// src/modules/lawyer-inquiries/lawyer-directory.service.ts
//
// Thin service layer over LawyerDirectoryRepository, backing scoping
// doc §2 step 2 (public, pre-auth "browse verified lawyers" listing).
//
// FLAGGED: unlike every other Service pasted/written this session
// (AnonymousAnalysisService takes a currentUser-less deps object;
// CaseService extends BaseService and takes `currentUser: AuthUser | null`
// as its first constructor arg), this service takes NO currentUser at
// all -- there is no authentication concept for this step of the flow
// (step 2 is explicitly pre-auth, before step 3's "this is the auth
// gate"). Not extending BaseService is a deliberate module-boundary
// choice, not an oversight: BaseService's own requireAuthentication()/
// requireOwnership()/requireFirmRole() all assume a currentUser exists
// to check against, which has no meaning here. If that assumption is
// wrong -- e.g. if BaseService has an anonymous-safe path never pasted
// this session -- this should be revisited.
//
// FLAGGED: no caching/pagination attempted. A public directory listing
// will eventually need pagination (and probably search/filter by
// practice area, location, etc.), but nothing in the scoping doc's §2
// step 2 language ("Visitor browses a lawyer directory") specifies
// those, and no frontend directory-page source was pasted this session
// to confirm what it actually needs. Kept to the simplest possible
// "return everything verified" shape rather than guessing pagination
// params that might not match what the frontend expects.

import type { LawyerDirectoryRepository } from './lawyer-directory.repository';

// FLAGGED: mirrors VerifiedLawyerListingRow's shape from the repository
// file rather than re-exporting it directly -- kept as a separate
// service-layer type on the same idiom other services in this project
// use (row types vs. DTO types), though no pasted source this session
// actually confirms that idiom is followed elsewhere; a reasonable
// default, not a discovered convention.
export interface VerifiedLawyerListing {
  profileId: string;
  fullName: string;
  registrationNumber: string;
  verifiedAt: string | null;
}

export class LawyerDirectoryService {
  constructor(private readonly deps: { repository: LawyerDirectoryRepository }) {}

  /**
   * Returns every currently-verified individual lawyer for the public
   * directory. No auth check -- see file header.
   *
   * FLAGGED: does not currently support filtering to verified FIRMS
   * (the other half of "specific verified lawyer or firm" in the
   * scoping doc's step 3) -- carried forward from the repository's own
   * flag, since no `firms` table source exists to build that query
   * against yet.
   */
  async listVerifiedLawyers(): Promise<VerifiedLawyerListing[]> {
    const rows = await this.deps.repository.listVerifiedLawyers();

    return rows.map((row) => ({
      profileId: row.profile_id,
      fullName: row.full_name,
      registrationNumber: row.registration_number,
      verifiedAt: row.verified_at,
    }));
  }
}