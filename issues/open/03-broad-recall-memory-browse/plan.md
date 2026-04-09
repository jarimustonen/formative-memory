# Plan: Metahaku (Broad Recall) — Tool-Based Approach

> Date: 2026-04-08
> Status: Accepted — ready for implementation
> Branch: feat-broad-recall
> Reviewed by: Gemini (gemini-3.1-pro-preview), GPT-5.4, Claude (claude-opus-4-6)

---

## 1. Ongelma

Nykyinen `assemble()` ottaa viimeisen käyttäjäviestin ja käyttää sitä suoraan `recall(query, limit)` -hakuna. Tämä toimii hyvin spesifisille kysymyksille mutta epäonnistuu avoimille/meta-kysymyksille kuten "Kerro mitä muistat minusta?" — BM25/embedding ei matchaa meta-sanoja sisältöön.

## 2. Ratkaisu: Tool-Based Broad Recall

**Alkuperäinen heuristiikka-lähestymistapa hylätty.** Sen sijaan:

- **Uusi `memory_browse` työkalu** jonka kutsuva LLM voi kutsua kun tarvitsee laajan katsauksen
- **Ei heuristiikkaa** — LLM on paras intent-luokittelija
- **assemble() pysyy ennallaan** — browse on erillinen lisätyökalu
- **Palauttaa kaikki/paljon muistoja kerrallaan** (jopa ~100), vahvuusjärjestyksessä tyyppidiversiteetillä

### Brainstorm-opit (Gemini + Codex)

Alkuperäisestä LLM-brainstormista hyödynnetään broad recall -algoritmiin:
- **Candidate pool + type-capped greedy selection** (ei rigid per-type quotas)
- **Recency bias:** `broadScore = 0.8 * strength + 0.2 * exp(-ageDays / 30)`
- **Near-duplicate suppression** (normalized content prefix match)
- **Type normalization** ennen capping: `toLowerCase().trim()`

## 3. Uudet komponentit

### 3.1 `MemoryDatabase.getTopByStrength(limit)`

```sql
SELECT * FROM memories WHERE strength > 0.05
ORDER BY strength DESC, created_at DESC LIMIT ?
```

### 3.2 `MemoryManager.broadRecall(limit)`

1. Hae kandidaattipooli: `getTopByStrength(min(200, limit * 4))`
2. Pisteytä: `broadScore = 0.8 * strength + 0.2 * exp(-ageDays / 30)`
3. Järjestä broadScore DESC
4. Greedy-valinta:
   - Type cap: `maxPerType = max(2, ceil(limit / 3))`
   - Near-duplicate suppression (normalized content exact/prefix match)
5. Toinen kierros: jos jäi tilaa, relaksoi type cap, pidä dedup
6. Palauta `limit` tulosta

### 3.3 `memory_browse` työkalu (index.ts)

- **Parametrit:** `limit` (optional, default 50)
- **Palauttaa:** muistot JSON-taulukkona: id, id_short, type, content, strength, score, temporal_state, created_at
- **Ledger-integraatio:** track browse results

### 3.4 System prompt -päivitys

Lisää `memory_browse` kuvaus ja ohje käyttöön:
"Use `memory_browse` for broad overview when the user asks what you remember, or when injected memories don't cover the topic."

## 4. Optionaalinen: LLM-relevanssifiltterointi (ei V1)

Myöhempi laajennus: `memory_browse` voi ottaa `query`-parametrin, jolloin jokainen muisto arvioidaan nopealla LLM-kutsulla relevanssiksi. Ei toteuteta V1:ssä.

## 5. Toteutusjärjestys

1. ✅ Suunnitelma (tämä dokumentti)
2. `db.ts`: `getTopByStrength()` + testit
3. `memory-manager.ts`: `broadRecall()` + testit
4. `index.ts`: `memory_browse` työkalu + system prompt + testit
5. Kaikki testit vihreällä
