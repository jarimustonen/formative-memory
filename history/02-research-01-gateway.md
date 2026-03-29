# Raportti F: OpenClaw Gateway -arkkitehtuuri

> **Tutkimus tehty:** 25.2.2026
> **Tarkoitus:** Kattava tekninen kuvaus gatewayn roolista, rakenteesta ja toiminnasta OpenClaw-järjestelmässä.

---

## Tiivistelmä

Gateway on OpenClaw:n **keskuspalvelin** – pitkäkestoinen prosessi, joka yhdistää kaikki viestintäkanavat, AI-agenttijärjestelmän ja asiakasohjelmistot (CLI, selain, mobiili) yhteen pisteeseen. Meidän tapauksessamme se pyörii **Linux-kontissa (Ubuntu)**. Se on WebSocket + HTTP -palvelin, joka:

- **vastaanottaa ja reitittää viestejä** kaikista kanavista (Telegram, Discord, Slack, Signal, iMessage, WhatsApp, Matrix, Teams...)
- **hallitsee AI-agenttien ajoja** – käynnistää, seuraa ja striimaa niiden vastauksia
- **tarjoaa RPC-rajapinnan** (~90+ metodia) WebSocket-yhteyden yli
- **palvelee HTTP-endpointteja** (webhookit, OpenAI-yhteensopiva API, Control UI, Canvas)
- **hallitsee kanavien elinkaarta** (käynnistys, sammutus, auto-restart)

Yhteenveto: ilman gatewayta OpenClaw on pelkkä CLI-työkalu. Gateway tekee siitä **aina päällä olevan viestintäalustan**.

---

## 1. Mikä gateway on?

### Pääsisäänkäyntipiste

| Tiedosto                     | Rooli                                                   |
| ---------------------------- | ------------------------------------------------------- |
| `src/gateway/server.ts`      | Barrel-export (julkinen API)                            |
| `src/gateway/server.impl.ts` | Varsinainen toteutus – `startGatewayServer(port, opts)` |

`startGatewayServer()` käynnistää kaiken:

1. Lataa ja validoi konfiguraation (`~/.openclaw/openclaw.json`)
2. Migroi vanhat config-avaimet
3. Alustaa autentikoinnin (luo tokenin tarvittaessa)
4. Lataa pluginit ja kanavapluginit
5. Luo HTTP/HTTPS-palvelimen + WebSocket-palvelimen
6. Rekisteröi kaikki WS RPC -metodikäsittelijät
7. Käynnistää kanavat, cronin, heartbeatit, health-monitorit, Bonjour-discoverin, Tailscale-exposuren
8. Ajaa `BOOT.md`-agentin (jos olemassa)
9. Palauttaa `{ close }` -kahvan graceful shutdownia varten

### Palautettu tyyppi

```typescript
type GatewayServer = {
  close: (opts?: { reason?: string; restartExpectedMs?: number | null }) => Promise<void>;
};
```

---

## 2. Gateway ja viestintäkanavat

### Kanavaarkkitehtuuri

Gateway käynnistää **kaikki konfiguroidut viestintäkanavat** bootin yhteydessä `ChannelManager`-luokan kautta.

**Käynnistysketju:**

1. `createChannelManager()` (`src/gateway/server-channels.ts`) luo managerin, joka seuraa per-kanava, per-tili tilaa
2. `startGatewaySidecars()` (`src/gateway/server-startup.ts`) kutsuu `startChannels()`
3. Jokainen kanavaplugin toteuttaa `ChannelPlugin`-rajapinnan (`src/channels/plugins/types.plugin.ts`)
4. Pluginin `gateway`-adapteri tarjoaa `startAccount()` ja `stopAccount()`

### Tuetut kanavat

**Ydinkanavat** (`src/`):

| Kanava     | Kohdepalvelu              | Protokolla/API                                       |
| ---------- | ------------------------- | ---------------------------------------------------- |
| `telegram` | Telegram                  | Telegram Bot API (HTTPS long-poll / webhook)         |
| `discord`  | Discord                   | Discord Gateway (WebSocket) + REST API               |
| `slack`    | Slack                     | Slack Events API (HTTP) + Web API                    |
| `signal`   | Signal                    | Signal-CLI (paikallinen daemon, D-Bus/JSON-RPC)      |
| `imessage` | iMessage / Apple Messages | Paikallinen AppleScript/SQLite (vain macOS)          |
| `web`      | WhatsApp                  | WhatsApp Web -protokolla (`@whiskeysockets/baileys`) |

**Laajennuskanavat** (`extensions/`):

| Kanava       | Kohdepalvelu                         | Protokolla/API                                                             | Tunnisteet                                                                                                            |
| ------------ | ------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `msteams`    | Microsoft Teams                      | Azure Bot Framework (`@microsoft/agents-hosting`) + Graph API              | `appId`, `appPassword`, `tenantId` (Azure AD)                                                                         |
| `matrix`     | Matrix-verkko (Element, Synapse ym.) | Matrix Client-Server API (`@vector-im/matrix-bot-sdk`), E2EE-tuki          | `homeserver`, `userId`, `accessToken`                                                                                 |
| `zalo`       | Zalo (Vietnamin pääviestisovellus)   | Zalo Bot API (HTTPS, Telegram-tyyppinen)                                   | `botToken`                                                                                                            |
| `zalouser`   | Zalo (henkilökohtainen tili)         | Epävirallinen reverse-engineered API (`zca`-CLI-binääri), QR-kirjautuminen | Ei tokenia – QR-skannauksella                                                                                         |
| `voice-call` | PSTN-puhelinverkko                   | Twilio / Telnyx / Plivo (valittavissa)                                     | Provider-kohtaiset: `accountSid`+`authToken` (Twilio), `apiKey`+`connectionId` (Telnyx), `authId`+`authToken` (Plivo) |

> **Huom.:** `imessage` ja `signal` vaativat paikallista järjestelmäintegraatiota, joka ei toimi konteissa. `zalouser` on epävirallinen ja käyttö voi johtaa tilin jäädyttämiseen.

### Auto-restart

Channel manager toteuttaa automaattisen uudelleenkäynnistyksen eksponentiaalisella back-offilla:

- Enintään 10 yritystä
- Viive 5s → 5min, kerroin 2x
- Manuaalisesti pysäytetyt kanavat ohitetaan

---

## 3. Mitä gateway tekee ajonaikana?

### 3.1 Viestien vastaanotto ja reititys

#### Yksinkertainen tapaus: Bob ja Alice (henkilökohtainen assistentti)

Järjestelmä tukee useiden käyttäjien useita agentteja monimutkaisilla binding-säännöillä, mutta **yleisin käyttötapaus on yksinkertaisin**: yksi käyttäjä (Bob) ja yksi agentti (Alice). Tällöin reititys on triviaali:

1. Bob lähettää viestin Telegramissa Alice-botille
2. `resolveAgentRoute()` etsii binding-sääntöjä → ei löydy yhtään (tyhjä config)
3. Fallback: `resolveDefaultAgentId()` palauttaa `"main"` (tai ainoan konfiguroidun agentin)
4. Sessioavain: `agent:main:main` (oletus-DM-scope)
5. Viestiä ei torjuta, koska Bob on parituksen kautta sallittulistalla

**Paritusmekanismi (ensimmäinen viesti):**

Ennen kuin Bob voi keskustella Alicen kanssa, hänen täytyy "parittaa" itsensä:

1. Bob lähettää ensimmäisen viestinsä → dmPolicy on `"pairing"` (oletus)
2. Bob ei ole sallittulistalla → Alice vastaa parituskoodilla (esim. `ABCD1234`)
3. Bob (= botin omistaja) hyväksyy: `openclaw pairing approve telegram ABCD1234`
4. Bobin Telegram-ID lisätään sallittulistaan (`~/.openclaw/credentials/telegram-allowFrom.json`)
5. Tästä eteenpäin Bobin viestit menevät suoraan läpi

**DM-käytäntövaihtoehdot** (`session.dmPolicy`):

- `"pairing"` (oletus) – parituskoodi vaaditaan
- `"allowlist"` – vain ennalta konfiguroidut käyttäjät
- `"open"` – kuka tahansa voi puhua botille
- `"disabled"` – DM:t estetty kokonaan

#### Yleinen reititys (useat agentit, monimutkaiset säännöt)

Kun binding-sääntöjä on konfiguroitu, reititys noudattaa **prioriteettijärjestystä:**

| Prioriteetti | Binding               | Selitys                                             |
| ------------ | --------------------- | --------------------------------------------------- |
| 1            | `binding.peer`        | Suora peer-match (tietty käyttäjä → tietty agentti) |
| 2            | `binding.peer.parent` | Ketjun emoviesti                                    |
| 3            | `binding.guild+roles` | Discord-guild + roolit                              |
| 4            | `binding.guild`       | Pelkkä guild                                        |
| 5            | `binding.team`        | Slack-team                                          |
| 6            | `binding.account`     | Tili-kohtainen                                      |
| 7            | `binding.channel`     | Kanava-laajuinen                                    |
| 8            | Oletus                | Oletusagentti (= Bobin Alice)                       |

Meidän käyttötapauksessamme päädytään aina riville 8.

### 3.2 Sessioavaimet ja kontekstin muodostuminen

`src/routing/session-key.ts` rakentaa deterministiset sessioavaimet:

```
agent:main:main                                     # oletus-DM (MEIDÄN TAPAUS)
agent:main:direct:userid123                          # per-peer DM
agent:main:telegram:group:groupid456                 # ryhmäkeskustelu
agent:main:discord:channel:channelid789              # Discord-kanava
agent:main:telegram:default:direct:userid:thread:t1  # ketjutettu
```

**`dmScope`-asetus** (`session.dmScope`) määrää, miten DM-keskustelut eristetään:

| dmScope                      | Sessioavain                              | Merkitys                                                  |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `"main"` (oletus)            | `agent:main:main`                        | **Kaikki DM:t yhdessä sessiossa** – kanavasta riippumatta |
| `"per-peer"`                 | `agent:main:direct:123`                  | Eri sessio per käyttäjä                                   |
| `"per-channel-peer"`         | `agent:main:telegram:direct:123`         | Eri sessio per käyttäjä per kanava                        |
| `"per-account-channel-peer"` | `agent:main:telegram:default:direct:123` | Täysin eriytetty                                          |

#### Esimerkki: Bob viestii Alicelle usealta kanavalta

Oletuksella `dmScope: "main"`, Bobin kaikki DM-viestit päätyvät **samaan sessioon** riippumatta kanavasta:

```
                    ┌─────────────┐
Bob (Telegram) ────►│             │
                    │  Sessio     │     ┌──────────┐
Bob (Discord)  ────►│  agent:     ├────►│  Alice   │
                    │  main:main  │     │  (LLM)   │
Bob (Matrix)   ────►│             │     └──────────┘
                    │  .jsonl     │
                    └─────────────┘
```

**Mitä Alice näkee konteksti-ikkunassaan (agenttiajon aikana):**

```
[Järjestelmäkehote: agentin identiteetti, työkalut, ohjeet]

[Järjestelmäkehote: Inbound Context]
{
  "channel": "matrix",           ← VAIN nykyisen viestin kanava
  "provider": "matrix",
  "chat_type": "direct"
}

[käyttäjä] Hei Alice, muistatko mitä eilen puhuttiin?    ← Telegram-viesti (eilinen)
[assistentti] Kyllä, keskustelimme projektisi aikataulusta...
[käyttäjä] Voitko tarkistaa kalenterin?                   ← Discord-viesti (tänään)
[assistentti] Tarkistin: huomenna on palaveri klo 14...
[käyttäjä] Kiitos! Laita muistutus.                       ← Matrix-viesti (juuri nyt)
```

**Kriittinen havainto:** Sessio-JSONL-tiedosto tallentaa vain raa'at `user`/`assistant`-vuorot **ilman kanavatietoa**. Alice ei voi nähdä aiempien viestien kanavaa – hän tietää vain nykyisen viestin kanavan (system prompt -metadatasta). Keskustelu näyttäytyy yhtenä jatkuvana dialogina.

**Vastauksen reititys oikealle kanavalle:**

Vaikka sessio on jaettu, vastaus menee aina **sille kanavalle, jolta viesti tuli**:

- `OriginatingChannel` ja `OriginatingTo` tallennetaan per-viesti `MsgContext`-rakenteeseen
- `dispatchReplyFromConfig()` käyttää näitä reitittääkseen vastauksen oikeaan kanavaan
- Bobin Telegram-viestiin vastataan Telegramissa, Discord-viestiin Discordissa

```
Bob (Telegram): "Mikä on huomisen sää?"
  → Alice vastaa Telegramissa: "Huomenna on pilvistä..."

Bob (Discord): "Entä ylihuomenna?"         ← jatkaa SAMAA sessiota
  → Alice vastaa Discordissa: "Ylihuomenna aurinkoista..."
```

**Sessiotiedoston sijainti:**

```
~/.openclaw/agents/main/sessions/<uuid>.jsonl
```

Sessiotiedoston formaatti (JSONL – yksi JSON-rivi per merkintä):

```jsonl
{"type":"session","version":1,"id":"abc-123","timestamp":"2026-02-25T10:00:00Z"}
{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Hei Alice"}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Hei Bob!"}]}}
```

### 3.3 Agenttiajojen käynnistys

Agentti voidaan käynnistää **viidellä tavalla:**

| Lähde         | Polku                                                          |
| ------------- | -------------------------------------------------------------- |
| Viestikanava  | Kanava → auto-reply → `resolveAgentRoute()` → `agentCommand()` |
| WebSocket RPC | `chat.send` / `agent` → handler → `agentCommand()`             |
| HTTP webhook  | `POST /hooks/agent` → dispatch                                 |
| Cron          | Ajastettu trigger → agentti                                    |
| CLI           | `openclaw agent --message "..."` → suoraan tai gateway-kautta  |

### 3.4 Agenttitapahtumien striimaus

`createAgentEventHandler()` (`src/gateway/server-chat.ts`) prosessoi agenttitapahtumia ja **broadcastaa** ne kaikille yhdistetyille WebSocket-asiakkaille reaaliajassa:

- Streaming-tokenit (deltat)
- Tool call -tapahtumat
- Completion-tapahtumat
- Heartbeat-suodatus

### 3.5 Cron-ajastus

`buildGatewayCronService()` (`src/gateway/server-cron.ts`) tukee ajastettuja agenttiajoja.

### 3.6 Node-rekisteri

`src/gateway/node-registry.ts` hallitsee yhdistettyjä "nodeja" (etälaskentalaitteet – Mac, iOS, Android):

- Laiteparituksen (`node.pair.*`)
- Etäkutsut (`node.invoke`)
- Push-notifikaatiot (`push.*`)
- Kaksisuuntainen tapahtumien striimaus

---

## 4. Verkkokerros

### 4.1 HTTP-palvelin

`src/gateway/server-http.ts` – `createGatewayHttpServer()` luo HTTP(S)-palvelimen:

| Polku                  | Käsittelijä                      | Tarkoitus                       |
| ---------------------- | -------------------------------- | ------------------------------- |
| `/hooks/*`             | `handleHooksRequest`             | Webhook-sisääntulo              |
| `/v1/tools/invoke`     | `handleToolsInvokeHttpRequest`   | Työkalujen kutsuminen           |
| `/slack/*`             | `handleSlackHttpRequest`         | Slack HTTP -tapahtumat          |
| `/api/channels/*`      | `handlePluginRequest`            | Kanavapluginien HTTP-endpointit |
| `/v1/responses`        | `handleOpenResponsesHttpRequest` | OpenResponses API               |
| `/v1/chat/completions` | `handleOpenAiHttpRequest`        | OpenAI-yhteensopiva API         |
| `/a2ui/*`, `/canvas/*` | Canvas host                      | Canvas/A2UI                     |
| `/`                    | `handleControlUiHttpRequest`     | Selain-Control UI               |

### 4.2 WebSocket-palvelin

`src/gateway/server-ws-runtime.ts` käärii `ws`-kirjaston. Yhteydenkäsittely:

1. Hyväksy WS-yhteys samalla HTTP-palvelimella (upgrade handler)
2. Suorita `connect`-kättely autentikoinnilla (token, salasana tai device auth)
3. Validoi roolit ja scopet
4. Luo `GatewayWsClient` ja seuraa yhteyksiä
5. Reititä RPC-pyynnöt oikeaan käsittelijään

### 4.3 RPC-protokolla

`src/gateway/protocol/` määrittelee:

- `ConnectParams` – autentikointikättely
- `RequestFrame` – asiakas → palvelin RPC-kutsut
- `ResponseFrame` – palvelin → asiakas vastaukset
- `EventFrame` – palvelimen push-tapahtumat
- Versioitu protokolla (`PROTOCOL_VERSION`)

### 4.4 Bind-moodit

| Moodi      | Sidonta                             | Käyttötapaus        |
| ---------- | ----------------------------------- | ------------------- |
| `loopback` | 127.0.0.1                           | Oletus, turvallisin |
| `lan`      | 0.0.0.0                             | Kaikki rajapinnat   |
| `tailnet`  | Tailscale IPv4 (100.64.0.0/10)      | Tailscale-verkko    |
| `auto`     | Loopback ensisijaisesti, LAN varana | Automaattinen       |
| `custom`   | Käyttäjän määrittelemä              | Erikoisjärjestelyt  |

### 4.5 Discovery (Bonjour/mDNS)

Gateway mainostaa itseään lähiverkossa:

- **mDNS** (Bonjour): `_openclaw-gw._tcp`
- **Wide-Area Bonjour** (unicast DNS-SD)
- **Tailscale DNS** -vihjeet

### 4.6 Tailscale-integraatio

`src/gateway/server-tailscale.ts` voi paljastaa gatewayn:

- `tailscale serve` – jaa tailnetissä
- `tailscale funnel` – jaa julkisesti Tailscale Funnelin kautta

---

## 5. Käynnistys ja konfiguraatio

### CLI-komennot

```
openclaw gateway run        # käynnistä gateway etualalla
openclaw gateway health     # terveystarkistus
openclaw gateway status     # tila + probet
openclaw gateway probe      # multi-gateway debug
openclaw gateway call <m>   # raaka RPC-kutsu
openclaw gateway discover   # Bonjour-haku
openclaw gateway install    # asenna järjestelmäpalveluksi
openclaw gateway start      # käynnistä palvelu
openclaw gateway stop       # pysäytä palvelu
openclaw gateway restart    # uudelleenkäynnistä
openclaw gateway uninstall  # poista palvelu
```

### Konfiguraatio (`~/.openclaw/openclaw.json`)

Keskeiset gateway-asetukset:

| Avain                                            | Kuvaus                                               |
| ------------------------------------------------ | ---------------------------------------------------- |
| `gateway.mode`                                   | `"local"` vaaditaan käynnistykseen                   |
| `gateway.port`                                   | WebSocket-portti (oletus 18789)                      |
| `gateway.bind`                                   | Sidontamoodi                                         |
| `gateway.auth.mode`                              | `"token"`, `"password"`, `"none"`, `"trusted-proxy"` |
| `gateway.auth.token`                             | Jaettu autentikointitoken                            |
| `gateway.controlUi.enabled`                      | Control UI päälle/pois                               |
| `gateway.http.endpoints.chatCompletions.enabled` | OpenAI-yhteensopiva API                              |
| `gateway.http.endpoints.responses.enabled`       | OpenResponses API                                    |
| `gateway.tls.*`                                  | TLS-konfiguraatio                                    |
| `gateway.tailscale.mode`                         | `"off"`, `"serve"`, `"funnel"`                       |
| `gateway.channelHealthCheckMinutes`              | Kanavien terveyspollin väli                          |

### Hot-reload

`src/gateway/config-reload.ts` – gateway tarkkailee `~/.openclaw/openclaw.json`-tiedostoa ja soveltaa muutoksia lennossa (kanavat, hookit, heartbeat, cron, selainohjaus) tai käynnistää uudelleen tarvittaessa.

### Järjestelmäpalvelu (daemon)

`src/cli/daemon-cli/lifecycle.ts` tukee gatewayn asentamista palveluksi:

| Alusta  | Palvelunhallinta                         |
| ------- | ---------------------------------------- |
| macOS   | launchd LaunchAgent (`bot.molt.gateway`) |
| Linux   | systemd user service                     |
| Windows | schtasks                                 |

---

## 6. Gateway Linux-kontissa (meidän käyttötapaus)

OpenClaw-gateway tukee useita ajotapoja. **Meidän tapauksessamme** gateway pyörii Linux-kontissa (Ubuntu), ei macOS:n menubar-sovelluksena.

### Konttikäyttö

Kontissa gateway käynnistetään suoraan etualaprosessina:

```bash
openclaw gateway run --bind loopback --port 18789 --force
```

Tai taustalla (esim. kontin PID 1 -prosessina):

```bash
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
```

### Daemon-tuki Linuxissa

Vaihtoehtoisesti gateway voidaan asentaa systemd user serviceksi:

```bash
openclaw gateway install   # luo ~/.config/systemd/user/openclaw-gateway.service
openclaw gateway start     # käynnistää palvelun
openclaw gateway status    # tarkistaa tilan
```

### Mitä EI ole käytettävissä kontissa

| Ominaisuus             | Syy                                                    |
| ---------------------- | ------------------------------------------------------ |
| iMessage-kanava        | Vaatii macOS:n (AppleScript/SQLite)                    |
| Signal (mahdollisesti) | Vaatii signal-cli -daemonin asentamisen konttiin       |
| Bonjour/mDNS discovery | Ei hyödyllinen konttien välillä                        |
| Mac-sovellus (menubar) | macOS-only; kontissa käytetään CLI:tä ja Control UI:ta |

### Muut client-yhteydet konttiin

Vaikka Mac-sovellusta ei käytetä, gatewayhin voi silti yhdistää:

- **Control UI** (selain): `http://localhost:18789/` (jos `controlUi.enabled: true`)
- **CLI**: `openclaw gateway call <method>` samassa kontissa
- **Mobiilisovellukset**: SSH-tunneli tai Tailscale konttiin
- **OpenAI-yhteensopiva API**: `POST http://localhost:18789/v1/chat/completions`

> **Huom.:** Mac-sovelluksen arkkitehtuuri (launchd, `GatewayConnectivityCoordinator.swift`, `ControlChannel`) on dokumentoitu koodissa mutta ei koske meidän käyttötapaustamme.

---

## 7. Arkkitehtuurikaavio (Linux-kontti, yksittäinen käyttäjä)

```
                    Bob
                     │
        ┌────────────┼────────────┐
        │            │            │
   Telegram      Discord      Matrix
        │            │            │
        ▼            ▼            ▼
┌────────────────────────────────────────────────────┐
│              LINUX-KONTTI (Ubuntu)                  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │           GATEWAY SERVER (:18789)             │  │
│  │                                              │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │ Channel Manager                        │  │  │
│  │  │  ┌──────────┬──────────┬────────────┐  │  │  │
│  │  │  │ Telegram │ Discord  │  Matrix     │  │  │  │
│  │  │  │ Bot API  │ Gateway  │  CS API     │  │  │  │
│  │  │  └────┬─────┴────┬─────┴─────┬──────┘  │  │  │
│  │  └───────┼──────────┼───────────┼─────────┘  │  │
│  │          │          │           │              │  │
│  │          ▼          ▼           ▼              │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │ Routing: resolveAgentRoute()           │  │  │
│  │  │ → ei bindingeja → oletus: "main"       │  │  │
│  │  └──────────────────┬─────────────────────┘  │  │
│  │                     │                         │  │
│  │                     ▼                         │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │ Sessio: agent:main:main                │  │  │
│  │  │ (yksi jaettu JSONL-tiedosto)           │  │  │
│  │  │                                        │  │  │
│  │  │ [user] Hei Alice        (← Telegram)   │  │  │
│  │  │ [asst] Hei Bob!                        │  │  │
│  │  │ [user] Tarkista kalenteri (← Discord)  │  │  │
│  │  │ [asst] Huomenna palaveri...            │  │  │
│  │  │ [user] Kiitos!           (← Matrix)    │  │  │
│  │  └──────────────────┬─────────────────────┘  │  │
│  │                     │                         │  │
│  │                     ▼                         │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │ Alice (Pi agent → LLM API)             │  │  │
│  │  │ Näkee: koko keskusteluhistoria          │  │  │
│  │  │ Tietää: nykyisen viestin kanavan        │  │  │
│  │  └──────────────────┬─────────────────────┘  │  │
│  │                     │                         │  │
│  │          ┌──────────┼───────────┐             │  │
│  │          ▼          ▼           ▼             │  │
│  │     Telegram    Discord     Matrix            │  │
│  │     (vastaus    (vastaus    (vastaus           │  │
│  │      takaisin)  takaisin)   takaisin)         │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  Muut palvelut: Cron, Config hot-reload,           │
│  Control UI (selain), OpenAI-compat API            │
└────────────────────────────────────────────────────┘
```

---

## 8. Yhteenveto: Gatewayn merkitys kokonaisarkkitehtuurissa

Gateway on **koko OpenClaw-järjestelmän sydän**. Se on pitkäkestoinen daemon-prosessi, joka tekee OpenClaw:sta pelkän CLI-työkalun sijaan **aina päällä olevan viestintäalustan**.

| Ilman gatewayta               | Gatewayn kanssa                                |
| ----------------------------- | ---------------------------------------------- |
| Agentti ajetaan käsin CLI:stä | Agentit reagoivat viesteihin automaattisesti   |
| Yksi kanava kerrallaan        | Kaikki kanavat samanaikaisesti                 |
| Ei reaaliaikaista striimausta | WebSocket-striimaus kaikille asiakkaille       |
| Ei etäkäyttöä                 | CLI, selain (Control UI), mobiili, etägateway  |
| Ei ajastusta                  | Cron-ajetut agentit                            |
| Ei laitehallintaa             | Node-rekisteri, paritukset, push-notifikaatiot |

Gateway on siis **hub-and-spoke -mallinen keskussolmu**: kanavat, asiakassovellukset ja agenttijärjestelmä kaikki yhdistyvät siihen, ja se orkestroi viestien kulkua niiden välillä.
