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
- **Decay** – per-muisto rapautuminen käyttötiheydestä riippuen
- **Muistotyyppikohtainen retrieval** – eri hakustrategiat eri muistotyypeille
- **Väritetyt muistot** – muistot muuttuvat palautettaessa

---

## Vaiheistus

### Vaihe 1: Tietomalli (design-01, design-02)

Perusta kaikelle muulle. Vastaa kysymyksiin:

- Mikä on "muisto"? Miten se eroaa chunkista?
- Miten muistot identifioidaan? (Content hash -malli)
- Mitä muistotyyppejä on? (Narratiivinen, tool-usage, päätös, fakta...)
- Miten assosiaatiot rakentuvat? Mitä tyyppejä niillä on?
- Mikä on SQLite-skeema?
- Miten memory-layout manifesti toimii?

**Riippuvuudet:** Research-sarja (valmis), observations (jatkuva)
**Avoimet kysymykset joihin vastattava:**
- Muistoyksikön koko (dynaaminen vs. kiinteä, yläraja?)
- Assosiaation suunta (yksi- vai kaksisuuntainen?)
- Muistotyyppien lopullinen lista

### Vaihe 2: Muistin elinkaari (design-03)

Miten muistot syntyvät, elävät ja kuolevat. Vastaa kysymyksiin:

- Miten muisto luodaan? (Hookista, agentin työkalusta, importista, konsolidaatiosta)
- Miten temporaalinen tila toimii? (Futuuri → preesens → imperfekti)
- Miten tick-mekanismi toimii?
- Miten decay lasketaan per-muisto?
- Miten muiston sisällön muutos päivittää assosiaatiot atomisesti?
- Miten "väritetty muisto" toimii konkreettisesti?

**Riippuvuudet:** Vaihe 1 (tietomalli ja skeema)

### Vaihe 3: Haku ja retrieval (design-04)

Miten agentti löytää relevantteja muistoja. Vastaa kysymyksiin:

- Miten hakuputki toimii? (Vektori + BM25 + assosiaatio-boosting)
- Miten muistotyyppi vaikuttaa hakustrategiaan?
- Miten assosiaatiot vaikuttavat tulosten pisteytykseen?
- Mitä agentille injektoidaan kontekstiin? Miten paljon?
- Miten system prompt -osio generoidaan?
- Miten retrieval vahvistaa assosiaatioita (co-retrieval)?

**Riippuvuudet:** Vaihe 1 (tietomalli), Vaihe 2 (elinkaari, decay)

### Vaihe 4: Konsolidaatio (design-05)

"Uni"-vaihe: taustaprosessi joka järjestää ja vahvistaa muistia. Vastaa kysymyksiin:

- Miten Jaccard-esikarsinta + embedding-konsolidaatio toimii?
- Miten uusia assosiaatioita löydetään? ("REM-uni")
- Miten duplikaatit tunnistetaan ja yhdistetään?
- Miten konsolidaatio ajoitetaan? (Cron/service)
- Miten konsolidaatio muokkaa muistoja ja päivittää hashit/assosiaatiot atomisesti?
- Milloin muisto kuolee (decay → poisto)?

**Riippuvuudet:** Vaihe 1–3

### Vaihe 5: Integraatio ja migraatio (design-06, design-07)

Miten plugin istuu OpenClaw:iin ja miten siihen siirrytään. Vastaa kysymyksiin:

- Plugin-rakenne: hookit, työkalut, service, CLI
- Osa A -riippuvuudet: mitkä tarvitaan MVP:hen? Mitkä voivat odottaa?
- Memory-layout manifesti: tiedosto + tietokanta
- Migraatiostrategia: memory-core-v1 → associative-memory-v1
- Semanttinen chunking importoinnissa (TextTiling / hybridi)
- Rollback: associative-memory-v1 → memory-core-v1

**Riippuvuudet:** Vaihe 1–4, Osa A -keskustelu OpenClaw:n tekijöiden kanssa

---

## Dokumenttirakenne

| #  | Tiedosto                     | Sisältö                                                            | Tila    |
| -- | ---------------------------- | ------------------------------------------------------------------ | ------- |
| 00 | `03-design-00-index.md`         | Tämä indeksi ja vaiheistussuunnitelma                              | –       |
| 01 | `03-design-01-data-model.md`    | Muisto-olio, muistotyypit, content hash, SQLite-skeema             | Tulossa |
| 02 | `03-design-02-associations.md`  | Assosiaatiorakenne, tyypit, painot, päivitysmekaniikat              | Tulossa |
| 03 | `03-design-03-lifecycle.md`     | Luonti, temporaalinen tila, tick, decay, väritys                   | Tulossa |
| 04 | `03-design-04-retrieval.md`     | Hakuputki, assosiaatio-boosting, muistotyyppikohtainen strategia   | Tulossa |
| 05 | `03-design-05-consolidation.md` | "Uni", Jaccard + embedding, duplikaatit, REM-vaihe                 | Tulossa |
| 06 | `03-design-06-integration.md`   | Plugin-rakenne, hookit, system prompt, Osa A -riippuvuudet         | Tulossa |
| 07 | `03-design-07-migration.md`     | memory-core → assosiatiivinen muisti, layout-versiointi, rollback  | Tulossa |

---

## Päätökset

> Tähän kirjataan tehdyt suunnittelupäätökset sitä mukaa kun ne syntyvät.

| # | Päätös | Perustelu | Vaihe |
| - | ------ | --------- | ----- |
| 1 | Content hash (SHA-256 tekstistä) muiston identiteettinä | Yksinkertainen, content-addressable, atominen assosiaatiopäivitys muutoksissa | 1 |
| 2 | SQLite riittää backendiksi | Oikea skaala, ACID-transaktiot, sqlite-vec + FTS5 jo paikallaan | 1 |
| 3 | Plugin ei valitse embedding-mallia – käyttäjän konfiguraatio | Parempi malli = paremmat assosiaatiot, mutta se on käyttäjän päätös | 1 |
| 4 | Muistotyyppi vaikuttaa retrieval-strategiaan | Tool-usage: BM25-painotteinen, narratiivinen: embedding-painotteinen | 3 |

---

## Avoimet kysymykset

> Keskeiset avoimet kysymykset, jotka pitää ratkaista suunnittelun aikana. Kattavampi lista: `02-research-07-observations.md`.

1. Muistoyksikön maksimikoko? Dynaaminen vs. kiinteä, yläraja?
2. Assosiaation suunta: yksisuuntainen vai kaksisuuntainen?
3. Embedding-pohjainen konsolidaatio: luodaanko uusia assosiaatioita vai vain vahvistetaan olemassa olevia?
4. Konsolidaation kosinisamankaltaisuuden kynnysarvo?
5. Session-memory: hyödynnetäänkö session-memoryn tuottamia tiedostoja vai korvaako plugin session-tallennuksen kokonaan?
6. Miten plugin pääsee embedding-infraan käsiksi? (Osa A -riippuvuus A6)
