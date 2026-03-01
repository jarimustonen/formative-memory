# Design-05: Konsolidaatio ("uni")

> **Tila:** Ensimmäinen vedos (korkea taso)
> **Päivitetty:** 28.2.2026
> **Riippuvuudet:** design-01 (tietomalli), design-02 (assosiaatiot), design-03 (elinkaari), design-04 (retrieval)
> **Ruokkii:** design-06 (integraatio)

---

## 1. Tarkoitus

Kuvata konsolidaatioprosessi – taustajärjestelmä joka järjestää, vahvistaa, tiivistää ja siivoaa muistia. Biologinen analogia: uni, jossa päivän kokemukset integroituvat pitkäkestomuistiin.

---

## 2. Yleiskuva

Konsolidaatio on **taustaprosessi** joka ajetaan säännöllisesti (cron, manuaalinen trigger tai inaktiivisuusjakson tunnistus). Se tekee neljä asiaa:

```
Konsolidaatio
├── 1. Decay-päivitys ja pruning      ← Kuolleet muistot pois
├── 2. Duplikaattien tunnistaminen     ← Lähes-duplikaatit yhdistetään
├── 3. Assosiaatioiden vahvistaminen    ← Retrieval-patternien analyysi
└── 4. REM-vaihe                       ← Uusien assosiaatioiden löytäminen
```

---

## 3. Vaihe 1: Decay ja pruning

### 3.1 Batch-decay-päivitys

Lasketaan kaikkien muistojen nykyinen decay-arvo (lazy-menetelmä → nyt materialisoidaan):

```sql
UPDATE memories
SET decay = base_decay * exp(-lambda * (current_tick - last_retrieved_at_tick))
WHERE last_retrieved_at_tick IS NOT NULL;
```

### 3.2 Kuolleiden muistojen tunnistaminen

```sql
SELECT id FROM memories
WHERE decay < 0.05
AND id NOT IN (
  SELECT source_id FROM associations WHERE weight > 0.3
  UNION
  SELECT target_id FROM associations WHERE weight > 0.3
);
```

Kuollut muisto **jolla on vahvoja assosiaatioita** ei kuole – assosiaatio pitää sen elossa.

### 3.3 Pruning

- Kuolleet muistot: tiedosto poistetaan, tietokantarivi poistetaan
- Kuolleet assosiaatiot (weight < 0.01): poistetaan tietokannasta
- Optio: arkistointi `memory/archive/`-hakemistoon ennen poistoa

---

## 4. Vaihe 2: Duplikaattien tunnistaminen

### 4.1 Jaccard-esikarsinta (halpa)

```
Kaikille muistopareille (i, j):
  jaccard = |tokens(i) ∩ tokens(j)| / |tokens(i) ∪ tokens(j)|
  jos jaccard > 0.6 → yhdistämiskandidaatti
```

Optimointi: ei vertailla kaikkia pareja (O(N²)), vaan:
- Minhash/LSH esikarsinnan kautta
- Tai vain äskettäin luodut/muutetut muistot vs. olemassa olevat

### 4.2 Embedding-tarkennus

Jaccard-kandidaateille lasketaan embedding-kosinisamankaltaisuus:
- Jos kosini > 0.85 → vahva duplikaatti → yhdistä
- Jos 0.7 < kosini < 0.85 → mahdollinen duplikaatti → LLM tarkistaa
- Jos kosini < 0.7 → ei duplikaatti (vaikka Jaccard korkea)

### 4.3 Yhdistäminen

Kun duplikaatti/konsolidoitava pari tunnistetaan:

1. LLM yhdistää sisällöt (yksi uusi narratiivinen muisto)
2. Uudelle muistolle lasketaan uusi hash
3. Uusi muisto perii molempien assosiaatiot (painot yhdistetään)
4. Vanhat muistot poistetaan
5. Kaikki operaatiot yhdessä transaktiossa (atominen)

**Konsolidaation progressio** (Jarin idea):
- 1. matka: "Jari kertoi menevänsä Tampereelle"
- 2. matka: "Jari sanoi olevansa matkalla"
- Konsolidaatio: "Jari oli matkalla Tampereella" (2 kokemusta → 1 muisto)
- 3. matka → "Jari on käynyt kolme kertaa Tampereella"
- Lopulta syntyy interpretation: "Jari matkustaa usein Tampereelle"

---

## 5. Vaihe 3: Assosiaatioiden vahvistaminen (retrieval-analyysi)

### 5.1 Retrieval-patternien analyysi

Konsolidaatio analysoi retrieval-historiaa viimeisimmästä konsolidaatiosta lähtien:

- Mitkä muistot haettiin samassa sessiossa?
- Mitkä haettiin samalla tai lähellä olevalla tickillä?
- Näiden parien assosiaatiot vahvistuvat

### 5.2 Assosiaatioiden normalisointi

Varmistetaan, että assosiaatiomatriisi on tasapainossa:
- Yksittäisen muiston assosiaatioiden summa ei kasva rajattomasti
- Normalisointi: top-N vahvinta assosiaatiota per muisto säilytetään, loput leikataan

**Avoin kysymys:** N:n arvo? Ehdotus: 50 assosiaatiota per muisto.

---

## 6. Vaihe 4: REM-vaihe (uusien yhteyksien löytäminen)

### 6.1 Konsepti

Jarin idea: "Otetaan 10 viimeisintä keskustelua, valitaan satunnaisesti käyttäjän viestejä. Unen jälkeen käytetään muistin hakuprofiilia assosiaatioiden päivittämiseen."

Biologinen analogia: REM-unen aikana aivot aktivoivat satunnaisia muistijälkiä ja löytävät uusia yhteyksiä.

### 6.2 Mekanismi

1. Valitaan **satunnainen otos** muistoja (esim. 20–50 kpl)
2. Jokaiselle otoksen muistolle tehdään embedding-haku kaikista muistoista
3. Jos löytyy semanttisesti samankaltainen muisto (kosini > kynnys) **jolla ei ole assosiaatiota**:
   - Luodaan uusi assosiaatio (alkupaino = samankaltaisuus × kerroin)
4. Tämä simuloi "oivallusta" – muistot jotka eivät koskaan olleet kontekstissa yhdessä mutta liittyvät toisiinsa

### 6.3 Satunnaisuuden rooli

Satunnaisuus on **tarkoituksellista**: emme halua systemaattisesti käydä kaikkia pareja, koska:
- O(N²) on liian kallista
- Satunnainen otanta tuottaa "yllätyksiä" – kuten uni
- Ajan myötä kattavuus kasvaa (monta konsolidaatiosykliä)

### 6.4 Kontekstuaalinen REM

Voidaan myös ohjata REM:iä: valitaan satunnaisesti viimeisten keskustelujen viestejä → embedding-haku muistista → löydetään mitkä muistot liittyvät keskustelujen teemoihin → luodaan assosiaatioita.

---

## 7. Konsolidaation ajastus ja trigger

### 7.1 Automaattiset triggerit

| Trigger | Kuvaus | Prioriteetti |
| --- | --- | --- |
| Cron | Ajastettu aika (esim. yöllä) | Ensisijainen |
| Inaktiivisuus | Käyttäjä ei ole ollut aktiivinen N tuntiin | Sekundaarinen |
| Tick-raja | Viimeisimmästä konsolidaatiosta kulunut > M tickiä | Fallback |

### 7.2 Manuaalinen trigger

- CLI-komento: `openclaw memory consolidate`
- Agentin pyyntö: "Minun pitäisi nukkua hetken" (Jarin idea)

### 7.3 Toteutus: Service

Plugin rekisteröi servicen (`api.registerService()`) joka:
- Käynnistyy pluginin latauksessa
- Tarkistaa ajastuksen periodisesti
- Suorittaa konsolidaation kun trigger laukeaa
- Logittaa tulokset (montako muistoa käsitelty, yhdistetty, poistettu)

---

## 8. Väritetyt muistot konsolidaatiossa

### 8.1 Mekanismi

Konsolidaation yhteydessä muistoja voidaan "värittää" – muokata niiden sisältöä uudemman tiedon perusteella:

1. LLM saa kontekstiin: alkuperäinen muisto + siihen assosioituvat uudemmat muistot
2. LLM arvioi: onko alkuperäinen muisto edelleen relevantti sellaisenaan?
3. Jos ei: LLM kirjoittaa päivitetyn version
4. Päivitetty muisto saa uuden hashin → assosiaatiot siirretään

### 8.2 Esimerkki

- Alkuperäinen: "Jari harkitsee projektin aloittamista"
- Uudempi assosioitu muisto: "Jari aloitti projektin ja ensimmäinen versio on valmis"
- Väritetty: "Jari aloitti projektin jonka hän oli harkinnut" (tai konsolidoitu pois kokonaan)

---

## 9. LLM-kustannukset

Konsolidaatio vaatii LLM-kutsuja:
- Duplikaattien yhdistäminen (sisältöjen fuusio)
- REM-vaiheen assosiaatioarviointi (onko yhteys aito?)
- Väritys (muiston päivitys)

**Kustannusten hallinta:**
- Konsolidaatio käyttää **edullisempaa mallia** (konfiguroitava, esim. Haiku)
- Batch-prosessointi (monta päätöstä per kutsu)
- Jaccard ja embedding karsiovat ennen LLM-kutsuja

---

## 10. Avoimet kysymykset

1. **Konsolidaation kesto:** Miten pitkään konsolidaatio saa kestää? Timeout?
2. **LLM-malli konsolidaatiossa:** Sama malli kuin agentilla vai halvempi? Konfiguroitava?
3. **REM-otannan koko:** Montako muistoa per konsolidaatiosykli?
4. **Kosinisamankaltaisuuden kynnys:** Milloin luodaan uusi assosiaatio REM:ssä?
5. **Assosiaatioiden normalisointi:** Top-N per muisto – mikä on N?
6. **Konsolidaation raportointi:** Pitäisikö agentille kertoa mitä konsolidaatio teki? ("Nukuin hyvin, löysin uusia yhteyksiä X:n ja Y:n välillä")

---

## 11. Kytkökset muihin design-dokumentteihin

- **design-01 (Tietomalli):** Muiston hash-päivitys konsolidaatiossa, skeema
- **design-02 (Assosiaatiot):** Uusien assosiaatioiden luonti, pruning, normalisointi
- **design-03 (Elinkaari):** Decay-batch-päivitys, muiston kuolema, väritys
- **design-04 (Retrieval):** Retrieval-patternien analyysi, co-retrieval-historia
- **design-06 (Integraatio):** Service-rekisteröinti, cron-ajastus, CLI
