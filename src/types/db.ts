// Generated via `supabase gen types typescript --project-id lpgwxacoqiqpcfpkklib`
// Temporarily a placeholder until the schema migration is applied.
// Run the MCP tool `generate_typescript_types` after applying 0001_init.sql
// and replace this file wholesale.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
