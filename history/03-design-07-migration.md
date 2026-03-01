# Design-07: Migraatio ja layout-versiointi

> **Tila:** Ensimmäinen vedos (korkea taso)
> **Päivitetty:** 28.2.2026
> **Riippuvuudet:** design-01 (tietomalli), design-06 (integraatio)
> **Ruokkii:** Toteutusvaihe

---

## 1. Tarkoitus

Kuvata miten nykyinen memory-core-muisti siirretään assosiatiiviseen muistiin, miten muistilayout-versiointi toimii, ja miten rollback tapahtuu jos plugin ei toimi.

---

## 2. Layout-versiointi

### 2.1 Konsepti

Muistimalli (layout) on eksplisiittisesti versioitu. Jokainen workspace tietää, mikä muistimalli on käytössä.

| Layout | Kuvaus |
| --- | --- |
| `memory-core-v1` | Nykyinen oletusmalli (flat-tiedostot, mekaaninen chunking) |
| `associative-memory-v1` | Assosiatiivinen muisti (muisto-oliot, assosiaatiot, decay) |

### 2.2 Manifesti

Tallennetaan **kahteen paikkaan** (yhdenmukainen):

1. **Tiedostojärjestelmä:** `memory/.layout.json`
2. **Tietokanta:** `state`-taulu (key=`layout_version`)

Jos nämä ovat ristiriidassa → varoitus, migraatio on kesken tai epäonnistunut.

### 2.3 Manifestin sisältö

```json
{
  "layout": "associative-memory-v1",
  "schema_version": 1,
  "created_at": "2026-02-28T10:00:00Z",
  "migrated_from": "memory-core-v1",
  "migration_completed_at": "2026-02-28T10:05:00Z"
}
```

---

## 3. Migraatio: memory-core-v1 → associative-memory-v1

### 3.1 Yleiskuva

```
memory-core-v1                              associative-memory-v1
┌─────────────────────────┐                 ┌─────────────────────────┐
│ MEMORY.md               │ ──semanttinen──→│ memory/chunks/*.md      │
│ memory/YYYY-MM-DD.md    │    chunking     │                         │
│ memory/YYYY-MM-DD-*.md  │                 │ memory/associations.db  │
│ (SQLite: johdettu)      │                 │ memory/.layout.json     │
└─────────────────────────┘                 └─────────────────────────┘
```

### 3.2 Semanttinen chunking (importointi)

Flat-tiedostojen pilkkominen koherenteiksi muistoyksiköiksi:

**Vaihe 1: Rakenteellinen segmentointi**
- Markdown-otsikot (`##`, `###`) = luonnolliset rajat
- Tyhjät rivit erottavat kappaleet
- Listat ovat koherentteja yksiköitä

**Vaihe 2: Embedding-tarkennus (TextTiling)**
- Liian isoille blokeille: embedataan jokainen rivi, lasketaan kosinisamankaltaisuus vierekkäisten rivien välillä
- Pudotuskohdissa → uusi raja

**Vaihe 3: Pienten blokkien yhdistäminen**
- Alle ~20 tokenin blokit yhdistetään viereiseen jos embedding-samankaltaisuus riittävä

### 3.3 Muistotyypin päätteleminen

Importoiduille muistoille tyyppi arvataan heuristiikalla:
- Sisältää päivämääriä ja tapahtumakuvauksia → `narrative`
- Sisältää "päätettiin", "valittiin" → `decision`
- Sisältää koodia, virheviestejä, komentoja → `tool_usage`
- Sisältää "haluaa", "tykkää", "preferoi" → `preference`
- Muuten → `fact`

LLM voi tarkentaa tyypin (konfiguroitava, vaatii LLM-kutsuja migraatiossa).

### 3.4 Alkuassosiaatioiden luominen

Importoinnin yhteydessä luodaan alkuassosiaatiot:

1. **Samassa tiedostossa** olevat muistot: heikko assosiaatio (0.2)
2. **Embedding-samankaltaisuus:** kosini > 0.7 → assosiaatio (paino = kosini × 0.5)
3. **Temporaalinen läheisyys:** samana päivänä luodut muistot → heikko assosiaatio (0.1)

### 3.5 Migraation vaiheet

1. **Varmuuskopio** – kopioi `memory/` kokonaisuudessaan `memory/.backup-<timestamp>/`
2. **Luo manifesti** – `memory/.layout.json` (tila: `migrating`)
3. **Semanttinen chunking** – pilko flat-tiedostot muistoyksiköiksi
4. **Luo muisto-oliot** – tiedostot `memory/chunks/`, rivit tietokantaan
5. **Luo embeddings** – embedaa kaikki muistot
6. **Luo alkuassosiaatiot** – samankaltaisuuden perusteella
7. **Päivitä manifesti** – tila: `completed`
8. **Siirrä vanhat tiedostot** – `memory/.migrated/` (ei poisteta)

### 3.6 Migraation atomisyys

Migraatio ei ole atominen (voi kestää minuutteja), mutta on **idempotent**:
- Jos keskeyttää, voi aloittaa uudelleen
- Manifesti kertoo missä vaiheessa ollaan
- Varmuuskopio on aina olemassa

---

## 4. Rollback: associative-memory-v1 → memory-core-v1

### 4.1 Mitä menetetään

- Assosiaatiot (eivät käänny flat-tiedostoiksi)
- Per-muisto decay-tila
- Tick-historia
- Konsolidaatiohistoria
- Muistojen narratiivinen uudelleenkirjoitus (konsolidaation/värityksen muutokset)

**Mitä säilyy:** Muistojen sisältö (viimeisin versio).

### 4.2 Rollback-prosessi

1. Exporttaa muistot flat-tiedostoiksi:
   - `memory/chunks/*.md` → yhdistä `MEMORY.md`:ksi (tai `memory/`-hakemiston tiedostoiksi)
   - Muiston frontmatter → markdown-osio
2. Poista `associations.db`
3. Päivitä `.layout.json` → `memory-core-v1`
4. Käynnistä memory-core uudelleen (reindex)

### 4.3 Rollback-työkalu

CLI-komento: `openclaw associative-memory rollback`

---

## 5. Uuden käyttäjän onboarding (ei olemassa olevaa muistia)

### 5.1 Tyhjästä aloittaminen

Jos workspace:ssa ei ole olemassa olevaa muistia:
1. Luo `memory/`-hakemisto
2. Luo `memory/.layout.json` (tila: `initialized`)
3. Luo tyhjä `associations.db` (skeema, ei dataa)
4. Plugin alkaa kerätä muistoja hookien ja työkalujen kautta

### 5.2 Bootstrapping

Ensimmäisten sessioiden aikana muisteja on vähän → assosiaatioita ei vielä ole → järjestelmä toimii kuten tavallinen muisti. Assosiaatioiden arvo kasvaa vasta kun muistoja kertyy.

---

## 6. Skeemamigraatiot (tulevat versiot)

### 6.1 Skeemaversio

`schema_version` manifestissa kertoo tietokannan skeemaversion. Kun plugin päivittyy:

1. Plugin tarkistaa manifestin `schema_version`:n
2. Jos < nykyinen → ajaa migraatioskriptit järjestyksessä
3. Päivittää `schema_version`:n

### 6.2 Migraatioskriptien rakenne

```
src/migrations/
├── 001-initial.sql
├── 002-add-temporal-anchor.sql
└── ...
```

---

## 7. Avoimet kysymykset

1. **Semanttisen chunkingin laatu:** Miten testataan importoinnin laatua? Manuaalinen tarkastus?
2. **LLM-kutsut migraatiossa:** Halutaanko LLM:n tarkentavan muistotyyppejä? Kustannusvaikutus?
3. **Vanhojen tiedostojen kohtalo:** Poistetaanko `MEMORY.md` ja `memory/*.md` migraation jälkeen vai säilytetäänkö `memory/.migrated/`-hakemistossa?
4. **session-memory-hookin tiedostot:** Migraatiossa importoidaanko `memory/YYYY-MM-DD-<slug>.md` -tiedostot?
5. **Migraation kesto:** Suurella muistilla (tuhansia tiedostoja) kesto? Onko progressi-indikaattori tarpeen?

---

## 8. Kytkökset muihin design-dokumentteihin

- **design-01 (Tietomalli):** Muisto-olion rakenne, skeema
- **design-02 (Assosiaatiot):** Alkuassosiaatioiden luominen
- **design-06 (Integraatio):** Plugin-asennus ja konfiguraatio
- **Research-06 (Nykyinen muisti):** memory-core:n rakenne jota migroitaan
- **Research-07 (Havainnot):** Importoinnin haasteet
