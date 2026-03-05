# Design-02: Assosiaatiot

> **Tila:** Vedos 2 (yksinkertaistettu malli)
> **Päivitetty:** 28.2.2026
> **Riippuvuudet:** design-01 (tietomalli)
> **Ruokkii:** design-03 (elinkaari), design-04 (retrieval), design-05 (konsolidaatio)

---

## 1. Tarkoitus

Määritellä miten muistojen väliset assosiaatiot rakentuvat, päivittyvät ja vaikuttavat muistijärjestelmän toimintaan. Assosiaatiot ovat koko järjestelmän ydin – ne tekevät muistista *assosiatiivisen*.

---

## 2. Assosiaation peruskäsitteet

### 2.1 Mikä on assosiaatio?

Assosiaatio on **painotettu linkki kahden muiston välillä**. Se ilmaisee, kuinka vahvasti nämä muistot liittyvät toisiinsa agentin "kokemushistoriassa".

Biologinen analogia: Hebin sääntö – "neurons that fire together wire together". Muistot, jotka palautetaan yhdessä, assosioituvat toisiinsa.

### 2.2 Assosiaation ominaisuudet (V1, minimaaliset)

| Ominaisuus | Tyyppi | Kuvaus |
| --- | --- | --- |
| `memory_a` | string | Muisto A (aakkosjärjestyksessä pienempi hash) |
| `memory_b` | string | Muisto B (aakkosjärjestyksessä suurempi hash) |
| `weight` | float | Assosiaation vahvuus [0.0, 1.0] |
| `created_at` | datetime | Milloin assosiaatio syntyi |
| `last_updated_at` | datetime | Milloin viimeksi päivitetty |

**V1-yksinkertaistus:** Ei assosiaatiotyyppejä – pelkkä weight riittää. Tyypit (co_retrieval, co_creation, temporal) voidaan lisätä V2:ssa.

---

## 3. Suunta: kaksisuuntainen

**Päätös:** Kaksisuuntainen assosiaatio (yksi rivi tietokannassa per pari).

Tallennetaan aina `(min(a,b), max(a,b))` → yksiselitteinen järjestys, ei duplikaatteja.

```sql
PRIMARY KEY (memory_a, memory_b),
CHECK (memory_a < memory_b)
```

---

## 4. Päivätason assosiaatioseuranta

### 4.1 Perusperiaate (V1-yksinkertaistus)

Assosiaatioita **ei päivitetä reaaliajassa**. Sen sijaan:

1. **Päivän aikana:** Kirjataan co-retrieval-tapahtumat kevyeen lokiin
2. **Nukkuessa (konsolidaatio):** Loki prosessoidaan → varsinaiset assosiaatiot päivittyvät

Tämä yksinkertaistaa reaaliaikaista koodia merkittävästi.

### 4.2 Retrieval-lokitiedosto

Co-retrieval-tapahtumat kirjataan append-only-lokitiedostoon `memory/retrieval.log`:

```
2026-03-05T14:30:00Z search a1b2c3d4 e5f6a7b8 c9d0e1f2
2026-03-05T14:35:00Z search a1b2c3d4 f3a4b5c6
2026-03-05T14:35:12Z store  f3a4b5c6 context:a1b2c3d4,e5f6a7b8
```

- `search` = nämä muistot palautuivat yhdessä (co-retrieval)
- `store` = uusi muisto luotiin näiden kontekstissa (co-creation)

Esimerkki: haku palauttaa muistot {A, B, C} → lokiin kirjataan yksi `search`-rivi kolmella hash:lla. Konsolidaatio laskee parit (A-B, A-C, B-C) ja niiden esiintymiskerrat.

**Miksi lokitiedosto eikä SQLite-taulu:**
- Ei tietokantakirjoituksia normaalikäytössä (vain tiedosto-append)
- Ihmisluettava – näkee suoraan mitä agentti on hakenut
- Debug-ystävällinen – retrieval-patternit näkyvissä ennen konsolidaatiota
- Volyymi pieni (~100–5000 paria/päivä)

### 4.3 Co-creation (uuden muiston luonti)

Kun uusi muisto M luodaan, kirjataan `store`-rivi retrieval.log:iin. `context:`-kentässä luetellaan ne muistot, jotka ovat juuri haettu kontekstiin (viimeisin memory_search -tulos).

Konsolidaatio käsittelee `store`-rivit samalla logiikalla kuin `search`-rivit – luo assosiaatioparit uuden muiston ja kontekstimuistojen välille.

---

## 5. Assosiaatioiden päivitys konsolidaatiossa

### 5.1 Co-retrieval → assosiaatiot

Konsolidaatio parsii `retrieval.log`:n ja päivittää varsinaiset assosiaatiot:

```
Jokaiselle parille (A, B) lokissa:
  jos assosiaatio (A, B) ei ole olemassa:
    luo uusi assosiaatio, weight = α × count
  muuten:
    vahvista: weight ← 1 - (1 - weight) × e^(-α × count)
```

Missä `α` on vahvistuskerroin (konfiguroitava, esim. 0.1).

**Vahvistuskaava** on sama "jäljellä olevan välimatkan kutistaminen" kuin retrieval-vahvistus – ei voi ylittää 1.0:aa, hidastuu lähellä huippua.

### 5.2 Assosiaatioiden decay

Konsolidaatiossa kaikkien assosiaatioiden painoja heikennetään:

```
weight ← weight × e^(-λ_assoc)
```

Missä `λ_assoc` on assosiaation decay-nopeus (voi olla eri kuin muistojen λ). Jos weight < 0.01 → assosiaatio poistetaan.

### 5.3 Lokin tyhjennys

Konsolidaation jälkeen `retrieval.log` tyhjennetään (tai nimetään uudelleen arkistointia varten, esim. `retrieval-2026-03-05.log`).

---

## 6. Kertautuva assosiaatio (Jarin alkuperäinen idea)

### 6.1 Konsepti

"Jos muistolla X on keskivahva assosiaatio muistoihin A, B, C, ja tilanne palauttaa juuri A, B, C kontekstiin, X:n assosiaatio joukkoon (A, B, C) on kertautuvasti vahva."

### 6.2 V1-toteutus: konsolidaatiossa

Kertautuva assosiaatio lasketaan **konsolidaatiossa**, ei reaaliajassa:

1. Käy läpi päivän co-retrieval-loki
2. Jos muistot {A, B, C} haettiin yhdessä, etsi muisto X jolla:
   - assoc(X, A) > 0 JA assoc(X, B) > 0 (tai C)
   - X ei ollut haussa
3. Vahvista X:n assosiaatiota A:han, B:hen, C:hen

### 6.3 V2-laajennettavuus

Myöhemmässä versiossa kertautuva assosiaatio voidaan laskea myös reaaliajassa (retrieval-vaiheessa) "piilomuistojen" löytämiseksi (ks. design-04).

---

## 7. Harva matriisi

Tallennetaan vain **eksplisiittiset assosiaatiot** (weight > 0). Suurin osa muistopareista ei koskaan assosioidu.

- 1000 muistoa, joista jokainen assosioituu keskimäärin 20 muistoon → ~10 000 riviä
- Assosiaatio, jonka weight < 0.01, poistetaan konsolidaatiossa

```sql
CREATE INDEX idx_assoc_a ON associations(memory_a);
CREATE INDEX idx_assoc_b ON associations(memory_b);
CREATE INDEX idx_assoc_weight ON associations(weight DESC);
```

---

## 8. Avoimet kysymykset

1. **α-parametri (vahvistuskerroin):** Mikä arvo? Tarvitseeko empiirinen viritys?
2. **λ_assoc:** Sama kuin muistojen λ vai eri? Pitäisikö assosiaatioiden rapautua hitaammin tai nopeammin kuin muistojen?
3. **Maksimiassosiaatiot per muisto:** Rajoitetaanko (esim. top-50) vai annetaan kasvaa vapaasti?
4. **Kertautuvan assosiaation kynnysarvo:** Miten monta assosiaatiota "samaan suuntaan" tarvitaan?

---

## 9. Päätökset

| # | Päätös | Perustelu |
| - | ------ | --------- |
| 1 | Kaksisuuntaiset assosiaatiot | Yksinkertainen, symmetrinen malli |
| 2 | Ei assosiaatiotyyppejä V1:ssä | Pelkkä weight riittää, tyypit V2:ssa |
| 3 | Co-retrieval-seuranta lokitiedostoon (retrieval.log), prosessointi konsolidaatiossa | Ei DB-kirjoituksia normaalikäytössä, ihmisluettava, yksinkertainen |
| 4 | Sama vahvistuskaava kuin muistoille | 1 - (1-w) × e^(-α×count), ei ylitä 1.0 |

---

## 10. Kytkökset muihin design-dokumentteihin

- **design-01 (Tietomalli):** associations-taulun skeema, retrieval.log-formaatti
- **design-03 (Elinkaari):** Assosiaatioiden luonti muiston syntyessä
- **design-04 (Retrieval):** Assosiaatio-boosting hakutuloksissa
- **design-05 (Konsolidaatio):** Co-retrieval-lokin prosessointi, kertautuva assosiaatio, pruning
- **design-06 (Integraatio):** after_tool_call-hookista retrieval.log-kirjaus
