type BrowserEnvironment = {
  VITE_API_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_URL?: string;
};

function nonEmptyEnvironmentValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export function resolveConfig(environment: BrowserEnvironment) {
  const supabaseUrl = nonEmptyEnvironmentValue(environment.VITE_SUPABASE_URL);
  const supabasePublishableKey = nonEmptyEnvironmentValue(environment.VITE_SUPABASE_PUBLISHABLE_KEY);

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Lemma is missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }

  const normalizedSupabaseUrl = withoutTrailingSlash(supabaseUrl);
  const apiUrl = nonEmptyEnvironmentValue(environment.VITE_API_URL);

  return {
    apiUrl: apiUrl
      ? withoutTrailingSlash(apiUrl)
      : `${normalizedSupabaseUrl}/functions/v1/lemma-api/api/v1`,
    supabasePublishableKey,
    supabaseUrl: normalizedSupabaseUrl,
  } as const;
}

export const config = resolveConfig({
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
});
