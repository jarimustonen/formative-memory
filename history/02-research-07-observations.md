# Research-07: Havainnot, avoimet kysymykset ja Osa A -muutokset

> Jatkuva dokumentti. Kerätään matkan varrella asioita, jotka vaikuttavat pluginin suunnitteluun tai vaativat huomiota toteutusvaiheessa. Ruokkii design-sarjaa.

---

## AGENTS.md:n hardkoodatut muistiohjeet

**Lähde:** `docs/reference/templates/AGENTS.md` (oletus-template)
**Havaittu:** research-02, luku 3

AGENTS.md-oletus-template sisältää yksityiskohtaisia ohjeita muistin käsittelystä:

- "Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context"
- "If in MAIN SESSION: Also read `MEMORY.md`"
- "Daily notes: `memory/YYYY-MM-DD.md` — raw logs"
- "Long-term: `MEMORY.md` — curated memories"
- "ONLY load MEMORY.md in main session"
- Heartbeat-ohjeet sisältävät muistin ylläpidon ("Memory Maintenance During Heartbeats")

**Ongelma:** Jos assosiatiivinen muisti -plugin korvaa tai laajentaa muistijärjestelmää, nämä ohjeet ovat **harhaanjohtavia tai ristiriitaisia**. Agentti noudattaa AGENTS.md:n ohjeita, jotka ohjaavat käyttämään vanhaa muistimallia.

**Mahdollisia ratkaisuja:**

1. **Plugin muokkaa AGENTS.md:tä asennusvaiheessa** – korvaa muistiosiot uusilla ohjeilla
2. **Hook-pohjainen ylikirjoitus** – bootstrap-hook muokkaa AGENTS.md:n sisältöä lennossa ennen injektiota
3. **AGENTS.md template -variantit** – eri muistilayout = eri template (vrt. design-dokin "memory layout" -konsepti)
4. **Muistiohjeiden siirto erilliseen tiedostoon** – AGENTS.md viittaa muistitiedostoon, jonka plugin voi korvata

**Huom:** Tämä ei koske vain AGENTS.md:tä – myös system prompt sisältää "Memory Recall" -osion (`src/agents/system-prompt.ts`, `buildMemorySection()`), joka kehottaa käyttämään `memory_search`/`memory_get` -työkaluja. Plugin saattaa tarvita myös tähän puuttumista.

---

## System promptin Memory Recall -osio

**Lähde:** `src/agents/system-prompt.ts`, rivi 37–63
**Havaittu:** research-02, luku 3

System prompt sisältää hardkoodatun osion:

```
## Memory Recall
Before answering anything about prior work, decisions, dates, people, preferences,
or todos: run memory_search on MEMORY.md + memory/*.md; then use memory_get to
pull only the needed lines.
```

Tämä on koodissa, ei bootstrap-tiedostossa – plugin ei voi muokata sitä hookilla. Vaatii joko:

- Koodimuutoksen OpenClaw:iin (osio ehdolliseksi plugin-konfiguraation perusteella)
- Tai pluginin omien työkalujen priorisoimista memory_search/memory_get:n yli

---

## Bootstrap-tiedostojen hook-mahdollisuus

**Lähde:** `src/agents/bootstrap-hooks.ts`
**Havaittu:** research-02, luku 3.11

Bootstrap-hookit (`agent.bootstrap`) mahdollistavat tiedostojen muokkauksen ennen injektiota. Tämä on potentiaalinen mekanismi, jolla muisti-plugin voisi:

- Muokata AGENTS.md:n muistiosiot omilla ohjeillaan
- Lisätä uusia kontekstitiedostoja (esim. assosiatiivisen muistin tilan yhteenveto)
- Poistaa/tyhjentää MEMORY.md:n jos plugin hallitsee muistia eri tavalla

**Avoin kysymys:** Onko hook riittävän ilmaisuvoimainen tähän? Entä ajoitus – saako hook tietää session kontekstin (sessioavain, kanava, käyttäjä)?

→ Kyllä: `AgentBootstrapHookContext` sisältää `sessionKey`, `sessionId`, `agentId`, `workspaceDir`, `cfg`.

---

## Plugin vs. OpenClaw -muutosten rajanveto (Osa A vs. Osa B)

**Havaittu:** Projektin suunnitteluvaihe

Ensimmäisiä tunnistettuja Osa A -muutoksia (OpenClaw-järjestelmä):

| Kohde                                    | Nykyinen tila                               | Tarvittava muutos                                   |
| ---------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| `buildMemorySection()` system promptissa | Hardkoodattu memory_search/memory_get -ohje | Pitää olla ehdollinen tai plugin-ohitettavissa      |
| AGENTS.md template muistiosiot           | Hardkoodattu MEMORY.md + daily notes -malli | Template-variantti tai hook-pohjainen korvaus       |
| memory_search / memory_get -työkalut     | Sisäänrakennetut                            | Plugin pitää voida korvata tai laajentaa näitä      |
| Muisti-layout -konsepti                  | Ei olemassa                                 | Mahdollisesti tarvitaan MEMORY.md frontmatter -tuki |
| Tick/sisäinen aika                       | Ei olemassa                                 | Agentic loopin stepit pitää voida laskea            |

Nämä tunnistuvat tarkemmin tutkimusten 04–06 aikana.

---

## JSONL-transkripti ei tallenna kanavametadataa per viesti

**Lähde:** research-01, luku 3.2 (rivi 200)
**Havaittu:** research-01 ja -03 katselmointi

JSONL-transkripti tallentaa vain `user`/`assistant`/`tool`-vuorot **ilman tietoa siitä, mistä kanavasta viesti tuli**. Alice tietää vain nykyisen viestin kanavan (system prompt -metadatasta). Historiassa kaikki viestit näyttävät samalta.

**Merkitys muisti-pluginille:** Jos assosiatiivinen muisti haluaa assosioida muistoja kontekstiin ("tämä keskustelu tapahtui Telegramissa", "tästä puhuttiin Discord-ryhmässä"), tätä tietoa ei saa jälkikäteen transkriptista. Design-dokin narratiivinen muisti hyötyisi kontekstitiedosta.

**Mahdolliset ratkaisut:**

- Plugin seuraa kanavaa reaaliajassa (hookista/kontekstista) muistoa luotaessa
- Tai OpenClaw-järjestelmään lisätään kanavatieto JSONL:ään (Osa A -muutos)

---

## Agenttinen looppi on ulkoisessa kirjastossa

**Lähde:** research-03, luku 3.5 ja 10
**Havaittu:** research-03 katselmointi

Varsinainen agentic loop on `@mariozechner/pi-coding-agent` -kirjaston sisällä. OpenClaw kutsuu `session.prompt()` ja saa takaisin tuloksen – mutta loopin sisäiseen toimintaan ei pääse käsiksi.

**Merkitys muisti-pluginille:** Design-dokin **tick-konsepti** (sisäinen aikakäsite, joka kasvaa jokaisella agenttiloopin stepillä) ei voi suoraan laskea steppejä loopin sisällä. Tick-laskenta pitäisi toteuttaa **ulkopuolelta observoimalla:**

- `subscribeEmbeddedPiSession()`:n tapahtumat (onToolResult, onBlockReply)
- Tai hook-pisteet (llm_input, after_agent_end)

Tämä on arkkitehtuurityylinen rajoite, joka vaikuttaa tick-toteutuksen tarkkuuteen.

---

## Compaction voi tuhota kontekstia kesken ajon

**Lähde:** research-03, luku 4
**Havaittu:** research-03 katselmointi

Compaction voi tapahtua **agenttilooppien välissä tai loopin aikana**. Kun compaction ajaa, se korvaa vanhemmat viestit yhteenvedolla – alkuperäinen sisältö häviää kontekstista.

**Merkitys muisti-pluginille:**

- Jos plugin juuri haki muistoja kontekstiin ja compaction poistaa ne, assosiaatiolinkitys voi katketa
- **Memory flush** -mekanismi (`compaction.memoryFlush`) on jo olemassa – se kehottaa agenttia kirjoittamaan muistiin ennen tiivistystä. Plugin voisi koukuttaa tähän vaiheeseen tallentaakseen assosiaatiot.
- Compaction tuhoaa myös tool_use/tool_result -parit historiasta → pluginin pitää seurata assosiaatioita reaaliajassa, ei jälkikäteen transkriptista

---

## Transkripti tallentaa kaikki memory_search -kutsut

**Lähde:** research-03, luku 7; research-02, luku 1.4
**Havaittu:** research-03 katselmointi

Kaikki työkalukutsut tallentuvat JSONL-transkriptiin, mukaan lukien `memory_search`-kutsut ja niiden tulokset. Tämä tarkoittaa, että **mitkä muistot on haettu yhdessä** on jäljitettävissä historiallisista transkripteista.

**Merkitys muisti-pluginille:** Design-dokin assosiatiivisuus perustuu siihen, että "jos muistot palautetaan mieleen ajallisesti toisiaan lähellä, niiden assosiaatio kasvaa". Transkripteista voisi analysoida:

- Mitkä memory_search -kutsut tapahtuivat samassa sessiossa
- Mitkä muistichunkit palautettiin samoissa hauissa
- Tästä voi rakentaa assosiaatiomatriisin retroaktiivisesti

**Varoitus:** Compaction tuhoaa vanhoja tool_call/tool_result-pareja → analysointi pitää tehdä ennen compactionia tai reaaliajassa.

---

## Cron-sessiot konsolidaation mekanismina

**Lähde:** research-01, luku 3.5; research-03, luku 5
**Havaittu:** research-01 ja -03 katselmointi

Cron-ajot saavat oman session ja ajagenteilla (subagent lane) timeout on 0 = ei timeoutia. Cron-sessiot voivat myös käyttää eri mallia ja thinking-tasoa.

**Merkitys muisti-pluginille:** Design-dokin "uni" (sleep/consolidation) voitaisiin toteuttaa cron-ajona:

- Ajastetaan hiljainen aika (esim. yö) → cron käynnistää konsolidaation
- Cron-sessio saa supistetun bootstrap-joukon (ei MEMORY.md:tä, ei HEARTBEAT.md:tä) → **ongelma:** konsolidaatio tarvitsee nimenomaan pääsyn muistiin
- Tämä tarkoittaa, että joko `MINIMAL_BOOTSTRAP_ALLOWLIST`-joukkoa pitää laajentaa konsolidaatio-sessiolle, tai plugin käyttää omia työkalujaan suoran tiedostopääsyn sijaan

---

## Aliagenttisessiot eivät saa MEMORY.md:tä

**Lähde:** research-02, luku 3.10
**Havaittu:** research-01 ja -03 katselmointi

`MINIMAL_BOOTSTRAP_ALLOWLIST` = {AGENTS.md, TOOLS.md, SOUL.md, IDENTITY.md, USER.md}. Aliagentti- ja cron-sessiot eivät saa HEARTBEAT.md:tä, BOOTSTRAP.md:tä eikä **MEMORY.md:tä**.

**Merkitys muisti-pluginille:** Jos muistioperaatioita (konsolidaatio, REM-uni, assosiaatioanalyysi) delegoidaan aliagentille tai cron-ajolle, ne eivät näe MEMORY.md:tä bootstrapista. Ne voivat silti käyttää `memory_search`/`memory_get` -työkaluja tai pluginin omia työkaluja, mutta eivät saa muistikontekstia automaattisesti system promptiin.

**Tämä on todennäköisesti tarkoituksellinen turvallisuuspäätös** (muisti sisältää henkilökohtaista dataa), mutta se on suunniteltava pluginin arkkitehtuuriin.

---

## Viisi eri tapaa käynnistää agenttiajo

**Lähde:** research-01, luku 3.3; research-03, luku 1
**Havaittu:** research-03 katselmointi

Agenttiajo voi käynnistyä: viestikanava, WebSocket RPC, HTTP webhook, cron, CLI. Kaikki polut päätyvät `agentCommand()`:iin.

**Merkitys muisti-pluginille:** Muistijärjestelmän pitää toimia **yhtenäisesti riippumatta käynnistystavasta**. Erityisesti:

- Tick-laskurin pitää nollautua/jatkua oikein riippumatta lähteestä
- Assosiaatioiden päivitys pitää tapahtua samalla tavalla CLI:stä ja Telegramista
- Konsolidaatio-cron ei saa sekoittaa laskureita pääsession kanssa

---

## Pi-agent Extension API ei ole pluginien saavutettavissa

**Lähde:** `src/agents/pi-embedded-runner/extensions.ts`, `src/agents/pi-extensions/`
**Havaittu:** research-04, luku 4.3 ja 8.3

Pi-coding-agent-kirjastolla on oma Extension API (`ExtensionAPI`, `ExtensionFactory`), joka mahdollistaa:

- `"context"` -tapahtuman: viestien muokkaus ennen LLM-kutsua
- `"session_before_compact"` -tapahtuman: compaction-summarisoinnin hallinta

OpenClaw käyttää tätä API:a sisäisesti (compaction-safeguard ja context-pruning -extensionit), mutta **plugin-rajapinta ei tarjoa mekanismia ExtensionFactory:n rekisteröintiin**. Extensionit on hardkoodattu `buildEmbeddedExtensionFactories()`:ssa.

**Merkitys muisti-pluginille:** Tämä on **suurin tunnistettu infrastruktuuripuute**. Ilman Extension API -pääsyä plugin ei voi:

- Muokata konteksti-ikkunan viestejä ennen LLM-kutsua (esim. poistaa vanhentuneita muistoja)
- Integroitua compaction-summarisoinnin kanssa (esim. varmistaa assosiaatioiden tallentaminen)

**Suositus (Osa A):** Lisätä `api.registerExtension(factory)` plugin API:iin ja laajentaa `buildEmbeddedExtensionFactories()` hakemaan rekisteröidyt extensionit.

---

## llm_input -hook kutsutaan vain kerran per agenttiajo

**Lähde:** `src/agents/pi-embedded-runner/run/attempt.ts`, rivi 1150
**Havaittu:** research-04, luku 5

`llm_input` -hook laukaistaan attempt.ts:ssä **kerran** ennen `session.prompt()` -kutsua. Pi-agent-kirjaston sisäiset LLM-kutsut (tool_result → uusi LLM-kutsu → ...) eivät laukaise tätä hookia uudelleen.

**Merkitys muisti-pluginille:** Tick-laskenta ei voi perustua LLM-kutsuihin. Sen sijaan `after_tool_call` antaa paremman tick-signaalin: jokainen työkalukutsu = yksi tick.

---

## after_compaction -hook ei saa sessionFile-polkua (auto-compaction)

**Lähde:** `src/agents/pi-embedded-subscribe.handlers.compaction.ts`, rivi 67–82
**Havaittu:** research-04, luku 3.3 ja 9.1; **tarkennettu** research-05

`before_compaction` -hook saa `sessionFile`-polun ja `messages[]`-listan. `after_compaction` -hook saa **auto-compaction -polusta** vain `messageCount` ja `compactedCount` – ei sessionFile:a eikä sessionKey:tä. Manuaalinen compaction (`compact.ts`, rivi 687–693) sen sijaan lähettää sessionFile:n.

**Tämä on triviaali korjaus – ei arkkitehtuuripäätös.** `ctx.params.session.sessionFile` on jo saatavilla samassa kontekstissa, ja `before_compaction` samassa tiedostossa jo käyttää sitä. Korjaus on 2 muutosta `handleAutoCompactionEnd`:iin:

```diff
 hookRunnerEnd.runAfterCompaction(
   {
     messageCount: ctx.params.session.messages?.length ?? 0,
     compactedCount: ctx.getCompactionCount(),
+    sessionFile: ctx.params.session.sessionFile,
   },
-  {},
+  { sessionKey: ctx.params.sessionKey },
 )
```

**Tyyppi sallii jo molemmat kentät** – `PluginHookAfterCompactionEvent` sisältää `sessionFile?: string` ja hook-kontekstityyppi tukee `sessionKey`:tä.

**Suositus (Osa A):** Tämä kannattaa ehdottaa PR:nä OpenClaw:iin. Se on niin pieni muutos, ettei sen pitäisi herättää vastustusta.

**`sessionFile` viittaa session-transkriptin JSONL-tiedostopolkuun** (esim. `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`). Tämä on se tiedosto, johon kaikki user/assistant/tool-vuorot tallentuvat rivi kerrallaan.

---

## session-memory bundled-hook toimii memory-core:n rinnalla

**Lähde:** `src/hooks/bundled/session-memory/handler.ts`
**Havaittu:** research-04, luku 6.2

Session-memory on **bundled-hook** (ei plugin), joka tallentaa session-kontekstin `memory/YYYY-MM-DD-<slug>.md` -tiedostoon `/new` tai `/reset` yhteydessä. Se on riippumaton memory-core-pluginista.

**Merkitys muisti-pluginille:** Vaikka assosiatiivinen muisti -plugin korvaa memory-core:n (eksklusiivisen slotin kautta), session-memory-hook jatkaa toimintaansa ja kirjoittaa muistiinpanoja vanhan formaatin mukaisesti. Plugin pitää joko:

1. Hyödyntää nämä tiedostot omassa muistimallissaan
2. Tai disabloida session-memory-hook (vaatii mahdollisesti Osa A -muutoksen)

---

## Osa A: Tarvittavat muutokset OpenClaw:n code baseen

> **Koottu sektio.** Kaikki tunnistetut muutostarpeet OpenClaw:n ydinkoodiin, jotka vaaditaan tai joista hyödytään assosiatiivisen muistin pluginia varten. Päivitetään tutkimuksen edetessä.

### A1. Memory Recall -osio pluginin hallintaan (välttämätön)

**Lähde:** `src/agents/system-prompt.ts`, rivi 37–63
**Havaittu:** research-02, tarkennettu research-06 jälkeisessä keskustelussa

System promptin "Memory Recall" -osio on hardkoodattu `buildMemorySection()`:ssa. Se kehottaa agenttia käyttämään `memory_search` + `memory_get` -työkaluja tietyllä tavalla.

**Ongelma:** Tämän osion pitäisi tulla **memory-pluginista**, ei core-koodista. Eri muistipluginit tarvitsevat eri ohjeet: memory-core haluaa "hae MEMORY.md:stä ja memory/\*.md:stä", assosiatiivinen muisti haluaa "hae assosiaatioverkosta", memory-lancedb haluaa "käytä memory_recall:ia".

**Ehdotus:** Memory-pluginille uusi rekisteröintimahdollisuus:

```typescript
api.registerMemoryPromptSection((context) => {
  return "## Memory Recall\nUse memory_assoc_search to find memories...";
});
```

Tai yksinkertaisemmin: `buildMemorySection()` tarkistaa onko memory-slotissa plugin joka tarjoaa oman prompt-osion, ja käyttää sitä oletusosion sijaan.

### A2. ExtensionFactory-rekisteröinti (välttämätön)

**Lähde:** `src/agents/pi-embedded-runner/extensions.ts`
**Havaittu:** research-04, luku 4.3 ja 8.3

Plugin-rajapinta ei tarjoa mekanismia pi-coding-agent ExtensionFactory:n rekisteröintiin. Ilman tätä plugin ei voi muokata konteksti-ikkunan viestejä ennen LLM-kutsua tai integroitua compaction-summarisoinnin kanssa.

**Ehdotus:** `api.registerExtension(factory)` plugin API:iin.

### A3. `sessionFile` → after_compaction (välttämätön, triviaali)

**Lähde:** `src/agents/pi-embedded-subscribe.handlers.compaction.ts`, rivi 71–75
**Havaittu:** research-04, luku 3.3

Auto-compaction ei lähetä `sessionFile`-kenttää `after_compaction`-hookiin, vaikka se on saatavilla kontekstista. 2 rivin korjaus.

### A4. session-memory: siirto memory-pluginin vastuulle (arkkitehtuurimuutos)

**Lähde:** `src/hooks/bundled/session-memory/handler.ts`
**Havaittu:** research-04, luku 6.2; research-06, luku 13; tarkennettu keskustelussa

Session-memory on arkkitehtuurinen "haju" – se on **konseptuaalisesti osa muistijärjestelmää** mutta **teknisesti irrallinen siitä**. Memory-core ei tiedä session-memorystä, session-memory ei tiedä memory-coresta. Ne toimivat yhteen vain sattumalta: session-memory kirjoittaa `memory/YYYY-MM-DD-<slug>.md` -tiedostoja, chokidar huomaa ne, memory-core indeksoi ne.

**Ongelma:** Memory-plugin ei voi vaikuttaa miten tai mitä sessioista tallennetaan. Assosiatiivinen muisti haluaisi:

- Luoda muisto-olioita assosiaatioineen (ei flat-tiedostoja)
- Linkittää sessiomuistot aiempiin relevantteihin muistoihin
- Merkitä temporaalinen tila (tuore muisto = preesens)

**Ehdotus:** Session-tallennuslogiikan pitäisi olla **memory-pluginin vastuulla**, ei erillinen bundled-hook. Vaihtoehdot:

1. Siirtää session-memory osaksi memory-core:a (ja mahdollistaa muiden memory-pluginien korvata se)
2. Muuttaa session-memory kutsumaan memory-pluginin tarjoamaa rajapintaa sessiotallennukseen
3. Vähintään: ehdollinen disablointi memory-slotin perusteella + pluginin oma `session_reset`-hook

### A5. MMR tokenizer Unicode-tuki (bugikorjaus)

**Lähde:** `src/memory/mmr.ts`, rivi 33
**Havaittu:** research-06 jälkeinen keskustelu

Tokenizer käyttää `/[a-z0-9_]+/g` joka tiputtaa kaikki ei-ASCII-merkit. Suomenkieliset sanat ("päätös", "äänestys") eivät tokenisoidu. `buildFtsQuery` käyttää jo `/[\p{L}\p{N}_]+/gu` (rivi 37 `hybrid.ts`).

**Ehdotus:** Korjata tokenizer: `/[\p{L}\p{N}_]+/gu`. Tämä parantaa MMR-diversiteettiä kaikille ei-englanninkielisille käyttäjille. Itsenäinen bugikorjaus, ei riipu muisti-pluginista.

### A6. Embedding-providerin saavutettavuus pluginille (selvitettävä)

**Lähde:** `src/memory/embeddings.ts`
**Havaittu:** research-06 jälkeinen keskustelu

Plugin tarvitsee pääsyn embedding-infraan (providerit, batch, cache) omien muisto-olioiden embedaamiseen. Nykyinen `runtime.tools.createMemorySearchTool()` piilottaa infran sisäänsä. Plugin tarvitsee joko:

- `api.runtime.memory.createEmbeddingProvider()` tai vastaava
- Tai embeddingin tarjoamista palveluna (service)

### A7. Memory-layout manifesti (suositeltava)

**Havaittu:** research-06 jälkeinen keskustelu

Muistimallin versiointi (`memory-layout: memory-core-v1` / `associative-memory-v1`) pitäisi olla OpenClaw:n ydinominaisuus. Tiedostojärjestelmässä ja tietokannassa. Memory-core:n pitäisi myös kirjoittaa oma manifesti.

### A8. AGENTS.md muistiosiot (ratkeaa hookilla – ei koodimuutosta)

**Havaittu:** research-02, luku 3

Bootstrap-hook voi korvata AGENTS.md:n muistiosiot lennossa. Ei vaadi koodimuutosta OpenClaw:iin.

### A9. Pi-agent tick-laskuri (pitkä aikaväli)

**Havaittu:** research-04

`session.tickCount` tai vastaava pi-coding-agent-kirjastoon. Ei kriittinen – `after_tool_call` riittää tick-laskentaan.

### Yhteenveto prioriteeteittain

| Prioriteetti            | Kohteet                                                                | Perustelu                                                       |
| ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Välttämätön**         | A1 (Memory Recall pluginista), A2 (ExtensionFactory), A3 (sessionFile) | Ilman näitä plugin ei voi toimia kunnolla                       |
| **Bugikorjaus**         | A5 (MMR tokenizer)                                                     | Itsenäinen PR, hyödyttää kaikkia ei-englanninkielisiä käyttäjiä |
| **Arkkitehtuurimuutos** | A4 (session-memory pluginin vastuulle)                                 | Nykyinen malli ei skaalaudu eri muistiplugineihin               |
| **Suositeltava**        | A6 (embedding API), A7 (layout manifesti)                              | Parantaa arkkitehtuuria merkittävästi                           |
| **Ei koodimuutosta**    | A8 (AGENTS.md hookilla)                                                | Ratkeaa pluginin sisällä                                        |
| **Pitkä aikaväli**      | A9 (tick-laskuri)                                                      | Workaround olemassa                                             |

### Yhteydenotto OpenClaw:n tekijöihin

Osa A -muutokset vaativat yhteistyötä OpenClaw:n kehittäjien kanssa. Muutoksia ei voi tehdä pelkästään pluginin puolella.

**Lähestymisstrategia:**

1. **Aloita pienestä, itsenäisestä PR:stä** – A5 (MMR tokenizer Unicode-korjaus) on bugikorjaus joka hyödyttää kaikkia. Hyvä ensikontakti ja osoitus laadusta.
2. **Esittele muistilaajennettavuuden tarve** – A1 (Memory Recall pluginista) ja A4 (session-memory pluginin vastuulle) ovat arkkitehtuuriehdotuksia, jotka vaativat keskustelua designista.
3. **Konkretisoi design-dokumentilla** – research-07 (uusi muistisuunnittelu) toimii pohjana keskustelulle: "tätä haluamme rakentaa, tässä ovat rajoitteet jotka estävät".
4. **Ehdota vaiheittaista toteutusta** – kaikki A-muutokset eivät ole tarpeen kerralla. MVP voi toimia pienemmällä muutosjoukolla.

**Ajoitus:** Luonteva hetki on kun research-07 (uusi muistisuunnittelu) on valmis ja meillä on konkreettinen suunnitelma siitä, mitä rakennamme ja miksi nämä muutokset ovat tarpeen.

---

## Hook-fasadit ovat olemassa kaikille kriittisille hookeille

**Lähde:** `src/plugins/hooks.ts`, rivit 345–454, 716–750
**Havaittu:** research-04, tarkistus

Kaikki 23 plugin-hookia on toteutettu fasadimetodiena `HookRunner`:ssa (esim. `runAfterToolCall`, `runBeforeCompaction`, `runAfterCompaction`). Ne ovat valmiita käytettäviksi – plugin rekisteröi `api.on("after_tool_call", handler)` ja HookRunner kutsuu sitä.

Erityishuomiot:

- `runAfterToolCall` on **fire-and-forget** (`runVoidHook`) – ei hidasta loopin suoritusta
- `runBeforeCompaction`/`runAfterCompaction` ovat molemmat **fire-and-forget**
- `runToolResultPersist` on **synkroninen** (hot path – session transcript append)
- `runBeforeToolCall` on **sekventiaalinen ja muokattava** (voi estää/muokata kutsun)

Compaction-hookeja kutsutaan kahdesta paikasta:

1. Subscribe-handleri (auto-compaction agenttiloopin aikana)
2. Erillinen compact.ts (manuaalinen/schedule-compaction)

**Merkitys muisti-pluginille:** Infrastruktuuri on olemassa. Plugin voi rekisteröidä handlerit suoraan `api.on()`:lla ilman mitään Osa A -muutoksia näihin hookeihin.

---

## Muistityökalujen arkkitehtuuri: ei erillistä memory_write -työkalua

**Lähde:** `extensions/memory-core/index.ts`, `src/agents/tools/memory-tool.ts`, `docs/reference/templates/AGENTS.md`
**Havaittu:** research-04, tarkennuskeskustelu

**memory_search ja memory_get** ovat memory-core-pluginin rekisteröimiä työkaluja – ne **eivät ole hardkoodattuja** ydinjärjestelmään. Arkkitehtuuri:

```
src/agents/tools/memory-tool.ts        ← factory-funktiot (createMemorySearchTool, createMemoryGetTool)
src/plugins/runtime/                   ← runtime tarjoaa factoryt: api.runtime.tools.createMemorySearchTool()
extensions/memory-core/index.ts        ← plugin kutsuu factoryja ja rekisteröi työkalut api.registerTool():lla
```

Memory-core-plugin rekisteröi vain **kaksi työkalua**: `memory_search` ja `memory_get`. Factory-funktiot ovat OpenClaw:n core-koodissa (`src/agents/tools/memory-tool.ts`), mutta niiden rekisteröinti agenttikäyttöön tapahtuu **pluginin kautta**.

**memory_write -työkalua ei ole olemassa.** Research-03:ssa mainittu `memory_write` oli virheellinen – sellaista työkalua ei ole koodissa. Agentti kirjoittaa muistiin käyttäen **yleisiä tiedostotyökaluja** (write, edit):

- AGENTS.md-template ohjeistaa: "read, edit, and update MEMORY.md freely"
- Päivittäiset muistiinpanot: `memory/YYYY-MM-DD.md` – luodaan/muokataan write/edit-työkaluilla
- Pitkäkestoinen muisti: `MEMORY.md` – muokataan edit-työkalulla

**Merkitys assosiatiivisen muistin pluginille:**

1. **Plugin voi korvata memory_search ja memory_get** kokonaan (eksklusiivisen memory-slotin kautta)
2. **Muistiin kirjoitus on implisiittistä** – agentti käyttää tiedostotyökaluja, ei muistityökalua. Assosiatiivinen muisti -plugin voisi rekisteröidä oman `memory_write`-työkalun, joka tallentaa muistot assosiatiiviseen rakenteeseen sen sijaan, että agentti kirjoittaa flat-tiedostoja.
3. **Tai plugin voi observoida kirjoituksia** `after_tool_call`-hookista (toolName=write/edit, tarkista kohdepolku)
4. Research-03:n työkalu-taulukko pitää korjata: `memory_write` → poistettava tai merkittävä olemattomaksi

---

## Flat-tiedostot säilyvät, mutta chunkkaus muuttuu stabiileiksi identiteeteiksi

**Havaittu:** Suunnittelukeskustelu (research-04 jälkeen)

Muistot tallennetaan edelleen flat-tiedostoihin (ei tietokantaa), mutta formaatti pitää suunnitella niin, että **palastelu (chunking) tuottaa stabiileja yksiköitä**.

**Nykyinen malli:** memory_search palastelee tiedostot lennossa (embedding-haku, rivipohjainen chunking). Chunkkien rajat voivat muuttua jos tiedostoa muokataan – tämä on OK koska mitään ei viittaa yksittäiseen chunkkiin.

**Assosiatiivisen muistin ongelma:** Assosiaatiot ovat **chunkkien välisiä linkkejä**. Jos chunk A:lla ja chunk B:llä on assosiaatio (paino 0.7), ja sitten chunk A:n rajat muuttuvat uudelleenpalastelun takia, assosiaatio osoittaa tyhjyyteen tai väärään kohtaan.

Tämä tarkoittaa, että:

1. **Chunkkien pitää olla stabiileja** – niillä on identiteetti (id), ja ne eivät muutu uudelleenpalastelun seurauksena
2. **Uudelleenpalastelua ei voi tehdä lennossa** – chunkit luodaan kerran (esim. muistoa tallennettaessa) ja ne säilyvät sellaisenaan
3. **Flat-tiedoston formaatti tarvitsee chunkkien rajamerkinnät** – esim. YAML-frontmatter, markdown-osioiden otsikot + id:t, tai muu rakenne, joka tekee chunkista tunnistettavan yksikön
4. **Assosiaatiot tallennetaan erikseen** – erillinen tiedosto/rakenne, joka viittaa chunkkien id:ihin (esim. `associations.json` tai vastaava)

**Mahdollisia formaatteja:**

```markdown
<!-- chunk:abc123 created:2026-02-25 decay:0.9 -->

## Jarin projektipalaveri

Keskusteltiin muisti-pluginin arkkitehtuurista. Päätettiin käyttää flat-tiedostoja.

<!-- /chunk -->
```

Tai:

```yaml
# memory/chunks/abc123.md
---
id: abc123
created: 2026-02-25T14:30:00Z
decay: 0.9
tags: [projekti, arkkitehtuuri]
---
Jarin projektipalaveri. Keskusteltiin muisti-pluginin arkkitehtuurista...
```

**Kompromissi:** Yksi chunk per tiedosto olisi yksinkertaisin (id = tiedostonimi), mutta tuottaa paljon pieniä tiedostoja. Monta chunkkia per tiedosto on kompaktimpi, mutta vaatii rakenteellisen formaatin.

**Tämä on yksi research-08:n (uusi muistisuunnittelu) keskeisistä suunnittelupäätöksistä.**

---

## Pi-agent-kirjaston "musta laatikko" on harhaanjohtava kuvaus

**Lähde:** `src/agents/pi-tools.before-tool-call.ts`, `src/agents/pi-tool-definition-adapter.ts`, `src/agents/pi-embedded-subscribe.handlers.tools.ts`
**Havaittu:** research-04, tarkennuskeskustelu

Research-04:n datavirta-kaaviossa `session.prompt()` kuvataan "mustaksi laatikoksi". Tämä on **osittain harhaanjohtava**. Todellisuudessa:

**Mitä pi-agent hallitsee yksin:**

- LLM-kutsujen järjestyksen ja ajoituksen (milloin kutsutaan LLM:ää uudelleen)
- Päätöksen siitä, jatketaanko looppia vai lopetetaanko (end_turn)
- Konteksti-ikkunan hallinnan (compaction-triggerin ajoituksen)

**Mitä OpenClaw hallitsee:**

- **Työkalujen suorituksen** – kaikki työkalut ovat OpenClaw:n koodia, joka annetaan pi-agentille `createAgentSession({ tools, customTools })`:ssa. Pi-agent kutsuu niiden `execute()`-metodia, joka on OpenClaw:n wrapperin sisällä.
- **before_tool_call -hookin** – jokainen työkalu on kääritty `wrapToolWithBeforeToolCallHook()`:iin, joka ajaa `runBeforeToolCallHook()`:n **ennen** varsinaista suoritusta. Tämä wrapper on tool-olion `execute()`-funktion sisällä – se suoritetaan pi-agent-kirjaston loopin sisällä, mutta se on OpenClaw:n koodia.
- **Subscribe-tapahtumien observoinnin** – `tool_execution_start/end` -tapahtumat tulevat pi-agentilta, ja OpenClaw:n handlerit ajavat `after_tool_call` -hookin niiden perusteella.

**Kaksi eri polkua tool-hookeihin:**

```
Pi-agent-looppi kutsuu tool.execute()
  └─ OpenClaw:n wrapper: wrapToolWithBeforeToolCallHook()
     └─ runBeforeToolCallHook() ← before_tool_call hook TÄSSÄ
        └─ varsinainen tool.execute() ← OpenClaw:n työkalu suorittuu
           └─ paluu pi-agentille

Pi-agent emittoi tool_execution_end
  └─ subscribe-handler: handleToolExecutionEnd()
     └─ hookRunner.runAfterToolCall() ← after_tool_call hook TÄSSÄ
```

**Merkitys muisti-pluginille ja tick-laskennalle:**

- **Tick-laskenta `after_tool_call`:sta on luotettava** – jokainen työkalu kulkee OpenClaw:n koodin läpi ja laukaisee hookin
- **`before_tool_call` mahdollistaa rikastamisen** – plugin voi lisätä metadataa tai estää kutsun ennen suoritusta
- Pi-agent-kirjasto on "musta laatikko" vain **LLM-kutsujen osalta** (milloin kutsutaan, miten päätetään jatkamisesta). Työkalujen suoritus on täysin OpenClaw:n hallinnassa.

**Korjaus research-04:ään:** Luvun 5 datavirta-kaavion tulisi selventää, että `session.prompt()` on musta laatikko LLM-logiikan osalta, mutta työkalut suoritetaan OpenClaw:n koodissa callback-tyylisesti.

---

## Keskustelun kokonaistallentaminen vs. assosiatiivinen muisti

**Havaittu:** research-04 katselmointi, keskustelu

Assosiatiivinen muisti ja keskustelun kokonaistallentaminen ovat **kaksi eri asiaa**:

**Assosiatiivinen muisti** ei välttämättä tarvitse tietää kompaktoinnista. Se käsittelee muisto-olioita (chunkkeja, narratiiveja, assosiaatioita) – ei raakoja keskusteluviestejä. Muistin näkökulmasta relevanttia on:

- Mitä muistoja luotiin
- Mitä muistoja haettiin yhdessä (assosiaatiot)
- Miten muistojen vahvuus muuttuu ajan myötä (decay, konsolidaatio)

**Keskustelun kokonaistallennus** on eri tarve: "mitä agentti ja käyttäjä sanoivat toisilleen, sanasta sanaan". Nykyinen JSONL-transkripti hoitaa tämän osittain, mutta compaction tuhoaa vanhoja viestejä.

**Miksi tämä on tärkeää:**

- Jos halutaan, että keskusteluhistoria säilyy kokonaisena (esim. "mitä puhuttiin viime viikolla"), tarvitaan **erillinen arkistointikerros** – compaction ei ole ongelma muistille, mutta se on ongelma keskusteluhistorialle
- Assosiatiivinen muisti voi toimia hyvin ilman keskusteluarkistoa: se operoi omilla muisto-olioillaan, joita se luo ja päivittää reaaliajassa hookien kautta
- Kompaktointi vaikuttaa kuitenkin **agentin ja käyttäjän kommunikaatioon**: jos agentti menettää kontekstin, se ei voi viitata aiempiin keskusteluihin luontevasti. Tämä on UX-ongelma, ei muisti-pluginin ongelma.

**Mahdolliset tasot:**

1. **Pelkkä assosiatiivinen muisti** – ei tarvitse kompaktointitietoa, toimii hookien kautta
2. **Muisti + keskusteluarkisto** – erillinen mekanismi, joka tallentaa raakaviestit ennen compactionia (esim. `before_compaction` -hookista)
3. **Muisti + keskusteluarkisto + retrieval** – keskusteluhistoriasta voi hakea "mitä sanottiin" -tyylisiä muistoja

**Suositus:** Aloita tasolla 1 (pelkkä assosiatiivinen muisti). Keskusteluarkisto on itsenäinen feature, joka voidaan rakentaa myöhemmin `before_compaction` + `before_reset` -hookien päälle.

---

## after_compaction sessionFile on epäyhtenäinen kahdessa kutsupaikassa

**Lähde:** `src/agents/pi-embedded-subscribe.handlers.compaction.ts` (rivi 71–75), `src/agents/pi-embedded-runner/compact.ts` (rivi 687–693)
**Havaittu:** research-05, luku 16

`after_compaction` -hookia kutsutaan **kahdesta eri paikasta**:

1. **Auto-compaction (subscribe-handler):** Kutsuu `runAfterCompaction({ messageCount, compactedCount }, {})` – **ei sessionFile:a**
2. **Manuaalinen/schedule-compaction (compact.ts):** Kutsuu `runAfterCompaction({ messageCount, tokenCount, compactedCount, sessionFile }, hookCtx)` – **sisältää sessionFile:n**

Auto-compaction on yleisin tapaus (tapahtuu agenttilooppien aikana), joten plugin ei saa `sessionFile`:a useimmissa tilanteissa.

**Merkitys muisti-pluginille:** Jos plugin haluaa lukea session-transkriptin after_compaction:ssa, se ei voi luottaa `sessionFile`-kenttään. Workaround: tallentaa `sessionFile` `before_compaction`:sta ja käyttää sitä after:ssa.

**Suositus (Osa A):** Lisätä `sessionFile: ctx.params.session.sessionFile` myös `handleAutoCompactionEnd`:iin (yksi rivi).

---

## memory-lancedb on esimerkki hookien käytöstä memory-pluginissa

**Lähde:** `extensions/memory-lancedb/index.ts`
**Havaittu:** research-05, luku 14.2

`memory-lancedb` demonstroi kaikki tärkeät memory-pluginin mallit:

1. **Auto-recall:** `api.on("before_agent_start")` → hae relevantti muistit embeddingillä → palauta `{ prependContext }` → OpenClaw injektoi kontekstin alkuun
2. **Auto-capture:** `api.on("agent_end")` → analysoi käyttäjäviestit → tallenna triggeröivät muistot tietokantaan
3. **Omat työkalut:** `memory_recall`, `memory_store`, `memory_forget` (ei käytä runtime.tools-factory:ja)
4. **CLI ja Service:** Diagnostiikkaa ja alustus/sammutus

Tämä on **suora malli** assosiatiivisen muistin pluginille. Oleelliset erot:

- Assosiatiivinen muisti käyttää **assosiaatioita** eikä pelkkää vektorihakua
- Auto-capture ei riitä: tarvitaan myös assosiaatioiden seuranta `after_tool_call`:sta
- Konsolidaatio-service tarvitaan (decay, vahvistus, "uni")

---

## before_agent_start vs. before_prompt_build

**Lähde:** `src/plugins/types.ts`, rivit 347–367
**Havaittu:** research-05, luku 15.5

Plugin-hookien joukossa on **kaksi vaihetta**, jotka voivat injektoida kontekstia:

| Hook                   | Milloin kutsutaan                     | Palauttaa                           |
| ---------------------- | ------------------------------------- | ----------------------------------- |
| `before_model_resolve` | Ensimmäisenä, ennen session-viestejä  | `modelOverride`, `providerOverride` |
| `before_prompt_build`  | System prompt -rakennuksen aikana     | `prependContext`, `systemPrompt`    |
| `before_agent_start`   | Legacyn takia: yhdistää molemmat yllä | Kaikki yllä olevat                  |

**`before_prompt_build`** on eriytetympi ja tarkempi. **`before_agent_start`** on legacy-yhteensopiva, yhdistää molemmat.

Suositus: käytä `before_prompt_build`:ia muistojen injektointiin ja `before_model_resolve`:a vain jos mallin valintaa pitää ohjata.

---

## Plugin-rekisteröinti on synkroninen

**Lähde:** `src/plugins/loader.ts`, rivit 654–665
**Havaittu:** research-05, luku 4

Pluginin `register(api)` kutsutaan **synkronisesti** latauksen aikana. Jos funktio palauttaa Promisen, se logittaa varoituksen ja jättää Promisen odottamatta:

```typescript
const result = register(api);
if (result && typeof result.then === "function") {
  registry.diagnostics.push({
    level: "warn",
    message: "plugin register returned a promise; async registration is ignored",
  });
}
```

**Merkitys muisti-pluginille:** `register()`:n sisällä ei voi tehdä asynkronisia operaatioita (esim. tietokannan alustus). Raskas alustus pitää siirtää:

1. **Service:n `start()`-funktioon** (kutsutaan myöhemmin asynkronisesti)
2. **Lazy-initialisoitiin** (alustetaan ensimmäisen työkalukutsun yhteydessä)
3. **Hook-handleriin** (hookit voivat olla asynkronisia)

---

## Plugin-työkalujen factory kutsutaan agenttiajon alussa

**Lähde:** `src/plugins/tools.ts`, rivi 91–96
**Havaittu:** research-05, luku 7

`OpenClawPluginToolFactory` kutsutaan `resolvePluginTools()`:ssa, joka ajetaan **jokaisella agenttiajon alussa**. Factory saa `OpenClawPluginToolContext`:n, joka sisältää mm. `sessionKey`, `agentId`, `workspaceDir`.

**Merkitys muisti-pluginille:** Factory voi luoda session-kohtaisen työkalun, joka tietää nykyisen session kontekstin. Tätä voi käyttää assosiaatioiden kohdistamiseen.

---

## Chunk ID ei ole stabiili – kriittinen assosiatiivisen muistin rajoite

**Lähde:** `src/memory/manager-embedding-ops.ts`, `src/memory/internal.ts`
**Havaittu:** research-06, luku 5.5 ja 17.3

Nykyinen chunk ID lasketaan: `SHA-256("${source}:${path}:${startLine}:${endLine}:${chunkHash}:${providerModel}")`. Tämä tarkoittaa:

- Rivin lisäys tiedostoon → alla olevien chunkkien `startLine/endLine` muuttuu → uudet ID:t
- Embedding-providerin vaihto → kaikki ID:t muuttuvat
- Tiedoston uudelleennimeäminen → kaikki ID:t muuttuvat

**Merkitys:** Assosiatiivinen muisti ei voi käyttää näitä ID:itä assosiaatioiden ankkureina. Plugin tarvitsee **oman stabiilin identiteettijärjestelmän** muistoille (UUID, content-hash ilman rivinumeroita, tai tiedostonimi-pohjainen).

---

## Temporal decay on tiedostotasoinen, ei chunk-tasoinen

**Lähde:** `src/memory/temporal-decay.ts`
**Havaittu:** research-06, luku 8

Nykyinen temporal decay toimii tiedostotasolla: kaikki chunkit samasta tiedostosta rapautuvat samalla nopeudella. Päiväys haetaan tiedostopolusta (`memory/YYYY-MM-DD.md`) tai mtime:sta. "Evergreen"-tiedostot (MEMORY.md, päiväämättömät memory/\*) eivät rapaudu.

**Ero design-dokin malliin:** Assosiatiivisen muistin decay on per-muisto-olio: jokainen muisto rapautuu itsenäisesti riippuen siitä, kuinka usein se haetaan (retrieval vahvistaa) ja kuinka vahvat sen assosiaatiot ovat. Tämä on fundamentaalisesti eri malli.

---

## Embedding-infra on uudelleenkäytettävissä

**Lähde:** `src/memory/embeddings.ts`, `src/memory/manager-embedding-ops.ts`
**Havaittu:** research-06, luku 6

OpenClaw:n embedding-infra (providerit, batch-prosessointi, välimuisti) on hyvin rakennettu ja **uudelleenkäytettävissä**. Plugin voi hyödyntää samoja embedding-providereja ja välimuistia ilman omaa embedding-putkea.

**Avoin kysymys:** Miten plugin pääsee embedding-infraan käsiksi? `api.runtime.tools.createMemorySearchTool()` palauttaa valmiin työkalun, joka käyttää infran sisäisesti. Mutta jos plugin haluaa suoraan embedata omia muisto-olioita, se tarvitsee pääsyn `createEmbeddingProvider()`:iin tai vastaavaan. Tämä on selvitettävä Osa A -kontekstissa.

---

## session-memory-hook kirjoittaa vanhaan formaattiin memory-core-korvauksesta riippumatta

**Lähde:** `src/hooks/bundled/session-memory/handler.ts`
**Havaittu:** research-06, luku 13

Session-memory on bundled-hook, joka kirjoittaa `memory/YYYY-MM-DD-<slug>.md` -tiedostoja `/new`/`/reset`-komennoissa. Se on **itsenäinen memory-core-pluginista** – vaikka assosiatiivinen muisti -plugin korvaa memory-core:n, session-memory jatkaa toimintaansa.

**Vaihtoehdot:**

1. Plugin lukee session-memoryn tuottamat tiedostot ja konvertoi ne omaan tietomalliinsa
2. Session-memory disabloidaan (vaatii Osa A -muutoksen: ehdon `memory`-slotin perusteella)
3. Plugin rekisteröi oman `session_reset`-hookin, joka korvaa session-memoryn toiminnallisuuden

---

## Muistimalli tarvitsee versionoinnin (memory-layout manifesti)

**Havaittu:** research-06 jälkeinen keskustelu

Nykyinen tilanne on implisiittinen: mikään ei kerro, mitä muistimallia workspace käyttää. Jos agentti avaa workspacen, jossa on assosiatiivisen muistin tietomalli, memory-core yrittäisi indeksoida sen sokeasti.

**Ratkaisu: memory-layout manifesti**, joka ilmoittaa aktiivisen muistimallin:

- Esim. `memory-layout: memory-core-v1` tai `memory-layout: associative-memory-v1`
- Manifesti pitää löytyä **kahdesta paikasta**: tiedostojärjestelmästä (esim. `memory/.layout.json` tai `MEMORY.md` frontmatter) JA tietokannasta (esim. `meta`-tauluun)
- Jos nämä kaksi ovat ristiriidassa, järjestelmä tietää, että migraatio on kesken tai epäonnistunut → voidaan varoittaa tai estää käynnistyminen

**Migraatioskriptit (to-and-fro):**

- `memory-core-v1 → associative-memory-v1`: Lue flat-tiedostot, luo muisto-oliot stabiileilla ID:illä, rakenna alkuassosiaatiot, alusta tietokanta
- `associative-memory-v1 → memory-core-v1`: Exporttaa muistot flat-tiedostoiksi (assosiaatiot ja decay-tila menetetään, sisältö säilyy)
- Polku takaisin pitää olla olemassa – jos plugin ei toimi tai käyttäjä haluaa palata

**Suositus (Osa A):** Layout-konseptin pitää olla OpenClaw:n ydinominaisuus, ei vain pluginin sisäinen asia. Memory-core:n pitäisi myös kirjoittaa oma manifesti (`memory-core-v1`), jotta kaikki muistimallit ovat eksplisiittisiä.

---

## Tietokannan rooli muuttuu fundamentaalisesti assosiatiivisessa muistissa

**Havaittu:** research-06 jälkeinen keskustelu

**Nykyinen malli (memory-core):**

```
Flat-tiedostot = totuuden lähde
SQLite = johdettu indeksi (voidaan poistaa ja rakentaa uudelleen tiedostoista)
```

**Assosiatiivinen muisti:**

```
Flat-tiedostot = muistojen sisältö (totuuden lähde sisällölle)
Tietokanta = kriittinen osa muistimallia (ei johdettavissa tiedostoista)
├── Assosiaatiot (linkit muistojen välillä + painot)
├── Decay-tila (per-muisto rapautumisaste, viimeinen retrieval-aika)
├── Tick-laskuri ja temporaalinen tila
├── Konsolidaatiohistoria
└── Embeddings (voidaan regeneroida)
```

**Seuraukset:**

1. **Tietokanta tarvitsee varmuuskopioinnin** – uudelleenrakentaminen tiedostoista ei palauta assosiaatioita, decay-tilaa tai konsolidaatiohistoriaa
2. **Kaksi totuuden lähdettä eri asioille** – tiedostot = sisältö, tietokanta = suhteet ja tila
3. **Tietokanta pitää versionoida** layout-manifestin kanssa – migraatioskriptin pitää tietää sekä tiedostomalli että tietokantaskeema
4. **Safe-reindex ei riitä** – nykyinen "poista DB, rakenna uudelleen" -mekanismi tuhoaisi kriittistä tilaa. Tarvitaan eriytetty logiikka: embeddingit voidaan regeneroida, mutta assosiaatiot/decay/tila pitää säilyttää

---

## Embedding-mallin laatu vaikuttaa assosiaatioiden laatuun

**Havaittu:** research-06 jälkeinen keskustelu

Assosiatiivisessa muistissa embedding-laatu on **kriittisempi** kuin tavallisessa memory_search:ssa:

- Tavallisessa haussa "melkein oikea" riittää – käyttäjä näkee tulokset ja korjaa
- Assosiaatioissa huono embedding johtaa **hiljaiseen virheeseen**: väärät muistot linkittyvät, oikeat eivät, eikä kukaan näe tätä suoraan

**Paikallinen malli** (`embeddinggemma-300m-qat-Q8_0`, 300M params, kvantisoitu) on huomattavasti pienempi kuin pilvipalvelumallit (OpenAI `text-embedding-3-small` 1536 dims, Voyage `voyage-4-large` 1024 dims). Paikallisen mallin edut (ei kustannuksia, ei viivettä, offline, ei rate limittiä) ovat merkittäviä erityisesti jos assosiatiivinen muisti tekee enemmän embedding-operaatioita kuin nykyinen malli.

**Päätös:** Plugin ei valitse mallia – se käyttää käyttäjän konfiguroimaa provideria. Dokumentaatiossa mainitaan, että parempi embedding-malli tuottaa parempia assosiaatioita.

---

## Embedding-pohjainen konsolidaatio: avoin suunnittelukysymys

**Havaittu:** research-06 jälkeinen keskustelu

Design-dokin konsolidaatio ("uni") on kuvattu pääasiassa assosiaatiopainojen ja decay-tilan päivittämisenä. Mutta kosinihaku avaa toisen mahdollisuuden: **embedding-pohjainen konsolidaatio**.

Perusidea: konsolidaatiovaiheessa (cron/service) käydään läpi muisto-olioita ja lasketaan niiden embedding-vektorien kosinisamankaltaisuus. Muistot, jotka ovat semanttisesti lähellä mutta joilla ei vielä ole eksplisiittistä assosiaatiota, voisivat saada sellaisen automaattisesti. Tämä simuloi ihmismuistin "unen aikana tapahtuvia uusia yhteyksiä".

**Konsolidaation embedding-operaatiot voivat olla merkittäviä:**

- N muistoa → O(N²) parivertailua (tai optimoituna ANN-haulla)
- Jokainen vertailu vaatii embedding-vektorit (välimuistista tai API:sta)
- Tämä lisää painetta paikallisen mallin suuntaan (ei API-kustannuksia konsolidaatiosta)

**Avoimet kysymykset:**

1. Pitäisikö konsolidaation luoda uusia assosiaatioita embedding-samankaltaisuuden perusteella, vai vain vahvistaa/heikentää olemassa olevia?
2. Mikä on kynnysarvo: kuinka samanlaisten muistojen pitää olla ennen kuin syntyy automaattinen assosiaatio?
3. Pitäisikö embedding-pohjainen konsolidaatio olla erillinen vaihe ("REM-uni") vai osa samaa konsolidaatioprosessia?
4. Miten vältetään, ettei konsolidaatio luo turhia assosiaatioita semanttisesti samankaltaisten mutta kontekstuaalisesti erilaisten muistojen välille (esim. kaksi eri projektin palaverimuistiinpanoa, joissa molemmissa puhutaan "arkkitehtuurista")?

---

## Content hash toimii chunk-identiteettinä – suunnitteluperiaatteella

**Havaittu:** research-06 jälkeinen keskustelu

Alkuperäinen huoli: content hash (SHA-256 chunkin tekstistä) ei ole stabiili, koska muiston sisältö voi muuttua (konsolidaatio, "väritetyt muistot"). Tämä hajoittaisi assosiaatiot.

**Oivallus:** Tämä ei ole ongelma, koska:

1. **Kaikki sisältöä muuttavat operaatiot ovat meidän koodissamme** (konsolidaatio, väritys, yhdistäminen). Tiedämme vanhan ja uuden hashin samassa operaatiossa → päivitämme assosiaatiot atomisesti samassa transaktiossa.
2. **Muuttunut muisto on filosofisesti uusi muisto** – se perii edeltäjänsä assosiaatiot (mahdollisesti muokattuina). Tämä on puhdas malli.
3. **Content hash antaa ilmaiseksi:** deduplikaatio, eheysvarmistus, ei erillistä ID-generointimekanismia.

**Suunnitteluperiaate:** Kaikki muistoa muuttava koodi päivittää myös assosiaatiot. Tämä on arkkitehtuurisääntö, ei toive.

**Ainoa "hiljainen" katkeamispiste:** Käyttäjä muokkaa muistitiedostoa käsin ulkoisella editorilla. File watcher havaitsee muutoksen, mutta ei tiedä vanhaa hashia suoraan. Ratkaisuvaihtoehdot:

- Tietokannassa on vanha hash → diffataan ja siirretään assosiaatiot lähimpiin uusiin chunkkeihin
- Tai hyväksytään assosiaatiomenetys ulkoisissa muokkauksissa (käyttäjä teki tietoisen muokkauksen)

**Tämä yksinkertaistaa arkkitehtuuria merkittävästi** verrattuna UUID-pohjaiseen identiteettiin: ei tarvita erillistä ID-rekisteriä, content-addressable storage on konseptuaalisesti selkeä, ja se on tuttu malli (vrt. git).

---

## Olemassa olevan muistin importointi: semanttinen chunking

**Havaittu:** research-06 jälkeinen keskustelu

Uusien käyttäjien onboarding vaatii olemassa olevan memory-core-muistin importoinnin assosiatiiviseen muistiin. Kyseessä on käytännössä flat-tiedostojen (MEMORY.md, memory/\*.md) pilkkominen **koherenteiksi muistoyksiköiksi** – ei mekaanisiksi 400 tokenin paloiksi kuten nykyinen chunking tekee.

**Ongelman ydin:** Miten tunnistaa, mitkä rivit kuuluvat yhteen ja muodostavat yhden "muiston"?

**Lähestymistapa: hybridi rakenteellinen + embedding-pohjainen segmentointi**

1. **Rakenteellinen segmentointi ensin (Markdown):**
   - Otsikot (`##`, `###`) ovat luonnollisia rajoja
   - Tyhjät rivit erottavat kappaleet
   - Listat ovat koherentteja yksiköitä
   - Tämä antaa alkuarvauksen blokeista

2. **Embedding-tarkennus liian isoille blokeille:**
   - Embedataan jokainen rivi blokissa
   - Lasketaan kosinisamankaltaisuus vierekkäisten rivien välillä: `sim(rivi_i, rivi_{i+1})`
   - Missä samankaltaisuus putoaa kynnysarvon alle → uusi raja
   - Tämä on käytännössä TextTiling (Hearst, 1997) rivitystasolle adaptaationa

3. **Liian pienet blokit:** Yhdistä vierekkäiseen blokkiin jos embedding-samankaltaisuus on riittävän korkea

**Avoimet kysymykset:**

1. **Muistoyksikön maksimikoko?** Nykyinen 400 tokenia (~1600 merkkiä) on mekaaninen raja. Semanttiselle muistolle sopiva koko riippuu sisällöstä:
   - Yksittäinen fakta/päätös: ~20–100 tokenia
   - Konseptin kuvaus: ~100–300 tokenia
   - Tapahtuman/keskustelun yhteenveto: ~200–500 tokenia
   - Kognitiotieteessä työmuistin "chunk" on 5–9 elementtiä (Millerin laki), mutta se ei suoraan käänny tekstikooksi
   - **Ehdotus:** Dynaaminen koko, ei kiinteä raja. Semanttinen koherenssi määrää koon, mutta yläraja (esim. 500 tokenia) estää liian isot blokit.

2. **Kynnysarvo vierekkäisyydelle?** Kuinka paljon kosinisamankaltaisuuden pitää pudota ennen kuin se tulkitaan rajaksi? Tämä vaatii empiiristä testausta.

3. **Entä session-memory -hookin tuottamat tiedostot?** Ne ovat jo valmiiksi yhden session yhteenvetoja – pitäisikö ne importoida kokonaisina muistoyksikköinä vai pilkkoa edelleen?

4. **Importoidaanko assosiaatiot samalla?** Importoinnin yhteydessä voisi luoda alkuassosiaatiot:
   - Samassa tiedostossa olevat muistot saavat heikon assosiaation
   - Embedding-samankaltaisuuden perusteella löytyvät muistot saavat vahvemman assosiaation
   - Ajallisesti läheiset muistot (päivämäärän perusteella) saavat temporaalisen assosiaation

---

## BM25:n rooli ja rajoitteet: perustelut code basessa

**Lähde:** `docs/concepts/memory.md` (commit b5c023044), `src/agents/memory-search.ts`
**Havaittu:** research-06 jälkeinen keskustelu

**BM25 on mukana eksaktien tokenien takia:** ID:t (`a828e60`), koodisymbolit (`memorySearch.query.hybrid`), virheviestit (`"sqlite-vec unavailable"`). Vektorihaulla näitä ei löydy luotettavasti.

**Painotusta 0.7/0.3 ei perustella numeerisesti.** Dokumentaatio sanoo: _"This isn't 'IR-theory perfect', but it's simple, fast, and tends to improve recall/precision on real notes."_ Painot ovat konfiguloitavissa.

**Suomen kielen ongelma:** BM25/FTS5 vertaa eksakteja tokeneita. Suomi on agglutinoiva kieli – "muisti" ei löydä "muistissa", "muistojen", "muistelemme". Nykyisessä koodissa on query expansion CJK-kielille ja korean partikkelien strippaus (`src/memory/query-expansion.ts`), mutta suomea ei käsitellä lainkaan.

**Käytännön vaikutus:** Hybridihaussa (oletus) vektorin 0.7 paino kompensoi – suomenkielinen semanttinen haku toimii embeddingillä. FTS-only-tilassa (ei embedding-provideria) suomenkielinen haku on merkittävästi heikompaa.

---

## Muistotyypeillä eri hakustrategiat: tool-usage vs. narratiivinen muisti

**Havaittu:** research-06 jälkeinen keskustelu

Eri muistotyypeillä on fundamentaalisesti eri hakutarpeet:

| Muistotyyppi                  | Paras hakumenetelmä  | Perustelu                                            |
| ----------------------------- | -------------------- | ---------------------------------------------------- |
| Virheviestit, stack tracet    | BM25-painotteinen    | Eksakti merkkijono ratkaisee                         |
| Koodisymbolit, config-avaimet | BM25-painotteinen    | Ei ole parafraasi vaan tarkka token                  |
| Narratiiviset muistot         | Vektori-painotteinen | "Se keskustelu arkkitehtuurista" on semanttinen haku |
| Päätökset ja perustelut       | Hybridi              | Voi hakea sekä sanallisesti että semanttisesti       |

**Ehdotus:** Assosiatiivisessa muistissa voisi olla **erillinen muistipooli (tai muistotyyppi) tool-usage-havainnoille**, jossa hakuparametrit ovat erilaiset – esim. BM25 paino 0.5–0.7 vektorin sijaan. Tämä tarkoittaisi:

1. **Muistotyyppi ohjaa retrieval-strategiaa** – ei pelkästään sisältöä ja assosiaatioita
2. **Tool-usage-muisti** (virheviestit, komentoriviesimerkit, config-ongelmat) saa BM25-painotteisen haun
3. **Narratiivinen muisti** (keskustelut, päätökset, konteksti) saa embedding-painotteisen haun
4. **Hakutyökalu voi etsiä molemmista** ja yhdistää tulokset, tai kohdistaa haun tiettyyn muistotyyppiin

**Lisähyöty:** Tämä lieventää suomen kielen BM25-ongelmaa: narratiiviset muistot (usein suomeksi) painottavat embeddingejä, tekniset muistot (usein englanniksi) painottavat BM25:ttä.

**Kytkös design-dokkiin:** Tämä laajentaa design-dokin muistotyyppiajattelua – tyypit eivät ole vain sisällöllisiä kategorioita vaan vaikuttavat retrieval-strategiaan.

---

## Jaccard-samankaltaisuus konsolidaation työkaluna

**Lähde:** `src/memory/mmr.ts`, rivit 32–68
**Havaittu:** research-06 jälkeinen keskustelu

MMR:ssä käytetty Jaccard-samankaltaisuus soveltuu konsolidaatioon kahdella tavalla:

**1. Lähes-duplikaattien tunnistaminen (halpa esikarsinta):**

- Korkea Jaccard (esim. > 0.6) → muistot ovat lähes identtisiä → yhdistämiskandidaatteja
- Nopea, paikallinen, ei API-kutsuja
- Löytää tapaukset joissa sama asia on kirjattu hieman eri sanoin eri sessioissa

**2. Porrastettu konsolidaatio yhdessä embeddingin kanssa:**

```
Vaihe 1: Jaccard (halpa, nopea)
  → tunnista lähes-duplikaatit ja korkean sana-overlapin parit
  → näille ei tarvitse laskea embeddingiä erikseen

Vaihe 2: Embedding-kosini (kalliimpi)
  → tunnista semanttisesti samankaltaiset mutta eri sanoin ilmaistut muistot
  → vain niille pareille joita Jaccard ei löytänyt
```

Tämä on tehokas, koska Jaccard karsii O(N²)-vertailuista "helpot" tapaukset pois ilman API-kustannuksia.

**Kriittinen rajoite: tokenizer ei tue Unicode-merkkejä.** Nykyinen regex (`/[a-z0-9_]+/g`, rivi 33) tiputtaa pois kaikki ei-ASCII-merkit. Suomenkieliset sanat kuten "päätös", "äänestys", "yhteys" eivät tokenisoidu lainkaan (tai menettävät merkittäviä merkkejä). Konsolidaatiokäytössä tokenizer pitää korvata Unicode-tietoisella versiolla: `/[\p{L}\p{N}_]+/gu` (kuten `buildFtsQuery` jo käyttää, `hybrid.ts` rivi 37).

**Mahdollinen Osa A -ehdotus:** Korjata myös MMR:n tokenizer Unicode-tietoiseksi – tämä parantaa MMR-diversiteettiä kaikille ei-englanninkielisille käyttäjille.
