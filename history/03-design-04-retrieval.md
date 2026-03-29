# Design-04: Haku ja retrieval

> **Tila:** Vedos 2
> **Päivitetty:** 6.3.2026
> **Riippuvuudet:** design-01 (tietomalli), design-02 (assosiaatiot), design-03 (elinkaari)
> **Ruokkii:** design-05 (konsolidaatio), design-06 (integraatio)

---

## 1. Tarkoitus

Kuvata miten agentti löytää relevantteja muistoja ja miten retrieval kirjautuu muistijärjestelmään (retrieval.log). Hakuputki on se kohta, jossa agentti "kohtaa" muistinsa.

**V1-periaate:** Hakuputki on yksinkertainen. Assosiaatiot eivät vaikuta hakutuloksiin V1:ssä – ne prosessoidaan konsolidaatiossa. Kaikki muutokset (strength, assosiaatiot) tapahtuvat konsolidaatiossa, ei reaaliajassa.

---

## 2. Hakuputken yleiskuva

```
Kysely (query)
    │
    ▼
┌──────────────────────┐
│ 1. Embedding + BM25  │  ← Kandidaattien haku (hybridi-scoring)
│    kiinteä painotus   │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 2. Strength-painotus │  ← Vaimentaa rapautuneet muistot
└──────────┬───────────┘
           │
           ▼
Tulokset → kontekstiin + retrieval.log-kirjaus
```

Kolme vaihetta. Ei assosiaatio-boostia, ei kertautuvaa assosiaatiota, ei MMR:ää, ei temporaalista suodatusta hakuputkessa. Nämä voidaan lisätä V2:ssa.

---

## 3. Hakuvaiheet

### 3.1 Embedding + BM25 hybridi

Perustuu nykyiseen memory-core-hakuun. V1:ssä **kiinteä painotus** kaikille muistotyypeille:

```
hybrid_score = α × embedding_score + (1 - α) × bm25_score
```

Missä `α = 0.6` (embedding dominoi hieman). Muistotyyppikohtainen painotus (semanttinen vs. eksaktinen) voidaan lisätä V2:ssa kun on empiiristä dataa.

**Toteutus:** Haku tehdään kaikkiin muistoihin (working + consolidated) samalla kyselyllä. Embedding-haku sqlite-vec:llä, BM25 FTS5:llä.

### 3.2 Strength-painotus

```
final_score = hybrid_score × strength
```

Strength-arvo on muiston nykyinen vahvuus tietokannassa (päivitetään konsolidaatiossa, design-03). Rapautuneet muistot (matala strength) saavat luontaisesti heikommat pisteet.

### 3.3 V2-laajennettavuus

Myöhemmin hakuputkeen voidaan lisätä:

- **Assosiaatio-boosting:** Nostaa muistoja jotka assosioituvat kontekstissa oleviin
- **Kertautuva assosiaatio:** Tuo "piilomuistoja" jotka assosioituvat useaan haettuun muistoon
- **MMR (Maximal Marginal Relevance):** Estää liian samankaltaisten muistojen kertyminen
- **Muistotyyppikohtainen painotus:** Eri embedding/BM25-suhde eri muistotyypeille

Nämä eivät vaadi arkkitehtuurimuutoksia – lisävaiheita putken loppuun.

---

## 4. Auto-recall (ilman eksplisiittistä hakua)

### 4.1 before_prompt_build -injektio

Plugin injektoi relevantteja muistoja kontekstiin **automaattisesti** jokaisella agenttiajolla:

1. `before_prompt_build`-hook laukeaa
2. Plugin hakee: käyttäjän viimeisin viesti → embedding → top-N muistoa (sama hakuputki)
3. Tulokset injektoidaan `prependContext`:iin
4. Agentti näkee ne "automaattisesti" ilman eksplisiittistä hakua
5. retrieval.log:iin kirjataan `recall`-rivi

### 4.2 Temporaalinen pakkoinjektio

Konsolidaatio tarkistaa muistojen temporaaliset siirtymät (design-03, kohta 5.3). Kun muiston `temporal_state` on siirtymässä (future→present tai present→past):

- Muisto **pakotetaan mukaan** auto-recall-tuloksiin riippumatta haun pisteistä
- Tämä varmistaa ettei agentti "unohda" ajallisesti kriittisiä asioita
- Pakotetut muistot kirjataan retrieval.log:iin `recall`-rivillä

### 4.3 Injektoinnin budjetti

Kontekstibudjetti on rajallinen. Auto-recall ei saa viedä liikaa tilaa.

**Ehdotus:** Maksimi ~2000 tokenia auto-recall-muistoja per agenttiajon alku. Pakotetut transitiomuistot menevät tämän budjetin ohi (ne ovat aina mukana). Agentti voi hakea lisää eksplisiittisesti `memory_search`-työkalulla.

---

## 5. Retrieval-sivuvaikutukset

**V1-periaate:** Retrieval ei muuta tietokantaa. Ainoa sivuvaikutus on retrieval.log-kirjaus.

### 5.1 retrieval.log-kirjaus

Jokainen haku ja auto-recall kirjataan retrieval.log:iin (design-01, kohta 5):

| Tapahtuma  | Lähde                             | Esimerkki                                              |
| ---------- | --------------------------------- | ------------------------------------------------------ |
| `search`   | Agentti kutsui `memory_search`    | `2026-03-05T14:30:00Z search a1b2c3d4 e5f6a7b8`        |
| `recall`   | Auto-recall (before_prompt_build) | `2026-03-05T14:30:00Z recall a1b2c3d4 c9d0e1f2`        |
| `feedback` | Agentti kutsui `memory_feedback`  | `2026-03-05T14:31:00Z feedback a1b2c3d4:3 e5f6a7b8:1`  |
| `store`    | Agentti kutsui `memory_store`     | `2026-03-05T14:35:12Z store f3a4b5c6 context:a1b2c3d4` |

Konsolidaatio prosessoi lokin ja päivittää:

- **Strength-vahvistus:** painotettu palautteella (design-03, kohta 4.2)
- **Assosiaatiot:** co-retrieval-parit (design-02, kohta 5)

### 5.2 Mitä EI tapahdu haun yhteydessä (V1)

- Strength-arvoa ei päivitetä
- Assosiaatioita ei luoda tai vahvisteta
- Decay-arvoa ei lasketa
- Kaikki nämä tapahtuvat konsolidaatiossa ("nukkuessa")

**Poikkeus:** `memory_store` kirjoittaa uuden muiston tietokantaan ja working.md:hen, koska muiston on oltava haettavissa heti (design-03, kohta 3.1).

---

## 6. Agentin muistityökalut

### 6.1 Työkalut

| Työkalu           | Kuvaus                                 | Parametrit                                     |
| ----------------- | -------------------------------------- | ---------------------------------------------- |
| `memory_search`   | Semanttinen haku hakuputkella          | `query`, `limit?`                              |
| `memory_store`    | Uuden muiston tallentaminen            | `content`, `type`, `temporal_anchor?`          |
| `memory_feedback` | Relevanssipalaute haetuille muistoille | `ratings` (lista: id + tähdet 1-3), `comment?` |
| `memory_get`      | Yksittäisen muiston haku id:llä        | `id`                                           |

### 6.2 memory_search

Agentti tekee semanttisen haun. Parametrit:

- `query` (pakollinen): hakukysely
- `limit` (valinnainen, oletus 10): maksimitulokset

Palauttaa listan muistoja (id, sisältö, tyyppi, strength, luontiaika). Kirjaa `search`-rivin retrieval.log:iin.

### 6.3 memory_store

Agentti tallentaa uuden muiston. Parametrit:

- `content` (pakollinen): muiston narratiivinen sisältö
- `type` (pakollinen): vapaamuotoinen kategoria (esim. narrative, fact, decision, preference)
- `temporal_anchor` (valinnainen): päivämäärä jos muistolla on ajallinen ankkuri

Plugin:

1. Laskee SHA-256-hashin sisällöstä
2. Lisää chunkin working.md:hen
3. Lisää muiston tietokantaan (embedding + FTS indeksointi)
4. Kirjaa `store`-rivin retrieval.log:iin kontekstissa olevilla muistoilla

### 6.4 memory_feedback

Agentti arvioi haettujen muistojen relevanssin. Parametrit:

- `ratings` (pakollinen): lista muisto-id + tähdet (1-3)
  - ★ = heikosti relevantti
  - ★★ = osittain relevantti
  - ★★★ = täysin relevantti
- `comment` (valinnainen): vapaamuotoinen kommentti

Kirjaa `feedback`-rivin retrieval.log:iin. Konsolidaatio käyttää tähtiä painottamaan strength-vahvistusta ja assosiaatioita (design-03, kohta 4.2).

**Ajoitus:** Agenttia kehotetaan antamaan palautetta haettujen muistojen hyödyllisyydestä system promptissa. Palaute ei ole pakollinen.

### 6.5 memory_get

Yksittäisen muiston haku tunnetulla id:llä. Ei kirjaa retrieval.log:iin (ei ole semanttinen haku).

---

## 7. System prompt -osio

Plugin tarjoaa oman Memory Recall -osion system promptiin (vaatii Osa A muutoksen A1):

```
## Memory Recall
Your memory is associative – memories are linked to each other by association
strength. When you recall something, related memories may surface too.

- Use memory_search to find memories by content or meaning
- Use memory_store to save new memories (always write from your perspective)
- Use memory_feedback to rate how relevant recalled memories were (1-3 stars)
- Use memory_get to retrieve a specific memory by ID

When storing memories:
- Write narratively from your perspective ("Jari told me...")
- Choose a descriptive type (e.g. narrative, fact, decision, preference)
- Be epistemologically precise ("Jari said X" not "X is true")
- Include temporal anchors when applicable

After recalling memories, consider giving feedback on their relevance.
This helps the memory system learn which memories matter.
```

---

## 8. Avoimet kysymykset

1. **Auto-recall budjetti:** 2000 tokenia riittävä? Pitäisikö olla dynaaminen kontekstibudjetin mukaan?
2. **Embedding/BM25-painotus:** α = 0.6 optimaalinen? Tarvitseeko empiiristä viritystä?
3. **memory_feedback-kehotus:** Miten usein agenttia kehotetaan antamaan palautetta? Joka haun jälkeen vai harvemmin?
4. **memory_forget:** Tarvitaanko eksplisiittistä poistoa V1:ssä vai riittääkö luonnollinen decay?

---

## 9. Päätökset

| #   | Päätös                                              | Perustelu                                                                                  |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Ei assosiaatio-boostia hakuputkessa (V1)            | Yksinkertainen putki, assosiaatiot vaikuttavat epäsuorasti strengthin kautta               |
| 2   | Kiinteä embedding/BM25-painotus (V1)                | Muistotyyppikohtainen painotus V2:ssa kun on dataa                                         |
| 3   | Retrieval ei muuta tietokantaa – vain retrieval.log | V1-periaate: kaikki muutokset konsolidaatiossa                                             |
| 4   | Temporaalinen pakkoinjektio auto-recallissa         | Transitiomuistot pakotetaan kontekstiin, eivät vain boostattuja                            |
| 5   | memory_feedback-työkalu (1-3 tähteä)                | Agentti arvioi relevanssin, konsolidaatio painottaa                                        |
| 6   | Interpretation pois muistotyypeistä                 | Konsolidaation tuottama muisto saa normaalin tyypin, source=consolidation kertoo alkuperän |

---

## 10. Kytkökset muihin design-dokumentteihin

- **design-01 (Tietomalli):** SQLite-skeema (embedding + FTS), retrieval.log-formaatti, muistotyypit
- **design-02 (Assosiaatiot):** retrieval.log → konsolidaatio prosessoi co-retrieval-parit
- **design-03 (Elinkaari):** Strength vaikuttaa hakupisteisiin, retrieval.log → konsolidaatio vahvistaa
- **design-05 (Konsolidaatio):** Prosessoi retrieval.log:n, päivittää strengthit ja assosiaatiot
- **design-06 (Integraatio):** before_prompt_build-hook, system prompt -osio, muistityökalut
