import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdminUser } from "../../../shared/types";
import { apiRequest } from "../../lib/api";

export const profileQueryKeys = {
  me: ["profile", "me"] as const
};

export interface SyncUserProfileInput {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  emailVerified: boolean;
}

export function useSyncUserProfileMutation(adminUser: AdminUser | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profile: SyncUserProfileInput) =>
      apiRequest<{ id: string }>("/api/users/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile)
      }),
    onSuccess: (_data, profile) => {
      if (adminUser) {
        queryClient.setQueryData(profileQueryKeys.me, {
          ...adminUser,
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          imageUrl: profile.imageUrl
        });
      }
    }
  });
}
