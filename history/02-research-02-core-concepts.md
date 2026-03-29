# Raportti 02: Peruskäsitteet

> **Tutkimus tehty:** 25.2.2026
> **Tarkoitus:** Selventää OpenClaw:n ydinkäsitteet ennen agenttijärjestelmän syvempää tarkastelua.

---

## Tiivistelmä

OpenClaw:n ajonaikaisessa toiminnassa toistuvat viisi peruskäsitettä: **sessio**, **agenttikonfiguraatio**, **bootstrap-tiedostot**, **viestimalli** ja **konteksti-ikkuna**. Tämä raportti käsittelee nämä käsitteet ja niiden väliset suhteet, jotta lukija voi ymmärtää miten viesti kulkee järjestelmässä ja mitä agentti näkee kun se vastaa käyttäjälle.

---

## 1. Sessio

### 1.1 Mikä sessio on?

Sessio on **keskustelu agentin kanssa**. Konkreettisesti se on:

1. **JSONL-transkriptitiedosto** levyllä – sisältää koko keskusteluhistorian (käyttäjäviestit, agentin vastaukset, työkalukutsut ja niiden tulokset)
2. **Sessioavain** (session key) – deterministinen merkkijono, joka identifioi session
3. **SessionEntry-metadatatietue** – JSON-objekti `sessions.json`-tiedostossa, joka seuraa session tilaa

Nämä kolme muodostavat yhdessä "session":

```
Sessio = sessioavain + SessionEntry-metadatatietue + JSONL-transkripti
```

### 1.2 Sessioavain (Session Key)

Sessioavain on deterministinen merkkijono, joka muodostetaan **viestikontekstista** (kanava, käyttäjä, ryhmä, agentti).

**Muoto:** `agent:<agentId>:<rest>`

| Sessioavain                               | Selitys                                            |
| ----------------------------------------- | -------------------------------------------------- |
| `agent:main:main`                         | Oletustapauksemme: oletus-DM, kaikki kanavat       |
| `agent:main:direct:userid123`             | Per-käyttäjä DM (dmScope=per-peer)                 |
| `agent:main:telegram:direct:userid123`    | Per-käyttäjä per kanava (dmScope=per-channel-peer) |
| `agent:main:telegram:group:groupid456`    | Ryhmäkeskustelu                                    |
| `agent:main:discord:channel:channelid789` | Discord-kanava                                     |
| `agent:main:...:thread:t1`                | Ketjutettu keskustelu                              |
| `agent:main:subagent:...`                 | Aliagenttisessio                                   |
| `agent:main:cron:...`                     | Ajastettu ajo                                      |

**Muodostuslogiikka** (`src/routing/session-key.ts`):

```
buildAgentPeerSessionKey({
  agentId,      ← mikä agentti
  dmScope,      ← "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer"
  channel,      ← "telegram" | "discord" | "matrix" | ...
  peerKind,     ← "direct" | "group" | "channel"
  peerId,       ← käyttäjä- tai ryhmätunniste
  identityLinks ← cross-channel identiteettilinkitys
})
```

**dmScope-asetuksen merkitys** on kriittinen: se päättää, onko kaikilla kanavilla yksi jaettu sessio vai eriytetyt sessiot. Oletustapauksessamme (`dmScope: "main"`) kaikki DM-viestit kaikista kanavista päätyvät samaan sessioon `agent:main:main`.

**Identiteettilinkitys** (`identityLinks`): Kun `dmScope` on `per-peer` tai tarkempi, järjestelmä voi linkittää eri kanavien käyttäjätunnisteet yhteen. Esimerkki:

```json
{
  "jari": ["telegram:123456", "discord:789012", "matrix:@jari:matrix.org"]
}
```

Tällöin Jarin viestit kaikilta kanavilta ohjautuvat samaan per-peer-sessioon.

### 1.3 SessionEntry-metadatatietue

`sessions.json` on JSON-tiedosto, jossa jokaisella sessioavaimella on metadata-tietue (`SessionEntry`, `src/config/sessions/types.ts`):

```
~/.openclaw/agents/main/sessions/sessions.json
```

Rakenne (tärkeimmät kentät):

```typescript
type SessionEntry = {
  sessionId: string; // UUID – yhdistää tietueen JSONL-tiedostoon
  updatedAt: number; // Viimeinen päivitys (ms, epoch)
  sessionFile?: string; // Polku transkriptitiedostoon (jos poikkeava)

  // Seuranta
  compactionCount?: number; // Montako kertaa konteksti on tiivistetty
  inputTokens?: number; // Viimeisin input-tokenimäärä
  outputTokens?: number; // Viimeisin output-tokenimäärä
  totalTokens?: number; // Kontekstin kokonaistokenit
  model?: string; // Viimeisin käytetty malli

  // Kanava- ja reititystieto
  lastChannel?: string; // Viimeisin kanava (telegram, discord...)
  lastTo?: string; // Viimeinen vastaanottaja
  lastAccountId?: string; // Viimeinen tilintunniste
  deliveryContext?: DeliveryContext;

  // Asetukset
  thinkingLevel?: string; // "low" | "medium" | "high"
  modelOverride?: string; // Sessiokohtainen mallivaihto
  providerOverride?: string;
  sendPolicy?: string; // "allow" | "deny"
  queueMode?: string; // Viestien jonotusmoodi

  // Spawning
  spawnedBy?: string; // Emo-session key (sub-agentille)
  spawnDepth?: number; // 0 = pää, 1 = sub, 2 = sub-sub

  // Skills & system prompt
  skillsSnapshot?: SessionSkillSnapshot;
  systemPromptReport?: SessionSystemPromptReport;
};
```

**SessionEntry EI sisällä keskusteluhistoriaa** – se on puhtaasti metadataa. Historia on JSONL-tiedostossa.

### 1.4 JSONL-transkriptitiedosto

Varsinainen keskusteluhistoria tallennetaan JSONL-muodossa (yksi JSON-rivi per merkintä):

```
~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
```

Formaatti (yksinkertaistettu esimerkki):

```jsonl
{"type":"session","version":1,"id":"abc-123","timestamp":"2026-02-25T10:00:00Z","cwd":"/home/user"}
{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Hei Alice"}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Hei Bob!"}]}}
{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Mikä on huomisen sää?"}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":"tc_1","name":"web_search","input":{"query":"Helsinki sää huomenna"}}]}}
{"type":"message","message":{"role":"tool","content":[{"type":"toolResult","id":"tc_1","output":"Huomenna +5°C, pilvistä"}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Huomenna on pilvistä ja +5°C."}]}}
```

**JSONL tallentaa siis koko agenttiloopin historian**, mukaan lukien:

- **user**-viestit (käyttäjän lähettämät)
- **assistant**-viestit, jotka voivat sisältää:
  - Tekstivastauksia (`type: "text"`)
  - Työkalukutsuja (`type: "toolCall"` / `"toolUse"`)
- **tool**-viestit (työkalujen palauttamat tulokset)

Yhdellä käyttäjävuorolla JSONL:ään voi tallentua **useita rivejä**: LLM saattaa kutsua useita työkaluja peräkkäin ennen lopullista tekstivastausta. Kaikki nämä välivaiheet tallentuvat.

**Tärkeitä piirteitä:**

- **Ensimmäinen rivi** on aina session-otsikko (tyyppi, versio, id, aikaleima, työskentelyhakemisto)
- Kirjoitus tapahtuu `SessionManager`-luokan kautta (`@mariozechner/pi-coding-agent`)
- SessionManager pitää kirjaa viestien **parentId**-ketjusta (DAG-rakenne) – tätä ei tule ohittaa kirjoittamalla suoraan JSONL-rivejä
- JSONL-tiedostoa **ei koskaan ylikirjoiteta** kokonaan – uudet rivit lisätään loppuun (append-only)
- Kun konteksti kasvaa liian suureksi, **compaction** tiivistää vanhempaa historiaa yhteenvedoksi

**Kirjoituslukko:** `session-write-lock.ts` varmistaa, ettei kaksi agenttiajoa kirjoita samaan transkriptiin samanaikaisesti.

### 1.5 Session Store – koko kuva levyllä

```
~/.openclaw/
  agents/
    main/                          ← oletusagentti
      agent/                       ← agentin konfiguraatiotiedostot
      sessions/
        sessions.json              ← SessionEntry-tietueet (metadata)
        abc-123.jsonl              ← transkripti: sessio abc-123
        def-456.jsonl              ← transkripti: sessio def-456
        def-456-topic-thread1.jsonl ← ketjutettu transkripti
    second-agent/                  ← toinen agentti
      agent/
      sessions/
        sessions.json
        ...
```

### 1.6 Session reset – milloin sessio uusiutuu?

Sessio ei elä ikuisesti. Reset-mekanismi päättää, milloin aloitetaan uusi sessio:

**Reset-moodit** (`src/config/sessions/reset.ts`):

| Moodi            | Toiminta                                                         |
| ---------------- | ---------------------------------------------------------------- |
| `daily` (oletus) | Sessio vanhenee päivittäin tietyllä tunnilla (oletus klo 4:00)   |
| `idle`           | Sessio vanhenee tietyn inaktiivisen ajan jälkeen (oletus 60 min) |

**Evaluaatioketju:**

1. Viesti saapuu → `resolveSession()` kutsutaan
2. Haetaan `SessionEntry` avaimella `sessions.json`:sta
3. Lasketaan `evaluateSessionFreshness()`:
   - `daily`: `updatedAt < dailyResetAt` → vanha
   - `idle`: `now > updatedAt + idleMinutes * 60000` → vanha
4. Jos vanha → luodaan uusi `sessionId` (UUID) → uusi JSONL-tiedosto
5. Jos tuore → jatketaan samaa sessiota

**Manuaalinen reset:** `/new` tai `/reset` -komennot pakottavat uuden session.

**Per-kanava reset:** Voidaan konfiguroida eri reset-käytäntö eri kanaville (`resetByChannel`).

**Per-tyyppi reset:** DM:t, ryhmät ja ketjut voivat käyttää eri reset-sääntöjä (`resetByType`).

### 1.7 Sessioiden keskinäiset suhteet

Sessiot voivat olla hierarkkisessa suhteessa:

```
agent:main:main                             ← pääsessio
  └─ agent:main:subagent:tool-xyz           ← aliagenttisessio (spawnedBy)
  └─ agent:main:...:thread:t123             ← ketjutettu sessio (parentSessionKey)
```

- **spawnedBy**: Aliagenttisessio viittaa emosessioonsa
- **spawnDepth**: 0 = pääsessio, 1 = aliagentti, 2 = ali-aliagentti
- **Thread-sessiot**: Viestiketjut saavat oman session, jonka avain on emosession + `:thread:<id>`

---

## 2. Agenttikonfiguraatio

### 2.1 Mikä agentti on?

OpenClaw:ssa "agentti" on **konfiguroitu persoonallisuus**, joka vastaa viesteihin. Se EI ole ajonaikainen prosessi – se on joukko asetuksia, jotka kertovat miten agenttiajo tulisi suorittaa.

### 2.2 Agenttien listarakenne

Agentit konfiguroidaan `openclaw.json`-tiedostossa:

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-6",
      "workspace": "~/projects",
      "thinkingDefault": "low",
      "skipBootstrap": false,
      "maxConcurrent": 3,
      "memorySearch": { "enabled": true },
      "heartbeat": { "every": "30m" }
    },
    "list": [
      {
        "id": "main",
        "default": true,
        "name": "Alice",
        "identity": { "displayName": "Alice", "avatar": "🤖" },
        "workspace": "~/alice-workspace"
      },
      {
        "id": "coder",
        "name": "Bob",
        "model": "anthropic/claude-opus-4-6",
        "workspace": "~/code-projects"
      }
    ]
  }
}
```

`AgentConfig` (`src/config/types.agents.ts`) tärkeimmät kentät:

| Kenttä         | Selitys                                                  |
| -------------- | -------------------------------------------------------- |
| `id`           | Uniikki tunniste (käytetään sessioavaimissa)             |
| `name`         | Näkyvä nimi                                              |
| `workspace`    | Työskentelyhakemisto (missä agentti suorittaa komentoja) |
| `model`        | LLM-malli (voi olla ensisijainen + varamalleja)          |
| `identity`     | Nimi, avatar, kuvaus – näytetään käyttäjälle             |
| `skills`       | Sallitut taidot (tyhjä = kaikki)                         |
| `memorySearch` | Muistihaun konfiguraatio                                 |
| `tools`        | Työkalujen konfiguraatio                                 |
| `sandbox`      | Hiekkalaatikkoasetukset                                  |
| `groupChat`    | Ryhmäkeskusteluasetukset                                 |

### 2.3 Defaults vs. per-agent

`agents.defaults` sisältää oletusasetukset kaikille agenteille. Per-agent-konfiguraatio `agents.list[*]` ylikirjoittaa oletukset.

### 2.4 Workspace ja bootstrap-tiedostot

Jokaisella agentilla on **workspace-hakemisto** (konfiguroitu `agents.list[*].workspace` tai `agents.defaults.workspace`). Bootstrap-tiedostot ladataan **workspacesta**, ei agent-hakemistosta:

```
~/alice-workspace/               ← agentin "main" workspace
  AGENTS.md                      ← persoonallisuus ja ohjeet
  SOUL.md                        ← syvempi identiteetti
  TOOLS.md                       ← työkaluohjeet
  IDENTITY.md                    ← identiteettitiedot
  USER.md                        ← käyttäjätiedot
  HEARTBEAT.md                   ← heartbeat-ohjeet
  BOOTSTRAP.md                   ← yleiset bootstrap-ohjeet
  MEMORY.md                      ← agentin muisti (ladataan myös)
```

Kaikki nämä ladataan `loadWorkspaceBootstrapFiles()`:lla ja injektoidaan system promptiin **jokaisessa agenttiajossa**. Puuttuvat tiedostot ohitetaan hiljaisesti.

**Poikkeus:** Aliagentti- ja cron-sessiot saavat vain suppean joukon (AGENTS.md, TOOLS.md, SOUL.md, IDENTITY.md, USER.md).

Lisäksi agentilla on **agent-hakemisto**:

```
~/.openclaw/agents/main/
  agent/                  ← Pi-agentin sisäinen konfiguraatio
  sessions/               ← Sessiotiedostot (ks. luku 1)
```

`AGENTS.md` on pääasiallinen tapa antaa agentille persoonallisuutta, ohjeita ja kontekstia. Se on käytännössä "system prompt -liite" joka liitetään jokaiseen LLM-kutsuun.

### 2.5 Binding – agentin ja kanavan sidonta

`AgentBinding` (`src/config/types.agents.ts`) sitoo tietyn kanavan/käyttäjän/ryhmän tiettyyn agenttiin:

```json
{
  "agentId": "coder",
  "match": {
    "channel": "discord",
    "guildId": "123456789"
  }
}
```

Ilman bindingeja kaikki viestit ohjautuvat oletusagentille (= `main`). Raportti 01 kuvasi tämän prioriteettijärjestyksen.

---

## 3. Bootstrap-tiedostot

### 3.1 Miksi bootstrap-tiedostoja on useita?

Workspace-hakemisto sisältää joukon Markdown-tiedostoja, joista kukin palvelee **eri tarkoitusta**. Jako erillisiin tiedostoihin on tarkoituksellista:

1. **Eri elinkaaret**: Jotkut tiedostot (BOOTSTRAP.md) elävät vain hetken, toiset (SOUL.md) ovat pysyviä.
2. **Eri päivittäjät**: Joitakin päivittää agentti itse (IDENTITY.md, MEMORY.md), joitakin käyttäjä (TOOLS.md), joitakin molemmat (AGENTS.md).
3. **Eri tietoturvataso**: MEMORY.md sisältää henkilökohtaista dataa ja ladataan vain pääsessiossa. TOOLS.md sisältää infratietoja, jotka eivät kuulu jaettuihin skilleihin.
4. **Suodatus sessiotyypeittäin**: Aliagentti- ja cron-sessiot saavat vain osan tiedostoista (ks. 3.10).

### 3.2 AGENTS.md – Workspace-ohjeet

**Tarkoitus:** Agentin pääasiallinen toimintaohje joka sessiossa. Tämä on "käsikirja", jota agentti seuraa.

**Sisältö (oletusmallista):**

- Session alussa luettavat tiedostot (SOUL.md, USER.md, muistitiedostot)
- Muistikonventiot: päiväkohtaiset logit (`memory/YYYY-MM-DD.md`), pitkäkestoinen muisti (`MEMORY.md`)
- Turvallisuussäännöt (ei eksfiltrioi dataa, `trash` > `rm`, kysy ennen ulkoisia toimintoja)
- Ryhmäkeskustelukäyttäytyminen (milloin puhua, milloin olla hiljaa)
- Heartbeat-ohjeet (mitä tarkistaa, milloin ilmoittaa käyttäjälle)
- Muistin ylläpito (päivittäisten lokien tiivistys MEMORY.md:hen)

**Päivittyy:** Käyttäjä tai agentti voi muokata milloin tahansa. Oletus luodaan templatesta workspacen alustuksessa.

**Erityispiirteet:**

- Sisältyy `MINIMAL_BOOTSTRAP_ALLOWLIST`-joukkoon → ladataan myös aliagentille
- Käytännössä agentin "system prompt -liite"

### 3.3 SOUL.md – Persoonallisuus

**Tarkoitus:** Määrittelee agentin persoonallisuuden ja käyttäytymistyylin – "kuka olet".

**Sisältö (oletusmallista):**

- Core truths: ole aidosti avulias (ei performatiivisesti), muodosta mielipiteitä, etsi vastaus ennen kysymistä
- Rajat: yksityiset asiat pysyvät yksityisinä, kysy ennen ulkoisia toimintoja
- Vibe: "Be the assistant you'd actually want to talk to"
- Jatkuvuus: "Each session, you wake up fresh. These files _are_ your memory."

**Päivittyy:** Agentti voi muokata, mutta mallin mukaan "If you change this file, tell the user — it's your soul". Käyttäjä voi myös muokata suoraan.

**Erityispiirteet:**

- System prompt -rakentaja tunnistaa SOUL.md:n erikseen: "If SOUL.md is present, embody its persona and tone"
- Sisältyy MINIMAL_BOOTSTRAP_ALLOWLIST-joukkoon

### 3.4 IDENTITY.md – Identiteettitiedot

**Tarkoitus:** Strukturoitu metadatatietue agentin identiteetistä.

**Sisältö:**

- Nimi (agentti valitsee onboardingissa)
- Creature/olento (AI, robotti, henki koneessa...)
- Vibe (terävä, lämmin, kaoottinen, rauhallinen...)
- Emoji (allekirjoitusemoji)
- Avatar (polku tai URL)

**Päivittyy:** Agentti täyttää **onboarding-keskustelussa** (BOOTSTRAP.md:n ohjeen mukaan). Käyttäjä voi muokata myöhemmin.

**Erityispiirteet:**

- Onboarding-tilan seuranta: jos IDENTITY.md:n sisältö eroaa templatesta, workspace katsotaan "onboardatuksi" (legacy-migraatio `ensureAgentWorkspace`:ssa)
- Sisältyy MINIMAL_BOOTSTRAP_ALLOWLIST-joukkoon

### 3.5 USER.md – Käyttäjäprofiili

**Tarkoitus:** Tietoa käyttäjästä, jonka kanssa agentti työskentelee.

**Sisältö:**

- Nimi, puhuttelumuoto, pronominit
- Aikavyöhyke
- Kontekstia: mitä käyttäjä välittää, mitä projekteja hän tekee, mikä ärsyttää, mikä naurattaa

**Päivittyy:** Agentti täyttää onboarding-keskustelussa ja päivittää ajan myötä oppiessaan käyttäjästä lisää.

**Erityispiirteet:**

- Samoin kuin IDENTITY.md, käytetään onboarding-tilan evaluoinnissa
- Sisältyy MINIMAL_BOOTSTRAP_ALLOWLIST-joukkoon

### 3.6 TOOLS.md – Ympäristökohtaiset muistiinpanot

**Tarkoitus:** Käyttäjän laitteistokohtainen tieto, jota skillit eivät tiedä.

**Sisältö (esimerkkejä):**

- Kameroiden nimet ja sijainnit
- SSH-hostit ja aliakset
- TTS-ääniasetukset
- Kaiuttimet, huonenimet
- Laitteiden lempinimet

**Päivittyy:** Käyttäjä tai agentti lisää tietoa sitä mukaa kun uusia laitteita/palveluja konfiguroitaan.

**Erityispiirteet:**

- System prompt huomauttaa eksplisiittisesti: "TOOLS.md does not control tool availability; it is user guidance for how to use external tools." Toisin sanoen TOOLS.md EI määrittele mitä työkaluja agentti voi käyttää – se on muistilista ympäristökohtaisista yksityiskohdista.
- Sisältyy MINIMAL_BOOTSTRAP_ALLOWLIST-joukkoon

### 3.7 HEARTBEAT.md – Heartbeat-tehtävälista

**Tarkoitus:** Agentin säännöllisesti tarkistettavien asioiden lista.

**Sisältö (oletusmalli):**

- Tyhjä (vain kommentti). Tyhjänä heartbeat-pollaukset ohitetaan.
- Agentti lisää tehtäviä tarpeen mukaan (esim. "tarkista sähköpostit", "katso kalenteri")

**Päivittyy:** Agentti muokkaa heartbeat-tehtäviä dynaamisesti. Käyttäjä voi myös muokata.

**Erityispiirteet:**

- **Ei sisälly** MINIMAL_BOOTSTRAP_ALLOWLIST-joukkoon → aliagenttisessiot eivät saa tätä
- Heartbeat-mekanismi lukee tämän tiedoston säännöllisesti (konfiguroitu `agents.defaults.heartbeat.every`)

### 3.8 BOOTSTRAP.md – Ensimmäisen ajon onboarding

**Tarkoitus:** "Syntymätodistus" – ohjaa agentin ensimmäistä keskustelua.

**Sisältö:**

- Ohjeet ensimmäiseen keskusteluun: "Hey. I just came online. Who am I? Who are you?"
- Tehtävät: selvitä nimi, olemus, vibe, emoji käyttäjän kanssa
- Päivitä IDENTITY.md ja USER.md oppimillasi tiedoilla
- Avaa SOUL.md yhdessä ja keskustele käyttäytymisestä
- Kanavien kytkentäehdotukset (WhatsApp, Telegram)
- **Lopussa: poista tämä tiedosto**

**Elinkaari:**

1. `ensureAgentWorkspace()` luo BOOTSTRAP.md:n templatesta **vain** jos workspace on uusi (mikään muu bootstrap-tiedosto ei ole vielä muokattu)
2. Agentti lukee BOOTSTRAP.md:n ensimmäisessä sessiossa
3. Onboarding-keskustelu: agentti selvittää identiteettinsä, täyttää IDENTITY.md ja USER.md
4. Agentti poistaa BOOTSTRAP.md:n
5. Järjestelmä seuraa tilaa `workspace-state.json`:ssa: `bootstrapSeededAt`, `onboardingCompletedAt`

**Erityispiirteet:**

- **Ei sisälly** MINIMAL_BOOTSTRAP_ALLOWLIST-joukkoon
- Tiedoston läsnäolo laukaisee workspaceNotes-lisäyksen system promptiin: "Reminder: commit your changes in this workspace after edits."
- Legacy-migraatio: jos IDENTITY.md tai USER.md on jo muokattu (eroaa templatesta), BOOTSTRAP.md:tä ei luoda (workspace katsotaan jo onboardatuksi)

### 3.9 MEMORY.md – Pitkäkestoinen muisti

**Tarkoitus:** Agentin kuratoitu pitkäkestoinen muisti.

**Sisältö:** Ei templateta – agentti luo ja ylläpitää tämän itse orgaanisesti.

**Päivittyy:** Agentti kirjoittaa merkittäviä tapahtumia, päätöksiä, opittuja asioita. AGENTS.md kehottaa: "Over time, review your daily files and update MEMORY.md with what's worth keeping."

**Erityispiirteet:**

- **Ei sisälly** MINIMAL_BOOTSTRAP_ALLOWLIST-joukkoon → turvallisuussyistä, MEMORY.md sisältää henkilökohtaista dataa
- AGENTS.md ohjeistaa: "ONLY load in main session. DO NOT load in shared contexts (Discord, group chats, sessions with other people)"
- Tukee myös vaihtoehtoista nimeä `memory.md` (case-insensitive fallback)
- `resolveMemoryBootstrapEntries()` deduplikoi: jos sekä MEMORY.md että memory.md ovat olemassa ja viittaavat samaan tiedostoon, ladataan vain kerran
- System prompt sisältää erillisen "Memory Recall" -osion, joka kehottaa agenttia hakemaan muistia `memory_search`-työkalulla ennen vastausta

### 3.10 Bootstrap-tiedostojen suodatus sessiotyypeittäin

Kaikki 8 tiedostoa ladataan pääsessioissa (main, direct, group). Aliagentti- ja cron-sessiot saavat **supistetun joukon**:

| Tiedosto     | Pääsessio | Aliagentti/Cron |
| ------------ | --------- | --------------- |
| AGENTS.md    | ✅        | ✅              |
| SOUL.md      | ✅        | ✅              |
| TOOLS.md     | ✅        | ✅              |
| IDENTITY.md  | ✅        | ✅              |
| USER.md      | ✅        | ✅              |
| HEARTBEAT.md | ✅        | ❌              |
| BOOTSTRAP.md | ✅        | ❌              |
| MEMORY.md    | ✅        | ❌              |

`MINIMAL_BOOTSTRAP_ALLOWLIST` (`src/agents/workspace.ts`) määrittää tämän: `{AGENTS.md, TOOLS.md, SOUL.md, IDENTITY.md, USER.md}`.

Logiikka: `filterBootstrapFilesForSession()` tarkistaa sessioavaimesta, onko kyse aliagentista (`isSubagentSessionKey`) tai cron-ajosta (`isCronSessionKey`), ja suodattaa tiedostot vastaavasti.

### 3.11 Injektio kontekstiin

Bootstrap-tiedostojen matka workspacesta LLM:n konteksti-ikkunaan:

```
1. loadWorkspaceBootstrapFiles(workspaceDir)
   → Lukee kaikki 8 tiedostoa levyltä (puuttuvat merkitään missing: true)

2. filterBootstrapFilesForSession(files, sessionKey)
   → Suodattaa pois aliagenteilta/cronilta HEARTBEAT, BOOTSTRAP, MEMORY

3. applyBootstrapHookOverrides(files, ...)
   → Hookit voivat muokata tiedostojen sisältöä ennen injektiota
   → Esim. plugin voi vaihtaa SOUL.md:n sisällön dynaamisesti

4. buildBootstrapContextFiles(files, { maxChars, totalMaxChars })
   → Rajoittaa per-tiedosto max 20 000 merkkiä (oletus)
   → Rajoittaa kokonaisbudjetin max 150 000 merkkiä
   → Katkaisee head/tail -strategialla (70% alusta, 20% lopusta)

5. System prompt -rakentaja:
   → "# Project Context" -osion alle jokainen tiedosto:
      ## ~/alice-workspace/AGENTS.md
      <tiedoston sisältö>

      ## ~/alice-workspace/SOUL.md
      <tiedoston sisältö>
      ...
```

**Token-budjetointi:** Per-tiedosto max `bootstrapMaxChars` (oletus 20K merkkiä) ja kokonaisbudjetti `bootstrapTotalMaxChars` (oletus 150K merkkiä). Jos tiedosto ylittää rajan, se katkaistaan: 70% alusta + leikkausmarkkeri + 20% lopusta. Nämä rajat ovat konfiguroitavissa `agents.defaults.bootstrapMaxChars` ja `agents.defaults.bootstrapTotalMaxChars` -asetuksilla.

### 3.12 Yhteenvetotaulukko

| Tiedosto     | Tarkoitus                    | Luoja            | Päivittäjä        | Template | Aliagentti |
| ------------ | ---------------------------- | ---------------- | ----------------- | -------- | ---------- |
| AGENTS.md    | Workspace-ohjeet             | Järjestelmä      | Käyttäjä/Agentti  | Kyllä    | ✅         |
| SOUL.md      | Persoonallisuus              | Järjestelmä      | Agentti/Käyttäjä  | Kyllä    | ✅         |
| IDENTITY.md  | Identiteettimetadata         | Järjestelmä      | Agentti           | Kyllä    | ✅         |
| USER.md      | Käyttäjäprofiili             | Järjestelmä      | Agentti           | Kyllä    | ✅         |
| TOOLS.md     | Ympäristömuistiinpanot       | Järjestelmä      | Käyttäjä/Agentti  | Kyllä    | ✅         |
| HEARTBEAT.md | Heartbeat-tehtävät           | Järjestelmä      | Agentti           | Kyllä    | ❌         |
| BOOTSTRAP.md | Onboarding (kertakäyttöinen) | Järjestelmä (\*) | Agentti (poistaa) | Kyllä    | ❌         |
| MEMORY.md    | Pitkäkestoinen muisti        | Agentti          | Agentti           | Ei       | ❌         |

(\*) BOOTSTRAP.md luodaan vain jos workspace on uusi eikä onboardingia ole tehty.

---

## 4. Viestimalli (Message & MsgContext)

### 3.1 Agenttiviestit (AgentMessage)

LLM:n käsittelemät viestit noudattavat standardia chat-rakennetta:

```typescript
type AgentMessage = {
  role: "user" | "assistant" | "tool";
  content: string | ContentBlock[];
};
```

**Kolme roolia:**

| Rooli       | Sisältö                             | Kuka tuottaa       |
| ----------- | ----------------------------------- | ------------------ |
| `user`      | Käyttäjän viesti (teksti, kuvat)    | Käyttäjä kanavalta |
| `assistant` | Agentin vastaus TAI työkalukutsu(t) | LLM                |
| `tool`      | Työkalun palauttama tulos           | Työkalun suoritus  |

**Tärkeä nyansi:** `assistant`-viesti voi sisältää **sekä tekstiä että työkalukutsuja**. Yhdellä käyttäjävuorolla voi syntyä pitkä ketju:

```
user: "Mikä sää on?"
assistant: [toolCall: web_search("sää Helsinki")]     ← LLM päättää käyttää työkalua
tool: [toolResult: "Huomenna +5°C, pilvistä"]         ← työkalu palauttaa tuloksen
assistant: "Huomenna on pilvistä ja +5°C."             ← LLM vastaa käyttäjälle
```

Jokainen näistä on erillinen `AgentMessage`, joka **lisätään (append) JSONL-transkriptin loppuun** sitä mukaa kun loop etenee. JSONL:ää ei kirjoiteta uusiksi – SessionManager lisää aina uusia rivejä loppuun.

Nämä viestit lähetetään myös LLM:lle konteksti-ikkunassa: seuraavalla LLM-kutsulla malli näkee koko ketjun (historia + tool call + tool result) ja voi jatkaa siitä.

### 3.2 MsgContext – viestin reititysmetadata

`MsgContext` (`src/auto-reply/templating.ts`) on rikkaampi rakenne, joka kantaa mukanaan kaiken kontekstin yhdestä saapuvasta viestistä:

```typescript
type MsgContext = {
  Body?: string; // Viestin teksti
  BodyForAgent?: string; // Muotoiltu versio agentille
  From?: string; // Lähettäjän tunniste
  To?: string; // Vastaanottaja
  SessionKey?: string; // Resolved sessioavain
  AccountId?: string; // Kanavatilin tunniste

  // Reititys
  OriginatingChannel?: string; // Mistä kanavasta viesti tuli
  OriginatingTo?: string; // Mihin vastaus pitää reitittää
  ChatType?: string; // "direct" | "group" | "channel"
  MessageThreadId?: string; // Ketjutunniste

  // Lähettäjän tiedot
  SenderName?: string;
  SenderId?: string;
  SenderUsername?: string;
  SenderE164?: string; // Puhelinnumero (E.164-muoto)
  SenderIsOwner?: boolean; // Onko botin omistaja

  // Ryhmäkonteksti
  GroupSubject?: string;
  GroupChannel?: string;
  GroupMembers?: string;
  InboundHistory?: Array<{ sender: string; body: string; timestamp?: number }>;

  // Media
  MediaUrls?: string[];
  MediaTypes?: string[];
  MediaPaths?: string[];

  // Hook-data
  HookMessages?: string[];

  // ... ja ~40 muuta kenttää
};
```

**MsgContext vs. AgentMessage:**

|               | MsgContext                                       | AgentMessage                        |
| ------------- | ------------------------------------------------ | ----------------------------------- |
| **Elinkaari** | Yksi saapuva viesti                              | Koko keskusteluhistoria             |
| **Sisältö**   | Reititystieto + metadata + body                  | role + content (teksti/tool/result) |
| **Käyttö**    | Kanavakäsittelijä → reititys → promptin muotoilu | LLM API -kutsu + looppi             |
| **Tallennus** | Ei tallenneta sellaisenaan                       | Tallennetaan JSONL:ään (append)     |

**MsgContextin rooli virrassa:**

```
Kanava (Telegram/Discord/...)
  → MsgContext luodaan (Body, From, OriginatingChannel, ...)
  → Reititys: sessioavain + agentId resolved
  → Promptin muotoilu: MsgContext.BodyForAgent → AgentMessage (user)
  → Agentic loop:
      → LLM-kutsu → assistant-viesti (teksti tai tool call)
      → Jos tool call: työkalu suoritetaan → tool-viesti (tulos)
      → Takaisin LLM:lle → ... (toistuu kunnes teksti-vastaus)
      → Kaikki viestit (user, assistant, tool) tallennetaan JSONL:ään
  → Lopullinen teksti-vastaus reititetään OriginatingChannel kautta käyttäjälle
```

**Huom.:** Agentti voi myös lähettää **useita viestejä käyttäjälle** yhden loopin aikana `message`-työkalulla – esim. ensin kuittausviestin ja sitten varsinaisen vastauksen. Nämä kaikki reititetään samalle kanavalle, mutta ne ovat erillisiä toimituksia.

### 3.3 Vastauksen reititys

Vaikka sessio on jaettu (dmScope=main), vastaus menee aina **sille kanavalle, jolta viesti tuli**:

1. Kanava asettaa `MsgContext.OriginatingChannel` ja `MsgContext.OriginatingTo`
2. Agenttiajo tuottaa vastauksen
3. `dispatchReplyFromConfig()` lukee nämä kentät ja reitittää vastauksen oikeaan kanavaan

```
Bob (Telegram): "Mikä on sää?"
  → OriginatingChannel: "telegram", OriginatingTo: "123456"
  → Alice vastaa → vastaus lähetetään Telegram-botille → Bob saa sen Telegramissa

Bob (Discord): "Entä huomenna?"      ← SAMA sessio
  → OriginatingChannel: "discord", OriginatingTo: "789012"
  → Alice vastaa → vastaus lähetetään Discord-botille → Bob saa sen Discordissa
```

---

## 5. Konteksti-ikkuna

### 5.1 Mikä konteksti-ikkuna on?

Konteksti-ikkuna on se **kokonaiskuva, jonka LLM näkee** kun se vastaa viestiin. Se rakennetaan jokaisella agenttiajolla seuraavista osista:

```
┌──────────────────────────────────────────────┐
│ 1. System prompt                              │
│    ├─ Agentin identiteetti ja käyttäytymisohjeet │
│    ├─ Bootstrap-tiedostot (AGENTS.md, ...)   │
│    ├─ Skills-kehotteet                        │
│    ├─ Työkalujen kuvaukset                    │
│    ├─ Runtime-info (aika, kanava, kone)       │
│    └─ Extra-konteksti (hookeista, plugineista) │
│                                              │
│ 2. Sessiohistoria (JSONL:stä)                │
│    ├─ [Compaction summary] (jos tiivistetty) │
│    ├─ user: "Hei Alice"                      │
│    ├─ assistant: "Hei Bob!"                  │
│    ├─ user: "Mikä on sää?"                   │
│    ├─ assistant: [tool_call: web_search]     │
│    ├─ tool: [result: "+5°C, pilvistä"]       │
│    ├─ assistant: "Huomenna pilvistä..."      │
│    └─ ...                                    │
│                                              │
│ 3. Uusi käyttäjäviesti                       │
│    └─ user: "Kiitos! Laita muistutus."       │
│                                              │
│ 4. Työkalumäärittelyt (tool schemas)         │
│    ├─ exec (bash-komennot)                   │
│    ├─ sessions_send (viesti toiselle agentille) │
│    ├─ memory_search (muistihaku)             │
│    └─ ... (~20+ työkalua)                    │
└──────────────────────────────────────────────┘
```

### 5.2 Kontekstin koko ja rajat

- Mallin konteksti-ikkuna on tyypillisesti **200K–1M tokenia** (mallista riippuen)
- `resolveContextTokensForModel()` (`src/agents/context.ts`) selvittää mallin kontekstirajan
- Kontekstin koko kasvaa jokaisella viestillä, koska JSONL-historia pitenee

### 5.3 Compaction – kontekstin tiivistys

Kun sessiohistoria kasvaa liian suureksi, **compaction** tiivistää vanhemmat viestit yhteenvedoksi (`src/agents/compaction.ts`):

```
ENNEN compactiota:
  [system prompt]
  user: "Auta projektin kanssa"
  assistant: "Toki! Mitä tehdään?"
  user: "Tee todo-lista"
  assistant: "1. Suunnittele... 2. Koodaa..."
  user: "Aloita koodaus"
  assistant: [tool_call: exec("mkdir src && ...")]
  tool: [result: "Created directory src"]
  assistant: [tool_call: exec("cat > src/index.ts << ...")]
  tool: [result: "File written"]
  assistant: "Loin projektin rakenteen ja..."
  ... (200+ viestiä, sisältäen tool_call/tool_result -pareja)
  user: "Onko valmis?"

JÄLKEEN compactiota:
  [system prompt]
  [SUMMARY: "Bob pyysi apua projektissa. Tehtiin todo-lista ja aloitettiin
   koodaus. Tärkeimmät päätökset: käytetään TypeScriptiä, tietokantana SQLite.
   Avoimet kysymykset: testien kirjoitus."]
  user: "Tarkista testit"
  assistant: "Testit menevät läpi..."
  user: "Onko valmis?"
```

**Compaction-mekanismin piirteet:**

- **Adaptiivinen chunking**: Viestit jaetaan palasiin tokeni-budjetin mukaan
- **Chunked summarization**: Kukin palanen tiivistetään erikseen, sitten yhdistetään
- **Safety margin**: 20% puskuri token-estimoinnin epätarkkuuden varalta
- **Oversized message handling**: Ylisuuria viestejä (>50% kontekstista) ei yritetä tiivistää
- **CompactionCount**: SessionEntry seuraa montako kertaa compaction on ajettu

### 5.4 Memory flush

Compaction-vaiheessa voidaan myös "flushata" kontekstia muistiin (`memory.flush`):

- Soft threshold: kun tokenit ylittävät rajan, agenttia kehotetaan kirjoittamaan tärkeät asiat muistiin
- Tämä on nykyisen muistijärjestelmän osa – liittyy suoraan tulevaan assosiatiivisen muistin suunnitteluun

### 5.5 Context pruning

Kontekstin karsinta (`contextPruning`) on erillinen mekanismi compactionista:

- **cache-ttl**: Käyttää Anthropicin prompt caching -TTL:ää päättämään mitkä viestit poistetaan
- **off**: Ei karsintaa (oletus)

---

## 6. Käsitteiden väliset suhteet – kokonaiskuva

```
openclaw.json
  │
  ├─ agents.list[0]        ← AgentConfig (id: "main")
  │    │
  │    ├─ binding rules     ← Kuka ohjataan tähän agenttiin?
  │    │
  │    └─ sessions/
  │         │
  │         ├─ sessions.json  ← SessionEntry per sessioavain
  │         │   {
  │         │     "agent:main:main": {
  │         │       "sessionId": "abc-123",
  │         │       "updatedAt": 1740000000000,
  │         │       "lastChannel": "telegram",
  │         │       "totalTokens": 45000
  │         │     }
  │         │   }
  │         │
  │         └─ abc-123.jsonl  ← JSONL-transkripti
  │              {"type":"session","version":1,"id":"abc-123",...}
  │              {"type":"message","message":{"role":"user",...}}
  │              {"type":"message","message":{"role":"assistant",...}}  ← teksti tai tool call
  │              {"type":"message","message":{"role":"tool",...}}       ← tool result
  │              {"type":"message","message":{"role":"assistant",...}}  ← lopullinen vastaus
  │
  └─ session.dmScope: "main"  ← Kaikki DM:t → agent:main:main

Viesti saapuu:
  Telegram → MsgContext{From, Body, OriginatingChannel}
    → resolveAgentRoute() → agentId: "main"
    → buildAgentPeerSessionKey() → "agent:main:main"
    → resolveSession() → sessionId: "abc-123" (tuore!)
    → SessionManager.open("abc-123.jsonl")
    → [system prompt + historia + uusi viesti]  ← konteksti-ikkuna
    → Agentic loop:
        LLM-kutsu → assistant (tool call tai teksti)
        Jos tool call → suoritus → tool result → uusi LLM-kutsu → ...
        Kaikki vuorot tallentuvat JSONL:ään (append)
    → Lopullinen teksti-vastaus reititetään OriginatingChannel → Telegram
```

---

## 7. Yhteenveto

| Käsite                  | Mikä se on                                   | Missä se elää                                                |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| **Sessio**              | Nimetty keskustelu agentin kanssa            | Avain + metadata (sessions.json) + transkripti (.jsonl)      |
| **Sessioavain**         | Deterministinen tunniste sessiosta           | Rakennetaan dynaamisesti viestikontekstista                  |
| **SessionEntry**        | Session metadata (tokenit, malli, kanava...) | `sessions.json`                                              |
| **JSONL-transkripti**   | Keskusteluhistoria rivi per viesti           | `<sessionId>.jsonl`                                          |
| **AgentConfig**         | Agentin identiteetti ja asetukset            | `openclaw.json` + `agents/<id>/agent/`                       |
| **Bootstrap-tiedostot** | Workspacen Markdown-tiedostot (8 kpl)        | Workspace-hakemisto, injektoidaan system promptiin           |
| **MsgContext**          | Yksittäisen viestin reititysmetadata         | Ajonaikainen rakenne, ei tallenneta                          |
| **Konteksti-ikkuna**    | Kaikki mitä LLM näkee                        | Rakennetaan ajonaikaisesti system prompt + historia + viesti |
| **Compaction**          | Historian tiivistys yhteenvedoksi            | Tapahtuu kun konteksti lähestyy rajaa                        |

Seuraavassa raportissa (03) tarkastellaan **miten agenttiajo oikeasti toimii** – eli mikä on se silmukka, joka lukee session, kutsuu LLM:ää, suorittaa työkaluja ja kirjoittaa tulokset takaisin.
