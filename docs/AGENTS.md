# docs/ — OpenClaw Release Impact Tracking

Tämä hakemisto sisältää plugin-dokumentaation sekä OpenClaw-julkaisujen vaikutusseurannan.

## openclaw-release-impact.md — Ylläpito-ohje

### Tarkoitus

`openclaw-release-impact.md` seuraa OpenClaw-pääohjelman julkaisuja ja arvioi niiden vaikutukset tähän associative-memory -pluginiin. Jokainen julkaisu arvioidaan erikseen.

### Miten uusi julkaisu arvioidaan

1. **Päivitä openclaw-repo** — Hae uusin koodi viereisestä `../openclaw`-reposta:
   ```bash
   cd ../openclaw && git fetch --tags && git pull
   ```

2. **Lue CHANGELOG** — Avaa `../openclaw/CHANGELOG.md` ja etsi uuden version osio.

3. **Suodata pluginiin vaikuttavat muutokset** — Keskity näihin avainsanoihin:
   - `Plugin`, `plugin-sdk`, `Plugins/` — SDK-rajapinnan muutokset
   - `Memory`, `memory-core`, `QMD` — Muistipalvelun muutokset
   - `Context engine`, `assemble`, `compact`, `compaction` — Kontekstimoottorin muutokset
   - `Embedding`, `embed` — Embedding-providerien muutokset
   - `Agents/tools`, `registerTool` — Työkalurekisteröinnin muutokset
   - `Breaking` — Kaikki breaking changes

4. **Arvioi vaikutustaso:**
   - 🟢 **Ei vaikutusta** — Muutokset eivät koske pluginin rajapintoja
   - 🟡 **Kohtalainen** — Uusia ominaisuuksia joita voisi hyödyntää, tai pieniä yhteensopivuuskysymyksiä
   - 🔴 **Merkittävä** — Breaking changes tai rajapintamuutoksia jotka vaativat koodimuutoksia

5. **Tarkista konkreettiset vaikutukset** vertaamalla muutoksia pluginin rajapintapintoihin:

   | Tiedosto | Rajapinta | Mitä tarkistaa |
   |---|---|---|
   | `src/index.ts` | `OpenClawPluginApi` | `register()`, `registerTool()`, `registerMemoryPromptSection()`, `registerContextEngine()`, `registerCommand()` |
   | `src/index.ts` | Embedding Registry | `getMemoryEmbeddingProvider()`, `listMemoryEmbeddingProviders()`, `MemoryEmbeddingProvider` |
   | `src/context-engine.ts` | `ContextEngine` | `assemble()`, `afterTurn()`, `compact()`, `dispose()`, `ingest()` |
   | `src/context-engine.ts` | Compaction | `delegateCompactionToRuntime()` |
   | `package.json` | Versiovaatimus | `peerDependencies.openclaw` |

6. **Kirjaa toimenpiteet** — Listaa konkreettiset tehtävät checklistinä.

7. **Päivitä tiedosto** — Täytä version osio `openclaw-release-impact.md`:ssä.

### OpenClaw-repo sijainti

Pääohjelman repo löytyy suhteellisesta polusta `../openclaw`. CHANGELOG on `../openclaw/CHANGELOG.md`. Tagit vastaavat julkaisuja (esim. `v2026.3.28`).

### Git-diffin käyttö tarkempaan analyysiin

Jos CHANGELOG ei riitä, voit tutkia tarkkoja koodimuutoksia:

```bash
# Memory host SDK ja memory-core muutokset kahden version välillä
cd ../openclaw
git diff v2026.3.24..v2026.3.28 -- packages/memory-host-sdk/ extensions/memory-core/

# Etsi tiettyä rajapintamuutosta
git log v2026.3.24..v2026.3.28 --oneline -- packages/memory-host-sdk/

# Plugin-runtimeen vaikuttavat muutokset (laajempi haku)
git log v2026.3.24..v2026.3.28 --oneline --grep="plugin" --grep="memory" --grep="context engine" --all-match
```
