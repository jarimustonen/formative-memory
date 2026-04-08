---
created: 2026-04-08T18:45:00+03:00
source_branch: main
task: Research runtime schema validation for DB layer
---

# Task: Runtime-skeemavalidointi DB-kerrokseen — tutkimus

## Objective

Tutki sopiiko Zod, olemassa oleva typebox, tai jokin muu lähestymistapa DB-rivien, AfterTurnParams-sisääntulon ja transcript-parsintarajapintojen runtime-validointiin. Tämä on **tutkimus, ei toteutus** — ei kiireellinen, tehdään perusteellisesti.

## Context

Projektissa on `@sinclair/typebox` tool-parametreissa ja käsin kirjoitetut TypeScript-tyypit + `as`-castit DB-riveille. Revieweissä toistuva löydös: evidence/mode-stringeille ei ole CHECK-rajoitteita eikä runtime-validointia, `unknown[]`-tyypitys transkriptiparsinnassa.

TODO.md:n avoin kysymys:
> Tutkittava: sopiiko Zod (tai olemassa oleva typebox) DB-rivien, AfterTurnParams-sisääntulon ja transcript-parsintarajapintojen runtime-validointiin? Huomioitava: kahden skeemakirjaston ylläpitokustannus vs. hyöty, SQLiten TEXT-kenttien luonne, validointikerroksen sijainti (DB-luku vs. rajapinta).

## Tutkimuskysymykset

1. **Mikä kirjasto?** Zod, typebox (jo riippuvuus), valibot, tai joku muu? Bundlekoko, ergonomia, typebox-integraatio.
2. **Missä validoidaan?** DB-luku (rowToMemory jne.), rajapinta (AfterTurnParams), transcript-parsinta, vai kaikissa?
3. **Kustannus vs. hyöty?** Kahden skeemakirjaston ylläpito? Voisiko typebox korvata molemmat tarpeet?
4. **SQLite CHECK -rajoitteet?** Pitäisikö evidence/mode/source -stringeille lisätä CHECK-rajoitteet DB-tasolle?
5. **Performance?** Validoinnin overhead hot pathilla (assemble, afterTurn)?
6. **Miten muut tekevät?** Katso miten OpenClaw:n memory-core käsittelee vastaavan ongelman.

## Files to Examine

Meidän koodi:
- src/db.ts — rowToMemory, as-castit
- src/after-turn.ts — AfterTurnParams, transcript-parsinta
- src/context-engine.ts — unknown[]-tyypit
- src/memory-manager.ts — tyyppimäärittelyt
- src/config.ts — typebox-käyttö tool-parametreissa
- package.json — nykyiset riippuvuudet

OpenClaw (vertailu):
- /Users/jari/Sources/openclaw/extensions/memory-core/src/ — miten he validoivat

## Success Criteria

- Tutkimusdokumentti `history/analysis-schema-validation.md`
- Vertailu vaihtoehdoista (taulukko)
- Konkreettinen suositus: tehdäänkö vai ei, ja jos tehdään, millä lähestymistavalla
- Käytä `/llm-collab` ja/tai `/llm-review` skillejä arviointiin

## Workflow

You implement the task. When complete, the user will review your changes.
The user should commit all changes using `/commit`.
The user should finalize and merge worktree with `/worktree-merge`.
