# Plan: Aikataulutettu konsolidaatio

> Päivämäärä: 2026-04-08
> Perustuu: history/analysis-sleep-architecture.md
> Status: Ehdotus

## Tavoite

Korvaa manuaalinen `/memory sleep` -triggeri automaattisella päivittäisellä konsolidaatiolla. Lisää catch-up decay joka kompensoi väliin jääneet ajot. Erota temporaalisten tilojen päivitys omaksi 12h ajokseen.

Ei schema-muutoksia. Kaikki muutokset ovat logiikkamuutoksia nykyiseen koodiin.

---

## 1. Catch-up decay

**Tiedostot:** `src/consolidation.ts`, `src/consolidation-steps.ts`

**Muutos:** Lisää `runConsolidation()`-funktion alkuun catch-up-logiikka joka laskee montako decay-kierrosta on jäänyt väliin ja soveltaa ne kerralla ennen normaalia decay-kierrosta.

**`src/consolidation-steps.ts`** — uusi funktio:

```typescript
/** Maximum catch-up cycles to prevent amnesia on very long gaps. */
export const MAX_CATCHUP_CYCLES = 30;

/**
 * Apply catch-up decay for missed consolidation cycles.
 *
 * If consolidation hasn't run for N days, applies N decay cycles
 * (capped at MAX_CATCHUP_CYCLES). Uses pow() for efficiency.
 *
 * @param cycles Number of missed cycles (typically daysSinceLastRun - 1,
 *               since normal applyDecay handles the current cycle).
 *               Minimum 0. When called from `/memory sleep`, pass 0
 *               so only the normal single-cycle decay applies.
 */
export function applyCatchUpDecay(db: MemoryDatabase, cycles: number): number {
  if (cycles <= 0) return 0;
  const effectiveCycles = Math.min(cycles, MAX_CATCHUP_CYCLES);
  const allMemories = db.getAllMemories();
  let count = 0;

  for (const mem of allMemories) {
    const factor = mem.consolidated ? DECAY_CONSOLIDATED : DECAY_WORKING;
    const catchUpFactor = Math.pow(factor, effectiveCycles);
    const newStrength = mem.strength * catchUpFactor;
    db.updateStrength(mem.id, newStrength);
    count++;
  }

  // Also catch-up decay associations
  const assocFactor = Math.pow(DECAY_ASSOCIATION, effectiveCycles);
  db.decayAllAssociationWeights(assocFactor);

  return count;
}
```

**`src/consolidation.ts`** — lisää Transaction 1:n alkuun:

```typescript
// Phase 4.0 — Catch-up decay for missed cycles
const lastAt = params.db.getState("last_consolidation_at");
let catchUpCycles = 0;
if (lastAt) {
  const daysSince = (Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60 * 24);
  catchUpCycles = Math.max(0, Math.floor(daysSince) - 1);
}
summary.catchUpDecayed = applyCatchUpDecay(params.db, catchUpCycles);

// Phase 4.1 — Normal single-cycle decay + reinforcement
summary.reinforced = applyReinforcement(params.db);
summary.decayed = applyDecay(params.db);
```

Lisää `ConsolidationSummary`:iin `catchUpDecayed: number`.

**Testit:** `src/consolidation.test.ts`, `src/consolidation-steps.test.ts`

- `applyCatchUpDecay` soveltaa oikean määrän kierroksia
- `applyCatchUpDecay` kunnioittaa MAX_CATCHUP_CYCLES kattoa
- `applyCatchUpDecay(db, 0)` ei muuta mitään
- `runConsolidation` laskee catch-up-kierrokset `last_consolidation_at`:sta
- Matemaattinen oikeellisuus: `pow(0.977, 3)` ≈ yksittäisten kierrosten tulo

---

## 2. Temporaalisten tilojen erillinen ajo

**Tiedostot:** `src/consolidation-steps.ts` (ei muutoksia funktioon), `src/index.ts`

`applyTemporalTransitions()` on jo itsenäinen funktio. Tarvitaan vain wrapper ja cron-rekisteröinti.

**`src/index.ts`** tai uusi `src/sleep-scheduler.ts`:

```typescript
/**
 * Run only temporal transitions. Intended for frequent scheduling
 * (e.g., every 12h) separate from full consolidation.
 */
export function runTemporalTransitionsOnly(db: MemoryDatabase): number {
  return db.transaction(() => applyTemporalTransitions(db));
}
```

**Cron-integraatio:**

```typescript
// Pseudo — tarkka API riippuu OpenClaw:n cron-rajapinnasta
registerCron({
  name: "memory-consolidation",
  schedule: "0 3 * * *",          // Joka yö klo 03:00
  handler: () => runConsolidation(params),
});

registerCron({
  name: "memory-temporal-transitions",
  schedule: "0 3,15 * * *",       // Klo 03:00 ja 15:00
  handler: () => runTemporalTransitionsOnly(db),
});
```

Klo 03:00 molemmat triggerit laukeavat. Temporal transitions on idempotentti joten tuplaajo on harmitonta.

**Testit:**
- `runTemporalTransitionsOnly` ajaa vain temporaaliset siirtymät, ei muuta
- Idempotentti — kahden peräkkäisen ajon tulos sama

---

## 3. Manuaalisen `/memory sleep` säilyttäminen

Nykyinen komento säilyy. Catch-up decay toimii automaattisesti `last_consolidation_at`:n perusteella. Jos konsolidaatio ajettiin juuri, manuaalinen ajo tekee yhden normaalin decay-kierroksen mutta 0 catch-up-kierrosta.

---

## Ajojärjestys konsolidaatiossa (klo 03:00)

```
1. Catch-up decay (missedCycles = päivät edellisestä ajosta - 1)
2. Reinforcement
3. Decay (normaali 1 kierros)
4. Co-retrieval associations
5. Transitive associations
6. Temporal transitions
7. Pruning
8. Merge candidates + LLM merge
9. Provenance GC
```

Decay on ensimmäisenä (catch-up + normaali) koska se normalisoi strength-arvot ennen muita operaatioita.
