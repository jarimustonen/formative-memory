---
created: 2026-04-08T18:45:00+03:00
source_branch: main
task: Design and implement broad recall for open-ended queries
merged: 2026-04-08T20:19:13+03:00
commits:
  - hash: 1a3e150
    message: "feat: add memory_browse tool for broad recall"
  - hash: 088c4cb
    message: "docs: add worktree prompt for feat-broad-recall"
---

# Task: Metahaku (Broad Recall) — Phase 7

## Objective

Suunnittele ja toteuta metahaku-funktio joka tunnistaa avoimet/laajat kysymykset ja hakee monipuolisesti. Tämä korjaa live-testauksessa löydetyn ongelman: "Kerro mitä muistat minusta?" palauttaa vain 5 satunnaista osumaa.

## Context

TODO.md Phase 7 kuvaus:
> **Ongelma:** Nykyinen recall käyttää viimeistä käyttäjäviestiä raakana hakuna. "Kerro mitä muistat minusta?" ei ole hyvä BM25/embedding-query — se on metakysymys joka tarvitsee laajan katsauksen, ei yksittäistä faktamatchausta. Tulos: palautuu 5 satunnaista osumaa vahvojen ja relevanttien muistojen sijaan.
>
> **Ratkaisu:** Erillinen metahaku-funktio joka tunnistaa avoimet/laajat kysymykset ja hakee monipuolisesti: top-by-strength, per-type-sampling, kategoriahaku. Normaali recall jatkaa toimimaan tarkkoihin kysymyksiin.
>
> **Harkittavia lähestymistapoja:** query rewriting (LLM tiivistää hakutermiksi), monihaku (useita queryja eri näkökulmista), budget-nosto geneerisille kysymyksille, top-by-strength fallback

## Työskentelytapa

1. **Lue nykyinen recall-toteutus** — context-engine.ts assemble(), memory-manager.ts recall/search
2. **Suunnittele** — kirjoita suunnitelma `history/plan-broad-recall.md`
3. **Käytä `/llm-collab`** ideointiin eri lähestymistavoista
4. **Toteuta testit edellä** — YAML-fixtuurit, unit-testit ennen koodia
5. **Toteuta** — metahaku-logiikka, integraatio assemble():en
6. **Käytä `/llm-review`** koodin arviointiin

## Files to Examine

- src/context-engine.ts — assemble(), extractLastUserMessage(), recallLimitForBudget()
- src/memory-manager.ts — recall(), search()
- src/db.ts — getMemoriesByStrength(), FTS-haku, embedding-haku
- TODO.md — Phase 7 kuvaus
- history/plan-context-engine-architecture-v2.md — arkkitehtuuri

## Success Criteria

- Suunnitelma `history/plan-broad-recall.md`
- Metahaku-tunnistuslogiikka (onko query avoin/laaja vai spesifinen)
- Monipuolinen haku: top-by-strength, per-type sampling, mahdollisesti query rewriting
- Integraatio assemble()-funktioon
- Testit: metahaku-tunnistus, monipuoliset tulokset, normaali recall ei muutu
- Kaikki olemassa olevat testit menevät läpi

## Workflow

You implement the task. When complete, the user will review your changes.
The user should commit all changes using `/commit`.
The user should finalize and merge worktree with `/worktree-merge`.
