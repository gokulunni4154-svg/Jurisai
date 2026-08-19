// src/modules/lawyer-inquiries/lawyer-directory.repository.ts
// FLAGGED: path assumes this lives alongside anonymous-analysis.repository.ts
// and lawyer-inquiry.repository.ts, both under modules/lawyer-inquiries/ per
// the progress log's own note that this directory name was "invented, not
// confirmed." Not independently re-verified here -- same inherited gap.
//
// Backs scoping doc §2 step 2: "Visitor browses a lawyer directory —
// verified lawyers only." This is a pre-auth, public read.
//
// FLAGGED, carried directly from this session's review of
// 20260803000002_create_professional_verifications_table.sql: that
// table's RLS only has select_own and select_admin policies -- there is
// no policy letting an anonymous or ordinary visitor read OTHER
// people's verification rows. So this repository, like
// AnonymousAnalysisRepository, MUST be constructed with the admin
// (service-role) client, not the RLS-respecting one every other
// directory-style read in this project presumably uses. This is a new
// instance of the same pattern already established in
// anonymous-analysis.factory.ts's doc comment, not a new invention.
//
// UPDATED THIS SESSION, against real pasted
// 20260711120000_create_profiles_table.sql: `profiles.full_name` is
// confirmed real, but `profiles.role` DOES NOT EXIST and never will --
// role lives only in `auth.users.app_metadata`, by explicit design (a
// user cannot self-escalate by editing a normal RLS-writable table).
// The previous `.eq('profiles.role', 'lawyer')` filter and the `role`
// field pulled out of the `profiles!inner(...)` embed have both been
// removed -- they were not just unconfirmed, they would fail outright
// against the real schema (no such column to select or filter on).
//
// RESOLVED THIS SESSION via new migration
// 20260810000000_add_role_to_professional_verifications.sql: a nullable
// `role` column mirroring auth.users.app_metadata.role was added directly
// to professional_verifications (decided, not a new table or a view --
// see that migration's own header for the full tradeoff). The filter
// below now uses THAT column, not profiles.role. FLAGGED, CARRIED FROM
// THE MIGRATION: this column is a deliberate denormalization, not the
// source of truth, and is NOT backfilled for pre-existing rows -- any
// verified-lawyer row created before that migration ran will have
// role IS NULL and will be silently excluded from this query until
// backfilled. Also still pending: the actual write of this column on
// new rows lives in ProfessionalVerificationService#submitVerification(),
// which has not been pasted this session -- this repository fix does
// nothing to populate the column going forward, only to filter on it.
//
// FLAGGED: no `firms` table row shape confirmed either -- so this file
// covers ONLY the "browse individual verified lawyers" half of step 2.
// "browse verified firms" is a separate, not-yet-scoped query this file
// deliberately does not attempt, rather than guessing a firms join with
// no source to check it against.

import type { SupabaseClient } from '@supabase/supabase-js';

// FLAGGED: hand-typed, not from generated Supabase types -- same
// caveat as every other row interface written this session.
interface VerifiedLawyerListingRow {
  profile_id: string;
  full_name: string; // CONFIRMED real column name (profiles.full_name).
  registration_number: string;
  verified_at: string | null; // FLAGGED: mapped from reviewed_at below;
                               // reviewed_at is set on any admin
                               // decision (verified OR rejected), not
                               // exclusively on verification -- since
                               // this query already filters
                               // status = 'verified', reviewed_at is
                               // safe to surface as "verified_at" here,
                               // but the column itself doesn't
                               // distinguish the two occasions in
                               // general.
}

const PROFESSIONAL_VERIFICATIONS_TABLE = 'professional_verifications';

// FLAGGED: hand-typed raw select-result shape, not from generated
// Supabase types -- same caveat as VerifiedLawyerListingRow above. Only
// used to replace an `any` on the .map() callback below with something
// that reflects the actual `.select()` columns; no behavior change.
interface VerifiedLawyerRawRow {
  profile_id: string;
  registration_number: string;
  reviewed_at: string | null;
  profiles: { full_name: string | null } | null;
}

/**
 * Thin Postgres access for the public "browse verified lawyers"
 * directory. Always constructed with the admin client -- see the file
 * header. Read-only; this repository has no write methods, unlike
 * AnonymousAnalysisRepository/LawyerInquiryRepository, since nothing in
 * step 2 of the flow involves a write.
 */
export class LawyerDirectoryRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Lists verified lawyers for the pre-auth directory.
   *
   * Filters on professional_verifications.role directly (the new mirror
   * column, migration 20260810000000) rather than any profiles column.
   * FLAGGED, CARRIED FROM THE MIGRATION: rows with role IS NULL (i.e.
   * verified before that migration ran, or written by a
   * ProfessionalVerificationService that hasn't yet been updated to
   * populate role on insert -- see file header) are silently excluded
   * by this filter, not surfaced as an error. That's the correct
   * behavior for a "lawyers only" listing (better to under-include than
   * to leak a non-lawyer into it), but it means this method's result
   * count may look artificially low until both gaps close.
   *
   * The `profiles!inner(full_name)` embed is unrelated to the role fix
   * above -- still used only to pull display name, unchanged from the
   * prior version of this file.
   */
  async listVerifiedLawyers(): Promise<VerifiedLawyerListingRow[]> {
    const { data, error } = await this.client
      .from(PROFESSIONAL_VERIFICATIONS_TABLE)
      .select(
        `
        profile_id,
        registration_number,
        reviewed_at,
        profiles!inner ( full_name )
      `
      )
      .eq('status', 'verified')
      .eq('role', 'lawyer');

    // FLAGGED: raw error thrown, matching the same
    // repository-layer-doesn't-wrap-in-AppError inconsistency already
    // visible in AnonymousAnalysisRepository and
    // LawyerInquiryRepository -- not re-decided here, kept consistent
    // with the existing (flagged) pattern rather than silently fixed
    // in just this one file.
    if (error) {
      throw error;
    }

    // FLAGGED: reshaping the embedded `profiles` object into a flat row
    // here is a guess at the right shape for a directory listing
    // response -- no frontend directory-page source was pasted this
    // session to confirm what shape it actually consumes.
    // Cast the raw result array (not the callback param) to the real
    // runtime shape: passing a plain string to `.select()` on an
    // untyped `SupabaseClient` makes supabase-js infer embedded
    // relations as arrays regardless of actual cardinality, which
    // doesn't match the `!inner` (to-one) embed's real runtime shape
    // used below -- same reasoning as FirmMemberRawRow's cast further
    // down this file.
    const rows = (data ?? []) as unknown as VerifiedLawyerRawRow[];

    return rows.map((row) => ({
      profile_id: row.profile_id,
      full_name: row.profiles?.full_name ?? '',
      registration_number: row.registration_number,
      verified_at: row.reviewed_at,
    }));
  }

  /**
   * NEW -- authenticated "contact a lawyer" flow. Lists every firm for
   * the picker's first step. Real, confirmed columns only (id, name) --
   * firm.repository.ts's own FirmRow type covers more, but this is a
   * public-facing listing read, so only what's actually needed to
   * display a pickable list is selected.
   *
   * FLAGGED, REAL SCOPING GAP, not solved here: unlike
   * listVerifiedLawyers() above, there is no verification concept for
   * FIRMS anywhere in this schema -- professional_verifications is 1:1
   * on individual profiles only, and signUpAsFirm()'s own doc comment
   * confirms no verification row is created for a firm signup. This
   * method therefore returns EVERY firm, unfiltered -- there is nothing
   * to filter on. Revisit if/when a firm-level verification concept is
   * ever built.
   *
   * Admin client, same reasoning as every other method in this file --
   * this is a public, pre-auth-safe read in principle (reused by the
   * authenticated flow too), and no confirmed `firms` SELECT policy for
   * an arbitrary caller was found in pasted source this session.
   */
  async listFirms(): Promise<FirmListingRow[]> {
    const { data, error } = await this.client
      .from('firms')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as FirmListingRow[];
  }

  /**
   * NEW -- authenticated "contact a lawyer" flow. Lists a single firm's
   * full member roster, for the picker's second step (drill into a
   * firm to pick a specific person, or stop at the firm level).
   *
   * Deliberately does NOT go through FirmMemberRepository
   * (findByFirmId()) even though that method already does almost
   * exactly this -- FirmMemberRepository is constructed with the
   * RLS-respecting client everywhere else in this project
   * (firm_members_select_same_firm only lets a caller read rows
   * sharing their OWN firm_id), which is wrong for this use case: the
   * client browsing this picker is, by definition, not yet a member of
   * the firm they're looking at. Same admin-client-bypass reasoning as
   * every other method in this file, just applied to a different table.
   *
   * FLAGGED, DELIBERATE NON-FILTERING, real judgment call: does NOT
   * filter to FirmRole 'lawyer'. signUpAsLawyer() (auth.service.ts,
   * confirmed real source) gives a solo practitioner FirmRole 'owner',
   * not 'lawyer' -- filtering this query to role = 'lawyer' would
   * silently exclude every solo lawyer in the directory, which is
   * almost certainly wrong for a "who can I contact at this firm"
   * picker. Returns the full roster with each member's role attached
   * instead, so the caller (frontend) can label each entry (e.g. "Jane
   * Doe -- Owner", "John Smith -- Lawyer") and let the person judge who
   * to contact, rather than this layer silently deciding for them.
   */
  async listFirmMembers(firmId: string): Promise<FirmMemberListingRow[]> {
    const { data, error } = await this.client
      .from('firm_members')
      .select(
        `
        profile_id,
        role,
        profiles!inner ( full_name )
      `
      )
      .eq('firm_id', firmId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    // Cast the raw result array (not the callback param) to the real
    // runtime shape -- see VerifiedLawyerRawRow's comment above for why
    // a direct callback param type doesn't structurally match what
    // supabase-js infers for a plain-string `.select()` on an untyped
    // client.
    const rows = (data ?? []) as unknown as FirmMemberRawRow[];

    return rows.map((row) => ({
      profile_id: row.profile_id,
      full_name: row.profiles?.full_name ?? '',
      role: row.role,
    }));
  }
}

/** NEW -- see listFirms() above. */
interface FirmListingRow {
  id: string;
  name: string;
}

/** NEW -- see listFirmMembers() above. */
interface FirmMemberListingRow {
  profile_id: string;
  full_name: string;
  role: string;
}

// FLAGGED: hand-typed raw select-result shape, not from generated
// Supabase types -- same caveat as FirmMemberListingRow above. Only
// used to replace an `any` on the .map() callback below with something
// that reflects the actual `.select()` columns; no behavior change.
interface FirmMemberRawRow {
  profile_id: string;
  role: string;
  profiles: { full_name: string | null } | null;
}
