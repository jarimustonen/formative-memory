# Assosiatiivinen muisti – Suunnitteludokumentaatio

> **Projekti:** Assosiatiivisen muistin plugin OpenClaw:lle
> **Aloitettu:** 28.2.2026
> **Pohjana:** `01-idea-associative-memory-plugin.md` (alkuperäiset ideat), 02-research-sarja (järjestelmän ymmärrys), `02-research-07-observations.md` (havainnot ja avoimet kysymykset)

---

## Tavoite

Suunnitella assosiatiivisen muistin plugin, joka korvaa memory-core:n ja toteuttaa:

- **Muisto-oliot** stabiileilla identiteeteillä (content hash)
- **Assosiaatiot** muistojen välillä (painotetut linkit)
- **Temporaalinen tila** (futuuri → preesens → imperfekti)
- **Konsolidaatio** ("uni") – assosiaatioiden vahvistaminen ja muistojen tiivistäminen
- **Strength-malli** – decay nukkuessa, retrieval vahvistaa
- **Muistotyyppikohtainen retrieval** – eri hakustrategiat eri muistotyypeille
- **Väritetyt muistot** – muistot muuttuvat konsolidaatiossa

---

## V1-filosofia

Ensimmäisen version tulee olla **yksinkertainen** ja **laajennettava**. Yksinkertaistukset vedos 1:stä:

1. **Kaksi tiedostoa** (working.md + consolidated.md) yhden-per-muisto sijaan
2. **Assosiaatiot päivätasolla** – co-retrieval-loki päivän aikana, konsolidaatio prosessoi
3. **Decay vain nukkuessa** – ei reaaliaikaista rapautumista
4. **Ei tick-mekanismia V1:ssä** – päivätaso riittää
5. **Ei assosiaatiotyyppejä V1:ssä** – pelkkä weight
6. **Nolla DB-kirjoituksia normaalikäytössä** – retrieval.log ainoa kirjoitus, kaikki prosessointi konsolidaatiossa

---

## Vaiheistus

### Vaihe 1: Tietomalli (design-01, design-02)

Perusta kaikelle muulle.

**Ratkaistu:**

- Muisto = semanttinen yksikkö, id = SHA-256(content)
- Vapaamuotoinen muistotyyppi (esim. narrative, fact, decision, preference)
- Kaksisuuntaiset assosiaatiot, ei tyyppejä V1:ssä
- Tallennus: working.md + consolidated.md + SQLite
- Päivätason co-retrieval-loki → konsolidaatio prosessoi

**Avoimet:**

- Embedding-dimension dynaamisuus
- Consolidated.md:n kasvun hallinta

### Vaihe 2: Muistin elinkaari (design-03)

**Ratkaistu:**

- Eri decay-nopeus: working ×0.906/uni (7 unen puoliintumisaika), consolidated ×0.977/uni (30 unen puoliintumisaika)
- Konsolidaatio nollaa strength 1.0:aan (working → consolidated -siirto)
- Retrieval-vahvistus painotettu palautteella: store 2×, search 1×, feedback ★/3, recall ½
- Kuolema: strength ≤ 0.05 (ellei vahvoja assosiaatioita)
- Temporaalinen tila: future/present/past/none, automaattiset siirtymät
- Transitiopäivien pakkoinjektio kontekstiin
- Väritys vain konsolidaatiossa (V1)

**Avoimet:**

- Working-muistin maksimiikä
- η-parametrin herkkyys

### Vaihe 3: Haku ja retrieval (design-04)

Miten agentti löytää relevantteja muistoja.

**Ratkaistu:**

- Hakuputki: embedding+BM25 (kiinteä painotus) → strength-painotus → tulokset
- Ei assosiaatio-boostia V1:ssä (assosiaatiot vaikuttavat epäsuorasti strengthin kautta)
- Sivuvaikutukset: vain retrieval.log-kirjaus (search/recall/feedback/store)
- Auto-recall: before_prompt_build + temporaalinen pakkoinjektio
- Työkalut: memory_search, memory_store, memory_feedback, memory_get
- Interpretation poistettu muistotyypeistä (source=consolidation riittää)

### Vaihe 4: Konsolidaatio (design-05)

"Uni"-vaihe.

**Ratkaistu:**

- 10-vaiheinen prosessi kiinteässä järjestyksessä
- Retrieval-vahvistus (retrieval.log → painotettu strength-päivitys)
- Eri decay: working ×0.906, consolidated ×0.977
- Assosiaatiopäivitys (retrieval.log → co-retrieval-parit, painotettu)
- Kertautuva assosiaatio (siirretty retrievalista)
- Working → consolidated siirto (strength → 1.0)
- Temporaaliset siirtymät, duplikaattien yhdistäminen, väritys
- Pruning: kuolleet muistot (strength ≤ 0.05) ja assosiaatiot (weight < 0.01)

### Vaihe 5: Integraatio ja migraatio (design-06, design-07)

**Ratkaistu:**

- Yksinkertaistettu hook-set (ei tick-mekanismia)
- after_tool_call: vain retrieval.log-kirjaus
- memory_feedback lisätty, memory_forget poistettu
- Importoidut muistot → consolidated.md (source=import, strength=1.0)
- Vapaamuotoinen muistotyyppi heuristiikalla

---

## Dokumenttirakenne

| #   | Tiedosto                        | Sisältö                                                           | Tila    |
| --- | ------------------------------- | ----------------------------------------------------------------- | ------- |
| 00  | `03-design-00-index.md`         | Tämä indeksi ja vaiheistussuunnitelma                             | –       |
| 01  | `03-design-01-data-model.md`    | Muisto-olio, muistotyypit, content hash, SQLite-skeema            | Vedos 3 |
| 02  | `03-design-02-associations.md`  | Assosiaatiorakenne, painot, päivätason seuranta                   | Vedos 3 |
| 03  | `03-design-03-lifecycle.md`     | Luonti, working/consolidated, strength-malli, väritys             | Vedos 3 |
| 04  | `03-design-04-retrieval.md`     | Hakuputki, auto-recall, muistityökalut, retrieval.log             | Vedos 2 |
| 05  | `03-design-05-consolidation.md` | 10-vaiheinen uniprosessi, retrieval.log-prosessointi              | Vedos 4 |
| 06  | `03-design-06-integration.md`   | Plugin-rakenne, hookit, työkalut, Osa A -riippuvuudet             | Vedos 3 |
| 07  | `03-design-07-migration.md`     | memory-core → assosiatiivinen muisti, layout-versiointi, rollback | Vedos 2 |

---

## Päätökset

> Tähän kirjataan tehdyt suunnittelupäätökset sitä mukaa kun ne syntyvät.

| #   | Päätös                                                                              | Perustelu                                                                            | Vaihe |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----- |
| 1   | Content hash (SHA-256 tekstistä) muiston identiteettinä                             | Yksinkertainen, content-addressable, atominen assosiaatiopäivitys muutoksissa        | 1     |
| 2   | SQLite riittää backendiksi                                                          | Oikea skaala, ACID-transaktiot, sqlite-vec + FTS5 jo paikallaan                      | 1     |
| 3   | Plugin ei valitse embedding-mallia – käyttäjän konfiguraatio                        | Parempi malli = paremmat assosiaatiot, mutta se on käyttäjän päätös                  | 1     |
| 4   | Muistotyyppi vaikuttaa retrieval-strategiaan                                        | Tool-usage: BM25-painotteinen, narratiivinen: embedding-painotteinen                 | 3     |
| 5   | Kaksi tiedostoa: working.md + consolidated.md                                       | Ihmisluettava, yksinkertainen elinkaari, selkeä jako                                 | 1     |
| 6   | Kaksisuuntaiset assosiaatiot, ei tyyppejä V1:ssä                                    | Pelkkä weight riittää MVP:hen, tyypit V2:ssa                                         | 1     |
| 7   | Co-retrieval-seuranta lokitiedostoon (retrieval.log), prosessointi konsolidaatiossa | Ei DB-kirjoituksia normaalikäytössä, ihmisluettava, yksinkertainen                   | 1–2   |
| 8   | Eri decay working- ja consolidated-muistoille                                       | Working: 7 unen puoliintumisaika (×0.906), consolidated: 30 unen (×0.977)            | 2     |
| 9   | Konsolidaatio nollaa strength 1.0:aan                                               | Working → consolidated = uusi alku pitkäkestomuistina                                | 2     |
| 10  | Kaikki muutokset konsolidaatiossa (V1)                                              | Nolla DB-kirjoituksia normaalikäytössä, paitsi uuden muiston luonti                  | 1–3   |
| 11  | Painotettu retrieval-vahvistus (η=0.7)                                              | store 2×, search 1×, feedback ★/3, recall ½ – eri signaalit = eri relevanssi         | 2     |
| 12  | Temporaalinen tila: future/present/past/none                                        | None = ei ankkuria (faktat, preferenssit), ei temporaalista boostingia               | 2     |
| 13  | Transitiopäivien pakkoinjektio                                                      | Siirtymässä olevat muistot pakotetaan kontekstiin auto-recall-vaiheessa              | 2     |
| 14  | Ei assosiaatio-boostia hakuputkessa (V1)                                            | Yksinkertainen putki, assosiaatiot vaikuttavat epäsuorasti strengthin kautta         | 3     |
| 15  | Kiinteä embedding/BM25-painotus (V1)                                                | Muistotyyppikohtainen painotus V2:ssa kun on dataa                                   | 3     |
| 16  | Vapaamuotoinen muistotyyppi (ei enum)                                               | Tyyppi on metadataa, ei vaikuta V1-hakuun – agentti valitsee luontevimman kategorian | 1,3   |
| 17  | memory_feedback-työkalu (1-3 tähteä)                                                | Agentti arvioi relevanssin, konsolidaatio painottaa                                  | 3     |

---

## Avoimet kysymykset

> Keskeiset avoimet kysymykset. Kattavampi lista: `02-research-07-observations.md`.

1. Embedding-pohjainen konsolidaatio: luodaanko uusia assosiaatioita vai vain vahvistetaan olemassa olevia?
2. Konsolidaation kosinisamankaltaisuuden kynnysarvo?
3. Session-memory: hyödynnetäänkö session-memoryn tuottamia tiedostoja vai korvaako plugin session-tallennuksen kokonaan?
4. Miten plugin pääsee embedding-infraan käsiksi? (Osa A -riippuvuus A6)
5. Consolidated.md:n kasvun hallinta pitkällä aikavälillä?
