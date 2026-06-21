import { Webhook } from "svix";

import { softDeleteUserByClerkId, upsertUserProfile, type UserProfile } from "./users.js";

interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification: {
    status?: string;
  } | null;
}

interface ClerkUserEventData {
  id: string;
  primary_email_address_id: string | null;
  email_addresses: ClerkEmailAddress[];
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
}

interface ClerkDeletedUserEventData {
  id?: string;
}

type ClerkWebhookEvent =
  | { type: "user.created" | "user.updated"; data: ClerkUserEventData }
  | { type: "user.deleted"; data: ClerkDeletedUserEventData }
  | { type: string; data: unknown };

type WebhookHeaders = Record<string, string | string[] | undefined>;

function readHeader(headers: WebhookHeaders, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function toSvixHeaders(headers: WebhookHeaders): Record<string, string> {
  return {
    "svix-id": readHeader(headers, "svix-id"),
    "svix-timestamp": readHeader(headers, "svix-timestamp"),
    "svix-signature": readHeader(headers, "svix-signature")
  };
}

function profileFromEvent(data: ClerkUserEventData): UserProfile {
  const primaryEmail =
    data.email_addresses.find((email) => email.id === data.primary_email_address_id) ?? data.email_addresses[0];

  if (!primaryEmail?.email_address) {
    throw new Error("Clerk webhook user does not have an email address.");
  }

  return {
    clerkUserId: data.id,
    email: primaryEmail.email_address,
    firstName: data.first_name,
    lastName: data.last_name,
    imageUrl: data.image_url,
    emailVerified: primaryEmail.verification?.status === "verified"
  };
}

function isUserEvent(
  event: ClerkWebhookEvent
): event is Extract<ClerkWebhookEvent, { type: "user.created" | "user.updated" }> {
  return event.type === "user.created" || event.type === "user.updated";
}

function isDeletedUserEvent(event: ClerkWebhookEvent): event is Extract<ClerkWebhookEvent, { type: "user.deleted" }> {
  return event.type === "user.deleted";
}

export async function handleClerkWebhook(rawBody: string, headers: WebhookHeaders): Promise<void> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("CLERK_WEBHOOK_SECRET must be set.");
  }

  const event = new Webhook(secret).verify(rawBody, toSvixHeaders(headers)) as ClerkWebhookEvent;

  if (isUserEvent(event)) {
    await upsertUserProfile(profileFromEvent(event.data));
    return;
  }

  if (isDeletedUserEvent(event) && event.data.id) {
    await softDeleteUserByClerkId(event.data.id);
  }
}
