export type ConsolidationNotificationLevel = "off" | "summary" | "detailed";

export type AssociativeMemoryConfig = {
  embedding: {
    /** Provider ID: "auto", "openai", "gemini", "voyage", "mistral", "ollama", "local". */
    provider: string;
    /** Optional model override. When omitted the provider's default model is used. */
    model?: string;
  };
  consolidation: {
    /** Notification level after consolidation runs. Default: "summary". */
    notification: ConsolidationNotificationLevel;
  };
  temporal: {
    /** Notification level after temporal transitions run. Default: "summary". */
    notification: ConsolidationNotificationLevel;
  };
  dbPath: string;
  autoCapture: boolean;
  autoRecall: boolean;
  verbose: boolean;
  logQueries: boolean;
  requireEmbedding: boolean;
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
    assertAllowedKeys(cfg, ["embedding", "consolidation", "temporal", "dbPath", "autoCapture", "autoRecall", "verbose", "logQueries", "requireEmbedding"], "memory config");

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

    let consolidationNotification: ConsolidationNotificationLevel = "summary";
    if (cfg.consolidation != null) {
      if (typeof cfg.consolidation !== "object" || Array.isArray(cfg.consolidation)) {
        throw new Error("consolidation must be an object");
      }
      const consolidation = cfg.consolidation as Record<string, unknown>;
      assertAllowedKeys(consolidation, ["notification"], "consolidation config");
      if (typeof consolidation.notification === "string") {
        const valid: ConsolidationNotificationLevel[] = ["off", "summary", "detailed"];
        if (!valid.includes(consolidation.notification as ConsolidationNotificationLevel)) {
          throw new Error(`consolidation.notification must be one of: ${valid.join(", ")}`);
        }
        consolidationNotification = consolidation.notification as ConsolidationNotificationLevel;
      }
    }

    let temporalNotification: ConsolidationNotificationLevel = "summary";
    if (cfg.temporal != null) {
      if (typeof cfg.temporal !== "object" || Array.isArray(cfg.temporal)) {
        throw new Error("temporal must be an object");
      }
      const temporal = cfg.temporal as Record<string, unknown>;
      assertAllowedKeys(temporal, ["notification"], "temporal config");
      if (typeof temporal.notification === "string") {
        const valid: ConsolidationNotificationLevel[] = ["off", "summary", "detailed"];
        if (!valid.includes(temporal.notification as ConsolidationNotificationLevel)) {
          throw new Error(`temporal.notification must be one of: ${valid.join(", ")}`);
        }
        temporalNotification = temporal.notification as ConsolidationNotificationLevel;
      }
    }

    return {
      embedding: { provider, model },
      consolidation: { notification: consolidationNotification },
      temporal: { notification: temporalNotification },
      dbPath: typeof cfg.dbPath === "string" ? cfg.dbPath : "~/.openclaw/memory/associative",
      autoCapture: cfg.autoCapture !== false,
      autoRecall: cfg.autoRecall !== false,
      verbose: cfg.verbose === true,
      logQueries: cfg.logQueries === true,
      requireEmbedding: cfg.requireEmbedding !== false,
    };
  },
};
