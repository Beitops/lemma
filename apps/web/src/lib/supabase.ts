import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

export const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
  },
});

/**
 * A short-lived, caller-scoped client for Storage operations. Supplying the
 * signal through the underlying fetch keeps ordinary uploads cancellable;
 * the long-running TUS path handles cancellation separately.
 */
export function createStorageClient(accessToken: string, signal?: AbortSignal) {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    accessToken: async () => accessToken,
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    ...(signal
      ? {
          global: {
            fetch: (input, init) => globalThis.fetch(input, { ...init, signal }),
          },
        }
      : {}),
  });
}
