# Osa A: OpenClaw-muutokset assosiatiivisen muistin pluginia varten

> Tämä dokumentti kuvaa OpenClaw:n ydinkoodiin tarvittavat muutokset, jotka mahdollistavat tai parantavat assosiatiivisen muistin pluginin toimintaa. Jokainen muutos on itsenäinen, taaksepäin yhteensopiva PR.
>
> **Konteksti:** Rakennamme OpenClaw-pluginia joka korvaa `memory-core`:n assosiatiivisella muistijärjestelmällä. Plugin käyttää eksklusiivista memory-slottia (`kind: "memory"`).

---

## Prioriteetti 1: Välttämättömät

### A1. `buildMemorySection()` ehdolliseksi

**Tiedosto:** `src/agents/system-prompt.ts`

**Ongelma:** System promptin "Memory Recall" -osio on hardkoodattu ohjaamaan agenttia käyttämään `memory_search`/`memory_get` -työkaluja tietyllä tavalla. Kun toinen memory-plugin on aktiivinen, ohjeet ovat harhaanjohtavia.

**Muutos:** `buildMemorySection()` tarkistaa aktiivisen memory-slotin. Jos slotti ei ole `"memory-core"`, osio jätetään pois ja annetaan pluginin injektoida omat ohjeensa `before_prompt_build` → `prependContext`-hookilla.

**Vaikutus:** Mahdollistaa minkä tahansa memory-pluginin omien system prompt -ohjeiden käytön.

### A3. `sessionFile` → `after_compaction` (triviaali)

**Tiedosto:** `src/agents/pi-embedded-subscribe.handlers.compaction.ts`, rivit ~71–75

**Ongelma:** Auto-compaction ei lähetä `sessionFile`-kenttää `after_compaction`-hookissa, vaikka se on saatavilla kontekstista ja tyyppi sen sallii. Manuaalinen compaction lähettää sen.

**Muutos:**
```diff
hookRunnerEnd.runAfterCompaction(
  {
    messageCount: ctx.params.session.messages?.length ?? 0,
    compactedCount: ctx.getCompactionCount(),
+   sessionFile: ctx.params.session.sessionFile,
  },
- {},
+ { sessionKey: ctx.params.sessionKey },
)
```

---

## Prioriteetti 2: Bugikorjaus (itsenäinen)

### A5. MMR tokenizer Unicode-tuki

**Tiedosto:** `src/memory/mmr.ts`, rivi ~33

**Ongelma:** Tokenizer käyttää `/[a-z0-9_]+/g` joka tiputtaa kaikki ei-ASCII-merkit. Suomenkieliset sanat ("päätös", "äänestys") eivät tokenisoidu. `buildFtsQuery` käyttää jo `/[\p{L}\p{N}_]+/gu`.

**Muutos:** Korvata regex: `/[\p{L}\p{N}_]+/gu`. Parantaa MMR-diversiteettiä kaikille ei-englanninkielisille käyttäjille.

---

## Prioriteetti 3: Arkkitehtuurimuutokset (suositeltavat)

### A4. session-memory ehdolliseksi

**Tiedosto:** `src/hooks/bundled/session-memory/handler.ts`

**Ongelma:** Bundled-hook `session-memory` tallentaa session-transkriptin `memory/YYYY-MM-DD-<slug>.md` -tiedostoon. Se on riippumaton memory-pluginista → tuottaa duplikaatteja kun toinen memory-plugin on aktiivinen.

**Muutos:** Hook tarkistaa aktiivisen memory-slotin. Jos slotti ei ole `"memory-core"`, hook ei aja.

### A6. Embedding-providerin saavutettavuus pluginille

**Tiedostot:** `src/memory/embeddings.ts`, plugin API

**Ongelma:** Plugin tarvitsee pääsyn embedding-infraan (providerit, batch, cache) omien muisto-olioiden embedaamiseen. Nykyinen API piilottaa infran.

**Muutos:** `api.runtime.memory.createEmbeddingProvider()` tai vastaava rajapinta.

### A7. Memory-layout manifesti

**Ongelma:** Mikään ei kerro, mitä muistimallia workspace käyttää. Jos agentti avaa workspacen jossa on assosiatiivisen muistin tietomalli, memory-core yrittäisi indeksoida sen sokeasti.

**Muutos:** `memory/.layout.json` joka ilmoittaa aktiivisen muistimallin. Memory-core kirjoittaa oman manifesti (`memory-core-v1`).

---

## Prioriteetti 4: Pitkä aikaväli

### A2. ExtensionFactory-rekisteröinti plugineille

**Tiedostot:** `src/agents/pi-embedded-runner/extensions.ts`, plugin API

**Ongelma:** Pi-coding-agent Extension API (`context`-event, `session_before_compact`-event) ei ole pluginien saavutettavissa.

**Muutos:** `api.registerExtension(factory)` tai vastaava.

**Huom:** Ei MVP-blokkeraaja – `before_prompt_build` + `prependContext` riittää alkuun.

---

## Ehdotettu PR-järjestys

1. **A5** (MMR Unicode) – pieni bugikorjaus, hyvä ensikontakti
2. **A3** (sessionFile) – triviaali 2 rivin korjaus
3. **A1** (buildMemorySection ehdolliseksi) – pieni mutta vaatii design-keskustelun
4. **A4** (session-memory ehdolliseksi) – yksinkertainen ehto
5. **A6, A7** – laajemmat, vaativat keskustelua
6. **A2** – pitkän aikavälin arkkitehtuurimuutos
