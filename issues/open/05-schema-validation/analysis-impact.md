# Parannusehdotusten vaikutusarvio

Asteikko: `++` erittäin positiivinen, `+` positiivinen, `0` neutraali, `-` negatiivinen, `--` erittäin negatiivinen

**Selkeys** = koodin luettavuus ja ymmärrettävyys
**Robustisuus** = virheiden havaitseminen ja järjestelmän kestävyys
**Ylläpidettävyys** = muutoskustannus tulevaisuudessa, uuden koodin ylläpitotaakka

## A. Arkkitehtuuri ja virhekäsittely

| # | Parannus | Selkeys | Robustisuus | Ylläpidettävyys | Trade-off? | Huomiot |
|---|----------|---------|-------------|-----------------|------------|---------|
| A1 | `ParseResult<T>` -virhekäsittelystrategia | + | ++ | - | **Kyllä** | Jokainen kutsupaikka joutuu käsittelemään Result-tyypin. Lisää abstraktiota. Hyöty on suuri mutta vaatii laajan refaktoroinnin. |
| A2 | Validointi `db.ts`-kerrokseen (domain-objektit ulos) | + | + | - | **Kyllä** | Iso refaktorointi: muuttaa DB-luokan API-pinnan. Kaikki kutsupaikat muuttuvat. Hyöty pitkällä aikavälillä. |
| A3 | Strict vs tolerant erilliset DB-metodit | - | ++ | -- | **Kyllä** | Tuplaa API-pinnan. Jokainen query tarvitsee kaksi versiota. Raskas ylläpitää. |
| A4 | Startup-integritettiskanni | 0 | + | - | **Kyllä** | Uusi koodi ylläpidettäväksi. Pitää päättää mitä tehdään löydetyille ongelmille. Hyödyllinen mutta ei kiireellinen. |

## B. Enum-validointi

| # | Parannus | Selkeys | Robustisuus | Ylläpidettävyys | Trade-off? | Huomiot |
|---|----------|---------|-------------|-----------------|------------|---------|
| B1 | `temporal_state` assertion/guard | + | + | + | **Ei** | Tekee sallitut arvot eksplisiittisiksi. Pieni lisäys. |
| B2 | `source` assertion/guard | + | + | + | **Ei** | Sama kuin B1. |
| B3 | `evidence` assertion/guard | + | ++ | + | **Ei** | Kriittisin kenttä — ohjaa merge-logiikkaa. Suurin robustisuushyöty. |
| B4 | `mode` assertion/guard | + | + | + | **Ei** | Sama pattern kuin B1–B3. |
| B5 | `retrieval_mode` assertion/guard | + | + | + | **Ei** | Sama pattern. |
| B6 | `makeEnumGuard()` factory | ++ | + | ++ | **Ei** | DRY: yksi toteutus, kaikki enumit käyttävät. Vähentää boilerplatea. |
| B7 | Const tuple → union-tyyppi (`as const`) | ++ | + | ++ | **Ei** | Eliminoi duplikaation TS-tyypin ja Set:in välillä. Yksi totuuden lähde. |

## C. Numeerinen ja aikaleima-integriteetti

| # | Parannus | Selkeys | Robustisuus | Ylläpidettävyys | Trade-off? | Huomiot |
|---|----------|---------|-------------|-----------------|------------|---------|
| C1 | `updateStrength()` `Number.isFinite()` | 0 | + | 0 | **Ei** | Yksi rivi. Estää NaN:n pääsyn DB:hen. |
| C2 | `setEmbedding()` validointi | 0 | + | 0 | **Ei** | Muutama rivi: pituus jaollinen, finite-tarkistus. |
| C3 | ISO-8601 UTC aikaleiman validointi kirjoituspoluilla | + | ++ | - | **Kyllä** | Pitää kirjoittaa ja ylläpitää regex/parser kanoniselle muodolle. Päätettävä mitä muotoja hyväksytään. Mutta hyöty on suuri koska koko SQL-logiikka perustuu leksikografiseen järjestykseen. |
| C4 | `getTransitionMemories()` NaN-käsittely | + | + | 0 | **Ei** | Lisätään `isNaN`-tarkistus ennen vertailua. Pieni, paikallinen muutos. |
| C5 | `cosineSimilarity()` NaN/Infinity-tarkistus | 0 | + | 0 | **Ei** | Muutama rivi. Palauttaa 0 jos input ei finite. |

## D. Import/write-side -polkujen validointi

| # | Parannus | Selkeys | Robustisuus | Ylläpidettävyys | Trade-off? | Huomiot |
|---|----------|---------|-------------|-----------------|------------|---------|
| D1 | `insertExposureRaw()` validointi | + | ++ | 0 | **Ei** | Kutsuu B4/B5 guardeja + aikaleima-check ennen inserttiä. Pieni lisäys trust-rajalla. |
| D2 | `insertAttributionRaw()` validointi | + | ++ | 0 | **Ei** | Kutsuu B3 guardia + confidence bounds + aikaleima. Pieni lisäys. |
| D3 | LLM-rikastuksen tulosten validointi | + | + | 0 | **Ei** | Validoi `parseEnrichmentResponse()` palautus ennen store(). |
| D4 | `insertExposure()` API: `mode: string` → `ExposureMode` | ++ | + | + | **Ei** | Puhdas tyyppimuutos. Kääntäjä pakottaa oikeat arvot. |
| D5 | `upsertAttribution()` API: `evidence: string` → `AttributionEvidence` | ++ | + | + | **Ei** | Sama kuin D4. Kääntäjä huomaa virheelliset kutsut. |

## E. SQLite CHECK -rajoitteet

| # | Parannus | Selkeys | Robustisuus | Ylläpidettävyys | Trade-off? | Huomiot |
|---|----------|---------|-------------|-----------------|------------|---------|
| E1 | CHECK-rajoitteet skeema-SQL:ään (uudet asennukset) | + | + | - | **Kyllä** | Split-brain: vanhat asennukset eri käytös. SQLite CHECK:ien evoluutio vaatii taulun uudelleenrakennuksen. |
| E2 | Lykätään CHECKit (ei tehdä nyt) | 0 | 0 | 0 | — | Ei muutosta. Voidaan palata myöhemmin. |
| E3 | Taulujen rebuild-migraatio olemassa oleville DB:ille | 0 | + | -- | **Kyllä** | Monimutkainen migraatiokoodi: temp table, copy, drop, rename, rebuild indexes, FTS sync. Suuri ylläpitotaakka. |

## F. Tyyppijärjestelmän parannukset (TS-taso)

| # | Parannus | Selkeys | Robustisuus | Ylläpidettävyys | Trade-off? | Huomiot |
|---|----------|---------|-------------|-----------------|------------|---------|
| F1 | `feedbackEvidenceForRating()` → narrow return type | ++ | + | + | **Ei** | Puhdas tyyppimuutos. Yhdistyy luontevasti B3:n `AttributionEvidence`-tyypiin. |
| F2 | `extractLastUserMessage()` poista `any`-castit | ++ | + | + | **Ei** | Korvaa `any` oikeilla tyypeillä. Puhdas parannus. |
| F3 | `type`-kentän pituus/merkki-validointi | 0 | + | - | **Kyllä** | Pitää päättää arbitraariset rajat. Mitä tehdään liian pitkällä type-stringillä? Policy-kysymys. |
| F4 | Yhtenäinen message/block-malli transkriptiparsintaan | ++ | + | +/- | **Kyllä** | DRY ja selkeä, mutta iso refaktorointi: koskee after-turn.ts, context-engine.ts, mahdollisesti testit. |

## G. TypeBox-laajennus

| # | Parannus | Selkeys | Robustisuus | Ylläpidettävyys | Trade-off? | Huomiot |
|---|----------|---------|-------------|-----------------|------------|---------|
| G1 | `parseFeedbackCalls()` → TypeCompiler | +/- | + | - | **Kyllä** | TypeBox verbose. Ei korvaa business-logiikkaa (slice, dedup). Hyöty rajallinen. |
| G2 | `config.ts` → TypeBox-skeema | + | + | +/- | **Kyllä** | Yhdenmukaisuutta, mutta nykyinen parser on pieni ja toimiva. Muutos muutoksen vuoksi. |
| G3 | `extractLastUserMessage()` → TypeBox | +/- | + | - | **Kyllä** | Sama kuin G1. F2 (any-poisto) antaa suurimman hyödyn ilman TypeBox-riippuvuutta. |

## H. Muut data-integriteetti

| # | Parannus | Selkeys | Robustisuus | Ylläpidettävyys | Trade-off? | Huomiot |
|---|----------|---------|-------------|-----------------|------------|---------|
| H1 | `resolveAlias()` sykli/max-depth -logitus | + | + | 0 | **Ei** | Lisätään `logger.warn()` kun sykli tai max-depth osuu. Yksi rivi. |
| H2 | Embedding BLOB pituustarkistus | 0 | + | 0 | **Ei** | Tarkista `byteLength % 4 === 0` ennen Float32Array-luontia. Muutama rivi. |
| H3 | Orphaned FTS -rivien tarkistus | 0 | + | - | **Kyllä** | Uusi integritettiscan. Milloin ajetaan? Mitä tehdään löydetyille? |

---

## Yhteenveto: parannukset ilman trade-offeja

Nämä **19 parannusta** parantavat selkeyttä, robustisuutta ja/tai ylläpidettävyyttä ilman haittapuolia:

| # | Parannus | Työmäärä |
|---|----------|----------|
| **B6** | `makeEnumGuard()` factory | Pieni |
| **B7** | Const tuple → union-tyyppi (`as const`) kaikille enumeille | Pieni |
| **B1** | `temporal_state` guard | Pieni (käyttää B6:ta) |
| **B2** | `source` guard | Pieni |
| **B3** | `evidence` guard | Pieni |
| **B4** | `mode` guard | Pieni |
| **B5** | `retrieval_mode` guard | Pieni |
| **D4** | `insertExposure()` `mode: string` → `ExposureMode` | Pieni |
| **D5** | `upsertAttribution()` `evidence: string` → `AttributionEvidence` | Pieni |
| **F1** | `feedbackEvidenceForRating()` narrow return type | Pieni |
| **F2** | `extractLastUserMessage()` poista `any` | Pieni |
| **C1** | `updateStrength()` `Number.isFinite()` | Triviaali |
| **C2** | `setEmbedding()` pituus + finite-check | Triviaali |
| **C4** | `getTransitionMemories()` NaN-guard | Triviaali |
| **C5** | `cosineSimilarity()` NaN/Infinity-guard | Triviaali |
| **D1** | `insertExposureRaw()` enum+aikaleima-validointi | Pieni |
| **D2** | `insertAttributionRaw()` enum+confidence+aikaleima-validointi | Pieni |
| **D3** | LLM-rikastuksen tulosten validointi | Pieni |
| **H1** | `resolveAlias()` sykli-logitus | Triviaali |
| **H2** | Embedding BLOB pituustarkistus | Triviaali |
