# TODO – Assosiatiivinen muisti

> Plugin OpenClaw:lle. Design valmis, toteutus käynnissä.

## Tilanne (2026-03-09)

**Valmista:** Infrastruktuuri (DB, tyypit, hash, chunks, retrieval-log, config), MemoryManager (store, search, recall), työkalurekisteröinti (memory_store, memory_search, memory_get, memory_feedback), 62 testiä läpi.

**Kesken:** Hookit (Phase 3), konsolidaatio (Phase 4), OpenClaw-PR:t odottavat reviewiä.

**V1-periaate:** Yksinkertainen ja laajennettava. Nolla DB-kirjoitusta normaalikäytössä paitsi uuden muiston luonti. Kaikki tilamuutokset konsolidaatiossa.

## Päätökset

Kattava lista: `03-design-00-index.md`, Päätökset-taulukko. **Lue ne ennen koodausta.**

Tiivistelmä: content hash (SHA-256), SQLite backend, working.md + consolidated.md, kaksisuuntaiset assosiaatiot (pysyvä taulu, päivitetään konsolidaatiossa), retrieval.log (append-only), 10-vaiheinen uniprosessi, vapaamuotoinen muistotyyppi, ei assosiaatio-boostia V1-haussa.

## Toteutusjärjestys

### Phase 1: Runko ja tietomalli ✅

- [x] Projektin rakenne (TypeScript, plugin manifest, `kind: "memory"`)
- [x] SQLite-skeema (design-01 §4.6): memories, associations, memory_embeddings, memory_fts, state
- [x] Tiedostoformaatti: working.md + consolidated.md chunkkimerkinnöillä
- [x] Layout-manifesti (`.layout.json` + state-taulu)
- [x] Muisto-olion luonti: hash, embedding, FTS-indeksointi, tiedostokirjoitus

### Phase 2: Työkalut ja retrieval ✅

- [x] Store-logiikka: content → hash → working.md + DB + retrieval.log
- [x] Search-logiikka: embedding+BM25 hybridi → strength-painotus → tulokset
- [x] Recall-logiikka: search + retrieval.log-kirjaus
- [x] Get-logiikka: id/prefix → muisto
- [x] retrieval.log: append-only kirjoitus (search/recall/feedback/store)
- [x] `register()` → rekisteröi `memory_store` OpenClaw-työkaluksi
- [x] `register()` → rekisteröi `memory_search` OpenClaw-työkaluksi
- [x] `register()` → rekisteröi `memory_get` OpenClaw-työkaluksi
- [x] `register()` → rekisteröi `memory_feedback` OpenClaw-työkaluksi

### Phase 3: Hookit ja auto-recall ❌

- [ ] **`before_prompt_build`**: auto-recall (top-N muistoa viimeisen viestin perusteella)
  - Käytä `api.registerMemoryPromptSection()` (A1, PR #40126)
  - Injektoi temporaaliset siirtymät (getTransitionMemories)
  - Budjetti: ~2000 tokenia
- [ ] **`after_tool_call`**: retrieval.log-kirjaus (mitä työkaluja agentti käytti)
- [ ] **`agent_end` / `before_reset`**: session-muistojen kaappaus
  - Lue session-transkripti, tunnista tallennettavat muistot
  - Vaatii: A3 (#40781) sessionFile-hook
- [ ] **Bootstrap-hook**: AGENTS.md muistiohjeiden korvaus (myöhemmin)

### Phase 4: Konsolidaatio (uni) ❌

- [ ] Service-rekisteröinti (`api.registerService`)
- [ ] 10-vaiheinen prosessi (design-05):
  1. Retrieval-vahvistus (retrieval.log → strength)
  2. Decay (working ×0.906, consolidated ×0.977)
  3. Assosiaatiopäivitys (co-retrieval-parit → associations-taulu)
  4. Kertautuva assosiaatio (epäsuorat yhteydet)
  5. Working → consolidated (siirto + strength → 1.0)
  6. Temporaaliset siirtymät (future→present→past)
  7. Duplikaattien yhdistäminen (Jaccard + embedding → LLM)
  8. Väritys (muistojen päivitys assosioituvien uudempien perusteella)
  9. Pruning (strength ≤ 0.05, weight < 0.01)
  10. Lokin tyhjennys
- [ ] CLI: `memory stats`, `memory consolidate`, `memory inspect <id>`

### Phase 5: Osa A – OpenClaw PR:t

Erillinen kuvaus: `history/openclaw-upstream-changes.md`

| Tehtävä | PR | Tila | Prioriteetti |
|---|---|---|---|
| A1. buildMemorySection() pluggable | #40126 | Open, CI-ongelmia (check, actionlint) | P1 – välttämätön Phase 3:lle |
| A3. sessionFile after_compaction | #40781 | Open, puhdas CI | P1 – välttämätön Phase 3:lle |
| A5. Unicode MMR/FTS tokenizer | #38945 | Open, CI-ongelmia (check) | P2 – bugikorjaus |
| Docs: AGENTS.md viite | #38724 | Open, triviaali | P3 |
| A4. session-memory ehdollinen | — | ⏸️ tutkitaan | P3 – ei MVP |
| A6. Embedding-provider API | — | Ei aloitettu | P3 – V1 käyttää omaa sqlite vec0 |
| A7. Layout-manifesti | — | Ei aloitettu | P4 – diagnostiikka |
| A2. ExtensionFactory plugineille | — | Ei aloitettu | P4 – V2 |

## Suositeltu eteneminen

**Seuraava:** Phase 3 (hookit). Riippuu A1 (#40126) ja A3 (#40781) mergeämisestä. Sillä välin voi aloittaa konsolidaation (Phase 4), joka on itsenäinen.

**Rinnakkain:**
- Korjaa CI-ongelmat PR:issä #40126 ja #38945 (rebase/type-check)
- Aloita konsolidaation suunnittelu (vaiheet 1-6 ovat suoraviivaisia, 7-8 vaativat LLM-kutsuja)

## Avoimet kysymykset

### Kriittiset
1. **Samanaikaisuus:** Mitä jos agentti käyttää muistia konsolidaation aikana? Tarvitaanko lukitus vai riittääkö WAL-mode?
2. **Virheenkäsittely konsolidaatiossa:** Jos vaihe 7 tai 8 (LLM-kutsu) epäonnistuu, jääkö tila epäkonsistentiksi? Transaktiorajat vaiheiden välillä?
3. **Embedding-providerin saavutettavuus:** V1 käyttää omaa embedder-injektiota. Miten plugin saa embedder-instanssin `register()`-kutsussa? (→ tarkista OpenClaw plugin API)

### Parametrit (empiirinen viritys)
4. α-parametri (assosiaatiovahvistus): 0.1?
5. λ_assoc (assosiaatioiden decay): sama kuin muistojen λ?
6. η (retrieval-vahvistus): 0.7?
7. Auto-recall budjetti: 2000 tokenia?
8. Embedding/BM25-painotus: α = 0.6?

### Myöhemmin ratkaistavat
9. Consolidated.md:n kasvu pitkällä aikavälillä
10. Värityksen aggressiivisuus: kuinka herkästi muistoja päivitetään?
11. Unicode-tokenizer Jaccard-vertailuun (`/[\p{L}\p{N}_]+/gu` vs. nykyinen `/[a-z0-9_]+/g`)

## Go-to-Market

- [ ] GTM-strategian toteutus: `history/plan-gtm-formativememory.md`
- [ ] Landing page (formativememory.ai)
- [ ] README.md uudelleenkirjoitus GTM-suunnitelman mukaan
- [ ] Kanavajulkaisut (HN, Reddit, Discord, X)

## Työskentelyohjeet

- Lue aina ensin indeksi (`03-design-00-index.md`) ja relevantit design-dokumentit
- Observations: `02-research-07-observations.md` – laaja taustadokumentti, hyödyllinen toteutuksen yksityiskohdissa
- OpenClaw-sorsat: `../openclaw/`
- Päivitä tätä TODO:a kun tehtäviä valmistuu
