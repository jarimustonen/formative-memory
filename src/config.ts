export type AssociativeMemoryConfig = {
  embedding: {
    /** Provider ID: "auto", "openai", "gemini", "voyage", "mistral", "ollama", "local". */
    provider: string;
    /** Optional model override. When omitted the provider's default model is used. */
    model?: string;
  };
  dbPath: string;
  autoCapture: boolean;
  autoRecall: boolean;
  verbose: boolean;
};

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) {
    return;
  }
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

export const memoryConfigSchema = {
  parse(value: unknown): AssociativeMemoryConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("memory config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, ["embedding", "dbPath", "autoCapture", "autoRecall", "verbose"], "memory config");

    let provider = "auto";
    let model: string | undefined;

    if (cfg.embedding != null) {
      if (typeof cfg.embedding !== "object" || Array.isArray(cfg.embedding)) {
        throw new Error("embedding must be an object");
      }
      const embedding = cfg.embedding as Record<string, unknown>;
      assertAllowedKeys(embedding, ["provider", "model"], "embedding config");

      if (typeof embedding.provider === "string") {
        provider = embedding.provider;
      }
      if (typeof embedding.model === "string") {
        model = embedding.model;
      }
    }

    return {
      embedding: { provider, model },
      dbPath: typeof cfg.dbPath === "string" ? cfg.dbPath : "~/.openclaw/memory/associative",
      autoCapture: cfg.autoCapture === true,
      autoRecall: cfg.autoRecall !== false,
      verbose: cfg.verbose === true,
    };
  },
};
