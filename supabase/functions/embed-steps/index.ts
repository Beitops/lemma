import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "@supabase/supabase-js";

import {
  createEmbedStepsHandler,
  loadEmbedStepsEnvironment,
  type EmbeddingAdminClient,
  type EmbeddingSession,
} from "./handler.ts";

type SupabaseAiRuntime = {
  ai: {
    Session: new (model: string) => EmbeddingSession;
  };
};

declare const Supabase: SupabaseAiRuntime;

const environment = loadEmbedStepsEnvironment(Deno.env.toObject());
const admin = createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

// Kept at module scope so a warm Edge isolate reuses the model session.
const embeddingSession = new Supabase.ai.Session("gte-small");

const handler = createEmbedStepsHandler({
  admin: admin as unknown as EmbeddingAdminClient,
  environment,
  logError: (diagnostic) => console.error(diagnostic),
  session: embeddingSession,
});

Deno.serve(handler);
