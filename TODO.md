# Design-vaiheen TODO

> Assosiatiivisen muistin plugin OpenClaw:lle – suunnitteludokumentaation tila ja seuraavat askeleet.

## Konteksti

Design-dokumentit ovat `history/`-hakemistossa. Indeksi on `history/03-design-00-index.md`. Research-vaihe on valmis (02-research-sarja). Alkuperäiset ideat ovat `history/01-idea-associative-memory-plugin.md` ja `history/design-associative-memory.md`.

**V1-filosofia:** Yksinkertainen ja laajennettava. Keskeiset yksinkertaistukset on dokumentoitu indeksin "V1-filosofia"-osiossa ja kunkin design-dokumentin päätöslistassa.

## Tehdyt päätökset

Nämä on kirjattu indeksiin (`03-design-00-index.md`, Päätökset-taulukko). Lue ne ennen kuin jatkat – älä kyseenalaista ilman hyvää syytä.

Tiivistelmä: content hash identiteettinä, SQLite backend, kaksi tiedostoa (working.md + consolidated.md), kaksisuuntaiset assosiaatiot ilman tyyppejä V1:ssä, retrieval.log (append-only lokitiedosto), kaikki muutokset konsolidaatiossa (paitsi uuden muiston luonti). Eri decay: working ×0.906/uni (7 unen puoliintumisaika), consolidated ×0.977/uni (30 unen puoliintumisaika). Konsolidaatio nollaa strength 1.0:aan. Painotettu retrieval-vahvistus (store 2×, search 1×, feedback ★/3, recall ½, η=0.7). Vapaamuotoinen muistotyyppi (ei enum). Temporaalinen tila: future/present/past/none. Transitiopäivien pakkoinjektio. Yksinkertainen hakuputki (embedding+BM25 → strength, ei assoc-boostia V1:ssä). memory_feedback-työkalu (1-3 tähteä).

## Dokumenttien tila

| # | Tiedosto | Tila |
| - | -------- | ---- |
| 00 | `03-design-00-index.md` | Ajan tasalla |
| 01 | `03-design-01-data-model.md` | Vedos 3 |
| 02 | `03-design-02-associations.md` | Vedos 3 |
| 03 | `03-design-03-lifecycle.md` | Vedos 3 |
| 04 | `03-design-04-retrieval.md` | Vedos 2 |
| 05 | `03-design-05-consolidation.md` | Vedos 2 |
| 06 | `03-design-06-integration.md` | Vedos 2 |
| 07 | `03-design-07-migration.md` | Vedos 2 |

Kaikki design-dokumentit on päivitetty vastaamaan toisiaan. Seuraava vaihe: toteutus tai dokumenttien syventäminen tarpeen mukaan.

## Avoimet kysymykset (koottu kaikista dokumenteista)

1. **Embedding-dimensio:** Skeemassa hardkoodattu 768 – dynaaminen providerin mukaan?
2. **Consolidated.md:n kasvu:** Pilkkominen pitkällä aikavälillä?
3. **α-parametri (assosiaatiovahvistus):** 0.1 optimaalinen?
4. **λ_assoc:** Sama kuin muistojen λ vai eri?
5. **η-parametrin herkkyys:** 0.7 optimaalinen?
6. **Auto-recall budjetti:** 2000 tokenia riittävä?
7. **Embedding/BM25-painotus:** α = 0.6 optimaalinen?
8. **Konsolidaation LLM-malli:** Konfiguroitava, halvempi?
9. **REM-otannan koko:** Montako muistoa per sykli?
10. **Embedding-provideri:** Miten plugin pääsee käsiksi? (Osa A -riippuvuus A6)
11. **Session-memory-hook:** Hyödynnetään vai ignoroidaan?

## Työskentelyohjeet

- Lue aina ensin indeksi (`03-design-00-index.md`) ja relevantit design-dokumentit ennen muokkaamista
- Tarkista `02-research-07-observations.md` avoimille kysymyksille ja havainnoille
- Päivitä dokumentin tila-rivi ja päivämäärä muokatessa
- Säilytä "Avoimet kysymykset" ja "Kytkökset muihin design-dokumentteihin" -osiot
- Älä poista päätöksiä – lisää uusia tarvittaessa
- OpenClaw:n sorsat ovat `../openclaw/`-hakemistossa jos tarvitset tarkistaa yksityiskohtia
