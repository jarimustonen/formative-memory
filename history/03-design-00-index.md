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
- 6 muistotyyppiä (narrative, fact, decision, tool_usage, interpretation, preference)
- Kaksisuuntaiset assosiaatiot, ei tyyppejä V1:ssä
- Tallennus: working.md + consolidated.md + SQLite
- Päivätason co-retrieval-loki → konsolidaatio prosessoi

**Avoimet:**
- Embedding-dimension dynaamisuus
- Consolidated.md:n kasvun hallinta

### Vaihe 2: Muistin elinkaari (design-03)

**Ratkaistu:**
- Strength-malli: decay × 0.977 per uni, retrieval puolittaa välimatkan 1.0:aan
- Puoliintumisaika 30 unta (λ = 0.0231, η = 0.7)
- Kuolema: strength ≤ 0.05 (ellei vahvoja assosiaatioita)
- Temporaalinen tila: future/present/past, automaattiset siirtymät
- Väritys vain konsolidaatiossa (V1)

**Avoimet:**
- Working-muistin maksimiikä
- η-parametrin herkkyys

### Vaihe 3: Haku ja retrieval (design-04)

Miten agentti löytää relevantteja muistoja.

**Päivitettävä vedos 2:ksi:**
- Hakuputki: embedding+BM25 → strength-painotus → assoc-boost
- Retrieval-sivuvaikutukset: strength-vahvistus + co-retrieval-lokiin kirjaus
- Auto-recall: before_prompt_build

### Vaihe 4: Konsolidaatio (design-05)

"Uni"-vaihe.

**Päivitettävä vedos 2:ksi:**
- Working → consolidated siirto
- Decay-batch: kaikkien muistojen strength × 0.977
- Co-retrieval-lokin prosessointi → assosiaatiot
- Duplikaattien tunnistus ja yhdistäminen
- REM-vaihe: uusien assosiaatioiden löytäminen
- Pruning: kuolleet muistot ja assosiaatiot pois

### Vaihe 5: Integraatio ja migraatio (design-06, design-07)

**Päivitettävä vedos 2:ksi:**
- Tiedostorakenteen muutos
- Yksinkertaistettu hook-set

---

## Dokumenttirakenne

| #  | Tiedosto                     | Sisältö                                                            | Tila    |
| -- | ---------------------------- | ------------------------------------------------------------------ | ------- |
| 00 | `03-design-00-index.md`         | Tämä indeksi ja vaiheistussuunnitelma                              | –       |
| 01 | `03-design-01-data-model.md`    | Muisto-olio, muistotyypit, content hash, SQLite-skeema             | Vedos 2 |
| 02 | `03-design-02-associations.md`  | Assosiaatiorakenne, painot, päivätason seuranta                    | Vedos 2 |
| 03 | `03-design-03-lifecycle.md`     | Luonti, working/consolidated, strength-malli, väritys              | Vedos 2 |
| 04 | `03-design-04-retrieval.md`     | Hakuputki, assosiaatio-boosting, muistotyyppikohtainen strategia   | Vedos 1 |
| 05 | `03-design-05-consolidation.md` | "Uni", Jaccard + embedding, duplikaatit, REM-vaihe                 | Vedos 1 |
| 06 | `03-design-06-integration.md`   | Plugin-rakenne, hookit, system prompt, Osa A -riippuvuudet         | Vedos 1 |
| 07 | `03-design-07-migration.md`     | memory-core → assosiatiivinen muisti, layout-versiointi, rollback  | Vedos 1 |

---

## Päätökset

> Tähän kirjataan tehdyt suunnittelupäätökset sitä mukaa kun ne syntyvät.

| # | Päätös | Perustelu | Vaihe |
| - | ------ | --------- | ----- |
| 1 | Content hash (SHA-256 tekstistä) muiston identiteettinä | Yksinkertainen, content-addressable, atominen assosiaatiopäivitys muutoksissa | 1 |
| 2 | SQLite riittää backendiksi | Oikea skaala, ACID-transaktiot, sqlite-vec + FTS5 jo paikallaan | 1 |
| 3 | Plugin ei valitse embedding-mallia – käyttäjän konfiguraatio | Parempi malli = paremmat assosiaatiot, mutta se on käyttäjän päätös | 1 |
| 4 | Muistotyyppi vaikuttaa retrieval-strategiaan | Tool-usage: BM25-painotteinen, narratiivinen: embedding-painotteinen | 3 |
| 5 | Kaksi tiedostoa: working.md + consolidated.md | Ihmisluettava, yksinkertainen elinkaari, selkeä jako | 1 |
| 6 | Kaksisuuntaiset assosiaatiot, ei tyyppejä V1:ssä | Pelkkä weight riittää MVP:hen, tyypit V2:ssa | 1 |
| 7 | Co-retrieval-seuranta lokitiedostoon (retrieval.log), prosessointi konsolidaatiossa | Ei DB-kirjoituksia normaalikäytössä, ihmisluettava, yksinkertainen | 1–2 |
| 8 | Strength-malli: decay nukkuessa (×0.977), retrieval vahvistaa | Eksponentiaalinen, [0,1], Ebbinghaus-yhteensopiva, 2 parametria | 2 |
| 9 | 30 unen puoliintumisaika (λ=0.0231, η=0.7) | Armollinen, muistot elävät kuukausia ilman retrievalia | 2 |
| 10 | Kaikki muutokset konsolidaatiossa (V1) | Nolla DB-kirjoituksia normaalikäytössä, retrieval.log ainoa kirjoitus | 1–3 |

---

## Avoimet kysymykset

> Keskeiset avoimet kysymykset. Kattavampi lista: `02-research-07-observations.md`.

1. Embedding-pohjainen konsolidaatio: luodaanko uusia assosiaatioita vai vain vahvistetaan olemassa olevia?
2. Konsolidaation kosinisamankaltaisuuden kynnysarvo?
3. Session-memory: hyödynnetäänkö session-memoryn tuottamia tiedostoja vai korvaako plugin session-tallennuksen kokonaan?
4. Miten plugin pääsee embedding-infraan käsiksi? (Osa A -riippuvuus A6)
5. Consolidated.md:n kasvun hallinta pitkällä aikavälillä?
