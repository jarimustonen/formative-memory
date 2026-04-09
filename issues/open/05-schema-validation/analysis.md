# Analyysi: Runtime-skeemavalidointi DB-kerrokseen

**Päivämäärä:** 2026-04-08
**Status:** Tutkimus valmis

## Tausta

Koodissa toistuva pattern: SQLite palauttaa `MemoryRow`-tyypin jossa `source: string` ja `temporal_state: string`, ja `rowToMemory()` castaa ne union-tyypeiksi (`as TemporalState`, `as MemorySource`) ilman runtime-tarkistusta. Vastaavasti `AfterTurnParams.messages` on `unknown[]` ja transkriptin parsinta käyttää `as Record<string, unknown>` -ketjuja.

### Nykytila

| Paikka | Tyypitys | Validointi |
|--------|----------|------------|
| `rowToMemory()` (memory-manager.ts:249–262) | `as TemporalState`, `as MemorySource` | Ei runtime-validointia |
| `insertMemory()` (db.ts:181–208) | Tyypitetty parametri (`TemporalState`, `MemorySource`) | TypeScript-tyyppi, ei runtime-tarkistusta |
| `AfterTurnParams.messages` (after-turn.ts:20) | `unknown[]` | Manuaaliset type guard -ketjut |
| `parseFeedbackCalls()` (after-turn.ts:217–248) | `as Record<string, unknown>` -ketju | Manuaaliset typeof-tarkistukset |
| `estimateMessageTokens()` (context-engine.ts:37–49) | `as Record<string, unknown>` | Manuaalinen |
| Config-parsinta (config.ts) | Käsin kirjoitettu parser | Kattava mutta ei skeemakirjastoa |
| Tool-parametrit (index.ts) | `@sinclair/typebox` | OpenClaw runtime validoi |
| SQLite: `temporal_state`, `source`, `mode`, `evidence` | `TEXT NOT NULL` | Ei CHECK-rajoitteita |

### OpenClaw memory-core -vertailu

OpenClaw:n oma memory-core käyttää **identtistä patternia**: `as`-castit DB-riveille, ei runtime-validointia. Tool-parametreissa TypeBox, config-tasolla Zod + AJV. Tämä tarkoittaa, ettei ekosysteemissä ole vakiintunutta käytäntöä jota seuraisimme.

## Tutkimuskysymys 1: Mikä kirjasto?

### Vaihtoehdot

| Kirjasto | Bundlekoko (min+gz) | Jo riippuvuus? | TS-tyyppi-inferenssi | Ergonomia |
|----------|---------------------|----------------|----------------------|-----------|
| **@sinclair/typebox** | ~30 kB | ✅ Kyllä | ✅ `Static<T>` | JSON Schema -pohjainen, verbose |
| **@sinclair/typebox/compiler** | +~10 kB | Osittain | ✅ | Optimoitu validointi |
| **Zod** | ~14 kB | ❌ Ei | ✅ `z.infer<T>` | Ergonominen, ketjutettava |
| **Valibot** | ~1–6 kB (tree-shake) | ❌ Ei | ✅ | Modulaarinen, pieni |
| **Käsin kirjoitettu** | 0 kB | — | ❌ Manuaalinen | Virhealttis, ei geneerinen |

### Analyysi

**TypeBox** on jo riippuvuus tool-parametreissa. Sen `TypeCompiler` tuottaa nopean validaattorin, mutta skeeman kirjoittaminen on verbosempaa kuin Zodissa. Typebox-skeema voidaan kääntää JSON Schemaksi (hyödyllinen jos tarvitaan ulkoista validointia).

**Zod** olisi ergonomisin ratkaisu (`.parse()`, `.safeParse()`, ketjutus), mutta lisäisi toisen skeemakirjaston ylläpidettäväksi. Tämä on projektin suurin riski: `config.ts`-parseri on jo käytännössä "kolmas skeemakirjasto".

**Valibot** on pienin (tree-shakeable), mutta lisäisi silti toisen riippuvuuden.

**Käsin kirjoitetut guardit** toimivat nykyiseen tarpeeseen (rajallinen enum-validointi), mutta eivät skaalaudu.

## Tutkimuskysymys 2: Missä validoidaan?

### Validointipinnan analyysi

```
Ulkomaailma
  │
  ├── Tool call (params)      → TypeBox validoi (OpenClaw runtime)  ✅
  ├── Config (plugin config)   → config.ts käsin parsii             ⚠️
  │
  ├── afterTurn(messages)      → unknown[] + manuaaliset guardit    ⚠️
  │
  └── SQLite rivi
       └── rowToMemory()       → as-cast, ei validointia            ❌
```

**Suositus: validoi rajapinnoilla, ei joka DB-luvussa.**

| Kohde | Suositeltu lähestymistapa | Perustelu |
|-------|--------------------------|-----------|
| `rowToMemory()` | Assertion-funktio enum-kentille | DB on oma hallittu data, kevyt tarkistus riittää |
| `AfterTurnParams.messages` | Tyyppitarkistetut helper-funktiot (nykytila ok) | Ulkoinen data, manuaaliset guardit toimivat |
| `config.ts` | Korvaa TypeBox-skeemalla tai pidä käsin | Kertaluonteinen, ei hot path |
| `insertMemory()` | SQLite CHECK + TS-tyyppi | Belt and suspenders |

## Tutkimuskysymys 3: Kustannus vs. hyöty

### Hyödyt

1. **Bugien ehkäisy**: `rowToMemory()` palauttaisi virheen jos DB:ssä on tuntematon `source`-arvo → bugit näkyvät heti eikä myöhemmin väärässä paikassa.
2. **Refaktoroinnin turvallisuus**: Uuden `TemporalState`- tai `MemorySource`-arvon lisääminen vaatisi päivityksen skeemaan → pakottaa ajattelemaan kaikki polut.
3. **Dokumentaatio**: Skeema on elävä dokumentaatio sallituista arvoista.

### Kustannukset

1. **Kahden kirjaston ylläpito** (jos Zod): Tool-parametrit TypeBox, muu validointi Zod → kehittäjän pitää muistaa molemmat APIt.
2. **Boilerplate**: TypeBox-skeeman kirjoittaminen enum-validointiin on ylimitoitettu; pelkkä assertion-funktio riittää.
3. **Performance-overhead**: Jokaisella DB-luvulla validoidaan rivi. Pieni mutta mitattava hot pathilla.
4. **Väärä turvallisuudentunne**: Validointi luutuneissa rajapinnoissa voi antaa väärän kuvan kattavuudesta.

### Kustannus-hyötyarvio

Tässä projektissa:
- DB on täysin oma — ei ulkoista dataa (paitsi import/migraatio).
- Enum-arvot ovat stabiileja (4 TemporalState-arvoa, 4 MemorySource-arvoa).
- Ainoa oikea riskipinta on **import/migraatio** jossa ulkoinen data tulee sisään.
- Bugi-ikkuna on pieni: väärä `source`-arvo ei kaada ohjelmaa, se vain näkyy vääränä.

**Kokonaishyöty: matala.** Riskiä on lähinnä migraatio- ja import-poluilla.

## Tutkimuskysymys 4: SQLite CHECK -rajoitteet

### Suositus: Kyllä, lisätään.

SQLite CHECK-rajoitteet ovat **nollakustanteinen turvaverkko** — ne eivät vaikuta lukusuorituskykyyn ja tarkistetaan vain INSERT/UPDATE-yhteydessä.

```sql
-- Ehdotetut CHECK-rajoitteet
ALTER TABLE memories ADD CHECK (temporal_state IN ('future', 'present', 'past', 'none'));
ALTER TABLE memories ADD CHECK (source IN ('agent_tool', 'hook_capture', 'consolidation', 'import'));
ALTER TABLE turn_memory_exposure ADD CHECK (mode IN ('auto_injected', 'tool_search_returned', 'tool_get', 'tool_store'));
```

**Huom:** SQLite ei tue `ALTER TABLE ... ADD CONSTRAINT` suoraan olemassa oleville tauluille. CHECK-rajoitteet pitää lisätä skeema-SQL:ään `CREATE TABLE`-lauseisiin ja ne vaikuttavat vain uusiin tauluihin. Olemassa olevilla tauluilla tarvitaan migraatio (CREATE new → copy → DROP old → RENAME).

**Pragmaattinen vaihtoehto:** Lisätään CHECK:it skeema-SQL:ään CREATE TABLE -lauseisiin. Ne aktivoituvat uusille asennuksille. Olemassa oleville DB:lle migraatiota ei tarvitse tehdä — riski on pieni.

## Tutkimuskysymys 5: Performance

### Hot path -analyysi

| Polku | Kutsumäärä | Vaikutus |
|-------|-----------|----------|
| `assemble()` → recall → `rowToMemory()` | 1–5 muistia per turn | Merkityksetön |
| `afterTurn()` → exposure/attribution writes | 1–20 inserttiä per turn | INSERT-CHECK: ~µs, merkityksetön |
| `getAllMemories()` → `rowToMemory()` monelle riville | Consolidation (100+ muistia) | Assertion-funktio: <1ms/100 riviä |
| `search()` → getAllEmbeddings + scoring | Hot path | Ei validointia tarvita (numeerinen data) |

**Johtopäätös:** Validointi-overhead on merkityksetön kaikilla poluilla. Embedding-haku ja cosinisimilaarisuus ovat suuruusluokkia hitaampia.

## Tutkimuskysymys 6: Miten muut tekevät?

OpenClaw memory-core:
- DB-rivit: `as`-castit, ei runtime-validointia (identtinen meidän patterniin)
- Tool-parametrit: TypeBox (identtinen)
- Config: Zod + AJV
- Transkripti: Manuaaliset type guardit `typeof`-tarkistuksilla

**Johtopäätös:** Emme ole poikkeus — sama pattern koko ekosysteemissä.

## Suositus

### Pääsuositus: Kevyt lähestymistapa (ei uutta skeemakirjastoa)

1. **SQLite CHECK -rajoitteet** skeema-SQL:ään (`CREATE TABLE`) — nollakustanteinen turvaverkko uusille asennuksille.

2. **Assertion-funktiot** enum-tyypeille:
   ```typescript
   // types.ts
   const TEMPORAL_STATES = new Set(["future", "present", "past", "none"]);
   const MEMORY_SOURCES = new Set(["agent_tool", "hook_capture", "consolidation", "import"]);

   export function assertTemporalState(v: string): asserts v is TemporalState {
     if (!TEMPORAL_STATES.has(v)) throw new Error(`Invalid temporal_state: ${v}`);
   }
   export function assertMemorySource(v: string): asserts v is MemorySource {
     if (!MEMORY_SOURCES.has(v)) throw new Error(`Invalid source: ${v}`);
   }
   ```

3. **Käytä assertion-funktioita** `rowToMemory()`:ssä ja import/migraatio-poluilla.

4. **Älä lisää Zodia tai Valibotia.** TypeBox on jo riippuvuus, mutta sitäkään ei kannata laajentaa DB-kerrokseen — assertion-funktiot ovat yksinkertaisempia ja nopeampia tähän tarkoitukseen.

5. **config.ts**: Voidaan halutessa refaktoroida TypeBox-skeemaksi yhdenmukaisuuden vuoksi, mutta nykyinen käsin kirjoitettu parseri toimii hyvin. Ei prioriteetti.

### Miksi ei Zodia?

- Lisäisi toisen skeemakirjaston (TypeBox tool-parametreissa, Zod kaikessa muussa)
- Ongelma on pieni: 2 × 4-arvoista enum-validointia + manuaaliset type guardit jotka toimivat
- Zod:n hyöty näkyisi vasta jos validoitavien rakenteiden kompleksisuus kasvaisi merkittävästi

### Toteutuksen laajuus (jos päätetään tehdä)

| Tehtävä | Työmäärä | Prioriteetti |
|---------|----------|-------------|
| CHECK-rajoitteet skeema-SQL:ään | Pieni | Korkea |
| Assertion-funktiot types.ts:ään | Pieni | Korkea |
| `rowToMemory()` käyttää assertioneja | Pieni | Korkea |
| Import/migraatio-polut validoivat | Keskisuuri | Keskitaso |
| config.ts → TypeBox-skeema | Keskisuuri | Matala |
| Transkriptiparsinta (after-turn.ts) | — | Ei tarvetta (manuaaliset guardit ok) |

### Päätösehdotus

**Tehdään kevyesti.** CHECK-rajoitteet + assertion-funktiot kattavat todellisen riskin (väärä enum-arvo DB:ssä) ilman uusia riippuvuuksia tai ylläpitokuormaa. Laajempi skeemavalidointi (Zod/TypeBox koko DB-kerrokseen) on ylimitoitettu tämän projektin tarpeisiin.

---

## LLM-review: Kriittiset löydökset ja tarkistettu suositus

> Alkuperäinen analyysi arvioitiin `/llm-review`-skillillä (Gemini + Codex, 2 kierrosta).
> Täydellinen raportti: `history/review-schema-validation.md`

### Alkuperäisen analyysin puutteet (konsensus)

1. **Virhekäsittelystrategia puuttuu kokonaan.** Analyysi ehdottaa assertion-funktioita ilman virhekäsittelysuunnitelmaa. Jos `getAllMemories()` kohtaa yhden virheellisen rivin, koko konsolidaatio kaatuu. Ennen validointikoodin kirjoittamista tarvitaan eksplisiittinen virhestrategia: fail-fast admin-poluilla, skip+log käyttäjälle näkyvillä poluilla.

2. **Validointiskoopin liian kapea.** Analyysi keskittyy `temporal_state` ja `source` -kenttiin mutta jättää huomiotta semanttisesti kriittisimmän kentän: `message_memory_attribution.evidence`. Kentän arvo ohjaa `mergeAttributionRow()`:n 40-rivistä CASE-logiikkaa (`LIKE 'agent_feedback_%'`). Väärä arvo muuttaa attribuutio-prioriteettia äänettömästi.

3. **Olemassa olevat DB:t jäävät suojatta.** `CREATE TABLE IF NOT EXISTS` ei lisää CHECK-rajoitteita olemassa oleviin tauluihin. Uusien assertion-funktioiden yhdistäminen vanhoihin DB:ihin ilman migraatiota luo split-brain -tilanteen: samat koodiversiot käyttäytyvät eri tavalla asennushistorian mukaan.

4. **Aikaleima- ja numeerinen integriteetti puuttuu.** Koodin kriittinen sopimus (ISO-8601 UTC, leksikografinen järjestys) ei ole validoitu missään. `getTransitionMemories()` tuottaa NaN:n virheellisellä `temporal_anchor`:lla. `updateStrength()` hyväksyy NaN/Infinity.

5. **Import/raw-kirjoituspolut validoimatta.** `insertExposureRaw()`, `insertAttributionRaw()` ja LLM-rikastuksen tulokset kirjoittavat validoimattomia stringejä kriittisiin kenttiin.

### Tarkistettu suositus

#### Vaihe 0: Virhekäsittelystrategia (PAKOLLINEN ennen validointia)

Määritellään kaksi DB-lukutilaa:
- **Strict** (admin/tooling): throw virheellisillä arvoilla — `memory-sleep`, import, CLI-diagnostiikka
- **Tolerant** (user-facing): skip+log virheellisillä riveillä — `search()`, `assemble()`, `recall()`

```typescript
// types.ts
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; rowId?: string };
```

#### Vaihe 1: Enum-validointi kaikille kriittisille kentille

Laajennettu scope (alkuperäisen `temporal_state` + `source` lisäksi):

| Kenttä | Taulu | Riski |
|--------|-------|-------|
| `temporal_state` | memories | Kyselyt, siirtymälogiikka |
| `source` | memories | Provenance |
| `evidence` | message_memory_attribution | **Kriittinen** — ohjaa merge-logiikkaa |
| `mode` | turn_memory_exposure | Exposure-analyysi |
| `retrieval_mode` | turn_memory_exposure | Analyysi |

Yhteinen factory enum-guardeille:
```typescript
// types.ts
export const TEMPORAL_STATES = ["future", "present", "past", "none"] as const;
export type TemporalState = (typeof TEMPORAL_STATES)[number];

export const MEMORY_SOURCES = ["agent_tool", "hook_capture", "consolidation", "import"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const EXPOSURE_MODES = ["auto_injected", "tool_search_returned", "tool_get", "tool_store"] as const;
export type ExposureMode = (typeof EXPOSURE_MODES)[number];

export const ATTRIBUTION_EVIDENCE = [
  "auto_injected", "tool_search_returned", "tool_get",
  "agent_feedback_neutral", "agent_feedback_positive", "agent_feedback_negative",
] as const;
export type AttributionEvidence = (typeof ATTRIBUTION_EVIDENCE)[number];

function makeEnumGuard<const T extends readonly string[]>(values: T) {
  const set = new Set<string>(values);
  return {
    is: (v: unknown): v is T[number] => typeof v === "string" && set.has(v),
    assert: (v: unknown, label: string): asserts v is T[number] => {
      if (typeof v !== "string" || !set.has(v))
        throw new Error(`Invalid ${label}: ${String(v)}`);
    },
  };
}

export const TemporalStateGuard = makeEnumGuard(TEMPORAL_STATES);
export const MemorySourceGuard = makeEnumGuard(MEMORY_SOURCES);
export const ExposureModeGuard = makeEnumGuard(EXPOSURE_MODES);
export const AttributionEvidenceGuard = makeEnumGuard(ATTRIBUTION_EVIDENCE);
```

#### Vaihe 2: Numeerinen ja aikaleima-validointi kirjoituspoluilla

- `updateStrength()`: `Number.isFinite(strength)` -tarkistus
- `setEmbedding()`: Float32-taulukon pituus- ja finite-tarkistus
- Import/`*Raw`-polut: ISO-8601 UTC -muodon validointi aikaleimoille

#### Vaihe 3: SQLite CHECK -rajoitteet (lykätty)

**Muutos alkuperäisestä:** CHECK-rajoitteita **ei lisätä** nyt. Perustelut:
- Enum-arvot kehittyvät edelleen — SQLite CHECK:in päivittäminen vaatii taulujen uudelleenrakennuksen
- TypeScript-validointi kirjoituspoluilla antaa saman turvan yhdenmukaisesti kaikille asennuksille
- Ei split-brain -riskiä

CHECK-rajoitteet voidaan harkita myöhemmin kun enum-arvot stabiloituvat ja projekti saa kunnollisen migraatiokehyksen.

#### Kirjastovalinta: ei muutosta

Alkuperäinen suositus pätee: **ei Zodia tai Valibotia.** Käsin kirjoitetut enumguardit + `makeEnumGuard`-factory riittävät. TypeBox-laajennusta voi harkita transkriptiparsintaan myöhemmin, mutta se on sekundäärinen prioriteetti.
