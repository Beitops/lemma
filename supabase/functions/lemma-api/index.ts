import { createLemmaApiHandler, loadLemmaApiEnvironment } from "./handler.ts";

type SupabaseAiRuntime = {
  ai: {
    Session: new (model: "gte-small") => {
      run(
        input: string,
        options: { mean_pool: true; normalize: true },
      ): Promise<unknown>;
    };
  };
};

declare const Supabase: SupabaseAiRuntime;

const embeddingSession = new Supabase.ai.Session("gte-small");

const handler = createLemmaApiHandler({
  embedText: (input) => embeddingSession.run(input, { mean_pool: true, normalize: true }),
  environment: loadLemmaApiEnvironment(Deno.env.toObject()),
  logError: (diagnostic) => console.error(diagnostic),
});

Deno.serve(handler);
