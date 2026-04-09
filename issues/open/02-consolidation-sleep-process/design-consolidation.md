# Design-05: Konsolidaatio ("uni")

> **Tila:** Vedos 4
> **Päivitetty:** 7.3.2026
> **Riippuvuudet:** design-01 (tietomalli), design-02 (assosiaatiot), design-03 (elinkaari), design-04 (retrieval)
> **Ruokkii:** design-06 (integraatio)

---

## 1. Tarkoitus

Kuvata uniprosessi – taustajärjestelmä joka prosessoi päivän tapahtumat, vahvistaa ja heikentää muistoja, päivittää assosiaatiot, siirtää tuoreet muistot pitkäkestomuistiin, ja siivoaa kuolleet pois.

Biologinen analogia: uni. Prosessi ajetaan silloin kun agentti ei ole aktiivinen.

**V1-periaate:** Uni on ainoa paikka jossa muistijärjestelmän tila muuttuu (paitsi uuden muiston luonti). Kaikki strength-päivitykset, assosiaatiomuutokset, decay ja pruning tapahtuvat täällä.

---

## 2. Perusperiaatteet

### 2.1 Funktionaalisuus, ei totuudenmukaisuus

Muistot eivät ole arkisto. Uniprosessin tavoite on pitää muistot **funktionaalisina** – hyödyllisinä agentin toiminnalle. Tämä tarkoittaa, että konsolidaatio voi vapaasti:

- Kirjoittaa muistoja joita ei ole edes tarkalleen ottaen tapahtunut. Esimerkiksi muistossa jossa käsitellään jonkin ohjelman jotakin tiettyä vikatilannetta ja siihen tulleita ratkaisuja, voi konsolidaatiossa muuttua radikaalistikin vastaamaan ohjelman päivitettyä versiota.
- Yhdistää kaksi muistoa yhdeksi ("Jari kävi Tampereella" × 3 → "Jari käy usein Tampereella")
- Päivittää muiston sisältöä uudemman tiedon perusteella ("harkitsee aloittamista" → "aloitti projektin")
- Poistaa muistoja jotka eivät ole enää relevantteja

### 2.2 Kaikki kerralla

Konsolidaatio prosessoi kaiken yhtenä eränä. Se lukee retrieval.log:n, päivittää tilan ja tyhjentää lokin. Seuraava uni aloittaa puhtaalta pöydältä.

---

## 3. Unen vaiheet

```
Uni
├── 1. Retrieval-vahvistus       ← retrieval.log → strength-päivitys
├── 2. Decay                     ← working ×0.906, consolidated ×0.977
├── 3. Assosiaatiopäivitys       ← retrieval.log → co-retrieval → assosiaatiot
├── 4. Kertautuva assosiaatio    ← epäsuorat yhteydet vahvistuvat
├── 5. Working → consolidated    ← siirto + strength → 1.0
├── 6. Temporaaliset siirtymät   ← future→present→past tarkistus
├── 7. Duplikaattien yhdistäminen ← Jaccard + embedding → LLM yhdistää
├── 8. Väritys                   ← muistojen päivitys uudemman tiedon perusteella
├── 9. Pruning                   ← kuolleet muistot ja assosiaatiot pois
└── 10. Lokin tyhjennys          ← retrieval.log tyhjennetään
```

**Järjestys on tärkeä:**

- Retrieval-vahvistus ennen decayta (päivän käyttö huomioidaan ensin)
- Decay ennen working→consolidated-siirtoa (heikot muistot karsiutuvat)
- Assosiaatiot ennen kertautuvaa assosiaatiota (tarvitsee päivitetyt painot)
- Kertautuva assosiaatio ennen pruningia (kuolleet eivät luo uusia)
- Duplikaattien yhdistäminen ennen väritystä (ensin yhdistä, sitten väritä)
- Väritys ennen pruningia (väritetyt muistot saavat uudet hashit)

---

## 4. Vaihe 1: Retrieval-vahvistus

Konsolidaatio parsii retrieval.log:n ja laskee jokaiselle muistolle painotetun retrieval-pisteen `w` (design-03, kohta 4.2):

```
Jokaiselle muistolle M retrieval.log:ssa:
  w = 0
  search-rivillä M:       w += 1.0
  feedback-rivillä M:     w += stars/3
  recall-rivillä M:       w += 0.5
  store context:M:        w += 2.0

  strength ← 1 - (1 - strength) × e^(-η × w)    (η = 0.7)
```

---

## 5. Vaihe 2: Decay

Kaikkien muistojen strength rapautuu (design-03, kohta 4.1):

```
Working-muistot:      strength ← strength × 0.906    (puoliintumisaika 7 unta)
Consolidated-muistot: strength ← strength × 0.977    (puoliintumisaika 30 unta)
```

---

## 6. Vaihe 3: Assosiaatiopäivitys

Sama retrieval.log prosessoidaan co-retrieval-parien osalta → assosiaatiot päivittyvät. Tämä on kuvattu kokonaan design-02:ssa (kohta 5). Konsolidaatio myös heikentää kaikkien assosiaatioiden painoja (design-02, kohta 5.2).

---

## 7. Vaihe 4: Kertautuva assosiaatio

Kertautuva assosiaatio vahvistaa epäsuoria yhteyksiä (design-02, kohta 6):

```
Jokaiselle co-retrieval-joukolle {A, B, C} retrieval.log:ssa:
  Etsi muisto X jolla:
    - assoc(X, A) > 0 JA assoc(X, B) > 0 (tai C)
    - X ei ollut haussa
  → Vahvista X:n assosiaatioita A:han, B:hen, C:hen
```

Biologinen analogia: "neurons that fire together wire together" – mutta myös ne neuronit jotka ovat yhteydessä aktiivisiin neuroneihin aktivoituvat.

---

## 8. Vaihe 5: Working → consolidated

Kaikki working-muistot siirretään:

1. Muisto siirtyy working.md → consolidated.md
2. `consolidated` = 1, `file_path` = consolidated.md
3. **Strength → 1.0** (uusi alku pitkäkestomuistina, design-03 kohta 4.3)
4. Working.md tyhjennetään (jätetään otsikko)

Kaikki operaatiot yhdessä SQLite-transaktiossa.

---

## 9. Vaihe 6: Temporaaliset siirtymät

Tarkistetaan muistojen temporaaliset tilat (design-03, kohta 5.2):

- `future` → `present`: kun nykyhetki ≥ temporal_anchor
- `present` → `past`: kun nykyhetki > temporal_anchor + kesto

Transitiossa olevat muistot merkitään – before_prompt_build pakkoinjektoi ne kontekstiin (design-03, kohta 5.3).

---

## 10. Vaihe 7: Duplikaattien tunnistaminen ja yhdistäminen

### 10.1 Tunnistaminen

Äskettäin konsolidoidut muistot verrataan olemassa oleviin:

1. **Jaccard-esikarsinta:** jos `|tokens(i) ∩ tokens(j)| / |tokens(i) ∪ tokens(j)|` > 0.6 → kandidaatti
2. **Embedding-tarkennus:** kosini > 0.85 → yhdistä, 0.7–0.85 → LLM tarkistaa

### 10.2 Yhdistäminen

1. LLM yhdistää sisällöt yhdeksi funktionaaliseksi muistoksi
2. Uusi hash, uusi muisto consolidated.md:hen (source=`consolidation`)
3. Assosiaatiot peritään molemmilta (painot yhdistetään)
4. Vanhat poistetaan
5. Atominen transaktio

**Konsolidaation progressio:**

```
1. kerta: "Jari kertoi menevänsä Tampereelle"
2. kerta: "Jari sanoi olevansa matkalla"
  → Konsolidaatio: "Jari oli matkalla Tampereella"
3. kerta: → "Jari on käynyt kolme kertaa Tampereella"
  → "Jari matkustaa usein Tampereelle"
```

---

## 11. Vaihe 8: Väritys

Muistoja päivitetään uudemman tiedon perusteella (design-03, kohta 6):

1. LLM saa kontekstiin: muisto + siihen assosioituvat uudemmat muistot
2. LLM arvioi: onko muisto edelleen relevantti sellaisenaan?
3. Jos ei: LLM kirjoittaa päivitetyn version
4. Päivitetty muisto saa uuden hashin → assosiaatiot siirretään atomisesti

**Esimerkki:**

- Alkuperäinen: "Jari harkitsee projektin aloittamista"
- Uudempi assosioitu muisto: "Jari aloitti projektin"
- Väritetty: "Jari aloitti projektin jonka hän oli harkinnut"

**Ero duplikaattien yhdistämiseen:** Yhdistäminen kohdistuu kahteen samankaltaiseen muistoon. Väritys kohdistuu yhteen muistoon, joka päivitetään siihen assosioituvien muistojen perusteella.

---

## 12. Vaihe 9: Pruning

### 12.1 Kuolleet muistot

```
strength ≤ 0.05 JA ei vahvoja assosiaatioita (weight ≤ 0.3):
  → Poistetaan tiedostosta ja tietokannasta
```

### 12.2 Kuolleet assosiaatiot

```
weight < 0.01 → poistetaan
```

---

## 13. Vaihe 10: Lokin tyhjennys

`retrieval.log` tyhjennetään. V1:ssä suora tyhjennys riittää.

---

## 14. Ajastus ja trigger

| Trigger           | Kuvaus                                           |
| ----------------- | ------------------------------------------------ |
| **Cron**          | Ajastettu aika (esim. yöllä) – ensisijainen      |
| **Inaktiivisuus** | Käyttäjä ei aktiivinen N tuntiin                 |
| **Manuaalinen**   | `openclaw memory consolidate` tai agentin pyyntö |

Plugin rekisteröi servicen joka tarkistaa ajastuksen ja suorittaa konsolidaation kun trigger laukeaa.

---

## 15. LLM-kustannukset

Konsolidaatio vaatii LLM-kutsuja duplikaattien yhdistämiseen ja muistojen väritykseen. Kustannusten hallinta:

- **Edullisempi malli** (konfiguroitava)
- **Batch-prosessointi** (monta yhdistämis-/värityspäätöstä per kutsu)
- **Jaccard + embedding** karsiovat ennen LLM-kutsuja (duplikaatit)
- **Assosiaatiovahvuus** karsii ennen LLM-kutsuja (väritys: vain vahvasti assosioituvat uudemmat muistot)

---

## 16. V2-laajennettavuus

Myöhemmin uniprosessiin voidaan lisätä:

- **Uusien assosiaatioiden löytäminen:** satunnainen otanta muistoja → embedding-haku → semanttisesti samankaltaisille luodaan assosiaatioita (löytää yhteyksiä joita co-retrieval ei ole paljastanut)
- **Muistotyyppikohtainen decay:** eri tyypit rapautuvat eri nopeudella

---

## 17. Avoimet kysymykset

1. **Konsolidaation kesto:** Timeout tarpeen?
2. **LLM-malli:** Konfiguroitava halvempi malli?
3. **Assosiaatioiden normalisointi:** Rajoitetaanko per muisto?
4. **Raportointi:** Kerrotaanko agentille mitä konsolidaatio teki?
5. **Värityksen aggressiivisuus:** Kuinka herkästi muistoja päivitetään?

---

## 18. Päätökset

| #   | Päätös                                                                    | Perustelu                                                     |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Uni on ainoa tilan muuttaja (V1)                                          | Yksinkertainen, ennustettava                                  |
| 2   | 10-vaiheinen prosessi kiinteässä järjestyksessä                           | Vahvistus → decay → assosiaatiot → siirto → väritys → pruning |
| 3   | Working → consolidated: strength → 1.0                                    | Pitkäkestomuistiin siirtyminen = uusi alku                    |
| 4   | Eri decay: working ×0.906, consolidated ×0.977                            | Tuoreet karsiutuvat nopeasti                                  |
| 5   | Muistoja päivitetään funktionaalisiksi, ei pidetä totuudenmukaisina       | Konsolidaatio yhdistää, tiivistää ja päivittää vapaasti       |
| 6   | Kertautuva assosiaatio vahvistaa epäsuoria yhteyksiä                      | Löytää piilossa olevia relevansseja                           |
| 7   | Väritys päivittää muistoja assosioituvien uudempien muistojen perusteella | Funktionaalisuusperiaate: muistot pysyvät relevantteina       |

---

## 19. Kytkökset muihin design-dokumentteihin

- **design-01 (Tietomalli):** Muiston hash-päivitys yhdistämisessä ja värityksessä, skeema, tiedostoformaatti
- **design-02 (Assosiaatiot):** Co-retrieval-lokin prosessointi → assosiaatiopäivitys ja -decay, kertautuva assosiaatio
- **design-03 (Elinkaari):** Decay-kaavat, strength-vahvistus, working→consolidated, kuolema, temporaaliset siirtymät, väritys
- **design-04 (Retrieval):** retrieval.log on konsolidaation syöte
- **design-06 (Integraatio):** Service-rekisteröinti, ajastus, CLI
