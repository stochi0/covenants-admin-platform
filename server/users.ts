import { getPool, supabase } from "./supabase.js";

export interface UserProfile {
  clerkUserId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  emailVerified: boolean;
}

const DEFAULT_USER_ROLE = "viewer";

export async function upsertUserProfile(profile: UserProfile): Promise<string> {
  const now = new Date().toISOString();
  const result = await getPool().query<{ id: string }>(
    `insert into public.users (
       clerk_user_id, email, role, first_name, last_name, image_url,
       email_verified, last_seen_at, deleted_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,null)
     on conflict (clerk_user_id) do update set
       email = excluded.email,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       image_url = excluded.image_url,
       email_verified = excluded.email_verified,
       last_seen_at = excluded.last_seen_at,
       deleted_at = null
     returning id`,
    [
      profile.clerkUserId,
      profile.email,
      DEFAULT_USER_ROLE,
      profile.firstName,
      profile.lastName,
      profile.imageUrl,
      profile.emailVerified,
      now
    ]
  );

  if (!result.rows[0]?.id) {
    throw new Error("Failed to upsert user.");
  }

  return String(result.rows[0].id);
}

export async function softDeleteUserByClerkId(clerkUserId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ deleted_at: new Date().toISOString() })
    .eq("clerk_user_id", clerkUserId);

  if (error) {
    throw new Error(error.message);
  }
}
