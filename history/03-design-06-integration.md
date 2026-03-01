# Design-06: Integraatio OpenClaw:iin

> **Tila:** Ensimmäinen vedos (korkea taso)
> **Päivitetty:** 28.2.2026
> **Riippuvuudet:** design-01–05 (kaikki edelliset), research-04 (hookit), research-05 (plugin-järjestelmä)
> **Ruokkii:** design-07 (migraatio)

---

## 1. Tarkoitus

Kuvata miten assosiatiivinen muisti -plugin konkreettisesti istuu OpenClaw:n plugin-arkkitehtuuriin: plugin-rakenne, hookit, työkalut, servicet, CLI-komennot ja Osa A -riippuvuudet.

---

## 2. Plugin-rakenne

### 2.1 Manifesti (`openclaw.plugin.json`)

```json
{
  "name": "associative-memory",
  "version": "0.1.0",
  "description": "Biologically-inspired associative memory for OpenClaw agents",
  "kind": "memory",
  "author": "Jari Mustonen",
  "license": "MIT",
  "main": "dist/index.js",
  "configSchema": {
    "type": "object",
    "properties": {
      "consolidation": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean", "default": true },
          "schedule": { "type": "string", "default": "0 3 * * *" },
          "model": { "type": "string" },
          "rem_sample_size": { "type": "integer", "default": 30 }
        }
      },
      "decay": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean", "default": true },
          "death_threshold": { "type": "number", "default": 0.05 }
        }
      },
      "retrieval": {
        "type": "object",
        "properties": {
          "auto_recall_budget_tokens": { "type": "integer", "default": 2000 },
          "association_boost_factor": { "type": "number", "default": 0.3 }
        }
      }
    }
  }
}
```

### 2.2 Tiedostorakenne

```
extensions/associative-memory/
├── openclaw.plugin.json
├── src/
│   ├── index.ts              ← register(api) entry point
│   ├── tools/
│   │   ├── memory-search.ts  ← memory_search työkalu
│   │   ├── memory-store.ts   ← memory_store työkalu
│   │   ├── memory-get.ts     ← memory_get työkalu
│   │   └── memory-forget.ts  ← memory_forget työkalu
│   ├── hooks/
│   │   ├── tick-counter.ts   ← after_tool_call → tick++
│   │   ├── auto-recall.ts    ← before_prompt_build → injektoi muistoja
│   │   ├── auto-capture.ts   ← agent_end → analysoi ja tallenna
│   │   ├── temporal-check.ts ← before_prompt_build → tarkista tilat
│   │   └── bootstrap-mod.ts  ← agent.bootstrap → muokkaa AGENTS.md
│   ├── services/
│   │   ├── consolidation.ts  ← tausta-konsolidaatiopalvelu
│   │   └── db.ts             ← SQLite-yhteys ja skeeman hallinta
│   ├── core/
│   │   ├── memory.ts         ← muisto-olion CRUD
│   │   ├── association.ts    ← assosiaatioiden hallinta
│   │   ├── retrieval.ts      ← hakuputki
│   │   ├── decay.ts          ← decay-laskenta
│   │   └── tick.ts           ← tick-laskuri
│   ├── cli/
│   │   └── commands.ts       ← CLI-komennot
│   └── types.ts              ← tyypit ja rajapinnat
└── dist/                     ← käännetty koodi
```

---

## 3. Rekisteröitävät komponentit

### 3.1 Hookit

| Hook | Tarkoitus | Tyyppi |
| --- | --- | --- |
| `after_tool_call` | Tick-laskuri + co-retrieval-seuranta | fire-and-forget |
| `before_prompt_build` | Auto-recall + temporaalinen tarkistus | palauttaa `prependContext` |
| `agent_end` | Automaattinen muistojen kaappaus | fire-and-forget |
| `before_reset` | Session-muistojen tallennus ennen nollausta | fire-and-forget |
| `agent.bootstrap` | AGENTS.md:n muistiosion korvaaminen | muokkaa tiedostoja |
| `before_compaction` | Tallenna sessionFile myöhempää käyttöä varten | fire-and-forget |

### 3.2 Työkalut

| Työkalu | API | Kuvaus |
| --- | --- | --- |
| `memory_search` | `api.registerTool()` | Semanttinen haku koko hakuputkella |
| `memory_store` | `api.registerTool()` | Uuden muiston tallentaminen |
| `memory_get` | `api.registerTool()` | Muiston haku id:llä |
| `memory_forget` | `api.registerTool()` | Muiston poisto |

### 3.3 Servicet

| Service | Tarkoitus |
| --- | --- |
| `associative-memory-db` | SQLite-yhteyden hallinta, skeeman alustus |
| `consolidation` | Tausta-konsolidaatioprosessi (cron/timer) |

### 3.4 CLI-komennot

| Komento | Kuvaus |
| --- | --- |
| `memory stats` | Muistojen ja assosiaatioiden tilastot |
| `memory consolidate` | Manuaalinen konsolidaatio |
| `memory inspect <id>` | Yksittäisen muiston tiedot + assosiaatiot |
| `memory graph` | Assosiaatioverkon visualisointi (teksti) |

---

## 4. Hook-toteutuksen yksityiskohdat

### 4.1 after_tool_call → Tick + assosiaatiot

```typescript
api.on("after_tool_call", async (event, ctx) => {
  // 1. Kasvata tickiä
  await tickCounter.increment();

  // 2. Jos työkalu oli memory_search → seuraa co-retrieval
  if (event.toolName === "memory_search" && event.result) {
    const retrievedIds = extractMemoryIds(event.result);
    await associations.recordCoRetrieval(retrievedIds, tickCounter.current());
  }

  // 3. Jos työkalu oli memory_store → seuraa co-creation
  if (event.toolName === "memory_store" && event.result) {
    const newId = extractNewMemoryId(event.result);
    const activeMemories = await getActiveMemories(tickCounter.current());
    await associations.recordCoCreation(newId, activeMemories);
  }
});
```

### 4.2 before_prompt_build → Auto-recall

```typescript
api.on("before_prompt_build", async (event, ctx) => {
  // 1. Hae käyttäjän viimeisin viesti
  const userMessage = extractLatestUserMessage(event);

  // 2. Hae relevantteja muistoja
  const memories = await retrieval.search(userMessage, {
    limit: 10,
    budgetTokens: config.retrieval.auto_recall_budget_tokens,
  });

  // 3. Tarkista temporaaliset siirtymät
  await temporalCheck.updateStates();

  // 4. Injektoi kontekstiin
  return {
    prependContext: formatMemoriesForContext(memories),
  };
});
```

### 4.3 agent.bootstrap → AGENTS.md-muokkaus

```typescript
api.registerHook("agent.bootstrap", async (files, ctx) => {
  const agentsFile = files.find(f => f.name === "AGENTS.md");
  if (agentsFile) {
    agentsFile.content = replaceMemorySection(agentsFile.content, {
      newInstructions: ASSOCIATIVE_MEMORY_INSTRUCTIONS,
    });
  }
  return files;
});
```

---

## 5. Osa A -riippuvuudet ja niiden vaikutus

### 5.1 Kriittiset (MVP-blokkerit?)

| Osa A | Kuvaus | Ilman tätä | Workaround |
| --- | --- | --- | --- |
| **A1** | Memory Recall pluginista | System prompt ohjaa käyttämään memory_search/memory_get memory-coren tapaan | Plugin rekisteröi samannimiset työkalut → ohjeet sattumanvaraisesti oikein |
| **A3** | sessionFile after_compaction | Ei voida lukea transkriptiä konsolidaatiossa | Tallennetaan before_compactionista |

### 5.2 Merkittävät (ei blokkerita mutta rajoittavat)

| Osa A | Kuvaus | Vaikutus |
| --- | --- | --- |
| **A2** | ExtensionFactory-rekisteröinti | Ei konteksti-ikkunan muokkausta, ei compaction-integraatiota |
| **A4** | Session-memory pluginin vastuulle | session-memory-hook jatkaa rinnalla, duplikaattimuistoja |
| **A6** | Embedding-API | Plugin joutuu luomaan oman embedding-putkensa |

### 5.3 MVP ilman Osa A -muutoksia

**Kysymys:** Voiko plugin toimia ilman yhtäkään Osa A -muutosta?

**Vastaus:** Kyllä, rajoitetusti:
- `memory_search` ja `memory_get` korvaavat memory-coren samannimiset → system prompt -ohjeet toimivat sattumalta
- `memory_store` ja `memory_forget` ovat uusia → AGENTS.md:n bootstrap-hookilla ohjeistetaan
- Tick-laskenta `after_tool_call`:sta → toimii
- Auto-recall `before_prompt_build`:stä → toimii
- Konsolidaatio servicenä → toimii
- Session-memory-hook tuottaa rinnakkaisia tiedostoja → plugin joko hyödyntää tai ignoroi

**Johtopäätös:** MVP voidaan rakentaa ilman Osa A -muutoksia. Muutokset parantavat integraatiota myöhemmin.

---

## 6. Embedding-infran käyttö

### 6.1 Nykyinen saavutettavuus

`api.runtime.tools.createMemorySearchTool()` palauttaa valmiin työkalun, mutta plugin tarvitsee raaemman pääsyn:
- Yksittäisten tekstien embedaaminen (uusi muisto)
- Batch-embedaaminen (konsolidaatio)
- Embedding-välimuistin käyttö

### 6.2 Workaround (ilman Osa A)

Plugin voi käyttää `createMemorySearchTool()`:n sisäistä embedding-provideria epäsuorasti, mutta tämä on hackish. Vaihtoehdot:

1. **Oma embedding-provideri** – plugin luo oman instanssin samasta providerista (duplikaatio mutta toimiva)
2. **Plugin lukee käyttäjän embedding-konfiguraation** ja luo providerin suoraan

**Ehdotus MVP:lle:** Vaihtoehto 2 – plugin lukee konfiguraation ja luo oman providerin. Ei vaadi Osa A -muutoksia.

---

## 7. Tietokanta-arkkitehtuuri

### 7.1 Sijainti

```
<workspace>/memory/associations.db
```

Tai:
```
<workspace>/.openclaw/associative-memory.db
```

**Avoin kysymys:** Onko tietokanta `memory/`-hakemistossa (näkyvä käyttäjälle, git-hallittava) vai `.openclaw/`-hakemistossa (piilossa, ei gitissä)?

### 7.2 Alustus

Service `associative-memory-db`:
- Tarkistaa onko tietokanta olemassa
- Luo skeeman jos uusi
- Tarkistaa layout-manifestin yhteensopivuuden
- Migraatio tarvittaessa (skeemaversio)

---

## 8. Avoimet kysymykset

1. **Tietokannan sijainti:** `memory/` vai `.openclaw/`?
2. **Embedding-provideri:** Oma instanssi vai jaettu?
3. **session-memory-hookin käsittely:** Hyödynnetään, ignoroidaan vai disabloidaan?
4. **Plugin-jakelu:** NPM-paketti, git-submodule vai OpenClaw:n extensions-hakemisto?
5. **Testaus:** Miten testataan plugin ilman koko OpenClaw-järjestelmää?

---

## 9. Kytkökset muihin design-dokumentteihin

- **design-01–05:** Kaikki edelliset dokumentit – tämä dokumentti kuvaa miten ne toteutetaan käytännössä
- **design-07 (Migraatio):** Plugin-asennus ja datan migraatio
- **Research-04 (Hookit):** Hook-rajapinnan yksityiskohdat
- **Research-05 (Pluginit):** Plugin-lataus, rekisteröinti, SDK
