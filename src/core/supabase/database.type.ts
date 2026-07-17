/**
 * Auto-generated Supabase database types.
 *
 * DO NOT HAND-EDIT THIS FILE.
 *
 * This is a generated artifact, checked into source control so that CI and
 * teammates can typecheck the codebase without a live database connection.
 * It currently reflects the database's true current state: zero migrations
 * have been applied, so there are zero tables, views, functions, enums, and
 * composite types.
 *
 * Regenerate after every migration with:
 *
 *   supabase gen types typescript --local > src/core/supabase/database.types.ts
 *
 * (or `--project-id <ref>` when generating against a remote project instead
 * of the local dev stack).
 *
 * Every Supabase client in this codebase (browser, server, middleware,
 * admin) is generic over `Database`, so adding a table and regenerating
 * this file immediately produces compile-time-checked `.from('table')`
 * calls everywhere that client is used — no other file needs to change.
 */

/**
 * Recursive JSON type matching how Postgres `jsonb` columns are represented
 * once decoded. Defined here (rather than duplicated per-module) because it
 * is structurally part of the generated database type surface — the
 * Supabase CLI emits this same shape for every `jsonb` column it encounters.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      [key: string]: never;
    };
    Views: {
      [key: string]: never;
    };
    Functions: {
      [key: string]: never;
    };
    Enums: {
      [key: string]: never;
    };
    CompositeTypes: {
      [key: string]: never;
    };
  };
}