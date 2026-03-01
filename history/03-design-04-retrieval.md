# Design-04: Haku ja retrieval

> **Tila:** Ensimmäinen vedos (korkea taso)
> **Päivitetty:** 28.2.2026
> **Riippuvuudet:** design-01 (tietomalli), design-02 (assosiaatiot), design-03 (elinkaari)
> **Ruokkii:** design-05 (konsolidaatio), design-06 (integraatio)

---

## 1. Tarkoitus

Kuvata miten agentti löytää relevantteja muistoja ja miten retrieval vaikuttaa muistijärjestelmään takaisin (assosiaatioiden vahvistaminen, decay-nollaus). Hakuputki on se kohta, jossa agentti "kohtaa" muistinsa.

---

## 2. Hakuputken yleiskuva

```
Kysely (query)
    │
    ▼
┌──────────────────────┐
│ 1. Embedding + BM25  │  ← Kandidaattien haku (nykyisen memory-core:n tapaan)
│    hybridi-scoring    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 2. Decay-painotus    │  ← Vaimentaa rapautuneet muistot
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 3. Assosiaatio-boost │  ← Nostaa muistot jotka assosioituvat jo kontekstissa oleviin
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 4. Kertautuva assoc. │  ← Tuo "piilomuistoja" jotka eivät olleet haussa
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 5. MMR-diversiteetti │  ← Poistaa duplikaatit, varmistaa monipuolisuus
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 6. Temporal-suodatus │  ← Nostaa tulevaisuuden muistot jotka ovat nyt ajankohtaisia
└──────────┬───────────┘
           │
           ▼
Tulokset → kontekstiin + sivuvaikutukset (assosiaatiot, decay-nollaus)
```

---

## 3. Hakuvaiheet

### 3.1 Embedding + BM25 hybridi

Perustuu nykyiseen memory-core-hakuun, mutta **muistotyypin mukaan painotettu**:

| Muistotyyppi | Embedding-paino | BM25-paino | Perustelu |
| --- | --- | --- | --- |
| `narrative` | 0.8 | 0.2 | Semanttinen haku dominoi |
| `interpretation` | 0.8 | 0.2 | Sama kuin narratiivinen |
| `fact` | 0.5 | 0.5 | Molemmat relevantteja |
| `decision` | 0.5 | 0.5 | Molemmat relevantteja |
| `tool_usage` | 0.2 | 0.8 | Eksakti merkkijono ratkaisee |
| `preference` | 0.3 | 0.7 | Usein eksakteja sanoja |

**Toteutus:** Haku tehdään kaikkiin muistoihin samalla kyselyllä, mutta scoring-vaiheessa painotetaan muistotyyppikohtaisesti.

### 3.2 Decay-painotus

```
adjusted_score = base_score × decay(memory)
```

Decay lasketaan lazy-menetelmällä (design-03, luku 6.4): nykyinen tick - viimeisin retrieval → eksponentiaalinen vaimennus.

### 3.3 Assosiaatio-boosting

Jos kontekstissa on jo muistoja (aiempi haku samassa sessiossa tai before_prompt_build-injektio):

```
assoc_boost(M) = Σ weight(M, Ci) for Ci in kontekstin muistot
boosted_score = adjusted_score × (1 + β × assoc_boost)
```

Missä `β` = assosiaatio-boosting-kerroin (konfiguroitava).

### 3.4 Kertautuva assosiaatio

Design-02:n luku 6.3: muistot jotka eivät ole haussa mutta assosioituvat vahvasti useaan haettuun muistoon:

1. Käy läpi top-K hakutulokset
2. Hae niiden assosiaatiot
3. Jos muisto X assosioituu ≥ 2 haettuun muistoon → laske kertautuva boost
4. Jos boost > kynnysarvo → lisää X tuloksiin

Tämä tuo esiin "piilomuistoja" – muistoja jotka eivät suoraan vastaa kyselyyn mutta liittyvät kontekstiin.

### 3.5 MMR (Maximal Marginal Relevance)

Nykyisestä memory-core:sta lainattu: estä liian samankaltaisten muistojen kertyminen tuloksiin.

Käytä Jaccard-samankaltaisuutta (halpa) + embedding-kosinia (tarkka) duplikaattien tunnistamiseen.

### 3.6 Temporal-suodatus

Erikoiskäsittely muistoille joiden temporaalinen tila on siirtymässä:
- `future` → `present` (transitio lähellä): **nosta prioriteettiä** (tämä on pian ajankohtainen)
- `present`: **nosta prioriteettiä** (tämä on juuri nyt relevanttia)
- Transitiopäivät saavat erityisen boosting (Jarin idea)

---

## 4. Auto-recall (ilman eksplisiittistä hakua)

### 4.1 before_prompt_build -injektio

Plugin injektoi relevantteja muistoja kontekstiin **automaattisesti** jokaisella agenttiajolla:

1. `before_prompt_build`-hook laukeaa
2. Plugin hakee: käyttäjän viimeisin viesti → embedding → top-N muistoa
3. Tulokset injektoidaan `prependContext`:iin
4. Agentti näkee ne "automaattisesti" ilman eksplisiittistä hakua

### 4.2 Injektoinnin budjetti

Kontekstibudjetti on rajallinen. Auto-recall ei saa viedä liikaa tilaa.

**Ehdotus:** Maksimi ~2000 tokenia auto-recall-muistoja per agenttiajon alku. Agentti voi hakea lisää eksplisiittisesti.

---

## 5. Retrieval-sivuvaikutukset

Haku ei ole vain lukuoperaatio – se **muuttaa** muistijärjestelmää:

### 5.1 Assosiaatioiden vahvistaminen

Kaikki hakutuloksena palautetut muistot:
- Parien assosiaatiot vahvistuvat (co-retrieval, design-02)
- Kertautuvan assosiaation kautta löydetyt muistot saavat uudet/vahvistuneet assosiaatiot

### 5.2 Decay-nollaus

Jokaisen palautetun muiston:
- `last_retrieved_at_tick` päivitetään
- `retrieval_count` +1
- `decay` vahvistuu (design-03, luku 6.3)

### 5.3 Tick-tallennus

Haun tick tallennetaan → voidaan myöhemmin analysoida retrieval-patterneja (konsolidaatiossa).

---

## 6. Agentin muistityökalut

### 6.1 Ehdotettavat työkalut

| Työkalu | Kuvaus | Parametrit |
| --- | --- | --- |
| `memory_search` | Semanttinen haku koko hakuputkella | `query`, `type_filter?`, `limit?` |
| `memory_store` | Uuden muiston tallentaminen | `content`, `type`, `temporal_anchor?`, `tags?` |
| `memory_get` | Yksittäisen muiston haku id:llä | `id` |
| `memory_forget` | Muiston eksplisiittinen poisto | `id` |

### 6.2 Nimivalinta

**Avoin kysymys:** Käytetäänkö samoja nimiä kuin memory-core (`memory_search`, `memory_get`) vai eri nimiä (`memory_recall`, `memory_store`)? Samat nimet ovat luontevampia (system prompt -ohjeet viittaavat niihin), mutta eri nimet välttävät sekaannuksen.

**Ehdotus:** Samat nimet (`memory_search`, `memory_get`) + uudet (`memory_store`, `memory_forget`). Plugin korvaa memory-core:n – samat nimet ovat luonnollinen jatko.

---

## 7. System prompt -osio

Plugin tarjoaa oman Memory Recall -osion system promptiin (vaatii Osa A muutoksen A1):

```
## Memory Recall
Your memory is associative – memories are linked to each other by association
strength. When you recall something, related memories may surface too.

- Use memory_search to find memories by content or meaning
- Use memory_store to save new memories (always write from your perspective)
- Use memory_get to retrieve a specific memory by ID
- Use memory_forget to remove a memory

When storing memories:
- Write narratively from your perspective ("Jari told me...")
- Choose the appropriate type (narrative, fact, decision, tool_usage, preference)
- Be epistemologically precise ("Jari said X" not "X is true")
- Include temporal anchors when applicable
```

---

## 8. Avoimet kysymykset

1. **Auto-recall budjetti:** 2000 tokenia riittävä? Pitäisikö olla dynaaminen kontekstibudjetin mukaan?
2. **Hakuputken vaiheiden järjestys:** Onko yllä esitetty järjestys optimaalinen?
3. **Kertautuvan assosiaation kynnysarvo:** Miten valitaan? Tarvitaanko empiiristä testausta?
4. **Temporal-boosting:** Miten paljon transitiopäivät nostavat prioriteettiä?
5. **Retrieval-sivuvaikutusten ajoitus:** Synkroninen (hidastaa vastausta) vai asynkroninen (fire-and-forget)?
6. **memory_search vs. memory_recall:** Kumpi nimi? Vai molemmat (aliakset)?

---

## 9. Kytkökset muihin design-dokumentteihin

- **design-01 (Tietomalli):** Muistotyyppi → hakustrategia, skeeman käyttö
- **design-02 (Assosiaatiot):** Co-retrieval-vahvistaminen, kertautuva assosiaatio
- **design-03 (Elinkaari):** Decay vaikuttaa pisteisiin, retrieval vahvistaa muistoa
- **design-05 (Konsolidaatio):** Retrieval-patternit ruokkivat konsolidaatioanalyysiä
- **design-06 (Integraatio):** before_prompt_build-hook, system prompt -osio
