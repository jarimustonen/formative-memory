// -- Enum definitions (single source of truth) --

export const TEMPORAL_STATES = ["future", "present", "past", "none"] as const;
export type TemporalState = (typeof TEMPORAL_STATES)[number];

export const MEMORY_SOURCES = ["agent_tool", "hook_capture", "consolidation", "import"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const EXPOSURE_MODES = ["auto_injected", "tool_search_returned", "tool_get", "tool_store"] as const;
export type ExposureMode = (typeof EXPOSURE_MODES)[number];

export const ATTRIBUTION_EVIDENCE = [
  "auto_injected",
  "tool_search_returned",
  "tool_get",
  "agent_feedback_neutral",
  "agent_feedback_positive",
  "agent_feedback_negative",
] as const;
export type AttributionEvidence = (typeof ATTRIBUTION_EVIDENCE)[number];

export const RETRIEVAL_MODES = ["hybrid", "bm25_only"] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

// -- Enum guards (factory + instances) --

function makeEnumGuard<const T extends readonly string[]>(values: T, label: string) {
  const set = new Set<string>(values);
  return {
    is: (v: unknown): v is T[number] => typeof v === "string" && set.has(v),
    assert(v: unknown): asserts v is T[number] {
      if (typeof v !== "string" || !set.has(v)) {
        throw new Error(`Invalid ${label}: ${String(v)}`);
      }
    },
  };
}

export const TemporalStateGuard = makeEnumGuard(TEMPORAL_STATES, "temporal_state");
export const MemorySourceGuard = makeEnumGuard(MEMORY_SOURCES, "source");
export const ExposureModeGuard = makeEnumGuard(EXPOSURE_MODES, "exposure mode");
export const AttributionEvidenceGuard = makeEnumGuard(ATTRIBUTION_EVIDENCE, "attribution evidence");
export const RetrievalModeGuard = makeEnumGuard(RETRIEVAL_MODES, "retrieval_mode");

// -- Domain types --

export type Memory = {
  id: string;
  content: string;
  type: string;
  temporal_state: TemporalState;
  temporal_anchor: string | null;
  created_at: string;
  strength: number;
  source: MemorySource;
  consolidated: boolean;
  embedding: number[] | null;
};

export type Association = {
  memory_a: string;
  memory_b: string;
  weight: number;
  created_at: string;
  last_updated_at: string | null;
};

export type RetrievalEventType = "search" | "recall" | "feedback" | "store";

export type RetrievalLogEntry = {
  timestamp: string;
  event: RetrievalEventType;
  ids: string[];
  ratings?: Record<string, number>;
  comment?: string;
  context_ids?: string[];
};

// -- Timestamp validation (for import/raw paths) --

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Validate that a string is UTC ISO-8601 (YYYY-MM-DDTHH:mm:ss[.sss]Z).
 * Checks both format (regex) and calendar validity (Date.parse).
 */
export function assertIsoUtcTimestamp(v: unknown, label: string): asserts v is string {
  if (typeof v !== "string" || !ISO_UTC_RE.test(v)) {
    throw new Error(`Invalid ${label}: expected ISO-8601 UTC timestamp, got ${String(v)}`);
  }
  if (!Number.isFinite(Date.parse(v))) {
    throw new Error(`Invalid ${label}: unparseable calendar date ${v}`);
  }
}
