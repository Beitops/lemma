import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("derives the Lemma Edge API URL when VITE_API_URL is omitted", () => {
    expect(resolveConfig({
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      VITE_SUPABASE_URL: "https://project-ref.supabase.co/",
    })).toEqual({
      apiUrl: "https://project-ref.supabase.co/functions/v1/lemma-api/api/v1",
      supabasePublishableKey: "sb_publishable_test",
      supabaseUrl: "https://project-ref.supabase.co",
    });
  });

  it("honours a non-empty API URL override", () => {
    expect(resolveConfig({
      VITE_API_URL: "https://api.lemma.example/api/v1/",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      VITE_SUPABASE_URL: "https://project-ref.supabase.co",
    }).apiUrl).toBe("https://api.lemma.example/api/v1");
  });

  it("treats a blank override as absent", () => {
    expect(resolveConfig({
      VITE_API_URL: "   ",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      VITE_SUPABASE_URL: "https://project-ref.supabase.co",
    }).apiUrl).toBe("https://project-ref.supabase.co/functions/v1/lemma-api/api/v1");
  });

  it("requires browser-safe Supabase configuration only", () => {
    expect(() => resolveConfig({
      VITE_SUPABASE_URL: "https://project-ref.supabase.co",
    })).toThrow(/VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY/u);
  });
});
