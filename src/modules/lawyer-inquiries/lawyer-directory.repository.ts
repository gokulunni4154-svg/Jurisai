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
    return (data ?? []).map((row: any) => ({
      profile_id: row.profile_id,
      full_name: row.profiles?.full_name ?? '',
      registration_number: row.registration_number,
      verified_at: row.reviewed_at,
    }));
  }
}