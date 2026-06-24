type TokenGetter = () => Promise<string | null | undefined>;

declare global {
  interface Window {
    Clerk?: {
      session?: {
        getToken: () => Promise<string | null>;
      };
      signOut?: () => Promise<void>;
    };
  }
}

let tokenGetter: TokenGetter | null = null;

export function setApiTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
}

export async function getAuthToken() {
  const token = tokenGetter ? await tokenGetter() : await window.Clerk?.session?.getToken();
  if (!token) {
    throw new Error("You must be signed in to continue.");
  }

  return token;
}

export async function apiRequest<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${await getAuthToken()}`);

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(data?.error ?? "Request failed.");
  }

  return data as T;
}
