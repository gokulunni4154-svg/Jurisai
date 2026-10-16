import { describe, expect, it, vi } from "vitest";

import type { AuthUser, UserRole } from "@/core/auth/types";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
} from "@/core/errors/app-error";
import type { Database } from "@/core/supabase/database.types";

vi.mock("server-only", () => ({}));

import type { ProfessionalVerificationRepository } from "./professional-verification.repository";
import { ProfessionalVerificationService } from "./professional-verification.service";

type Row = Database["public"]["Tables"]["professional_verifications"]["Row"];

function user(role: UserRole, id = "user-1"): AuthUser {
  return {
    id,
    email: `${id}@example.com`,
    emailVerified: true,
    role,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSignInAt: null,
  };
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "ver-1",
    profile_id: "user-1",
    registration_number: "MH/1/2020",
    role: "lawyer",
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function build(currentUser: AuthUser | null, existing: Row | null = null) {
  const repository = {
    findByProfileId: vi.fn().mockResolvedValue(existing),
    findByIdOrThrow: vi.fn().mockResolvedValue(existing),
    create: vi.fn(async (input: Partial<Row>) => row(input)),
    update: vi.fn(async (_id: string, input: Partial<Row>) =>
      row({ ...existing, ...input }),
    ),
    findAllForAdminReview: vi.fn(),
  };
  const service = new ProfessionalVerificationService(
    currentUser,
    repository as unknown as ProfessionalVerificationRepository,
  );
  return { service, repository };
}

describe("ProfessionalVerificationService#submit", () => {
  it('stores role "lawyer" for a lawyer account (taken from the session)', async () => {
    const { service, repository } = build(user("lawyer"));

    await service.submit("MH/1/2020");

    expect(repository.create).toHaveBeenCalledWith({
      profile_id: "user-1",
      registration_number: "MH/1/2020",
      role: "lawyer",
      status: "pending",
    });
  });

  it.each(["individual", "law_firm", "business"] as const)(
    "still supports the %s role and stores it",
    async (role) => {
      const { service, repository } = build(user(role));

      await service.submit("REG-1");

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ role, status: "pending" }),
      );
    },
  );

  it.each(["admin", "support", "client"] as const)(
    "rejects the %s role before touching the DB",
    async (role) => {
      const { service, repository } = build(user(role));

      await expect(service.submit("REG-1")).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      expect(repository.findByProfileId).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    },
  );

  it("requires authentication", async () => {
    const { service } = build(null);
    await expect(service.submit("REG-1")).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("resubmits a rejected request in place, re-stamping role and clearing live review fields", async () => {
    const rejected = row({
      status: "rejected",
      role: null, // legacy row rejected before role was ever written
      reviewed_by: "admin-1",
      reviewed_at: "2026-02-01T00:00:00.000Z",
    });
    const { service, repository } = build(user("lawyer"), rejected);

    await service.submit("MH/2/2021");

    expect(repository.create).not.toHaveBeenCalled(); // no duplicate request
    expect(repository.update).toHaveBeenCalledWith("ver-1", {
      registration_number: "MH/2/2021",
      role: "lawyer",
      status: "resubmitted",
      reviewed_at: null,
      reviewed_by: null,
    });
  });

  it.each(["pending", "verified", "resubmitted"] as const)(
    "refuses to resubmit from %s (409) and writes nothing",
    async (status) => {
      const { service, repository } = build(user("lawyer"), row({ status }));

      await expect(service.submit("REG-2")).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    },
  );
});

describe("ProfessionalVerificationService#review", () => {
  it("lets an admin approve: status verified, reviewer + timestamp set, role untouched", async () => {
    const { service, repository } = build(user("admin", "admin-1"), row());

    const before = Date.now();
    await service.review("ver-1", "verified");

    expect(repository.update).toHaveBeenCalledTimes(1);
    const [id, patch] = repository.update.mock.calls[0] as [
      string,
      Partial<Row>,
    ];
    expect(id).toBe("ver-1");
    expect(patch.status).toBe("verified");
    expect(patch.reviewed_by).toBe("admin-1");
    expect(Date.parse(patch.reviewed_at as string)).toBeGreaterThanOrEqual(
      before,
    );
    expect(patch).not.toHaveProperty("role");
  });

  it("records the reviewer and timestamp on rejection too", async () => {
    const { service, repository } = build(
      user("admin", "admin-1"),
      row({ status: "resubmitted" }),
    );

    await service.review("ver-1", "rejected");

    expect(repository.update).toHaveBeenCalledWith(
      "ver-1",
      expect.objectContaining({
        status: "rejected",
        reviewed_by: "admin-1",
        reviewed_at: expect.any(String),
      }),
    );
  });

  it.each(["individual", "lawyer", "law_firm", "business", "client"] as const)(
    "forbids %s from approving or rejecting",
    async (role) => {
      const { service, repository } = build(user(role), row());

      await expect(service.review("ver-1", "verified")).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(service.review("ver-1", "rejected")).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      expect(repository.findByIdOrThrow).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    },
  );

  it("rejects an unauthenticated caller", async () => {
    const { service } = build(null, row());
    await expect(service.review("ver-1", "verified")).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("does not let an admin review their own request", async () => {
    const { service, repository } = build(
      user("admin", "user-1"),
      row({ profile_id: "user-1" }),
    );

    await expect(service.review("ver-1", "verified")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("refuses to approve a row whose role was never established", async () => {
    const { service, repository } = build(
      user("admin", "admin-1"),
      row({ role: null }),
    );

    await expect(service.review("ver-1", "verified")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("still lets an admin reject a row with no role (so the applicant can resubmit)", async () => {
    const { service, repository } = build(
      user("admin", "admin-1"),
      row({ role: null }),
    );

    await service.review("ver-1", "rejected");

    expect(repository.update).toHaveBeenCalledWith(
      "ver-1",
      expect.objectContaining({ status: "rejected" }),
    );
  });

  it.each(["verified", "rejected"] as const)(
    "does not re-decide an already %s row",
    async (status) => {
      const { service, repository } = build(
        user("admin", "admin-1"),
        row({ status }),
      );

      await expect(service.review("ver-1", "verified")).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
});
