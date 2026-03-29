# Research-05: Plugin-järjestelmä

> **Tavoite:** Ymmärtää miten OpenClaw-pluginit löydetään, ladataan, rekisteröidään ja miten ne voivat laajentaa järjestelmää. Keskiössä muisti-pluginin rakentaminen.

---

## 1. Yhteenveto

OpenClaw:n plugin-järjestelmä on **monipuolinen ja kypsä**. Pluginit voivat rekisteröidä:

- **Agenttityökaluja** (tool) – agentin käyttämiä työkaluja LLM-loopin aikana
- **Hookeja** (hook) – tapahtumakäsittelijöitä elinkaaritapahtumiin (23 tyypitettyä hookia)
- **Kanavia** (channel) – viestintäkanavia (Telegram, Discord jne.)
- **Palveluita** (service) – taustaprosesseja, jotka käynnistyvät gatewayn mukana
- **CLI-komentoja** (cli) – `openclaw`-komentoriviin liittyviä komentoja
- **HTTP-käsittelijöitä** (http handler/route) – webhook-endpointteja
- **Gateway-metodeja** – RPC-tason laajennuksia
- **Providereita** – LLM-providereita (autentikaatio, mallikonfiguraatio)
- **Komentoja** (command) – käyttäjäkomentoja, jotka ohittavat agentin (esim. `/tts`)

Plugin ladataan **synkronisesti** käynnistyksessä ja sen `register()`-funktio kutsutaan heti. Async-rekisteröinti tuottaa varoituksen ja sivuutetaan.

---

## 2. Pluginin anatomia

Plugin koostuu kahdesta pakollisesta osasta:

### 2.1 Plugin-manifesti (`openclaw.plugin.json`)

```json
{
  "id": "memory-core",
  "kind": "memory",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

Pakolliset kentät:

- **`id`** – pluginin yksilöllinen tunniste (config-avain)
- **`configSchema`** – JSON Schema -muotoinen konfiguraatioskeema (pakollinen, vaikka olisi tyhjä)

Valinnaiset kentät:

- **`kind`** – eksklusiivinen slottityyppi (tällä hetkellä vain `"memory"`)
- **`name`**, **`description`**, **`version`** – metatiedot
- **`channels`**, **`providers`**, **`skills`** – ilmoitetut kanavat/providerit/skillit
- **`uiHints`** – konfiguraatiokenttien UI-vihjeet (label, help, sensitive, advanced jne.)

### 2.2 Entry point (`index.ts`)

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const myPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  kind: "memory" as const,
  configSchema: { ... },
  register(api: OpenClawPluginApi) {
    api.registerTool(...);
    api.on("after_tool_call", ...);
  }
};

export default myPlugin;
```

**Lähde:** `src/plugins/types.ts`, rivit 230–243

Plugin-moduuli voi olla joko:

1. **Objekti** (`OpenClawPluginDefinition`) – suositeltava, sisältää metatiedot + `register()`
2. **Funktio** – pelkkä `(api) => void` -funktio (legacy-tuki)

`register` ja `activate` ovat synonyymejä; molemmat tunnistetaan.

### 2.3 Package.json (npm-paketeille)

```json
{
  "name": "@openclaw/memory-core",
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

`openclaw.extensions` -kenttä kertoo, mitkä tiedostot ovat pluginin entry pointteja. Ilman tätä etsitään `index.ts`/`index.js`.

---

## 3. Löytäminen (Discovery)

**Lähde:** `src/plugins/discovery.ts`

Plugin-kandidaatit löydetään **neljästä lähteestä** prioriteettijärjestyksessä:

| Prioriteetti | Lähde       | Polku                                      | Kuvaus                        |
| :----------: | ----------- | ------------------------------------------ | ----------------------------- |
|      1       | `config`    | `plugins.load.paths[]` (konfiguraatiossa)  | Käyttäjän määrittelemät polut |
|      2       | `workspace` | `.openclaw/extensions/`                    | Workspace-kohtaiset pluginit  |
|      3       | `global`    | `~/.openclaw/extensions/`                  | Globaalit pluginit            |
|      4       | `bundled`   | `extensions/` (repojuuri tai exec-sibling) | Sisäänrakennetut pluginit     |

Discovery-prosessi:

1. Skannaa kukin hakemisto
2. Etsi `package.json` → lue `openclaw.extensions` → resolve entry pointit
3. Tai etsi `index.ts`/`index.js` alihakemistoista
4. Tarkista turvallisuus: symlinkit eivät saa karata plugin-juuresta, tiedostot eivät saa olla world-writable, omistajuus tarkistetaan

Tulos: lista `PluginCandidate`-objekteja, joissa on `idHint`, `source` (entry point), `rootDir`, `origin`.

### 3.1 Bundled-pluginien löytäminen

**Lähde:** `src/plugins/bundled-dir.ts`

Bundled-hakemisto etsitään kahdella tavalla:

1. **Käännetty binääri (bun --compile):** `path.dirname(process.execPath) + "/extensions/"`
2. **Dev/npm:** kävellään ylöspäin `import.meta.url`:sta, etsitään `extensions/`-hakemistoa

Repo-juuressa oleva `extensions/`-hakemisto (joka sisältää ~40 pluginia) on bundled-lähde.

---

## 4. Lataus ja rekisteröinti

**Lähde:** `src/plugins/loader.ts` (`loadOpenClawPlugins()`)

Lataus on **synkroninen, yksivaiheinen prosessi**:

```
discoverOpenClawPlugins()         ← löydä kandidaatit
  → loadPluginManifestRegistry()  ← lue openclaw.plugin.json jokaisesta
    → per kandidaatti:
      1. Tarkista enable/disable-tila
      2. Tarkista eksklusiivinen slotti (memory)
      3. Validoi configSchema JSON Schemaa vasten
      4. Lataa moduuli jiti:llä (TypeScript → runtime)
      5. Resolve export (default/named, objekti/funktio)
      6. Luo OpenClawPluginApi → kutsu register(api)
      7. Kirjaa PluginRecord registryyn
```

### 4.1 Jiti-lataaja

**Lähde:** `src/plugins/loader.ts`, rivit 417–439

Pluginit ladataan [jiti](https://github.com/unjs/jiti)-kirjastolla, joka tukee TypeScript-tiedostoja suoraan ilman erillistä build-vaihetta. Jiti:lle konfiguroidaan alias:

```
"openclaw/plugin-sdk" → src/plugin-sdk/index.ts (tai dist/plugin-sdk/index.js)
```

Tämä tarkoittaa, että plugin voi importata `openclaw/plugin-sdk`:ta vaikka se ei ole erillinen npm-paketti – jiti resolveaa sen OpenClaw:n sisäiseen koodiin.

### 4.2 Enable/disable-logiikka

**Lähde:** `src/plugins/config-state.ts`

```
1. plugins.enabled === false → kaikki disabloitu
2. plugins.deny.includes(id) → estetty
3. plugins.allow on asetettu ja id ei siellä → estetty
4. plugins.entries[id].enabled === true/false → eksplisiittinen
5. Bundled + BUNDLED_ENABLED_BY_DEFAULT → oletus-enabled (device-pair, phone-control, talk-voice)
6. Bundled muu → oletus-disabled
7. Muu (global/workspace/config) → oletus-enabled
```

**Testi-ympäristössä** (`VITEST=1`): pluginit ovat oletuksena disabled, memory-slotti asetetaan `"none"`.

### 4.3 Rekisteröinnin tulos: PluginRegistry

**Lähde:** `src/plugins/registry.ts`

`PluginRegistry` on kokoava tietorakenne:

```typescript
type PluginRegistry = {
  plugins: PluginRecord[]; // kaikki löydetyt pluginit (loaded/disabled/error)
  tools: PluginToolRegistration[];
  hooks: PluginHookRegistration[];
  typedHooks: TypedPluginHookRegistration[]; // api.on() -rekisteröinnit
  channels: PluginChannelRegistration[];
  providers: PluginProviderRegistration[];
  gatewayHandlers: GatewayRequestHandlers;
  httpHandlers: PluginHttpRegistration[];
  httpRoutes: PluginHttpRouteRegistration[];
  cliRegistrars: PluginCliRegistration[];
  services: PluginServiceRegistration[];
  commands: PluginCommandRegistration[];
  diagnostics: PluginDiagnostic[];
};
```

Registry talletetaan globaaliksi singletoniksi (`setActivePluginRegistry`) ja sille luodaan globaali HookRunner (`initializeGlobalHookRunner`).

---

## 5. Plugin API (`OpenClawPluginApi`)

**Lähde:** `src/plugins/types.ts`, rivit 245–284; `src/plugins/registry.ts`, rivit 472–503

Jokainen plugin saa oman `api`-objektin `register(api)`-kutsussa. API sisältää:

### 5.1 Metatiedot ja konteksti

| Kenttä             | Tyyppi                    | Kuvaus                           |
| ------------------ | ------------------------- | -------------------------------- |
| `api.id`           | `string`                  | Pluginin id (manifestista)       |
| `api.name`         | `string`                  | Pluginin nimi                    |
| `api.source`       | `string`                  | Entry pointin polku              |
| `api.config`       | `OpenClawConfig`          | Koko OpenClaw-konfiguraatio      |
| `api.pluginConfig` | `Record<string, unknown>` | Pluginin oma validoitu config    |
| `api.runtime`      | `PluginRuntime`           | Runtime-apufunktiot (ks. luku 9) |
| `api.logger`       | `PluginLogger`            | debug/info/warn/error -loggeri   |

### 5.2 Rekisteröintimetodit

| Metodi                    | Kuvaus                                              |
| ------------------------- | --------------------------------------------------- |
| `registerTool()`          | Rekisteröi agenttityökalu (tai factory)             |
| `registerHook()`          | Rekisteröi legacy-hook (internal hook -järjestelmä) |
| `on(hookName, handler)`   | Rekisteröi tyypitetty plugin-hook (23 hookia)       |
| `registerHttpHandler()`   | Rekisteröi HTTP-käsittelijä (catch-all)             |
| `registerHttpRoute()`     | Rekisteröi nimetty HTTP-reitti                      |
| `registerChannel()`       | Rekisteröi viestintäkanava                          |
| `registerProvider()`      | Rekisteröi LLM-provider                             |
| `registerGatewayMethod()` | Rekisteröi gateway RPC -metodi                      |
| `registerCli()`           | Rekisteröi CLI-komentoja                            |
| `registerService()`       | Rekisteröi taustaprosessi                           |
| `registerCommand()`       | Rekisteröi käyttäjäkomento (ohittaa agentin)        |
| `resolvePath()`           | Resolvoi polku (tilde-expansion jne.)               |

### 5.3 Kaksi hook-rekisteröintitapaa

Pluginilla on **kaksi tapaa rekisteröidä hookeja**:

1. **`api.registerHook(events, handler, opts)`** – legacy-tapa, rekisteröi `InternalHookHandler`:iin. Vaatii `name`-kentän. Tämä on sama mekanismi kuin bundled-hookeilla (YAML-pohjaisilla hookeilla).

2. **`api.on(hookName, handler, opts)`** – uusi tyypitetty tapa. Rekisteröi `PluginHookHandlerMap[K]` -tyyppisen handlerin. Tämä tallentuu `registry.typedHooks[]` -listaan ja HookRunner kutsuu näitä suoraan.

**Suositus muisti-pluginille:** Käytä `api.on()` -tapaa. Se on tyypitetty, yksinkertaisempi ja suoraan integroitu HookRunner-fasadeihin.

---

## 6. Eksklusiivinen slottijärjestelmä

**Lähde:** `src/plugins/slots.ts`, `src/plugins/config-state.ts`

### 6.1 Konsepti

Tietyille plugin-tyypeille (`kind`) on **eksklusiivinen slotti**: vain yksi plugin kyseistä tyyppiä voi olla aktiivinen kerrallaan.

Tällä hetkellä ainoa eksklusiivinen slotti on `"memory"`:

```typescript
const SLOT_BY_KIND = { memory: "memory" };
const DEFAULT_SLOT_BY_KEY = { memory: "memory-core" };
```

### 6.2 Toiminta

```
1. Konfiguraatio: plugins.slots.memory = "memory-core" (oletus)
2. Jos plugin.kind === "memory" ja plugin.id === slots.memory → enabled, selected
3. Jos plugin.kind === "memory" ja plugin.id !== slots.memory → disabled
4. Jos slots.memory === null ("none") → kaikki memory-pluginit disabled
```

### 6.3 Slotin vaihtaminen

**Lähde:** `src/plugins/slots.ts`, `applyExclusiveSlotSelection()`

Kun uusi memory-plugin valitaan, edellinen disabloidaan automaattisesti:

```typescript
applyExclusiveSlotSelection({
  config,
  selectedId: "memory-associative",
  selectedKind: "memory",
  registry,
});
// → Disabloi "memory-core", asettaa slots.memory = "memory-associative"
```

### 6.4 Merkitys assosiatiivisen muistin pluginille

Plugin rekisteröidään `kind: "memory"`:lla. Se korvaa `memory-core`:n kun käyttäjä asettaa:

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-associative"
    }
  }
}
```

Tai CLI:llä: `openclaw plugins enable memory-associative` (joka vaihtaa slotin automaattisesti).

---

## 7. Työkalujen luonti ja resoluutio

**Lähde:** `src/plugins/tools.ts`, `src/plugins/registry.ts`

### 7.1 Rekisteröinti

Plugin voi rekisteröidä työkalun kahdella tavalla:

**A) Staattinen työkalu:**

```typescript
api.registerTool(myTool, { name: "memory_recall" });
```

**B) Factory-funktio (kontekstiriippuvainen):**

```typescript
api.registerTool(
  (ctx: OpenClawPluginToolContext) => {
    // ctx sisältää: config, workspaceDir, agentDir, agentId, sessionKey, messageChannel
    return [memorySearchTool, memoryGetTool];
  },
  { names: ["memory_search", "memory_get"] },
);
```

Factory kutsutaan **jokaisella agenttiajon alussa** kun työkalut resolvoidaan.

### 7.2 Konteksti (`OpenClawPluginToolContext`)

```typescript
type OpenClawPluginToolContext = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  sandboxed?: boolean;
};
```

Tämä antaa pluginille tiedon **nykyisestä sessiosta ja agentista** – muisti-plugin voi käyttää `sessionKey`:tä assosiaatioiden kohdistamiseen.

### 7.3 Resoluutio (`resolvePluginTools`)

**Lähde:** `src/plugins/tools.ts`

Kun agenttiajo alkaa, `resolvePluginTools()` kutsuu kunkin pluginin factory-funktion:

1. Lataa/cache registry
2. Iteroi `registry.tools[]`
3. Tarkista nimikonfliktit core-työkalujen kanssa
4. Kutsu factory kontekstilla
5. Tarkista nimikonfliktit muiden plugin-työkalujen kanssa
6. Lisää `pluginToolMeta` WeakMapiin (seuranta)

**Tärkeää:** Plugin-työkalut lisätään core-työkalujen **jälkeen**. Nimikonfliktissa core voittaa ja plugin-työkalu hylätään. Tämä tarkoittaa, ettei plugin voi ylikirjoittaa olemassa olevia core-työkaluja nimen perusteella.

### 7.4 Optional-työkalut

Plugin voi merkitä työkalun `optional: true`:ksi. Tällöin työkalu aktivoidaan vain jos:

- Se on eksplisiittisesti allowlistattu (`plugins.entries[id].tools`)
- Tai `group:plugins` on allowlistattu

---

## 8. Hook-järjestelmä pluginien näkökulmasta

### 8.1 `api.on()` -rekisteröinti

```typescript
api.on("after_tool_call", (event, ctx) => {
  // event: { toolName, params, result, error, durationMs }
  // ctx: { agentId, sessionKey, toolName }
  if (event.toolName === "memory_recall") {
    trackAssociation(event);
  }
});
```

Rekisteröinti tallentuu `registry.typedHooks[]` -listaan:

```typescript
type PluginHookRegistration<K> = {
  pluginId: string;
  hookName: K;
  handler: PluginHookHandlerMap[K];
  priority?: number;
  source: string;
};
```

### 8.2 Priority

`api.on()` tukee `priority`-optiota:

```typescript
api.on("before_agent_start", handler, { priority: 10 });
```

HookRunner ajaa handlerit priority-järjestyksessä (pienempi = aikaisemmin). Oletus on `undefined` (ajetaan rekisteröintijärjestyksessä).

### 8.3 Muisti-pluginille relevantit hookit

| Hook                   | Milloin                 | Mitä saa                                        | Return                                            |
| :--------------------- | :---------------------- | :---------------------------------------------- | :------------------------------------------------ |
| `before_agent_start`   | Ennen agenttiajoa       | `prompt`, `messages[]`                          | `prependContext`, `systemPrompt`, `modelOverride` |
| `before_prompt_build`  | System prompt -rakennus | `prompt`, `messages[]`                          | `prependContext`, `systemPrompt`                  |
| `after_tool_call`      | Työkalun jälkeen        | `toolName`, `params`, `result`, `durationMs`    | void (fire-and-forget)                            |
| `before_compaction`    | Ennen tiivistystä       | `messageCount`, `messages[]`, `sessionFile`     | void (fire-and-forget)                            |
| `after_compaction`     | Tiivistyksen jälkeen    | `messageCount`, `compactedCount`, `sessionFile` | void                                              |
| `before_reset`         | Ennen /new tai /reset   | `sessionFile`, `messages[]`, `reason`           | void                                              |
| `agent_end`            | Agentin päättyminen     | `messages[]`, `success`, `durationMs`           | void                                              |
| `session_start`        | Session alku            | `sessionId`, `resumedFrom`                      | void                                              |
| `session_end`          | Session loppu           | `sessionId`, `messageCount`, `durationMs`       | void                                              |
| `before_model_resolve` | Mallin valinta          | `prompt`                                        | `modelOverride`, `providerOverride`               |

---

## 9. Plugin Runtime (`api.runtime`)

**Lähde:** `src/plugins/runtime/index.ts`, `src/plugins/runtime/types.ts`

Runtime on kokoelma **OpenClaw:n sisäisiä funktioita**, jotka tarjotaan plugineille. Muisti-pluginille relevantit osat:

### 9.1 `api.runtime.tools`

```typescript
tools: {
  createMemorySearchTool: CreateMemorySearchTool;
  createMemoryGetTool: CreateMemoryGetTool;
  registerMemoryCli: RegisterMemoryCli;
}
```

Nämä ovat factory-funktioita, joita `memory-core` käyttää. Assosiatiivinen muisti -plugin **ei käytä näitä** – se rekisteröi omat työkalunsa suoraan `api.registerTool()`:lla.

### 9.2 `api.runtime.config`

```typescript
config: {
  loadConfig: LoadConfig;
  writeConfigFile: WriteConfigFile;
}
```

Plugin voi lukea ja kirjoittaa OpenClaw-konfiguraatiota. Hyödyllinen esim. slotin vaihtamiseen asennusvaiheessa.

### 9.3 `api.runtime.state`

```typescript
state: {
  resolveStateDir: ResolveStateDir;
}
```

Palauttaa state-hakemiston polun (yleensä `~/.openclaw/state/`). Plugin voi tallentaa omia tilatiietojaan tänne.

### 9.4 `api.runtime.logging`

```typescript
logging: {
  shouldLogVerbose: ShouldLogVerbose;
  getChildLogger: (bindings?, opts?) => RuntimeLogger;
}
```

### 9.5 Muut runtime-osat

- **`api.runtime.channel.*`** – kanavatoiminnot (send, probe, monitor jne.)
- **`api.runtime.media.*`** – mediatoiminnot (mime, resize, fetch)
- **`api.runtime.system.*`** – järjestelmätoiminnot (enqueueSystemEvent, runCommandWithTimeout)

---

## 10. Plugin SDK (`openclaw/plugin-sdk`)

**Lähde:** `src/plugin-sdk/index.ts`

Plugin SDK on **re-export -paketti**, joka tarjoaa plugineille pääsyn OpenClaw:n sisäisiin tyyppeihin ja funktioihin. Pluginit importaavat:

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
```

SDK sisältää:

- **Tyypit:** `OpenClawPluginApi`, `OpenClawConfig`, `AnyAgentTool`, `PluginRuntime`, jne.
- **Kanava-apufunktiot:** `buildMentionRegexes`, `chunkTextForOutbound`, webhook-helpers
- **Turvallisuus:** `isBlockedHostname`, `fetchWithSsrFGuard`
- **Config-helpers:** `emptyPluginConfigSchema`, `buildChannelConfigSchema`
- **Työkalu-helpers:** `createActionGate`, `jsonResult`, `optionalStringEnum`, `stringEnum`

SDK:n **jiti-alias** varmistaa, että pluginit voivat importata `openclaw/plugin-sdk`:ta kehitysaikana ilman npm-asennusta. Jiti resolveaa aliaksen suoraan lähdetiedostoon.

---

## 11. Palvelut (Services)

**Lähde:** `src/plugins/services.ts`

Plugin voi rekisteröidä taustaprosesseja:

```typescript
api.registerService({
  id: "memory-consolidation",
  start: async (ctx) => {
    // ctx: { config, workspaceDir, stateDir, logger }
    startConsolidationTimer(ctx);
  },
  stop: async (ctx) => {
    stopConsolidationTimer();
  },
});
```

Palvelut käynnistetään `startPluginServices()`:lla gatewayn käynnistyksen yhteydessä ja pysäytetään käänteisessä järjestyksessä gatewayn sulkeutuessa.

**Merkitys muisti-pluginille:** Konsolidaatio-"uni" voitaisiin toteuttaa palveluna, joka ajaa ajastetun konsolidaation taustalla.

---

## 12. Asennusjärjestelmä

**Lähde:** `src/plugins/install.ts`

Pluginit voidaan asentaa usealla tavalla:

| Tapa                 | Lähde           | Kohde                            |
| -------------------- | --------------- | -------------------------------- |
| `installFromNpmSpec` | npm-rekisteri   | `~/.openclaw/extensions/<id>/`   |
| `installFromArchive` | .tar.gz/.zip    | `~/.openclaw/extensions/<id>/`   |
| `installFromDir`     | Hakemisto       | `~/.openclaw/extensions/<id>/`   |
| `installFromFile`    | Yksittäinen .ts | `~/.openclaw/extensions/<id>.ts` |
| `installFromPath`    | Auto-detect     | Valitsee oikean tavan            |

Asennusprosessi:

1. Resolveoi paketti ja lue `package.json` → `openclaw.extensions`
2. Lataa `openclaw.plugin.json` → lue kanoninen id
3. Skannaa lähdekoodi turvallisuushaavoittuvuuksien varalta (varoitus, ei estä)
4. Kopioi kohdekansioon
5. Aja `npm install --omit=dev` jos on runtime-riippuvuuksia

### 12.1 Plugin-id:n resoluutio

Asennuksessa id resolveoidaan seuraavasti:

1. **Ensisijainen:** `openclaw.plugin.json` → `id`
2. **Varasuunnitelma:** `package.json` → `name` (unscoped)

---

## 13. Konfiguraatio

### 13.1 Globaali konfiguraatio

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["memory-associative", "voice-call"],
    "deny": [],
    "load": {
      "paths": ["/custom/path/to/plugins"]
    },
    "slots": {
      "memory": "memory-core"
    },
    "entries": {
      "memory-associative": {
        "enabled": true,
        "config": {
          "consolidationInterval": "6h"
        }
      }
    }
  }
}
```

### 13.2 Plugin-kohtainen konfiguraatio

Plugin saa oman konfiguranssa `api.pluginConfig`:sta. Konfiguraatio validoidaan manifestin `configSchema`:a vasten JSON Schema -validaattorilla ennen pluginin latausta.

Esimerkki `memory-lancedb`:n configSchemasta:

```json
{
  "type": "object",
  "properties": {
    "embedding": {
      "type": "object",
      "properties": {
        "apiKey": { "type": "string" },
        "model": { "type": "string", "enum": ["text-embedding-3-small", "text-embedding-3-large"] }
      },
      "required": ["apiKey"]
    },
    "dbPath": { "type": "string" },
    "autoCapture": { "type": "boolean" },
    "autoRecall": { "type": "boolean" }
  },
  "required": ["embedding"]
}
```

---

## 14. Referenssipluginit

### 14.1 memory-core

**Lähde:** `extensions/memory-core/index.ts`

Minimaalinen memory-plugin (38 riviä). Rekisteröi kaksi factory-pohjaista työkalua ja CLI:n:

```typescript
register(api) {
  api.registerTool((ctx) => {
    const searchTool = api.runtime.tools.createMemorySearchTool({ config: ctx.config, agentSessionKey: ctx.sessionKey });
    const getTool = api.runtime.tools.createMemoryGetTool({ config: ctx.config, agentSessionKey: ctx.sessionKey });
    return [searchTool, getTool];
  }, { names: ["memory_search", "memory_get"] });

  api.registerCli(({ program }) => {
    api.runtime.tools.registerMemoryCli(program);
  }, { commands: ["memory"] });
}
```

**Huom:** memory-core ei käytä hookeja lainkaan – se on puhdas työkalu+CLI -plugin. Agentti käyttää `memory_search`:ia itse (system promptin ohjeiden mukaan).

### 14.2 memory-lancedb

**Lähde:** `extensions/memory-lancedb/index.ts`

Monimutkaisempi memory-plugin (671 riviä), joka demonstroi:

1. **Omat työkalut:** `memory_recall`, `memory_store`, `memory_forget` (ei käytä runtime-factory:ja)
2. **Lifecycle-hookit:**
   - `before_agent_start` → auto-recall: hae relevantti muistit ja injektoi `prependContext`:iin
   - `agent_end` → auto-capture: analysoi käyttäjäviestit, tallenna tärkeät muistiin
3. **CLI-komennot:** `ltm list`, `ltm search`, `ltm stats`
4. **Service:** `memory-lancedb` (alustus/sammutus)
5. **Konfiguroitavuus:** JSON Schema configilla (apiKey, model, dbPath, autoCapture, autoRecall)
6. **Turvallisuus:** prompt injection -suodatus muistoissa

**Tärkeä havainto:** `memory-lancedb` käyttää `before_agent_start`:ia injektoidakseen muistoja kontekstiin:

```typescript
api.on("before_agent_start", async (event) => {
  const results = await db.search(embed(event.prompt), 3, 0.3);
  return {
    prependContext: formatRelevantMemoriesContext(results),
  };
});
```

Tämä on **merkittävä malli** assosiatiiviselle muisti-pluginille: `before_agent_start` palauttaa `prependContext`-kentän, joka lisätään kontekstin alkuun ennen agentin käynnistystä.

---

## 15. Analyysi: assosiatiivisen muistin plugin

### 15.1 Plugin-rakenne

```
extensions/memory-associative/
├── openclaw.plugin.json       ← manifesti (id, kind: "memory", configSchema)
├── package.json               ← npm-metadata + openclaw.extensions
├── index.ts                   ← entry point, register(api)
├── tools/                     ← agenttityökalut
│   ├── memory-recall.ts       ← haku assosiatiivisesta verkosta
│   ├── memory-store.ts        ← muiston tallentaminen
│   └── memory-consolidate.ts  ← konsolidaation triggeröinti
├── hooks/                     ← lifecycle-hookien handlerit
│   ├── after-tool-call.ts     ← tick-laskenta + assosiaatioiden seuranta
│   ├── before-agent-start.ts  ← muistojen injektointi kontekstiin
│   ├── agent-end.ts           ← muistojen automaattinen tallentaminen
│   └── before-compaction.ts   ← muistojen flush ennen tiivistystä
├── consolidation/             ← "uni"-logiikka
│   ├── service.ts             ← ajastettu konsolidaatio-service
│   └── engine.ts              ← assosiaatioiden vahvistaminen, decay
├── storage/                   ← tallennuskerros
│   ├── chunks.ts              ← muistochunkien hallinta (stabiili id)
│   └── associations.ts        ← assosiaatiomatriisin tallentaminen
└── config.ts                  ← konfiguraatioskeema
```

### 15.2 Käytettävät API-pisteet

| Ominaisuus               | API-piste                                               |
| ------------------------ | ------------------------------------------------------- |
| Muistojen haku/tallennus | `api.registerTool()`                                    |
| Tick-laskenta            | `api.on("after_tool_call")`                             |
| Muistojen injektointi    | `api.on("before_agent_start")` → `prependContext`       |
| Assosiaatioiden seuranta | `api.on("after_tool_call")`                             |
| Muistojen flush          | `api.on("before_compaction")`, `api.on("before_reset")` |
| Automaattinen tallennus  | `api.on("agent_end")`                                   |
| Konsolidaatio            | `api.registerService()`                                 |
| CLI-diagnostiikka        | `api.registerCli()`                                     |
| Konfiguraatio            | `openclaw.plugin.json` configSchema                     |

### 15.3 Eksklusiivinen slotti

Plugin ilmoittaa `kind: "memory"`, jolloin se kilpailee `memory-core`:n kanssa. Kun se aktivoidaan, `memory-core` disabloituu automaattisesti.

Tärkeä seuraus: **`memory_search` ja `memory_get` -työkalut katoavat** kun memory-core disabloituu. Plugin korvaa ne omilla työkaluillaan (esim. `memory_recall`, `memory_store`, `memory_forget`).

### 15.4 Bootstrap-muistiohjeiden ongelma

Vaikka memory-core poistuu, system prompt sisältää edelleen `buildMemorySection()`:n, joka kehottaa käyttämään `memory_search`/`memory_get` -työkaluja. Nämä eivät enää ole olemassa.

**Ratkaisuvaihtoehdot (toistettu research-04:stä):**

1. **Osa A:** `buildMemorySection()` tehdään ehdolliseksi memory-slotin perusteella
2. **Plugin-workaround:** Rekisteröidään työkalu nimeltä `memory_search`, joka on wrapper assosiatiivisen haun ympärillä (väliaikainen ratkaisu)

### 15.5 `before_agent_start` vs. `before_prompt_build`

Molemmat voisivat toimia muistojen injektointiin. Ero:

- **`before_agent_start`** – kutsutaan kerran, saa `prompt` + `messages[]`, palauttaa `prependContext` + `systemPrompt` + `modelOverride`. Legacy-yhteensopiva.
- **`before_prompt_build`** – uudempi, erillinen vaihe. Saa `prompt` + `messages[]`, palauttaa `prependContext` + `systemPrompt`.

Suositus: käytä `before_prompt_build`:ia (tarkemmin eriytetty), mutta `before_agent_start` on myös kelvollinen.

### 15.6 Avoimet kysymykset

1. **Tiedostotallennus vs. tietokanta?**
   - memory-core: flat-tiedostot + embedding-haku
   - memory-lancedb: LanceDB (vektoritietokanta)
   - Assosiatiivinen muisti: flat-tiedostot (design-dokin perusteella) mutta stabiilit chunkit

2. **Miten konsolidaatio-service ajoitetaan?**
   - Ajastin (setInterval) vai cron-triggeröinti?
   - Service saa `stateDir`:n tallennusta varten

3. **Tarvitaanko `memory_search`-nimen yhteensopivuutta?**
   - Jos buildMemorySection() on hardkoodattu, plugin voisi rekisteröidä `memory_search` + `memory_get` -nimillä mutta eri toteutuksella
   - Tämä on väliaikainen ratkaisu ennen Osa A -muutosta

---

## 16. Yhteenveto Osa A -tarpeiden päivitys

Research-05:n perusteella päivitetyt Osa A -tarpeet:

| #   | Kohde                                     | Tärkeys          | Päivitys research-05:stä                                  |
| --- | ----------------------------------------- | ---------------- | --------------------------------------------------------- |
| 1   | ExtensionFactory-rekisteröinti            | Välttämätön      | Ei muutosta                                               |
| 2   | `buildMemorySection()` ehdolliseksi       | Välttämätön      | **Voidaan kiertää** rekisteröimällä memory_search-nimi    |
| 3   | `sessionFile` → after_compaction          | Välttämätön      | **Jo lisätty** – after_compaction saa nyt sessionFile:n   |
| 4   | AGENTS.md muistiosiot                     | Ratkeaa hookilla | `before_prompt_build` → `prependContext` / `systemPrompt` |
| 5   | session-memory bundled-hookin disablointi | Suositeltava     | Ei muutosta                                               |
| 6   | Pi-agent tick-laskuri                     | Pitkä aikaväli   | `after_tool_call` riittää alkuun                          |

**Tärkeä havainto #3:** Uudelleenarvioin `after_compaction` -eventin. `PluginHookAfterCompactionEvent` sisältää nykyään `sessionFile`-kentän (tyypissä on se, rivit 427–435). Aiempi havainto (research-04) saattoi perustua implementaation puutteeseen, mutta **tyyppi** sallii sen.

→ **Tarkistettu:** `sessionFile` kulkee after_compaction -hookissa **kahdesta kutsupaikasta riippuen eri tavalla**:

- **`compact.ts` (manuaalinen/schedule-compaction, rivi 692):** Lähettää `sessionFile: params.sessionFile` ✓
- **`handlers.compaction.ts` (auto-compaction subscribe-handleri, rivi 71–75):** **Ei lähetä sessionFile:a** – lähettää vain `messageCount` ja `compactedCount` ✗

Tämä on **osittainen puute**: auto-compaction (yleisin tapaus, tapahtuu agenttilooppien aikana) ei anna pluginille sessionFile:a. Manuaalinen compaction (harvinaisempi) antaa. Osa A -suositus pysyy: lisätä `sessionFile: ctx.params.session.sessionFile` myös `handleAutoCompactionEnd`:iin.
