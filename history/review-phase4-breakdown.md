# Review: Phase 4 Consolidation Breakdown

**Reviewed:** Ehdotettu 6-osainen Phase 4 -pilkkominen (4.0–4.5)
**Reviewers:** Gemini (3.1 Pro Preview), Codex (GPT-5.4)
**Rounds:** 2

---

## Critical Issues (Consensus)

### 1. Memory content ei ole SQLitessä — rakenteellinen blokkeri

- **Mitä:** `MemoryManager.rowToMemory()` lukee sisällön markdown-tiedostoista, ei SQLitestä. Arkkitehtuuri sanoo "SQLite is canonical". Konsolidaatio tarvitsee sisältöä (Jaccard, LLM merge, regenerointi). DB-mutaatiot ennen markdown-regenerointia jättävät järjestelmän epäkonsistenttiin tilaan.
- **Missä:** `memory-manager.ts:rowToMemory()`, `db.ts:memories`-taulu (ei content-saraketta)
- **Korjaus:** Lisää `content TEXT NOT NULL` memories-tauluun. `rowToMemory()` lukee DB:stä. Markdown-tiedostot ovat pelkkiä generoituja näkymiä.

### 2. Phase 4.4 (Merge) on liian suuri yhdeksi inkrementiksi

- **Mitä:** Yhdistää kandidaattien tunnistuksen (Jaccard+embedding), LLM-kutsun, uuden muiston luonnin, alkuperäisten heikennyksen/poiston, alias-päivityksen, assosiaatioperinnön ja attribution-rewriten. Ei testattavissa itsenäisesti.
- **Korjaus:** Pilko: (a) kandidaattien tunnistus, (b) merge-suoritus deterministisellä sisällöllä, (c) LLM-integraatio, (d) provenance/assosiaatio-rewrite.

### 3. Working→consolidated (4.3) ennen mergea (4.4) on väärä järjestys

- **Mitä:** Strength → 1.0 ennen merge/prune vääristää kandidaattien arvioinnin. Heikot muistot saavat keinotekoisen vahvistuksen. Alkuperäisten heikennys (×0.1) alkaa 1.0:sta eikä orgaanisesta post-decay vahvuudesta.
- **Korjaus:** Järjestys: reinforcement → decay → pruning → merge → sitten vasta working→consolidated.

### 4. Blocking UX kuuluu Phase 4.0:aan, ei 4.5:een

- **Mitä:** Aloitusilmoitus ei voi olla viimeistelyvaiheessa kun käyttäjä odottaa 10-60s ilman feedbackia.
- **Korjaus:** "Starting consolidation..." Phase 4.0:ssa, yhteenveto lopussa.

### 5. Transitive assosiaatio tarvitsee rajat

- **Mitä:** Ilman depth-limittia ja threshold-gatea O(N²) räjähdys. Graafi tihenee joka syklissä.
- **Korjaus:** 1-hop max, tuotetun yhteyden weight-threshold (esim. ≥ 0.1), cap per run.

---

## Disputed Issues

### Reinforcement-datan lähde: retrieval.log vs. SQLite provenance

- **Gemini:** retrieval.log on legacy/debug. Reinforcement lukee SQLite:n `message_memory_attribution` + `turn_memory_exposure`.
- **Codex:** TODO sanoo eksplisiittisesti "retrieval.log → strength". Log ei ole obsoliitti. Oikea malli on join: retrieval.log-tapahtumat + provenance confidence + mode_weight.
- **Moderaattorin arvio:** Codex on lähempänä oikeaa. Arkkitehtuuri käyttää molempia: retrieval.log kertoo **mitkä muistot haettiin** (co-retrieval parit assosiaatioille), provenance-taulut kertovat **kuinka vahvasti** (confidence, mode_weight). Reinforcement tarvitsee molemmat. Mutta retrieval.log-parsintaan tarvitaan crash-turvallinen kulutus.

### Assosiaatioiden decay puuttuu

- **Gemini:** Assosiaatioiden weight ei koskaan pienene — probabilistic OR vain kasvattaa. Pruning-threshold (< 0.01) ei koskaan laukea. Graafi kasvaa ikuisesti.
- **Codex:** Ei maininnut tätä.
- **Moderaattorin arvio:** Gemini on oikeassa. Arkkitehtuurissa ei ole eksplisiittistä assosiaatio-decayta. TODO mainitsee `λ_assoc` avoimena kysymyksenä (kohta 5). Tämä pitää ratkaista Phase 4.2:ssa tai graafi tihenee.

---

## Minor Findings

- Attribution rewrite tarvitsee `mergeAttributionRow`-logiikkaa PK-collisionien vuoksi (Gemini) — jo toteutettu `replaceMemoryId()`:ssä
- Retrieval.log-kulutus tarvitsee crash-turvallisen mallin: snapshot/rotate ennen prosessointia (Codex)
- Alias-ketjut tarvitsevat cycle-detection ja max-traversal (molemmat)
- Merge-klusterien token-budjetti puuttuu — 40 muistoa yhdessä LLM-promptissa räjäyttää (Gemini)
- DB-kerros tarvitsee bulk-helppereitä konsolidaatiota varten (Codex)
- "Väritys" (coloring) pitää poistaa suunnitelmasta — arkkitehtuuri sanoo eksplisiittisesti "implicit via merge" (Codex)

---

## What's Solid

- Kronologinen perusjärjestys (reinforcement → decay → assosiaatiot → merge → pruning) on oikea
- Itsenäinen testattavuus inkrementtien suunnitteluperiaatteena
- Alias-taulun sijoitus Phase 4:ään (ei aiemmin) on oikein

---

## Moderaattorin kokonaisarvio

**Codex** teki vahvemman analyysin — erityisesti content-blokkerin tunnistaminen, järjestysongelman selkeä argumentointi ja crash-semantiikan vaatiminen olivat paremmin perusteltuja. **Gemini** löysi assosiaatio-decay-aukon jonka Codex ohitti.

### Tärkein korjattava ennen toteutusta

**Content SQLiteen** on ehdoton blokkeri. Kaikki muu voidaan korjata inkrementeissa, mutta ilman kanonista sisältöä DB:ssä konsolidaatio ei voi toimia oikein.

### Suositeltu rakenne

Reviewerien löydösten perusteella ehdotan uuden pilkkomisen:

**4.0** — Infrastruktuuri: content DB:hen, entrypoint/trigger, UX-rajat, alias-taulu, `last_consolidation_at`
**4.1** — Retrieval-input normalisointi + reinforcement + decay (+ assosiaatio-decay)
**4.2** — Assosiaatiopäivitys (co-retrieval + bounded transitive) + temporaaliset siirtymät
**4.3** — Pre-merge pruning (strength ≤ 0.05, weight < 0.01)
**4.4** — Merge-kandidaattien tunnistus (Jaccard + embedding, deterministinen)
**4.5** — Merge-suoritus (LLM, DB-transaktio, alias, attribution rewrite, assosiaatioperintö)
**4.6** — Working→consolidated siirto + GC + markdown-regenerointi + integraatiotesti
