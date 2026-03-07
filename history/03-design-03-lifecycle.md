# Design-03: Muiston elinkaari

> **Tila:** Vedos 3
> **Päivitetty:** 6.3.2026
> **Riippuvuudet:** design-01 (tietomalli), design-02 (assosiaatiot)
> **Ruokkii:** design-04 (retrieval), design-05 (konsolidaatio)

---

## 1. Tarkoitus

Kuvata muiston koko elinkaari: miten se syntyy, miten se liikkuu working-muistista konsolidoituun, miten se vahvistuu ja rapautuu, ja milloin se kuolee.

---

## 2. Elinkaaren yleiskuva

```
  Päivän aikana:
    Luonti ──→ working.md
    Retrieval ──→ retrieval.log (append-only)

  Konsolidaatio ("uni"):
    ├── Retrieval-vahvistus (retrieval.log → painotettu strength-päivitys)
    ├── Decay: working ×0.906, consolidated ×0.977
    ├── Assosiaatiot päivitetään (retrieval.log → painotetut co-retrieval-parit)
    ├── Working → consolidated siirto (strength → 1.0)
    ├── Duplikaatit yhdistetään
    ├── Kuolleet poistetaan (strength ≤ 0.05)
    └── retrieval.log tyhjennetään
```

**V1-periaate: nolla tietokantakirjoitusta normaalikäytössä.** Kaikki muutokset tapahtuvat konsolidaatiossa.

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
- Plugin laskee hashin, lisää chunkin working.md:hen
- Plugin lisää muiston tietokantaan (embedding + FTS indeksointia varten, jotta muisto on haettavissa heti)
- retrieval.log:iin kirjataan `store`-rivi kontekstissa olevilla muistoilla

**Huom:** Uuden muiston luonti on ainoa DB-kirjoitus normaalikäytössä. Se on välttämätön, koska muuten muistoa ei voisi hakea ennen seuraavaa konsolidaatiota.

### 3.2 Automaattinen kaappaus (hookista)

Plugin observoi `agent_end` tai `before_reset`-hookista:
- Analysoi keskustelun ja tunnistaa tallennettavat muistot
- Muistot lisätään working.md:hen ja tietokantaan (source=`hook_capture`)
- retrieval.log:iin kirjataan `store`-rivi jokaiselle kaapatulle muistolle

### 3.3 Konsolidaatio (yhdistäminen)

Konsolidaatio voi luoda uusia muistoja (design-05):
- Useasta muistosta syntyy yksi tiivistetty muisto (tyyppi valitaan heuristisesti, esim. `fact`)
- Nämä syntyvät suoraan consolidated.md:hen ja tietokantaan (source=`consolidation`)

### 3.4 Importointi (migraatio)

Memory-core-muistojen tuonti (design-07):
- Importoidut muistot menevät suoraan consolidated.md:hen ja tietokantaan (source=`import`)

---

## 4. Strength-malli

### 4.1 Decay – eri nopeus working- ja consolidated-muistoille

```
strength ← strength × e^(-λ)
```

| Muiston tila | λ | Puoliintumisaika | Kerroin/uni |
| --- | --- | --- | --- |
| **Working** (konsolidoimaton) | `ln(2)/7 ≈ 0.099` | 7 unta | ×0.906 |
| **Consolidated** (konsolidoitu) | `ln(2)/30 ≈ 0.0231` | 30 unta | ×0.977 |

Working-muistot rapautuvat ~4× nopeammin. Tämä on tarkoituksellista:
- Tuoreet muistot jotka eivät ole relevantteja häviävät nopeasti
- Konsolidaatio "testaa" muiston – jos se selviää, se on kestävämpi
- Konsolidoimaton muisto joka ei koskaan haeta → kuolee ~5 viikossa (vs. ~4kk konsolidoitu)

### 4.2 Retrieval-vahvistus – painotettu palautteella

```
strength ← 1 - (1 - strength) × e^(-η × w)
```

Missä `w` on painotettu retrieval-pisteet päivältä (lasketaan retrieval.log:sta):

| Tapahtuma | Paino | Perustelu |
| --- | --- | --- |
| `search` (ilman palautetta) | 1.0 | Agentti haki aktiivisesti |
| `feedback` ★★★ | 1.0 | Täysin relevantti |
| `feedback` ★★ | 0.67 | Osittain relevantti |
| `feedback` ★ | 0.33 | Heikosti relevantti |
| `recall` (ilman palautetta) | 0.5 | Passiivinen injektio |
| `store context:` | 2.0 | Vahvin signaali – agentti loi uutta tämän perusteella |

- `η = 0.7` → peruskerroin
- Tapahtuu **konsolidaatiossa**, ei reaaliajassa

### 4.3 Konsolidaation strength-nollaus

Kun muisto siirtyy working → consolidated:
- **Strength nollataan 1.0:aan** – uusi alku pitkäkestomuistina
- Hitaampi decay (λ_consolidated) alkaa vasta tästä
- Biologinen analogia: pitkäkestomuistiin siirtyminen = muisto on "kertaalleen prosessoitu" ja kestävämpi

### 4.4 Esimerkkitaulukot

**Working-muisto (ei haettu, λ_working):**
```
Uni  1:  0.906
Uni  3:  0.744
Uni  7:  0.500
Uni 14:  0.250
Uni 21:  0.125
Uni 28:  0.063
Uni 30:  0.050  ← kuolema-kynnys
```

**Consolidated-muisto (ei haettu, λ_consolidated):**
```
Uni  1:  0.977
Uni  7:  0.851
Uni 30:  0.500
Uni 60:  0.250
Uni 90:  0.125
Uni 120: 0.063
Uni 130: 0.050  ← kuolema-kynnys
```

### 4.5 Muiston kuolema

- Strength ≤ 0.05 → konsolidaatio merkitsee kuolleeksi
- **Lisäehto:** jos muistolla on vahvoja assosiaatioita (weight > 0.3), se **ei kuole** – assosiaatio pitää sen elossa
- Kuolleet muistot poistetaan tiedostosta ja tietokannasta konsolidaation yhteydessä

### 4.6 V2-laajennettavuus

Myöhemmin voidaan lisätä:
- **Muistotyyppikohtainen λ:** preference rapautuu hitaammin, tool_usage nopeammin
- **Retrieval-count-riippuva λ:** `λ(n) = λ₀ / (1 + κn)` – usein haettu muisto rapautuu hitaammin (Ebbinghaus-spacing-efekti)
- Nämä eivät vaadi arkkitehtuurimuutoksia – pelkkä kaavan päivitys

---

## 5. Temporaalinen tila

### 5.1 Neljä tilaa

| Tila | Merkitys | Esimerkki |
| --- | --- | --- |
| `future` | Ei vielä tapahtunut | "Jari kertoi menevänsä Tampereelle ma 2.3." |
| `present` | Tapahtuu parhaillaan | "Jari on nyt Tampereella" |
| `past` | Jo tapahtunut | "Jari kävi Tampereella" |
| `none` | Ei temporaalista ankkuria | "Jarin koiran nimi on Namu" |

`none` on oletus muistoille joilla ei ole päivämääräankkuria (esim. faktat, preferenssit). Näille ei sovelleta temporaalista boostingia.

### 5.2 Siirtymät

Temporaalinen tila siirtyy **automaattisesti** `temporal_anchor`-päivämäärän perusteella:
- `future` → `present`: kun nykyhetki ≥ anchor
- `present` → `past`: kun nykyhetki > anchor + kesto

**Tarkistuspiste:** Konsolidaatiossa tarkistetaan kaikkien muistojen temporaaliset siirtymät. Myös before_prompt_build-hookissa voidaan tarkistaa (V2).

### 5.3 Transitiopäivien pakkoinjektio

Jarin idea: muisto assosioituu voimakkaammin transitiopäiviin. Käytännössä:

Kun muiston `temporal_state` on siirtymässä (future→present tai present→past), muisto **pakotetaan mukaan kontekstiin** auto-recall-vaiheessa (before_prompt_build). Tämä ei ole pelkkä boosting hakutuloksissa – se on pakollinen injektio.

- Konsolidaatio tarkistaa temporaaliset siirtymät ja merkitsee muistot jotka ovat transitiossa
- Before_prompt_build injektoi nämä kontekstiin riippumatta haun tuloksista
- Agentti näkee ne ja voi toimia niiden perusteella ("Huomenna Jari palaa matkalta")

Tämä varmistaa, ettei agentti "unohda" ajallisesti kriittisiä asioita.

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
  → "Jari matkustaa usein Tampereelle"
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
| 2 | Eri decay: working 7 unta, consolidated 30 unta | Tuoreet karsiutuvat nopeasti, konsolidoidut kestävät |
| 3 | η = 0.7 (retrieval puolittaa välimatkan), painotettu palautteella | Feedback-tähdet ja store-konteksti painottavat eri tavoin |
| 4 | Working → consolidated: strength → 1.0 | Pitkäkestomuistiin siirtyminen = vahvempi alku |
| 5 | Väritys vain konsolidaatiossa (V1) | Reaaliaikainen väritys liian kallis MVP:lle |
| 6 | Tilamuutokset konsolidaatiossa (V1) | Retrieval.log + uuden muiston luonti ainoat kirjoitukset päivällä |
| 7 | Temporal state: future/present/past/none | None = ei ankkuria (faktat, preferenssit) |
| 8 | Transitiopäivien pakkoinjektio | Siirtymässä olevat muistot pakotetaan kontekstiin |

---

## 9. Kytkökset muihin design-dokumentteihin

- **design-01 (Tietomalli):** Muiston kentät, strength-kenttä, skeema
- **design-02 (Assosiaatiot):** Assosiaation luonti co-retrieval-lokista, decay
- **design-04 (Retrieval):** Strength vaikuttaa hakutuloksiin, retrieval vahvistaa
- **design-05 (Konsolidaatio):** Working→consolidated, decay-batch, pruning, väritys
- **design-06 (Integraatio):** Hook-toteutukset
