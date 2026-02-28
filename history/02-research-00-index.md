# Assosiatiivinen muisti – Tutkimus- ja suunnitteludokumentaatio

> **Projekti:** Assosiatiivisen muistin plugin OpenClaw:lle
> **Aloitettu:** 25.2.2026

---

## Tavoite

Rakentaa OpenClaw-plugin, joka toteuttaa assosiatiivisen muistijärjestelmän `01-idea-associative-memory-plugin.md`:n ideoiden pohjalta. Työ edellyttää sekä itse pluginin kehittämistä että OpenClaw-järjestelmän muutoksia.

## Työn jako kahteen osaan

### Osa A: OpenClaw-järjestelmän muutokset

Asioita, joita nykyinen järjestelmä ei välttämättä tue tai jotka pitää muuttaa, jotta plugin voi toimia. Koottu lista: `02-research-07-observations.md`, sektio "Osa A".

### Osa B: Itse plugin

Assosiatiivisen muistin plugin. Suunnittelu: `03-design-00-index.md`.

---

## Dokumenttisarjat

### 01 – Idea

| Tiedosto                                | Sisältö                                         | Tila  |
| --------------------------------------- | ----------------------------------------------- | ----- |
| `01-idea-associative-memory-plugin.md`  | Alkuperäiset suunnittelumuistiinpanot (Jarin ideat) | Valmis |

### 02 – Research (OpenClaw:n ymmärtäminen)

| #  | Tiedosto                                        | Sisältö                                                    | Tila      |
| -- | ----------------------------------------------- | ---------------------------------------------------------- | --------- |
| 00 | `02-research-00-index.md`                       | Tämä indeksi                                               | –         |
| 01 | `02-research-01-gateway.md`                     | Gateway-arkkitehtuuri: viestien vastaanotto ja reititys     | Valmis    |
| 02 | `02-research-02-core-concepts.md`               | Peruskäsitteet: sessio, bootstrap, konteksti-ikkuna        | Valmis    |
| 03 | `02-research-03-agent-system.md`                | Agenttijärjestelmä: agenttinen looppi, LLM-kutsut, työkalut| Valmis    |
| 04 | `02-research-04-hooks-and-pi-agent-boundary.md` | Hook-järjestelmä ja pi-coding-agent-rajapinta              | Valmis    |
| 05 | `02-research-05-plugins.md`                     | Plugin-järjestelmä: lataus, rekisteröinti, SDK              | Valmis    |
| 06 | `02-research-06-current-memory.md`              | Nykyinen muistijärjestelmä: SQLite, chunking, hybrid-haku  | Valmis    |
| 07 | `02-research-07-observations.md`                | Havainnot, avoimet kysymykset ja Osa A -muutokset          | Käynnissä |
| 08 | `02-research-08-references.md`                  | Lähdetiedostot koodikannasta (viittausindeksi)             | Käynnissä |

### 03 – Design (uuden muistimallin suunnittelu)

| #  | Tiedosto                         | Sisältö                                                          | Tila    |
| -- | -------------------------------- | ---------------------------------------------------------------- | ------- |
| 00 | `03-design-00-index.md`          | Design-indeksi ja vaiheistussuunnitelma                          | –       |
| 01 | `03-design-01-data-model.md`     | Tietomalli: muisto-olio, muistotyypit, content hash, skeema      | Tulossa |
| 02 | `03-design-02-associations.md`   | Assosiaatiot: rakenne, tyypit, painot, päivitysmekaniikat         | Tulossa |
| 03 | `03-design-03-lifecycle.md`      | Muistin elinkaari: luonti, temporaalinen tila, tick, decay        | Tulossa |
| 04 | `03-design-04-retrieval.md`      | Haku: retrieval-pipeline, assosiaatio-boosting, strategiat        | Tulossa |
| 05 | `03-design-05-consolidation.md`  | Konsolidaatio: "uni", Jaccard + embedding, REM-vaihe             | Tulossa |
| 06 | `03-design-06-integration.md`    | Integraatio: plugin-rakenne, hookit, Osa A -riippuvuudet         | Tulossa |
| 07 | `03-design-07-migration.md`      | Migraatio: memory-core → assosiatiivinen muisti, rollback        | Tulossa |

---

## Oppimispolku

```
01 Idea (alkuperäiset ajatukset)
  ↓
02 Research (ymmärrä nykyjärjestelmä):
  01 Gateway → 02 Peruskäsitteet → 03 Agenttijärjestelmä
    → 04 Hookit & pi-agent → 05 Plugin-järjestelmä → 06 Nykyinen muisti
      → 07 Havainnot (jatkuva, ruokkii design-sarjaa)
      → 08 Viittaukset (lähdetiedostoindeksi)
  ↓
03 Design (suunnittele uusi muistimalli):
  01 Tietomalli → 02 Assosiaatiot → 03 Elinkaari
    → 04 Retrieval → 05 Konsolidaatio
      → 06 Integraatio → 07 Migraatio
```

Jokainen vaihe rakentaa edellisen päälle.
