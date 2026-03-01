# Design-03: Muiston elinkaari

> **Tila:** Vedos 2 (yksinkertaistettu malli)
> **Päivitetty:** 28.2.2026
> **Riippuvuudet:** design-01 (tietomalli), design-02 (assosiaatiot)
> **Ruokkii:** design-04 (retrieval), design-05 (konsolidaatio)

---

## 1. Tarkoitus

Kuvata muiston koko elinkaari: miten se syntyy, miten se liikkuu working-muistista konsolidoituun, miten se vahvistuu ja rapautuu, ja milloin se kuolee.

---

## 2. Elinkaaren yleiskuva

```
  Luonti ──→ working.md ──→ Konsolidaatio ("uni") ──→ consolidated.md
                                    │
                                    ├── Decay (strength × 0.977)
                                    ├── Assosiaatiot päivitetään
                                    ├── Duplikaatit yhdistetään
                                    └── Kuolleet poistetaan (strength ≤ 0.05)

  Retrieval (milloin tahansa) ──→ strength vahvistuu
```

### 2.1 Kaksi vaihetta

| Vaihe | Tiedosto | Kuvaus |
| --- | --- | --- |
| **Working** | `working.md` | Tuoreet, konsolidoimattomat muistot. Syntyneet tämän päivän aikana. |
| **Consolidated** | `consolidated.md` | Vähintään kerran konsolidoidut muistot. Pitkäkestomuisti. |

Konsolidaatio siirtää muistot working → consolidated. Tämä on selkeä elinkaaren raja.

---

## 3. Muiston syntytavat

### 3.1 Agentin työkalu (eksplisiittinen)

Agentti kutsuu `memory_store`-työkalua:
- Agentti valitsee tyypin (narrative, fact, decision...)
- Agentti kirjoittaa sisällön narratiivisena
- Plugin laskee hashin, lisää chunkin working.md:hen, päivittää tietokannan
- Co-retrieval-lokiin kirjataan yhteys kontekstissa oleviin muistoihin

### 3.2 Automaattinen kaappaus (hookista)

Plugin observoi `agent_end` tai `before_reset`-hookista:
- Analysoi keskustelun ja tunnistaa tallennettavat muistot
- Muistot lisätään working.md:hen source=`hook_capture`

### 3.3 Konsolidaatio (yhdistäminen)

Konsolidaatio voi luoda uusia muistoja (design-05):
- Useasta muistosta syntyy yksi tiivistetty muisto (interpretation)
- Nämä syntyvät suoraan consolidated.md:hen

### 3.4 Importointi (migraatio)

Memory-core-muistojen tuonti (design-07):
- Importoidut muistot menevät suoraan consolidated.md:hen (ne ovat jo "vanhoja")

---

## 4. Strength-malli

### 4.1 Kaksi operaatiota

**Decay (nukkuessa):**
```
strength ← strength × e^(-λ)
```
- `λ = ln(2) / 30 ≈ 0.0231`
- Käytännössä: `strength ← strength × 0.977` per uni
- Puoliintumisaika: 30 unta

**Retrieval (milloin tahansa):**
```
strength ← 1 - (1 - strength) × e^(-η)
```
- `η = 0.7`
- Yksi retrieval puolittaa välimatkan 1.0:aan

### 4.2 Ominaisuudet

- **Aina (0, 1]** – molemmat kaavat ovat multiplikatiivisia
- **Uusi muisto:** strength = 1.0
- **Ei-haettu muisto 30 unen jälkeen:** strength ≈ 0.50
- **Ei-haettu muisto 120 unen jälkeen:** strength ≈ 0.06 → lähestyy kuolemaa
- **Päivittäin haettu:** konvergoituu ~0.66:een (vakiotila)
- **Viikoittain haettu:** konvergoituu ~0.86:een

### 4.3 Esimerkkitaulukko (ei-haettu muisto)

```
Uni  1:  0.977
Uni  7:  0.851
Uni 30:  0.500
Uni 60:  0.250
Uni 90:  0.125
Uni 120: 0.063
Uni 130: 0.050  ← kuolema-kynnys
```

### 4.4 Muiston kuolema

- Strength ≤ 0.05 → konsolidaatio merkitsee kuolleeksi
- **Lisäehto:** jos muistolla on vahvoja assosiaatioita (weight > 0.3), se **ei kuole** – assosiaatio pitää sen elossa
- Kuolleet muistot poistetaan tiedostosta ja tietokannasta konsolidaation yhteydessä

### 4.5 V2-laajennettavuus

Myöhemmin voidaan lisätä:
- **Muistotyyppikohtainen λ:** preference rapautuu hitaammin, tool_usage nopeammin
- **Retrieval-count-riippuva λ:** `λ(n) = λ₀ / (1 + κn)` – usein haettu muisto rapautuu hitaammin (Ebbinghaus-spacing-efekti)
- Nämä eivät vaadi arkkitehtuurimuutoksia – pelkkä kaavan päivitys

---

## 5. Temporaalinen tila

### 5.1 Kolme tilaa

| Tila | Merkitys | Esimerkki |
| --- | --- | --- |
| `future` | Ei vielä tapahtunut | "Jari kertoi menevänsä Tampereelle ma 2.3." |
| `present` | Tapahtuu parhaillaan | "Jari on nyt Tampereella" |
| `past` | Jo tapahtunut | "Jari kävi Tampereella" |

### 5.2 Siirtymät

Temporaalinen tila siirtyy **automaattisesti** `temporal_anchor`-päivämäärän perusteella:
- `future` → `present`: kun nykyhetki ≥ anchor
- `present` → `past`: kun nykyhetki > anchor + kesto

**Tarkistuspiste:** Konsolidaatiossa tarkistetaan kaikkien muistojen temporaaliset siirtymät. Myös before_prompt_build-hookissa voidaan tarkistaa (V2).

### 5.3 Transitiopäivien boosting

Jarin idea: muisto assosioituu voimakkaammin transitiopäiviin. Käytännössä:
- Muiston strength saa tilapäisen boosting retrievalissa kun `temporal_state` on juuri muuttumassa
- Tämä toteutetaan hakuputkessa (design-04), ei strength-mallissa

### 5.4 Epistemologinen tarkkuus

"Jari kertoi menevänsä" – ei "Jari menee". Muisto tallentaa **mistä tieto tuli**.

**Toteutus:** System prompt -ohje kehottaa agenttia kirjoittamaan muistoja epistemologisesti tarkasti. Ei erillisiä kenttiä.

---

## 6. Väritetyt muistot

### 6.1 Konsepti

"Muistot EIVÄT ole totuudenmukaisia. Muistoja muutetaan sen perusteella miten ne palautettiin."

### 6.2 V1-toteutus: vain konsolidaatiossa

Konsolidaation yhteydessä muistoja voidaan "värittää":
1. LLM saa kontekstiin: alkuperäinen muisto + siihen assosioituvat uudemmat muistot
2. LLM arvioi: onko alkuperäinen muisto edelleen relevantti sellaisenaan?
3. Jos ei: LLM kirjoittaa päivitetyn version
4. Päivitetty muisto saa uuden hashin → assosiaatiot siirretään atomisesti

**Esimerkki:**
- Alkuperäinen: "Jari harkitsee projektin aloittamista"
- Uudempi assosioitu muisto: "Jari aloitti projektin"
- Väritetty/konsolidoitu: "Jari aloitti projektin jonka hän oli harkinnut"

### 6.3 Konsolidaation progressio (Jarin esimerkki)

```
1. matka: "Jari kertoi menevänsä Tampereelle"
2. matka: "Jari sanoi olevansa matkalla"
  → Konsolidaatio: "Jari oli matkalla Tampereella"
3. matka: → "Jari on käynyt kolme kertaa Tampereella"
  → Syntyy interpretation: "Jari matkustaa usein Tampereelle"
```

---

## 7. Avoimet kysymykset

1. **Working-muiston elinikä:** Jos konsolidaatio ei aja päivään (tai useaan), kasvaako working.md liian isoksi? Pitäisikö olla maksimiikä?
2. **Muiston arkistointi vs. poisto:** Poistetaanko kuolleet muistot kokonaan vai arkistoidaanko?
3. **Temporaalinen tila ilman anchoria:** Muistot joilla ei ole päivämääräankkuria – ovatko aina `past`?
4. **η-parametrin herkkyys:** Onko 0.7 liian vahva tai liian heikko? Tarvitseeko empiiristä testausta?

---

## 8. Päätökset

| # | Päätös | Perustelu |
| - | ------ | --------- |
| 1 | Decay vain konsolidaatiossa ("nukkuessa") | Yksinkertainen, ei reaaliaikaista päivitystarvetta |
| 2 | λ = 0.0231 (30 unen puoliintumisaika) | Armollinen, muistot elävät kuukausia |
| 3 | η = 0.7 (retrieval puolittaa välimatkan) | Yksi retrieval on merkittävä vahvistus |
| 4 | Working → consolidated konsolidaatiossa | Selkeä elinkaaren raja |
| 5 | Väritys vain konsolidaatiossa (V1) | Reaaliaikainen väritys liian kallis MVP:lle |

---

## 9. Kytkökset muihin design-dokumentteihin

- **design-01 (Tietomalli):** Muiston kentät, strength-kenttä, skeema
- **design-02 (Assosiaatiot):** Assosiaation luonti co-retrieval-lokista, decay
- **design-04 (Retrieval):** Strength vaikuttaa hakutuloksiin, retrieval vahvistaa
- **design-05 (Konsolidaatio):** Working→consolidated, decay-batch, pruning, väritys
- **design-06 (Integraatio):** Hook-toteutukset
