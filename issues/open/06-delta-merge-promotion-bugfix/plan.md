# Plan: Delta-merge ja promootio-bugfix

> Päivämäärä: 2026-04-08
> Perustuu: history/analysis-sleep-architecture.md
> Status: Ehdotus

## Tavoite

Kaksi itsenäistä parannusta konsolidaatioon:

1. **Delta-merge** — rajaa merge-kandidaattien haku kahteen suodatettuun joukkoon (O(S×T)) nykyisen O(N²):n sijaan
2. **Promootio-bugfix** — poista virheellinen `promoteWorkingToConsolidated()` joka merkitsee kaikki muistot consolidated-tilaan

Ei schema-muutoksia.

---

## 1. Delta-pohjainen merge-kandidaattien haku

**Tiedostot:** `src/merge-candidates.ts`, `src/consolidation.ts`, `src/db.ts`

### Ongelma

Nykyinen `findMergeCandidates()` vertaa kaikkia muistoja kaikkiin (O(N²)). Promootio-bugfixin jälkeen suurin osa muistoista on working-tilassa (vain merge-tulokset ovat consolidated), joten pelkkä "working vs all" ei rajaisi riittävästi.

### Ratkaisu

Kaksi suodatettua joukkoa joiden koko skaalautuu muistojen relevanssiin:

**Sources** (aktiiviset muistot — vertailun lähtöjoukko). Muisto on source jos mikä tahansa:
- `strength ≥ 0.5`
- `created_at > last_consolidation_at` (uusi)
- altistettu/haettu edellisen konsolidaation jälkeen

**Targets** (samat kriteerit, matalampi strength-kynnys):
- `strength ≥ 0.3`
- `created_at > last_consolidation_at` (uusi)
- altistettu/haettu edellisen konsolidaation jälkeen

Lisäksi: `source.type === target.type` (tyyppikonstrainti).

Vanhat, heikot, käyttämättömät muistot eivät ole kummallakaan puolella — ne vain decayavat ja prunautuvat pois.

### Toteutus

**`src/merge-candidates.ts`** — uudet vakiot ja funktio:

```typescript
/** Minimum strength for a memory to be a merge source. */
export const MERGE_SOURCE_MIN_STRENGTH = 0.5;

/** Minimum strength for a memory to be a merge target. */
export const MERGE_TARGET_MIN_STRENGTH = 0.3;

/**
 * Find merge candidate pairs between source and target memories.
 *
 * Only compares sources against targets. Only pairs with matching
 * `type` are considered. Complexity is O(S×T) where both S and T
 * are pre-filtered subsets of the full memory set.
 */
export function findMergeCandidatesDelta(
  sources: MemoryCandidate[],
  targets: MemoryCandidate[],
  maxPairs = MAX_MERGE_PAIRS,
): MergePair[] {
  if (sources.length === 0 || targets.length === 0) return [];

  const sourceFeatures = sources.map((m) => textFeatures(m.content));
  const targetFeatures = targets.map((m) => textFeatures(m.content));
  const pairs: MergePair[] = [];

  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < targets.length; j++) {
      if (sources[i].id === targets[j].id) continue;
      if (sources[i].type !== targets[j].type) continue;

      const jaccardScore = jaccardFromSets(sourceFeatures[i], targetFeatures[j]);
      let embeddingScore: number | null = null;
      let combinedScore = jaccardScore;

      if (sources[i].embedding && targets[j].embedding) {
        embeddingScore = cosineSimilarity(sources[i].embedding!, targets[j].embedding!);
        combinedScore = JACCARD_WEIGHT * jaccardScore + EMBEDDING_WEIGHT * embeddingScore;
      }

      if (combinedScore >= MERGE_THRESHOLD) {
        pairs.push({
          a: sources[i].id,
          b: targets[j].id,
          jaccardScore,
          embeddingScore,
          combinedScore,
        });
      }
    }
  }

  pairs.sort((x, y) => y.combinedScore - x.combinedScore);
  return pairs.slice(0, maxPairs);
}
```

`MemoryCandidate`-tyyppiä laajennetaan:

```typescript
export type MemoryCandidate = {
  id: string;
  content: string;
  type: string;          // lisätään type-kenttä
  embedding: number[] | null;
};
```

**`src/db.ts`** — uusi DB-metodi:

```sql
-- getMergeCandidateMemories(minStrength, lastConsolidationAt)
SELECT * FROM memories
WHERE strength >= :minStrength
   OR created_at > :lastConsolidationAt
   OR id IN (
     SELECT DISTINCT memory_id FROM turn_memory_exposure
     WHERE created_at > :lastConsolidationAt
   )
```

**`src/consolidation.ts`** — muutos merge-vaiheeseen:

```typescript
// Phase 4.4–4.5 — Merge (delta: filtered sources vs filtered targets)
if (params.mergeContentProducer) {
  const lastAt = params.db.getState("last_consolidation_at");

  const sourceMems = params.db.getMergeCandidateMemories(
    MERGE_SOURCE_MIN_STRENGTH, lastAt,
  );
  const targetMems = params.db.getMergeCandidateMemories(
    MERGE_TARGET_MIN_STRENGTH, lastAt,
  );

  const toCandidate = (m: MemoryRow): MemoryCandidate => ({
    id: m.id, content: m.content, type: m.type,
    embedding: params.db.getEmbedding(m.id),
  });

  const pairs = findMergeCandidatesDelta(
    sourceMems.map(toCandidate),
    targetMems.map(toCandidate),
  );
  // ... rest unchanged
}
```

Vanha `findMergeCandidates()` säilytetään.

### Testit

- Delta-funktio vertaa vain sources vs targets
- Tyyppikonstrainti: eri tyypit eivät tuota kandidaatteja
- Sama muisto ei vertaudu itseensä
- Vanhat heikot käyttämättömät muistot eivät ole kummassakaan joukossa
- Uudet muistot ovat aina mukana riippumatta strengthistä
- Äskettäin haetut muistot ovat aina mukana riippumatta strengthistä

---

## 2. Bugfix: poista virheellinen promoteWorkingToConsolidated

**Tiedostot:** `src/consolidation-steps.ts`, `src/consolidation.ts`

### Bugi

`promoteWorkingToConsolidated()` merkitsee *kaikki* working-muistot consolidated-tilaan konsolidaatioajon lopussa. Tämä on väärin — `consolidated` tarkoittaa muistoa joka on syntynyt useamman muiston yhdistämisestä (merge). Yksittäiset agentin tallentamat muistot ovat ja pysyvät working-tilassa.

### Seuraus

Ensimmäisen konsolidaatioajon jälkeen kaikki muistot saavat hitaamman decayn (0.977 vs 0.906) vaikka niitä ei ole koskaan yhdistetty. Working/consolidated -ero menettää merkityksensä.

### Korjaus

Poista `promoteWorkingToConsolidated()`-kutsu `runConsolidation()`-funktiosta. Consolidated-tilan asettaminen tapahtuu jo oikeassa paikassa: `executeMerge()` asettaa `consolidated: true` merge-tuloksille (`src/merge-execution.ts:125`).

**`src/consolidation.ts`** — poista Transaction 2:sta:

```typescript
// POISTA tämä rivi:
summary.promoted = promoteWorkingToConsolidated(params.db);
```

Poista myös `promoted`-kenttä `ConsolidationSummary`:sta.

**`src/consolidation-steps.ts`** — poista `promoteWorkingToConsolidated()` kokonaan tai merkitse `@deprecated`.

### Testit

- Working-muistot säilyvät working-tilassa konsolidaation jälkeen
- Merge-tulokset ovat consolidated (testataan jo merge-testeissä)
- Decay käyttää oikeaa kerrointa: working-muistot ×0.906, vain merge-tulokset ×0.977
