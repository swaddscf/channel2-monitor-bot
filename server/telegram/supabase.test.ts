import { describe, expect, it, beforeEach } from "vitest";
import { isValidSupabaseUrl, isSupabaseConfigured } from "./supabase";

const VALID = "postgresql://postgres.abc:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";

describe("Supabase connection string validation", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_DATABASE_URL;
  });

  it("accepts a normal Supabase pooler URL", () => {
    expect(isValidSupabaseUrl(VALID)).toBe(true);
  });

  it("accepts a direct connection string", () => {
    expect(isValidSupabaseUrl("postgresql://postgres.abc:secret@db.abc.supabase.co:5432/postgres")).toBe(true);
  });

  it("accepts a url whose password section is URL-safe", () => {
    expect(isValidSupabaseUrl("postgresql://postgres.abc:pa%40ss@db.abc.supabase.co:5432/postgres")).toBe(true);
  });

  it("rejects a URL whose password contains a raw #", () => {
    expect(isValidSupabaseUrl("postgresql://postgres.abc:p#ss@db.abc.supabase.co:5432/postgres")).toBe(false);
  });

  it("rejects a URL whose host list contains a comma", () => {
    expect(isValidSupabaseUrl("postgresql://postgres.abc:secret@db.abc.supabase.co:5432,db2.supabase.co:6543/postgres")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidSupabaseUrl("   ")).toBe(false);
  });

  it("rejects a non-postgres scheme", () => {
    expect(isValidSupabaseUrl("http://example.com/x")).toBe(false);
  });

  it("is not configured when env var is missing", () => {
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is not configured when env var is invalid and falls back to JSON mode", () => {
    process.env.SUPABASE_DATABASE_URL = "postgresql://postgres.abc:p#ss@db.abc.supabase.co:5432/postgres";
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is configured when env var is valid", () => {
    process.env.SUPABASE_DATABASE_URL = VALID;
    expect(isSupabaseConfigured()).toBe(true);
  });
});