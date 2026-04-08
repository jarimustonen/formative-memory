---
created: 2026-04-08T19:00:00+03:00
source_branch: main
task: Research sleep architecture — scheduled consolidation, REM-like learning, biological concepts
---

# Task: Nukkumisarkkitehtuurin tutkimus — aikataulutettu konsolidaatio ja REM-oppiminen

## Objective

Tutki miten meidän pluginin nukkumisarkkitehtuuri pitäisi kehittyä. Tämä EI ole pelkkä OpenClaw dreaming -vertailu vaan **syvempi konseptitutkimus** biologisista unimalleista, koneoppimisen konsolidaatiotekniikoista ja siitä miten ne voisivat rikastaa meidän muistijärjestelmää.

Kaksi jo päätettyä asiaa:
1. **Nukkuminen vakioaikataululla** — nykyinen manuaalinen `/memory sleep` pitää korvata tai täydentää automaattisella aikataululla (kuten OpenClaw:n cron-pohjainen malli)
2. **REM-tyyppinen oppiminen** — konsolidaation lisäksi haluamme vaiheen joka **jalostaa** muistojen informaatiota: tunnistaa teemoja, tekee yleistyksiä, löytää piilotettuja yhteyksiä

## Tutkimuskysymykset

### A. Biologiset unimallit — mitä konsepteja voimme ottaa?

Tutki biologista unta ja muistin konsolidaatiota:

- **Slow-wave sleep (SWS)**: hippocampus → neocortex transfer, muistojen vahvistaminen. Miten tämä vastaa meidän decay/reinforcement-vaihetta?
- **REM sleep**: muistojen uudelleenaktivointi, luovat yhdistelmät, emotionaalinen prosessointi. Miten tämä voisi ilmetä muistijärjestelmässä? Teema-analyysi, yleistykset, abstraktioiden luominen?
- **Sleep spindles**: lyhyet muistojen uudelleentoistot, synaptic consolidation. Voisiko tämä olla "micro-consolidation" joka tapahtuu useammin?
- **Synaptic homeostasis hypothesis (SHY)**: Päivän aikana synapsit vahvistuvat, uni normalisoi ne. Miten tämä suhtautuu meidän decay-mekanismiin?
- **Memory replay**: Hippocampus toistaa päivän kokemuksia unessa. Voisiko meidän järjestelmä "toistaa" päivän interaktioita ja oppia niistä?
- **Complementary Learning Systems (CLS)**: Nopea hippocampus-oppiminen + hidas neokorteksi-integraatio. Working → consolidated -siirtymä on jo tämän kaltainen, mutta voisiko olla syvempi?

### B. Monivaiheinen nukkuminen

- Pitäisikö meidän jakaa nykyinen 10-vaiheinen sleep useampaan itsenäiseen vaiheeseen?
- Millaiset vaiheet? Esim:
  - **Light sleep**: nopea, kevyt — decay, pruning, temporal shifts (usein, esim. 6h)
  - **Deep sleep**: perusteellinen — merge, vahvistus, assosiaatiot (päivittäin)
  - **REM**: luova — teema-analyysi, yleistykset, abstraktiot, uudet assosiaatiot (harvemmin, esim. viikoittain)
- Mikä on oikea aikataulurakenne?

### C. REM-oppiminen konkreettisesti

Tämä on tutkimuksen ydin. Mitä "REM-oppiminen" voisi tarkoittaa muistijärjestelmässä?

- **Teema-analyysi**: LLM analysoi muistoklustereita, tunnistaa toistuvia teemoja, kirjoittaa "meta-muistoja" jotka tiivistävät teeman
- **Abstraktioiden luominen**: "Käyttäjä piti kokouksen maanantaina + tiistaina + keskiviikkona" → "Käyttäjällä on säännöllisiä kokouksia alkuviikosta"
- **Ristiriitojen tunnistus**: Löytää muistoja jotka ovat keskenään ristiriidassa
- **Assosiaatioiden rikastus**: Löytää piilotettuja yhteyksiä jotka eivät syntyneet co-retrieval:sta
- **Predictiiviset muistot**: "Käyttäjä tekee aina X ennen Y:tä" -tyyppiset ennusteet
- **Muistojen luottamusarviointi**: Arvioi muistojen todennäköistä oikeellisuutta kontekstin perusteella
- **Mitä muuta?** Ideoi vapaasti

### D. Koneoppimisen konsolidaatiotekniikat

- Experience replay (DQN, offline RL)
- Catastrophic forgetting prevention (EWC, progressive neural networks)
- Knowledge distillation — voiko suuresta muistomassasta "tislata" tiivistettyä tietoa?
- Curriculum learning — pitäisikö muistojen käsittelyjärjestyksellä olla merkitystä?

### E. OpenClaw dreaming -vertailu

Lue OpenClaw:n toteutus vertailukohdaksi:
- `/Users/jari/Sources/openclaw/extensions/memory-core/src/sleep.ts`
- `/Users/jari/Sources/openclaw/extensions/memory-core/src/dreaming.ts`
- `/Users/jari/Sources/openclaw/extensions/memory-core/src/short-term-promotion.ts`
- `/Users/jari/Sources/openclaw/src/memory-host-sdk/sleep.ts`

Mutta tämä on vain yksi lähde — emme kopioi heidän ratkaisuaan, vaan etsimme omaa tietämme.

## Meidän nykyinen toteutus

- src/consolidation.ts — konsolidaation entrypoint
- src/consolidation-steps.ts — 10 vaihetta
- src/merge-execution.ts — LLM-merge
- history/plan-context-engine-architecture-v2.md — arkkitehtuuri
- history/analysis-dreaming-vs-consolidation.md — aiempi vertailuanalyysi

## Työskentelytapa

1. **Lue meidän nykyinen konsolidaatio** perusteellisesti
2. **Lue OpenClaw dreaming** vertailukohdaksi
3. **Käytä `/llm-collab`** laajaan ideointiin — anna Geminin ja Codexin brainstormata biologisia konsepteja, koneoppimisen tekniikoita, ja luovia sovelluksia muistijärjestelmään
4. **Käytä `/llm-review`** arvioimaan ehdotuksia — kriittinen arvio toteutettavuudesta, monimutkaisuudesta ja lisäarvosta
5. **Kirjoita tutkimusdokumentti** `history/analysis-sleep-architecture.md`

## Success Criteria

- Perusteellinen tutkimusdokumentti `history/analysis-sleep-architecture.md`
- Biologisten unimallien soveltaminen muistijärjestelmään — konkreettiset konseptit
- REM-oppimisen konkreettinen suunnitelma (mitä se tekee, miten se toimii)
- Monivaiheisen nukkumisen arkkitehtuuriehdotus
- Priorisoidut kehitysehdotukset
- `/llm-collab` ja `/llm-review` käytetty

## Workflow

You implement the task. When complete, the user will review your changes.
The user should commit all changes using `/commit`.
The user should finalize and merge worktree with `/worktree-merge`.
