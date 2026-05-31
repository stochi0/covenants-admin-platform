import { createPublicKey, createVerify } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { supabase } from "./supabase.js";

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface ClerkSessionClaims {
  azp?: string;
  exp?: number;
  iss?: string;
  nbf?: number;
  sid?: string;
  sub?: string;
}

interface Jwk {
  kid?: string;
  kty?: string;
  [key: string]: unknown;
}

interface JwksResponse {
  keys?: Jwk[];
}

export interface AdminUser {
  id: string;
  clerkUserId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: "admin";
}

export interface AuthenticatedAdminRequest extends Request {
  admin?: AdminUser;
}

type HeaderMap = Headers | Record<string, string | string[] | undefined>;

let jwksCache: { issuer: string; keys: Jwk[]; expiresAt: number } | null = null;

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodeJson<T>(value: string): T {
  return JSON.parse(base64UrlDecode(value).toString("utf8")) as T;
}

function getHeader(headers: HeaderMap, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getExpectedIssuer(): string {
  const publishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error("VITE_CLERK_PUBLISHABLE_KEY must be set.");
  }

  const encoded = publishableKey.replace(/^pk_(test|live)_/, "");
  const decoded = base64UrlDecode(encoded).toString("utf8").replace(/\$$/, "");
  if (!decoded) {
    throw new Error("Invalid VITE_CLERK_PUBLISHABLE_KEY.");
  }

  return `https://${decoded}`;
}

function getAuthorizedParties(): string[] {
  return (process.env.AUTHORIZED_PARTIES ?? "")
    .split(",")
    .map((party) => party.trim())
    .filter(Boolean);
}

async function getJwks(issuer: string): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.issuer === issuer && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  const response = await fetch(`${issuer}/.well-known/jwks.json`);
  if (!response.ok) {
    throw new Error("Failed to fetch Clerk JWKS.");
  }

  const data = (await response.json()) as JwksResponse;
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache = { issuer, keys, expiresAt: now + 1000 * 60 * 10 };
  return keys;
}

async function verifyClerkToken(token: string): Promise<ClerkSessionClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid session token.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeJson<JwtHeader>(encodedHeader);
  const claims = decodeJson<ClerkSessionClaims>(encodedPayload);
  const issuer = getExpectedIssuer();

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid session token header.");
  }
  if (claims.iss !== issuer) {
    throw new Error("Invalid session token issuer.");
  }
  if (!claims.sub) {
    throw new Error("Session token is missing a user id.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp <= now) {
    throw new Error("Session token has expired.");
  }
  if (claims.nbf && claims.nbf > now + 60) {
    throw new Error("Session token is not active yet.");
  }

  const authorizedParties = getAuthorizedParties();
  if (authorizedParties.length > 0 && (!claims.azp || !authorizedParties.includes(claims.azp))) {
    throw new Error("Session token is not authorized for this app.");
  }

  const keys = await getJwks(issuer);
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    jwksCache = null;
    throw new Error("No matching Clerk JWKS key.");
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const isValid = verifier.verify(
    createPublicKey({ key: jwk, format: "jwk" }),
    base64UrlDecode(encodedSignature)
  );
  if (!isValid) {
    throw new Error("Invalid session token signature.");
  }

  return claims;
}

export async function authenticateAdmin(headers: HeaderMap): Promise<AdminUser> {
  const authorization = getHeader(headers, "authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  if (!token) {
    throw new Error("Missing authorization token.");
  }

  const claims = await verifyClerkToken(token);
  const { data, error } = await supabase
    .from("users")
    .select("id, clerk_user_id, email, first_name, last_name, role")
    .eq("clerk_user_id", claims.sub)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.role !== "admin") {
    const accessError = new Error("Admin access is required.");
    accessError.name = "ForbiddenError";
    throw accessError;
  }

  return {
    id: String(data.id),
    clerkUserId: String(data.clerk_user_id),
    email: typeof data.email === "string" ? data.email : null,
    firstName: typeof data.first_name === "string" ? data.first_name : null,
    lastName: typeof data.last_name === "string" ? data.last_name : null,
    role: "admin"
  };
}

export async function requireAdmin(req: AuthenticatedAdminRequest, res: Response, next: NextFunction) {
  try {
    req.admin = await authenticateAdmin(req.headers);
    next();
  } catch (error) {
    const status = error instanceof Error && error.name === "ForbiddenError" ? 403 : 401;
    res.status(status).json({
      error: status === 403 ? "Forbidden" : "Unauthorized",
      details: error instanceof Error ? error.message : "Authentication failed."
    });
  }
}
