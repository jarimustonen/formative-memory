# TODO – Assosiatiivinen muisti (Context Engine v2)

> Plugin OpenClaw:lle. Yksityiskohtaiset tehtävät: `issues/open/`

## Tilanne (2026-04-16)

**Valmista:** v0.3.0 julkaistu. Infrastruktuuri, MemoryManager, context engine (Phase 3), konsolidaatio (Phase 4), `/memory sleep` komento, CLI-työkalu (Phase 5), memory-core-migraatio, embedding provider -integraatio, autoCapture + JSONL-session import (v0.2), standalone embedding provider + auth-profiles.json (v0.3), cron trigger interception fix (#21). DB on kanoninen datalähde. Live-testattu jarin botilla.

**Seuraava:** P1-paketti (deploy-testaus uusimpaan OpenClawiin: #30 startup-palvelut, #24 embedding-providerit, #26 manifest compliance), sitten #11 README ja GTM.

## Avoimet issuet

| #  | Issue | Tyyppi | Status |
|----|-------|--------|--------|
| 08 | [Upstream PRs to OpenClaw](issues/open/08-upstream-prs/item.md) | chore | open (2/4 submitoitu, odottaa reviewiä) |
| 10 | [Go-to-market](issues/open/10-go-to-market/item.md) | epic | open |
| 11 | [Public-facing README.md](issues/open/11-readme/item.md) | task | in-progress |
| 14 | [Consolidation detailed logging](issues/open/14-consolidation-detailed-logging/item.md) | feature | in-progress |
| 18 | [Salience profile for autoCapture](issues/open/18-salience-profile/item.md) | feature | open |
| 19 | [Extraction CoT reasoning](issues/open/19-extraction-cot/item.md) | improvement | open (deferred) |
| 22 | [Context engine SDK updates](issues/open/22-context-engine-sdk-updates/item.md) | improvement | open |
| 23 | [SDK provider auth APIs](issues/open/23-sdk-provider-auth-apis/item.md) | improvement | open |
| 24 | [Test new embedding providers](issues/open/24-test-new-embedding-providers/item.md) | task | open |
| 25 | [Active Memory coexistence](issues/open/25-active-memory-coexistence/item.md) | task | open |
| 26 | [Plugin manifest compliance](issues/open/26-plugin-manifest-compliance/item.md) | chore | open |
| 27 | [FTS fallback for embedding-free mode](issues/open/27-fts-fallback/item.md) | feature | open |
| 28 | [Task Flow integration for consolidation](issues/open/28-task-flow-consolidation/item.md) | feature | open |
| 30 | [Test automatic startup services](issues/open/30-test-automatic-startup-services/item.md) | task | open |
