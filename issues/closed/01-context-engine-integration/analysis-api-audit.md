# OpenClaw Context Engine API — Auditointi

> Phase 3.0 blokkerin ratkaisu. Päivämäärä: 2026-03-29.

## Yhteenveto

Context engine API on kypsä ja hyvin dokumentoitu. Memory-plugin (kind: "memory") voi rekisteröidä context enginen kutsumalla `api.registerContextEngine(id, factory)` register()-metodissa — manifest pysyy `kind: "memory"`.

## registerContextEngine()

```typescript
// OpenClawPluginApi-metodina:
registerContextEngine(id: string, factory: ContextEngineFactory): void;

// ContextEngineFactory:
type ContextEngineFactory = () => ContextEngine | Promise<ContextEngine>;

// Standalone-import (vaihtoehtoinen):
import { registerContextEngine } from "openclaw/plugin-sdk";
// Palauttaa: { ok: true } | { ok: false; existingOwner: string }
```

- Plugin-level API (`api.registerContextEngine()`) ei palauta tulosta, heittää virheen epäonnistuessa
- Standalone-funktio palauttaa `ContextEngineRegistrationResult`
- Ei voi claimata core-varattuja ID:itä (esim. "legacy")
- Vain yksi context engine per prosessi (exclusive slot)

## Lifecycle-metodit

### Pakolliset

| Metodi       | Kutsutiheys                   | Tarkoitus                             |
| ------------ | ----------------------------- | ------------------------------------- |
| `assemble()` | Joka prompt                   | Koosta viestit + systemPromptAddition |
| `ingest()`   | Per viesti (fallback)         | Syötä yksittäinen viesti              |
| `compact()`  | /compact, overflow, proactive | Tiivistä kontekstia                   |

### Valinnaiset

| Metodi          | Kutsutiheys                     | Tarkoitus              |
| --------------- | ------------------------------- | ---------------------- |
| `afterTurn()`   | Onnistuneen turnin jälkeen      | Post-turn logiikka     |
| `dispose()`     | Per-run + per-compact           | Resurssien vapautus    |
| `bootstrap()`   | Kerran per sessio               | Alustus                |
| `maintain()`    | Bootstrap/turn/compact jälkeen  | Transcript maintenance |
| `ingestBatch()` | Turnin jälkeen (jos toteutettu) | Batch-syöttö           |

### Signatuurit

```typescript
// assemble()
assemble(params: {
  sessionId: string;
  sessionKey?: string;
  messages: AgentMessage[];
  tokenBudget?: number;
  model?: string;
  prompt?: string;  // Käyttäjän syöte — hyödyllinen recall-haussa
}): Promise<AssembleResult>;

type AssembleResult = {
  messages: AgentMessage[];
  estimatedTokens: number;
  systemPromptAddition?: string;  // Prepend:atään system promptiin \n\n-erottimella
};

// ingest()
ingest(params: {
  sessionId: string;
  sessionKey?: string;
  message: AgentMessage;
  isHeartbeat?: boolean;
}): Promise<IngestResult>;

type IngestResult = { ingested: boolean };

// compact()
compact(params: {
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  tokenBudget?: number;
  force?: boolean;
  currentTokenCount?: number;
  compactionTarget?: "budget" | "threshold";
  customInstructions?: string;
  runtimeContext?: ContextEngineRuntimeContext;
}): Promise<CompactResult>;

type CompactResult = {
  ok: boolean;
  compacted: boolean;
  reason?: string;
  result?: { summary?: string; firstKeptEntryId?: string; tokensBefore: number; tokensAfter?: number; details?: unknown };
};

// afterTurn()
afterTurn?(params: {
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  messages: AgentMessage[];
  prePromptMessageCount: number;
  autoCompactionSummary?: string;
  isHeartbeat?: boolean;
  tokenBudget?: number;
  runtimeContext?: ContextEngineRuntimeContext;
}): Promise<void>;

// dispose()
dispose?(): Promise<void>;
```

## delegateCompactionToRuntime()

```typescript
import { delegateCompactionToRuntime } from "openclaw/plugin-sdk/core";
// TAI
import { delegateCompactionToRuntime } from "openclaw/plugin-sdk";

async function delegateCompactionToRuntime(
  params: Parameters<ContextEngine["compact"]>[0],
): Promise<CompactResult>;
```

Käytetään kun `ownsCompaction: false` — delegoi runtime:n sisäänrakennettuun kompaktioon.

## ownsCompaction-semantiikka

| Arvo                | Vaikutus                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `true`              | Pi:n auto-compaction pois päältä, engine hoitaa kaiken                                      |
| `false` / undefined | Pi:n auto-compaction toimii, engine:n compact() kutsutaan silti /compact:ssa ja overflowssa |

**V1-valinta: `ownsCompaction: false`** — delegoidaan runtimelle.

## session_id

- **Runtime-tarjoama** — tulee `params.sessionId`-parametrina kaikkiin lifecycle-metodeihin
- Ei tarvitse generoida itse
- Formaatti: string, voi alkaa `"probe-"` probe-sessioille

## turn_id

- **Ei eksplisiittistä turn_id:tä** API:ssa
- Turn-rajat tunnistetaan `prePromptMessageCount`-parametrista afterTurn():ssa
- Uudet viestit: `messages.slice(prePromptMessageCount)`
- Plugin voi generoida oman turn_id:n (esim. UUID tai session_id + timestamp)

## dispose()-semantiikka

- Kutsutaan **per-run** (run.ts finally-block) JA **per-compact** (compact.ts finally-block)
- EI prosessitason — jokainen run/compact saa oman engine-instanssin factorysta
- Resurssit jotka pitää siivota: DB-yhteydet, file handles
- Resurssit jotka **eivät resetoidu**: circuit breaker -tila (in-memory, factory-tason)

## Turn-rajat

1. **Turn alkaa** implisiittisesti kun `assemble()` kutsutaan
2. **Turn päättyy** eksplisiittisesti kun `afterTurn()` kutsutaan
3. `afterTurn()` kutsutaan VAIN onnistuneiden turnien jälkeen (ei virhe, ei abort)
4. Jos `afterTurn()` ei ole toteutettu → runtime kutsuu `ingestBatch()` tai `ingest()` fallbackina

## Memory + Context Engine -slottien claimaaminen

- Plugin manifest: `kind: "memory"` (ennallaan)
- Context engine rekisteröidään `api.registerContextEngine()`:lla register()-metodissa
- Slot-konfiguraatio OpenClaw:n asetuksissa:
  ```json
  {
    "plugins": {
      "slots": { "memory": "memory-associative", "contextEngine": "memory-associative" }
    }
  }
  ```
- `registerMemoryPromptSection()` vaatii `kind: "memory"` — säilyy toimivana

## ContextEngine.info

```typescript
type ContextEngineInfo = {
  id: string;
  name: string;
  version?: string;
  ownsCompaction?: boolean;
};
```

## Importit pluginille

```typescript
// Tyypit
import type {
  ContextEngine,
  AssembleResult,
  CompactResult,
  IngestResult,
} from "openclaw/plugin-sdk";
// TAI suoraan:
import type { ContextEngine } from "../context-engine/types.js"; // ei suositella

// Funktiot
import { delegateCompactionToRuntime } from "openclaw/plugin-sdk/core";
```

## Päätökset V1-toteutukseen

1. `ownsCompaction: false` — delegoidaan runtimelle
2. `ingest()` — no-op (return `{ ingested: false }`), koska emme tarvitse per-viesti ingestionia
3. `afterTurn()` — toteutetaan Phase 3.7:ssä (provenance, retrieval log)
4. `dispose()` — sulkee DB-yhteydet, resetoi transcript cache + ledger (ei circuit breakeria)
5. `bootstrap()` — ei toteuteta V1:ssä
6. `maintain()` — ei toteuteta V1:ssä
7. Turn ID generoidaan itse: `${sessionId}:${Date.now()}`
8. `before_prompt_build` hook säilyy kunnes assemble()-injektointi valmis (3.2)
