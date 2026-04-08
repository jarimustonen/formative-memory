---
created: 2026-04-08T18:45:00+03:00
source_branch: main
task: Plan Go-to-Market strategy, website, README, repo cleanup
---

# Task: Go-to-Market -suunnittelu

## Objective

Suunnittele Go-to-Market -kokonaisuus: verkkosivut, README, repon siivous julkaisua varten. Tämä on **suunnitteluvaihe** — ei vielä täysi toteutus, mutta konkreettiset artefaktit.

## Context

TODO.md GTM-osio:
- GTM-strategian toteutus: `history/plan-gtm-formativememory.md`
- Landing page (formativememory.ai)
- README.md uudelleenkirjoitus GTM-suunnitelman mukaan
- Kanavajulkaisut (HN, Reddit, Discord, X)

Plugin on teknisesti toimiva ja live-testattu. Nyt pitää valmistella julkinen julkaisu.

## Tehtävät

### 1. Verkkosivusuunnitelma
- Lue olemassa oleva GTM-suunnitelma: `history/plan-gtm-formativememory.md`
- Suunnittele kotisivun rakenne ja sisältö (formativememory.ai)
- Teknologiavalinnat: staattinen generaattori (Astro, Next.js, Hugo?), hosting, domain
- Sisältörakenne: hero, features, how it works, getting started, demo/screenshots
- Verkkosivut menevät todennäköisesti eri repoon, mutta suunnitelma tehdään tähän

### 2. README.md
- Kirjoita uusi README.md joka on julkaisukelpoinen
- Kohderyhmä: OpenClaw-käyttäjät jotka haluavat paremman muistin
- Rakenne: lyhyt intro, ominaisuudet, asennus, konfiguraatio, käyttö, arkkitehtuuri
- Käytä `/llm-collab` hyvän README:n ideointiin

### 3. Repon siivous julkaisua varten
- Inventoi mitä pitää siivota ennen julkaisua
- history/-kansion sisältö: pitääkö joitain poistaa tai siirtää?
- Git-historia: pitääkö squashata tai siivota?
- Onko arkaluontoista dataa (API-avaimet, henkilökohtaista dataa)?
- .gitignore: onko kattava?
- License: mikä lisenssi?

### 4. Kanavajulkaisusuunnitelma
- HN: mikä on hook/tarina?
- Reddit: mitkä subredditit?
- Discord: mitkä serverit?
- X: mikä sisältöstrategia?

## Files to Examine

- history/plan-gtm-formativememory.md — olemassa oleva GTM-suunnitelma
- README.md — nykyinen (jos löytyy)
- package.json — nimi, kuvaus
- history/ — mitä pitää siivota
- .gitignore
- LICENSE (jos löytyy)

## Success Criteria

- Verkkosivusuunnitelma: `history/plan-website.md` (rakenne, teknologia, sisältö)
- README.md -luonnos (tai valmis versio)
- Repon siivoussuunnitelma: `history/plan-repo-cleanup.md`
- Kanavajulkaisusuunnitelma osana GTM-dokumenttia
- Käytä `/llm-collab` ja `/llm-review` skillejä

## Workflow

You implement the task. When complete, the user will review your changes.
The user should commit all changes using `/commit`.
The user should finalize and merge worktree with `/worktree-merge`.
