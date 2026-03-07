# TODO – Assosiatiivinen muisti

> Plugin OpenClaw:lle. Design valmis, seuraava vaihe: koodi.

## Tilanne

Design-dokumentit (`history/03-design-*.md`) ovat vedos 3–4 ja keskenään johdonmukaisia. Observations-dokumentti (`history/02-research-07-observations.md`) on käyty läpi ja olennaiset havainnot on integroitu designiin tai kirjattu tähän.

**V1-periaate:** Yksinkertainen ja laajennettava. Nolla DB-kirjoitusta normaalikäytössä paitsi uuden muiston luonti. Kaikki tilamuutokset konsolidaatiossa.

## Päätökset

Kattava lista: `03-design-00-index.md`, Päätökset-taulukko. **Lue ne ennen koodausta.**

Tiivistelmä: content hash (SHA-256), SQLite backend, working.md + consolidated.md, kaksisuuntaiset assosiaatiot (pysyvä taulu, päivitetään konsolidaatiossa), retrieval.log (append-only), 10-vaiheinen uniprosessi, vapaamuotoinen muistotyyppi, ei assosiaatio-boostia V1-haussa.

## Toteutusjärjestys

### 1. Runko ja tietomalli
- [ ] Projektin rakenne (TypeScript, plugin manifest, `kind: "memory"`)
- [ ] SQLite-skeema (design-01 §4.6): memories, associations, memory_embeddings, memory_fts, state
- [ ] Tiedostoformaatti: working.md + consolidated.md chunkkimerkinnöillä
- [ ] Layout-manifesti (`.layout.json` + state-taulu)
- [ ] Muisto-olion luonti: hash, embedding, FTS-indeksointi, tiedostokirjoitus

### 2. Työkalut ja retrieval
- [ ] `memory_store`: content → hash → working.md + DB + retrieval.log (store-rivi)
- [ ] `memory_search`: embedding+BM25 hybridi → strength-painotus → tulokset
- [ ] `memory_feedback`: ratings → retrieval.log (feedback-rivi)
- [ ] `memory_get`: id → muisto
- [ ] retrieval.log: append-only kirjoitus (search/recall/feedback/store)

### 3. Hookit ja auto-recall
- [ ] `before_prompt_build`: auto-recall (top-N muistoa) + temporaalinen pakkoinjektio
- [ ] `after_tool_call`: retrieval.log-kirjaus
- [ ] `agent_end` / `before_reset`: session-muistojen kaappaus
- [ ] Bootstrap-hook: AGENTS.md muistiohjeiden korvaus

### 4. Konsolidaatio (uni)
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

### 5. Osa A (OpenClaw-muutokset)
Erillinen kuvaus: `history/osa-a-openclaw-muutokset.md`. Tehdään PR:nä OpenClaw-repoon, erillisellä agentilla.

## Avoimet kysymykset (ratkaistavat ennen/aikana toteutusta)

### Kriittiset
1. **Samanaikaisuus:** Mitä jos agentti käyttää muistia konsolidaation aikana? Tarvitaanko lukitus vai riittääkö WAL-mode?
2. **Virheenkäsittely konsolidaatiossa:** Jos vaihe 7 tai 8 (LLM-kutsu) epäonnistuu, jääkö tila epäkonsistentiksi? Transaktiorajat vaiheiden välillä?
3. **Embedding-providerin saavutettavuus:** Miten plugin pääsee `createEmbeddingProvider()`-infraan? (Osa A riippuvuus A6)

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

## Työskentelyohjeet

- Lue aina ensin indeksi (`03-design-00-index.md`) ja relevantit design-dokumentit
- Observations: `02-research-07-observations.md` – laaja taustadokumentti, hyödyllinen toteutuksen yksityiskohdissa
- OpenClaw-sorsat: `../openclaw/`
- Päivitä tätä TODO:a kun tehtäviä valmistuu
