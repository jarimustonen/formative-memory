# Design-vaiheen TODO

> Assosiatiivisen muistin plugin OpenClaw:lle – suunnitteludokumentaation tila ja seuraavat askeleet.

## Konteksti

Design-dokumentit ovat `history/`-hakemistossa. Indeksi on `history/03-design-00-index.md`. Research-vaihe on valmis (02-research-sarja). Alkuperäiset ideat ovat `history/01-idea-associative-memory-plugin.md` ja `history/design-associative-memory.md`.

**V1-filosofia:** Yksinkertainen ja laajennettava. Keskeiset yksinkertaistukset on dokumentoitu indeksin "V1-filosofia"-osiossa ja kunkin design-dokumentin päätöslistassa.

## Tehdyt päätökset

Nämä on kirjattu indeksiin (`03-design-00-index.md`, Päätökset-taulukko). Lue ne ennen kuin jatkat – älä kyseenalaista ilman hyvää syytä.

Tiivistelmä: content hash identiteettinä, SQLite backend, kaksi tiedostoa (working.md + consolidated.md), kaksisuuntaiset assosiaatiot ilman tyyppejä V1:ssä, päivätason co-retrieval-loki, strength-malli (decay nukkuessa ×0.977, retrieval vahvistaa η=0.7), 30 unen puoliintumisaika.

## Seuraavat askeleet

### 1. Päivitä design-04 (Retrieval) vedos 2:ksi

**Tiedosto:** `history/03-design-04-retrieval.md` (nyt vedos 1)

Muutokset tarvitaan:
- Hakuputki yksinkertaisemmaksi: embedding+BM25 → strength-painotus → assoc-boost (3 vaihetta riittää V1:lle)
- Kertautuva assosiaatio siirtyy konsolidaatioon (ei reaaliaikaista V1:ssä)
- Tick-viittaukset pois – päivätaso riittää
- Retrieval-sivuvaikutus: strength-vahvistus + kirjaus daily_co_retrievals-tauluun
- Auto-recall-budjetti: sovitettava working/consolidated-jakoon

### 2. Päivitä design-05 (Consolidation) vedos 2:ksi

**Tiedosto:** `history/03-design-05-consolidation.md` (nyt vedos 1)

Tämä muuttuu eniten. Konsolidaatio on nyt keskitetty paikka jossa tapahtuu:
- Working → consolidated -siirto (muistojen siirto tiedostosta toiseen)
- Decay-batch: kaikkien consolidated-muistojen strength × 0.977
- Co-retrieval-lokin prosessointi → assosiaatioiden päivitys (design-02:n kaava)
- Kertautuva assosiaatio (siirretty retrievalista tänne)
- Duplikaattien tunnistus ja yhdistäminen
- REM-vaihe
- Pruning: kuolleet muistot (strength ≤ 0.05) ja assosiaatiot (weight < 0.01)
- Tick-viittaukset pois

### 3. Päivitä design-06 (Integration) vedos 2:ksi

**Tiedosto:** `history/03-design-06-integration.md` (nyt vedos 1)

Muutokset:
- Tiedostorakenne: chunks/ → working.md + consolidated.md
- Hook-set yksinkertaistuu (ei tick-laskuria V1:ssä)
- after_tool_call: vain co-retrieval-lokin kirjaus (ei tick++)
- Skeema päivitettävä vastaamaan design-01 vedos 2:n skeemaa

### 4. Päivitä design-07 (Migration) vedos 2:ksi

**Tiedosto:** `history/03-design-07-migration.md` (nyt vedos 1)

Muutokset:
- Kohdetiedostorakenne: chunks/ → consolidated.md
- Importoidut muistot menevät suoraan consolidated.md:hen

### 5. Päivitä indeksi

**Tiedosto:** `history/03-design-00-index.md`

Kun kaikki dokumentit ovat vedos 2:lla, päivitä dokumenttitaulukko ja vaiheiden tilat.

## Työskentelyohjeet

- Lue aina ensin indeksi (`03-design-00-index.md`) ja relevantit design-dokumentit ennen muokkaamista
- Tarkista `02-research-07-observations.md` avoimille kysymyksille ja havainnoille
- Päivitä dokumentin tila-rivi (vedos 1 → vedos 2) ja päivämäärä
- Säilytä "Avoimet kysymykset" ja "Kytkökset muihin design-dokumentteihin" -osiot
- Älä poista päätöksiä – lisää uusia tarvittaessa
- OpenClaw:n sorsat ovat `../openclaw/`-hakemistossa jos tarvitset tarkistaa yksityiskohtia
