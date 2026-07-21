-- ============================================================================
-- Multi-document module -- initial schema.
--
-- Creates public.document_sets (a named grouping of documents, owned by a
-- single user -- same ownership model as public.documents) and
-- public.document_set_members (the many-to-many join between
-- document_sets and documents).
--
-- FLAGGED: this is the first many-to-many join table in this project.
-- There is no existing migration to match for document_set_members' own
-- RLS shape -- it's designed fresh below, following the same
-- ownership-check pattern public.documents already uses (owner_id =
-- auth.uid()), applied via an EXISTS subquery back to document_sets
-- rather than duplicating an owner_id column onto the join table itself.
-- Revisit if this turns out to be the wrong shape once real query
-- patterns exist.
--
-- FLAGGED ASSUMPTION: document_sets has no soft-delete column
-- (deleted_at), unlike public.documents. Nothing in the confirmed scope
-- (bulk upload + bulk analysis + a saved grouping) called for a
-- trash/recycle-bin view of sets themselves -- a hard DELETE removes the
-- set (and, via ON DELETE CASCADE, its membership rows) without touching
-- the underlying documents. Revisit together if a "restore a deleted set"
-- requirement surfaces.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- document_sets
-- ----------------------------------------------------------------------------

create table public.document_sets (
  id uuid primary key default gen_random_uuid(),

  -- Same ownership model as public.documents: a plain FK to auth.users,
  -- not profiles -- consistent with that table's own note that role/
  -- identity data lives in auth.users, not duplicated onto every owned
  -- table's FK target.
  owner_id uuid not null references auth.users (id) on delete cascade,

  name text not null check (char_length(name) between 1 and 255),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.document_sets is
  'A named, owned grouping of documents for cross-document (multi-document) analysis. Membership tracked in public.document_set_members.';

create index document_sets_owner_id_idx on public.document_sets (owner_id);

alter table public.document_sets enable row level security;

-- Naming convention follows File 25's amendment (per-table trigger
-- function names, not a generic shared one) -- same as
-- set_documents_updated_at.
create or replace function public.set_document_sets_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger document_sets_set_updated_at
  before update on public.document_sets
  for each row
  execute function public.set_document_sets_updated_at();

create policy "document_sets_select_own"
  on public.document_sets for select
  to authenticated
  using (owner_id = auth.uid());

create policy "document_sets_insert_own"
  on public.document_sets for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "document_sets_update_own"
  on public.document_sets for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "document_sets_delete_own"
  on public.document_sets for delete
  to authenticated
  using (owner_id = auth.uid());

create policy "document_sets_select_admin"
  on public.document_sets for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ----------------------------------------------------------------------------
-- document_set_members (join table)
-- ----------------------------------------------------------------------------

create table public.document_set_members (
  document_set_id uuid not null references public.document_sets (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,

  added_at timestamptz not null default now(),

  primary key (document_set_id, document_id)
);

comment on table public.document_set_members is
  'Many-to-many membership between document_sets and documents. No owner_id of its own -- ownership is enforced via document_set_id joining back to document_sets.owner_id, not duplicated onto this table.';

-- Composite PK above already indexes document_set_id as its leading
-- column, so the common "all members of this set" query is covered. A
-- separate index on document_id is added for the reverse lookup ("which
-- sets is this document in") -- a real, expected query given
-- documents-detail pages will likely want to show set membership.
create index document_set_members_document_id_idx
  on public.document_set_members (document_id);

alter table public.document_set_members enable row level security;

-- No INSERT/UPDATE/DELETE-specific ownership duplication needed here --
-- unlike public.documents (which has its own owner_id column), every
-- policy below reaches back to document_sets.owner_id via EXISTS. A
-- document_set the caller doesn't own is invisible via
-- document_sets_select_own regardless, so this is defense-in-depth
-- consistent with the rest of this project's RLS-first posture, not the
-- only thing standing between a caller and another owner's set.
--
-- Deliberately NOT also checking that documents.owner_id = auth.uid()
-- for the member document itself. The service layer (future
-- DocumentSetService) is expected to enforce that a document being added
-- to a set is owned by the same caller who owns the set -- this policy
-- only enforces "you can only manage membership rows for sets you own",
-- matching the single-ownership-check pattern the rest of this schema
-- uses (one EXISTS hop, not two). Flagged, not silently assumed
-- sufficient on its own -- revisit if cross-owner set membership is ever
-- found to be reachable through some path that skips the service layer.

create policy "document_set_members_select_own"
  on public.document_set_members for select
  to authenticated
  using (
    exists (
      select 1
      from public.document_sets ds
      where ds.id = document_set_members.document_set_id
        and ds.owner_id = auth.uid()
    )
  );

create policy "document_set_members_insert_own"
  on public.document_set_members for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.document_sets ds
      where ds.id = document_set_members.document_set_id
        and ds.owner_id = auth.uid()
    )
  );

create policy "document_set_members_delete_own"
  on public.document_set_members for delete
  to authenticated
  using (
    exists (
      select 1
      from public.document_sets ds
      where ds.id = document_set_members.document_set_id
        and ds.owner_id = auth.uid()
    )
  );

-- No UPDATE policy: membership rows have no mutable fields other than
-- added_at (which should never change after insert) -- add/remove is
-- modeled as insert/delete, matching a plain join table's usual shape.
-- No update policy exists to accidentally allow silently.

create policy "document_set_members_select_admin"
  on public.document_set_members for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');