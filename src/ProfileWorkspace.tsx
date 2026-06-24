import { useUser } from "@clerk/react";
import { Camera, CheckCircle2, LogOut, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { AdminUser } from "../shared/types";
import { useSyncUserProfileMutation } from "./features/profile/hooks";
import { getClerkErrorMessage } from "./lib/errors";
import { StatusBanner } from "./components/StatusBanner";

interface ProfileWorkspaceProps {
  adminUser?: AdminUser | null;
  onAdminUserChange: (user: AdminUser) => void;
}

type AvatarChange =
  | { type: "keep" }
  | { type: "remove" }
  | { type: "replace"; file: File; previewUrl: string };

export default function ProfileWorkspace({ adminUser, onAdminUserChange }: ProfileWorkspaceProps) {
  const { isLoaded, user } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState(adminUser?.firstName ?? "");
  const [lastName, setLastName] = useState(adminUser?.lastName ?? "");
  const [avatarChange, setAvatarChange] = useState<AvatarChange>({ type: "keep" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const syncProfile = useSyncUserProfileMutation(adminUser);

  useEffect(() => {
    setFirstName(adminUser?.firstName ?? "");
    setLastName(adminUser?.lastName ?? "");
  }, [adminUser?.firstName, adminUser?.lastName]);

  useEffect(
    () => () => {
      if (avatarChange.type === "replace") {
        URL.revokeObjectURL(avatarChange.previewUrl);
      }
    },
    [avatarChange]
  );

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPEG, GIF, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Profile images must be 5 MB or smaller.");
      return;
    }

    setAvatarChange((current) => {
      if (current.type === "replace") URL.revokeObjectURL(current.previewUrl);
      return { type: "replace", file, previewUrl: URL.createObjectURL(file) };
    });
    setError("");
    setNotice("");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !user || !adminUser) return;

    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    if (!cleanFirstName && !cleanLastName) {
      setError("Enter at least a first or last name.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await user.update({
        firstName: cleanFirstName || null,
        lastName: cleanLastName || null
      });

      if (avatarChange.type === "replace") {
        await user.setProfileImage({ file: avatarChange.file });
      } else if (avatarChange.type === "remove") {
        await user.setProfileImage({ file: null });
      }

      await user.reload();
      const syncedProfile = {
        email: user.primaryEmailAddress?.emailAddress ?? adminUser.email,
        firstName: user.firstName,
        lastName: user.lastName,
        imageUrl: user.hasImage ? user.imageUrl : null,
        emailVerified: user.primaryEmailAddress?.verification?.status === "verified"
      };
      await syncProfile.mutateAsync(syncedProfile);

      onAdminUserChange({
        ...adminUser,
        email: syncedProfile.email,
        firstName: syncedProfile.firstName,
        lastName: syncedProfile.lastName,
        imageUrl: syncedProfile.imageUrl
      });
      setAvatarChange({ type: "keep" });
      setNotice("Profile updated successfully.");
    } catch (caughtError) {
      setError(getClerkErrorMessage(caughtError, "Unable to update your profile."));
    } finally {
      setBusy(false);
    }
  }

  const avatarUrl =
    avatarChange.type === "replace"
      ? avatarChange.previewUrl
      : avatarChange.type === "remove"
        ? null
        : user
          ? user.hasImage
            ? user.imageUrl
            : null
          : adminUser?.imageUrl;

  return (
    <div className="profile-page">
      <header className="profile-hero">
        <div className="profile-hero-icon">
          <UserRound size={22} />
        </div>
        <div>
          <p className="eyebrow">Account</p>
          <h2>Your profile</h2>
          <p>Manage how your administrator identity appears across Covenants.</p>
        </div>
      </header>

      <form className="profile-card" onSubmit={saveProfile}>
        <div className="profile-card-heading">
          <div>
            <h3>Profile details</h3>
            <p>Update your name and profile image.</p>
          </div>
          <span className="profile-role-badge">
            <ShieldCheck size={14} /> Administrator
          </span>
        </div>

        <div className="profile-content">
          <section className="profile-avatar-section" aria-label="Profile image">
            <div className="profile-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" />
              ) : (
                <span>{getInitials(firstName, lastName, adminUser?.email)}</span>
              )}
            </div>
            <div className="profile-avatar-actions">
              <strong>Profile image</strong>
              <p>PNG, JPEG, GIF, or WebP. Maximum 5 MB.</p>
              <div>
                <button
                  className="ghost-button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <Camera size={15} /> {avatarUrl ? "Replace" : "Upload"}
                </button>
                {avatarUrl ? (
                  <button
                    className="profile-remove-button"
                    disabled={busy}
                    onClick={() => setAvatarChange({ type: "remove" })}
                    type="button"
                  >
                    <Trash2 size={15} /> Remove
                  </button>
                ) : null}
              </div>
              <input
                ref={fileInputRef}
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                onChange={chooseAvatar}
                type="file"
              />
            </div>
          </section>

          <div className="profile-form-grid">
            <label className="profile-field">
              <span>First name</span>
              <input
                autoComplete="given-name"
                disabled={busy}
                onChange={(event) => setFirstName(event.target.value)}
                value={firstName}
              />
            </label>
            <label className="profile-field">
              <span>Last name</span>
              <input
                autoComplete="family-name"
                disabled={busy}
                onChange={(event) => setLastName(event.target.value)}
                value={lastName}
              />
            </label>
            <label className="profile-field profile-field-wide">
              <span>Email address</span>
              <input disabled readOnly value={adminUser?.email ?? ""} />
              <small>Email changes are managed by your account administrator.</small>
            </label>
          </div>
        </div>

        <StatusBanner variant="error">{error}</StatusBanner>
        <StatusBanner variant="success">
          {notice ? (
            <>
              <CheckCircle2 size={16} /> {notice}
            </>
          ) : null}
        </StatusBanner>

        <div className="profile-card-actions">
          <button className="primary-button" disabled={busy || !isLoaded} type="submit">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <section className="profile-card profile-signout-card">
        <div>
          <h3>Sign out</h3>
          <p>End your current administrator session on this device.</p>
        </div>
        <button
          className="profile-signout-button"
          onClick={() => void window.Clerk?.signOut?.()}
          type="button"
        >
          <LogOut size={16} /> Sign out
        </button>
      </section>
    </div>
  );
}

function getInitials(firstName: string, lastName: string, email?: string | null) {
  return (
    [firstName, lastName]
      .filter(Boolean)
      .map((value) => value.trim().slice(0, 1).toUpperCase())
      .join("") ||
    email?.slice(0, 1).toUpperCase() ||
    "A"
  );
}
