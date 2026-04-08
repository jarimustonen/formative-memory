# Analyysi: OpenClaw Dreaming vs. Associative Memory Consolidation

> Tutkimus 2026-04-08. Perustuu OpenClaw v2026.4.5:n dreaming-toteutukseen.

## Yhteenveto

OpenClaw:n `memory-core` sai v2026.4.5:ssa kokeellisen **dreaming**-järjestelmän joka on konseptuaalisesti lähellä meidän `memory sleep` -konsolidaatiota. Molemmat käsittelevät muistojen vahvistamista ja organisointia, mutta toimivat eri datamalleilla ja eri abstraktiotasolla. **Ne eivät ole päällekkäisiä eivätkä ristiriidassa** — ne voivat toimia rinnakkain.

## OpenClaw Dreaming -järjestelmä

### Arkkitehtuuri

Kolme itsenäistä vaihetta, kukin omalla aikataululla ja cron-triggerillä:

| Vaihe | Aikataulun oletus | Tehtävä |
|-------|-------------------|---------|
| **Light** | 6h välein | Skannaa viimeaikaiset muistojäljet, deduplikoi Jaccard-samankaltaisuudella (0.9), ryhmittää päivittäismuistiinpanoiksi (`memory/YYYY-MM-DD.md`) |
| **Deep** | Päivittäin klo 3 | Promootoi kestävät muistot `MEMORY.md`:hen painotetulla pisteytysalgoritmilla. Ainoa vaihe joka kirjoittaa `MEMORY.md`:hen |
| **REM** | Viikoittain su klo 5 | Tunnistaa konseptitag-klustereita, kirjoittaa reflektioita päivittäismuistiinpanoihin |

### Deep Sleep -pisteytys (6 signaalia)

```
frequency    (0.24) — kuinka usein haettu
relevance    (0.30) — keskimääräiset hakupisteet
diversity    (0.15) — uniikkien hakujen määrä
recency      (0.15) — aikaperusteinen decay (half-life)
consolidation(0.10) — monipäiväinen hakuhistoria
conceptual   (0.06) — konseptitag-rikastuminen
```

Kaikki kynnysarvot (minScore, minRecallCount, minUniqueQueries) pitää ylittää samanaikaisesti (AND-logiikka).

### Aging-kontrollit

- **`recencyHalfLifeDays`** (oletus 14): Eksponentiaalinen decay muiston iän mukaan
- **`maxAgeDays`** (oletus 30): Kova raja — vanhemmat ehdokkaat pois

### Datan tallennustapa

- Tiedostopohjainen: `memory/YYYY-MM-DD.md`, `MEMORY.md`, `memory/.dreams/`
- Short-term recall: `memory/.dreams/short-term-recall.json`
- Lukko: `memory/.dreams/short-term-promotion.lock` (60s stale timeout)
- HTML-kommenttimerkinnät: `<!-- openclaw:sleep:light:start -->` / `end`

### Recovery-mekanismi

Deep sleep sisältää automaattisen palautumisen: kun muistin "terveysindeksi" putoaa alle 0.35, järjestelmä etsii vanhemmista lähteistä arvokasta materiaalia ja palauttaa sen.

### Embedding-providerit

**Dreaming EI käytä embedding-providereita.** Jaccard-samankaltaisuus (light dedup) ja konseptitag-klusterointi (REM) ovat tekstipohjaisia. Embedding-providereita käytetään memory-core:n hakutoiminnoissa, mutta ei dreaming-vaiheissa.

### Plugin-API

**Ei julkista rajapintaa ulkoisille plugineille.** Dreaming on memory-core:n sisäinen ominaisuus. Triggerointi tapahtuu cron-pohjaisilla heartbeat-eventeillä:
- `__openclaw_memory_core_light_sleep__`
- `__openclaw_memory_core_rem_sleep__`
- `__openclaw_memory_core_short_term_promotion_dream__`

## Vertailu meidän konsolidaatioon

| Ominaisuus | Meidän `memory sleep` | OpenClaw dreaming |
|------------|----------------------|-------------------|
| **Datamalli** | SQLite (kanoninen) | Tiedostopohjainen (markdown) |
| **Triggeri** | Manuaalinen (`/memory sleep`) + session reset | Cron-aikataulutettu (3 vaihetta) |
| **Decay** | Eksponentiaalinen (working ×0.906, consolidated ×0.977) | Half-life recency (14d) + hard cutoff (30d) |
| **Merge** | LLM-pohjainen sisältöjen yhdistäminen | Ei mergea — promootio sellaisenaan |
| **Assosiaatiot** | Kaksisuuntainen assosiaatioverkko, co-retrieval | Konseptitag-klusterointi (REM) |
| **Pruning** | Strength ≤ 0.05 → poisto | maxAgeDays → poissulkeminen |
| **Provenance** | Exposure + attribution -taulut | Short-term recall JSON |
| **Embeddingin käyttö** | Kyllä (cosine similarity merge-kandidaateissa) | Ei |
| **Temporaaliset siirtymät** | future→present→past (anchor-pohjainen) | Ei |
| **Vaiheistus** | 10 vaihetta yhdessä ajossa | 3 itsenäistä vaihetta eri aikataululla |

## Johtopäätökset

### Ei päällekkäisyyttä

1. **Eri datamalli**: Meidän plugin käyttää omaa SQLite-kantaa, dreaming operoi memory-core:n tiedostojärjestelmään. Ne eivät koske toistensa dataan.
2. **Eri abstraktiotaso**: Dreaming on tiedostotason organisointia (markdown-muistiinpanot → MEMORY.md promootio). Meidän konsolidaatio on semanttisen tason operaatio (assosiaatioverkko, LLM-merge, provenance-ketju).
3. **Eri triggerit**: Dreaming on automaattinen (cron). Meidän konsolidaatio on manuaalinen/session-pohjainen.

### Mahdolliset integraatiopisteet (tulevaisuus)

- **Signal sharing**: Dreaming:n recall-statistiikat (frequency, diversity) voisivat informoida meidän reinforcement-vaihetta
- **Concept tags**: REM:n tunnistamat teemat voisivat rikastaa meidän assosiaatioverkkoa
- **Scheduling**: Meidän konsolidaatio voisi hyötyä cron-pohjaisesta automatisaatiosta (vrt. dreaming:n malli)

### Suositus

**Ei toimenpiteitä.** Järjestelmät toimivat rinnakkain ilman konflikteja. Integraatiomahdollisuudet ovat mielenkiintoisia mutta eivät kiireellisiä — dreaming on vielä kokeellinen ja API:a ulkoisille plugineille ei ole.
