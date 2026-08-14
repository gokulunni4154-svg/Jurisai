// REAL FILE PATH: src/app/profile/page.tsx
//
// LAWYER TERMINAL — MY PROFILE. New page, this session, per the
// "next genuinely missing Lawyer Terminal workflow" audit brief.
//
// AUDIT FINDINGS (full writeup in the accompanying report):
//   - ProfileService/ProfileRepository/profile.schemas.ts (all real,
//     pasted this session) already fully implement getOwnProfile() and
//     updateOwnProfile() -- full_name, avatar_url, phone, each validated
//     server-side against the same CHECK constraints
//     20260711120000_create_profiles_table.sql enforces.
//   - GET/PATCH /api/profiles/me (real, pasted this session) already
//     wire that service up end-to-end and work today.
//   - Despite that, a full-repo search this session
//     (`find src/app -iname "*profile*"/"*settings*"/"*account*"`) found
//     ZERO frontend pages anywhere for a user to view or edit their own
//     profile -- only a firm-scoped Settings page
//     ((dashboard)/firm/[firmId]/settings), gated to firm owner/admin,
//     which is a different resource entirely (the firm's name and
//     roster, not this person's own name/phone/avatar). The shared
//     AppSidebar's own footer button is literally labeled "View
//     account" and, until this session, did nothing but toggle a
//     dropdown containing only "Sign out" -- a dead-end UI control
//     pointing at a page that never existed.
//   - This is a genuine, common, individual-scoped gap: every account
//     type (personal-org lawyer or firm-org lawyer) needs a way to see
//     and correct their own display name, contact number, and avatar.
//     It requires no Firm Terminal or General Portal functionality --
//     ProfileService's own authorization (requireOwnership) already
//     restricts every operation here to "self", by construction.
//
// GENUINE GAP THIS PAGE CLOSES: a real "My Profile" view + edit form,
// wired to the existing GET/PATCH /api/profiles/me routes. No new
// Service or Repository method was added. The ONE additive change on
// the backend side is documented in api/profiles/me/route.ts's own
// diff: GET now also merges in a few already-resolved, session-sourced
// fields (email, role, email_verified, last_sign_in_at) that live on
// AuthUser, not on the `profiles` table (which deliberately has no
// email column -- see ProfileRepository's own class-level comment) --
// no new Supabase call, no schema change, no new business logic.
//
// STYLING: matches the established Lawyer Terminal visual system --
// AppSidebar shell, semantic tokens (border-border, bg-card,
// text-muted-foreground, bg-primary, etc.), same header/loading/error
// markup conventions as tasks/mine/page.tsx and documents/page.tsx.
//
// DELIBERATELY NOT ADDED:
//   - No email or password change here. Email lives on auth.users, not
//     `profiles`; changing it is a distinct, security-sensitive auth
//     flow (would need its own confirmation/verification handling) that
//     no existing route in this repo implements. Shown read-only.
//   - No role change / account-type switch UI. `role` is sourced only
//     from auth.users.app_metadata by design (AuthUser's own doc
//     comment: never user-editable, to prevent self-escalation). Shown
//     read-only.
//   - No avatar file upload / image picker. avatar_url is validated
//     server-side as a plain URL string (profileAvatarUrlSchema) -- this
//     page accepts a URL the same way, rather than inventing a storage
//     upload flow no existing route in this repo supports.
//   - No "delete account" action -- no such route exists anywhere in
//     this repo; inventing one is out of scope for this task.

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  UserCircle2,
  Mail,
  ShieldCheck,
  Calendar,
  Clock,
  Building2,
  Bell,
  CheckCircle2,
} from 'lucide-react';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

interface MyProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  firm_id: string | null;
  created_at: string;
  updated_at: string;
  // Merged in by GET /api/profiles/me from the resolved session --
  // see this file's header and that route's own diff.
  email: string | null;
  role: string | null;
  email_verified: boolean;
  last_sign_in_at: string | null;
}

// Mirrors profile.schemas.ts's INDIAN_MOBILE_REGEX exactly (server is
// still the source of truth / final validator -- this is a client-side
// pre-check only, to give a field-specific error before a round trip,
// not a replacement for server validation).
const INDIAN_MOBILE_REGEX = /^(\+91[-\s]?)?[6-9]\d{9}$/;

const ROLE_LABELS: Record<string, string> = {
  individual: 'Individual',
  lawyer: 'Lawyer',
  law_firm: 'Law Firm',
  business: 'Business',
  admin: 'Admin',
  support: 'Support',
  client: 'Client',
};

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function initials(name: string | null): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state -- deliberately separate from `profile` so edits don't
  // mutate the loaded snapshot until a save actually succeeds.
  const [fullNameInput, setFullNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [avatarUrlInput, setAvatarUrlInput] = useState('');

  const [fieldErrors, setFieldErrors] = useState<{
    full_name?: string;
    phone?: string;
    avatar_url?: string;
  }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/profiles/me', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      const data: MyProfile = json.data;
      setProfile(data);
      setFullNameInput(data.full_name ?? '');
      setPhoneInput(data.phone ?? '');
      setAvatarUrlInput(data.avatar_url ?? '');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your profile.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Client-side pre-check only -- final validation always happens
  // server-side via updateProfileSchema.parse() (profile.schemas.ts).
  // Only fields that actually changed and are non-empty are checked;
  // an omitted/blank field is sent as `null` (cleared), which the
  // schema explicitly allows for every field here.
  function validate(): boolean {
    const errors: typeof fieldErrors = {};

    const trimmedName = fullNameInput.trim();
    if (trimmedName.length > 0 && trimmedName.length > 255) {
      errors.full_name = 'Full name cannot exceed 255 characters.';
    }

    const trimmedPhone = phoneInput.trim();
    if (trimmedPhone.length > 0 && !INDIAN_MOBILE_REGEX.test(trimmedPhone)) {
      errors.phone = 'Must be a valid Indian mobile number, e.g. 9847012345 or +919847012345.';
    }

    const trimmedAvatar = avatarUrlInput.trim();
    if (trimmedAvatar.length > 0) {
      try {
        new URL(trimmedAvatar);
      } catch {
        errors.avatar_url = 'Avatar must be a valid URL.';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);

    if (!validate()) return;
    if (!profile) return;

    // Only send fields that actually changed against the loaded
    // snapshot -- updateProfileSchema.refine() rejects an empty payload
    // outright, and an unchanged field shouldn't trigger a write. A
    // blank input for a field that previously had a value is sent as
    // `null` (clear), matching profile.schemas.ts's documented
    // omitted-vs-null distinction; an unchanged blank stays omitted.
    const payload: {
      full_name?: string | null;
      phone?: string | null;
      avatar_url?: string | null;
    } = {};

    const trimmedName = fullNameInput.trim();
    const currentName = profile.full_name ?? '';
    if (trimmedName !== currentName) {
      payload.full_name = trimmedName.length > 0 ? trimmedName : null;
    }

    const trimmedPhone = phoneInput.trim();
    const currentPhone = profile.phone ?? '';
    if (trimmedPhone !== currentPhone) {
      payload.phone = trimmedPhone.length > 0 ? trimmedPhone : null;
    }

    const trimmedAvatar = avatarUrlInput.trim();
    const currentAvatar = profile.avatar_url ?? '';
    if (trimmedAvatar !== currentAvatar) {
      payload.avatar_url = trimmedAvatar.length > 0 ? trimmedAvatar : null;
    }

    if (Object.keys(payload).length === 0) {
      setSaveSuccess(true);
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/profiles/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      // PATCH's response is the plain updated profile row -- it does
      // NOT carry email/role/email_verified/last_sign_in_at (those are
      // only merged in by GET, see route.ts's own diff). Preserve them
      // from the existing snapshot rather than dropping them.
      setProfile((prev) => (prev ? { ...prev, ...json.data } : prev));
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setIsSaving(false);
    }
  }

  const roleLabel = profile?.role ? (ROLE_LABELS[profile.role] ?? profile.role) : '—';

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="profile" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <UserCircle2 className="h-5 w-5 text-primary" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[19px] font-semibold leading-tight text-foreground">
                My Profile
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                Your personal account details, visible only to you.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsNotificationsPanelOpen((v) => !v)}
              className="relative flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <NotificationsPanel
          isOpen={isNotificationsPanelOpen}
          onClose={() => setIsNotificationsPanelOpen(false)}
          onUnreadCountChange={setUnreadCount}
        />

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading your profile…</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{loadError}</p>
              <button
                onClick={loadProfile}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : profile ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {/* Identity summary */}
              <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-6 py-5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-[18px] font-semibold text-primary">
                  {profile.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials(profile.full_name)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-foreground">
                    {profile.full_name ?? 'No name set'}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      {profile.email ?? 'Unknown'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {roleLabel}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" />
                      {profile.firm_id ? 'Firm workspace' : 'Personal workspace'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Edit form */}
              <form
                onSubmit={handleSave}
                className="flex flex-col gap-5 rounded-lg border border-border bg-card px-6 py-5"
              >
                <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                  Edit details
                </h2>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="full_name" className="text-[13px] font-medium text-foreground">
                    Full name
                  </label>
                  <input
                    id="full_name"
                    type="text"
                    value={fullNameInput}
                    onChange={(e) => setFullNameInput(e.target.value)}
                    maxLength={255}
                    placeholder="Your full name"
                    className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  {fieldErrors.full_name && (
                    <p className="text-[12px] text-destructive">{fieldErrors.full_name}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="phone" className="text-[13px] font-medium text-foreground">
                    Phone
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    maxLength={20}
                    placeholder="9847012345"
                    className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  {fieldErrors.phone ? (
                    <p className="text-[12px] text-destructive">{fieldErrors.phone}</p>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">
                      Indian mobile number, e.g. 9847012345 or +919847012345.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="avatar_url" className="text-[13px] font-medium text-foreground">
                    Avatar URL
                  </label>
                  <input
                    id="avatar_url"
                    type="text"
                    value={avatarUrlInput}
                    onChange={(e) => setAvatarUrlInput(e.target.value)}
                    placeholder="https://…"
                    className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  {fieldErrors.avatar_url && (
                    <p className="text-[12px] text-destructive">{fieldErrors.avatar_url}</p>
                  )}
                </div>

                {saveError && (
                  <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {saveError}
                  </div>
                )}
                {saveSuccess && !isSaving && (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[12.5px] text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Profile saved.
                  </div>
                )}

                <div>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isSaving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>

              {/* Account details (read-only) */}
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-6 py-5">
                <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                  Account details
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    Member since {formatDateTime(profile.created_at)}
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Last signed in {formatDateTime(profile.last_sign_in_at)}
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {profile.email_verified ? 'Email verified' : 'Email not verified'}
                  </div>
                </div>
                <p className="text-[12px] text-muted-foreground/80">
                  Email and account type can&apos;t be changed here.
                </p>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
