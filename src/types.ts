export type TemporalState = "future" | "present" | "past" | "none";

export type MemorySource = "agent_tool" | "hook_capture" | "consolidation" | "import";

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
