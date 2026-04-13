# Lokituspisteiden instrumentointi

## Konteksti

Logger-infrastruktuuri on paikallaan (src/logger.ts), mutta lokituskutsuja ei ole vielä lisätty operaatioihin. Soft launchia varten tarvitaan näkyvyys siihen mitä kukin botti tekee: mitä muistoja tallennetaan, mitä auto-recall injektoi, miten konsolidaatio etenee — ilman koodimuutoksia.

## Periaatteet

- **info** = aina näkyvissä, operatiivinen pulssi (merkittävät tapahtumat)
- **debug** = vain verbose-tilassa, diagnostiikka ja rutiinipäätökset
- **warn** = jo olemassa olevat varoitukset + circuit breaker OPEN
- Ei yliloggata — turha kohina piilottaa tärkeän signaalin
- Query-teksti oletuksena piilotettu (vain queryLen) — `logQueries: true` config-asetuksella saa raaka-queryjen näkyvyyden debug-lokeihin
- Yhtenäinen `key=value` -muoto kaikissa lokeissa

## Muutettavat tiedostot (3 kpl)

### 1. src/memory-manager.ts

**store() — onnistunut tallennus** — **info** (DB-transaktion jälkeen, ennen appendStoreEvent):
```
memory stored: id=a1b2c3d4 type=fact contentLen=42 hasEmbedding=yes
```

**store() — duplikaatti** — **debug** (early return):
```
memory store skipped: id=a1b2c3d4 reason=duplicate
```

**store() — embedding epäonnistui** — **debug** (catch-lohkossa):
```
store: embedding unavailable reason=circuit-open
store: embedding unavailable reason=timeout
```

**search()** — **debug** (ennen return):
```
search: queryLen=142 results=3 mode=hybrid topScore=0.847
search: queryLen=142 query="What do you remember ab..." results=3 mode=hybrid topScore=0.847  (kun logQueries=true)
```

**search() — embedding epäonnistui** — **debug** (catch-lohkossa):
```
search: semantic unavailable reason=circuit-open, falling back to BM25
search: semantic unavailable reason=timeout, falling back to BM25
```

**recall()** — **debug** (ennen return):
```
recall: results=3 limit=3
```

**~~getMemory()~~** — EI LOKITETA (kutsutaan search()-silmukasta, monistuisi N kertaa per haku)

**broadRecall()** — **debug** (ennen return):
```
broadRecall: pool=80 selected=20 limit=50
```

### 2. src/context-engine.ts

**ContextEngineLogger-tyyppi** (rivi 276) — lisätään `info?`:
```typescript
export type ContextEngineLogger = {
  warn: (msg: string, meta?: unknown) => void;
  info?: (msg: string, meta?: unknown) => void;
  debug?: (msg: string, meta?: unknown) => void;
};
```

**assemble() cache hit** — **debug**:
```
assemble: cache=hit budget=high
```

**assemble() cache miss, muistoja injektoitiin** — **info**:
```
assemble: recalled=3 temporal=1 budget=high cache=miss
```

**assemble() cache miss, ei muistoja** — **debug**:
```
assemble: recalled=0 temporal=0 budget=high cache=miss
```

**assemble() ohitettu** — **debug**:
```
assemble: skipped reason=budget-none
```

**afterTurn()** (processAfterTurn-kutsun jälkeen) — **debug**:
```
afterTurn: autoInjected=3 searchResults=0 explicitlyOpened=1 storedThisTurn=0
```

### 3. src/index.ts

**Circuit breaker** (createWorkspace, onStateChange callback) — kaikki siirtymät:
- `→ OPEN` — **warn**: `Circuit breaker: CLOSED → OPEN — switching to BM25-only mode`
- `→ HALF_OPEN` — **info**: `Circuit breaker: OPEN → HALF_OPEN — probing recovery`
- `→ CLOSED` — **info**: `Circuit breaker: HALF_OPEN → CLOSED — recovered`
- `HALF_OPEN → OPEN` — **warn**: `Circuit breaker: HALF_OPEN → OPEN — probe failed`

**Konsolidaatio** (molemmat kutsupaikat) — **debug**:
```
consolidation: starting trigger=command
consolidation: completed trigger=command durationMs=234
```
(info-tason yhteenveto on jo olemassa)

## Ei muuteta

| Tiedosto | Syy |
|----------|-----|
| consolidation.ts, consolidation-steps.ts | Logitetaan kutsupaikasta (index.ts), ei tarvita logger-parametria |
| after-turn.ts | Logitetaan kutsupaikasta (context-engine.ts afterTurn) |
| migration-service.ts | Jo wired centralisoituun loggeriin |
| createMemoryTools() | MemoryManager logittaa jo — tool-taso olisi duplikaatti |
| retrieval-log.ts | Append-only tiedosto-operaatiot, matala virheriski |
| db.ts | Virheet heitetään kutsujalle |

## Verifiointi

1. `pnpm tsgo` — ei uusia type-virheitä
2. `pnpm vitest run` — olemassa olevat testit menevät läpi
3. Manuaalinen tarkistus: `FORMATIVE_MEMORY_DEBUG=1` näyttää debug-lokit, ilman sitä vain info+
