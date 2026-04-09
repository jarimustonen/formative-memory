# TODO – Assosiatiivinen muisti (Context Engine v2)

> Plugin OpenClaw:lle. Yksityiskohtaiset tehtävät: `issues/open/`

## Tilanne (2026-04-08)

**Valmista:** Infrastruktuuri, MemoryManager, context engine (Phase 3), konsolidaatio (Phase 4), `/memory sleep` komento, CLI-työkalu (Phase 5), memory-core-migraatio (Phase 6.1–6.2), embedding provider -integraatio (Phase 6.5), OpenClaw release impact -katselmus (v2026.3.24–v2026.4.8). DB on kanoninen datalähde (markdown-tiedostot poistettu). Migraatio ja workspace-siivous ajetaan automaattisesti (lazy init) ensimmäisellä tool-kutsulla. Live-testattu Sylvialla.

**Seuraava:** Live-testaus ja stabilointi. Go-to-Market.

## Avoimet issuet

| #  | Issue | Tyyppi | Status |
|----|-------|--------|--------|
| 01 | [Context engine integration (Phase 3)](issues/open/01-context-engine-integration/item.md) | epic | in-progress |
| 02 | [Consolidation / sleep process (Phase 4)](issues/open/02-consolidation-sleep-process/item.md) | epic | open |
| 03 | [Broad recall — memory_browse tool](issues/open/03-broad-recall-memory-browse/item.md) | feature | open |
| 04 | [Scheduled / automated consolidation](issues/open/04-scheduled-consolidation/item.md) | feature | open |
| 05 | [Schema validation — enum guards and numeric integrity](issues/open/05-schema-validation/item.md) | improvement | open |
| 06 | [Delta-merge optimization + promotion bugfix](issues/open/06-delta-merge-promotion-bugfix/item.md) | improvement | open |
| 07 | [Embedding provider integration — use OpenClaw SDK](issues/open/07-embedding-provider-integration/item.md) | task | open |
| 08 | [Upstream PRs to OpenClaw](issues/open/08-upstream-prs/item.md) | chore | open |
| 09 | [Memory-core migration — remaining work](issues/open/09-memory-core-migration-remaining/item.md) | task | open |
| 10 | [Go-to-market](issues/open/10-go-to-market/item.md) | epic | open |
