import { supabase } from "./supabase.js";

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
  const profileFields = {
    email: profile.email,
    first_name: profile.firstName,
    last_name: profile.lastName,
    image_url: profile.imageUrl,
    email_verified: profile.emailVerified,
    last_seen_at: now,
    deleted_at: null
  };

  const { data: existingUser, error: lookupError } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", profile.clerkUserId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(lookupError.message);
  }

  if (existingUser?.id) {
    const { data, error } = await supabase
      .from("users")
      .update(profileFields)
      .eq("clerk_user_id", profile.clerkUserId)
      .select("id")
      .single();

    if (error) {
      throw new Error(error.message);
    }
    if (!data?.id) {
      throw new Error("Failed to update user.");
    }

    return String(data.id);
  }

  const { data, error } = await supabase
    .from("users")
    .insert({
      clerk_user_id: profile.clerkUserId,
      role: DEFAULT_USER_ROLE,
      ...profileFields
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }
  if (!data?.id) {
    throw new Error("Failed to upsert user.");
  }

  return String(data.id);
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
