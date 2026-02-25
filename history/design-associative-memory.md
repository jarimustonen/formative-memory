# Associative Memory Plugin – Design Notes

> Jari Mustosen alkuperäiset ajatukset ja suunnittelumuistiinpanot.

## Tausta

Jarilla on ~20v ohjelmistokehityskokemusta ja psykologian tutkinto. Hän rakensi aiemmin terapeuttisen chat-sovelluksen, jossa muistijärjestelmän tärkeys kävi ilmeiseksi. Nyt OpenClaw tarjoaa paikan toteuttaa näitä ideoita.

## Alkuperäiset ideat (Peterin kirje)

1. **Narrative memory**: Ihmisen muisti on narratiivinen – pyörii tarinan ympärillä. "Minä" on tarinan keskiössä. Agentti voisi kehittää enemmän persoonallisuutta, jos muistot kirjoitetaan agentin näkökulmasta tarinallisilla elementeillä, kokemuksilla ja tarinan kaarilla. Antaa agentille käsityksen siitä mistä se tulee ja minne se on menossa.

2. **Associative memory**: Kun muisto palautetaan, myös assosioituneet muistot tulisi palauttaa. Assosiatiivisuutta voidaan rakentaa seuraamalla mitkä chunkit haetaan yhdessä. Algoritmilla voidaan antaa arvoa assosiatiivisille muistoille. Voi johtaa erilliseen konsolidaatiovaiheeseen jossa läheisesti assosioituneet muistot fuusoidaan yhdeksi.

3. **Colored memories**: Muistot EIVÄT ole totuudenmukaisia, eikä niiden tarvitse olla. Konsolidoinnissa ei pidä yrittää säilyttää vanhoja historioita autenttisina. Muistoja muutetaan sen perusteella miten ne palautettiin.

4. **Retrieval-based relevance**: Aikasidonnainen vaimennus perustuu viimeiseen palautukseen tai palautusten määrään viimeisellä 10 000 muistikyselyllä. Muisto muuttuu aina kun se palautetaan.

5. **Sleep**: Konsolidaatiovaihe = "uni". Kaikki luonnolliset hermoverkko-olennot nukkuvat.

6. **REM sleep**: Otetaan 10 viimeisintä keskustelua, valitaan satunnaisesti käyttäjän viestejä agentille. Unen jälkeen käytetään muistin hakuprofiilia assosiaatioiden päivittämiseen. Toteutetaan ensin CLI:n kautta ajettavaksi.

7. **Personality overdoing**: Agentit liioittelevat persoonallisuutta. Ratkaisuna bootstrap-prosessi jossa agentti heijastaa sanoja takaisin käyttäjälle kuvatakseen heitä. (Jarin vaimo löysi hyvän persoonan emoji-vastauksilla: 🤓🧐🤩)

8. **Dopaminergic system**: Agentti arvioi tilanteen/tuloksen arvon, ennustaa tulevan toiminnan arvon (EV), ja dopamiinivaste on odotuksen ja tuloksen erotus. Antaa tavoiteohjautunutta motivaatiota. Ensimmäinen idea: lisätä "uni"-vaiheeseen.

## Tarkennetut suunnitelmat (plugin-fokus)

### Ensimmäinen versio: Muistin assosiatiivisuus

- **Jokaisella muistipalasella on assosiaatio jokaiseen toiseen muistoon.** Assosiaatio on luku; korkea luku = vahva assosiaatio.
- **Kertautuva assosiaatio**: Jos muistolla X on keskivahva assosiaatio muistoihin A, B, C, ja tilanne palauttaa juuri A, B, C kontekstiin, X:n assosiaatio joukkoon (A, B, C) on kertautuvasti vahva.
- **Assosiaation päivitys:**
  1. Jos muistot palautetaan "mieleen" ajallisesti toisiaan lähellä, niiden assosiaatio kasvaa.
  2. Uusien muistojen luontitilanteessa assosiaatio tehdään niihin muistoihin, jotka on haettu kontekstiin.
- **Matemaattinen malli** tarvitaan assosiaatioiden hallintaan.

### Konsolidaatiovaihe

- Vahvasti assosioituneet muistot konsolidoidaan.
- **Temporaalinen status**: futuuri, preesens, perfekti.
  - Esimerkki: "Jari kertoi, että on menossa ensi maanantaina (2026-03-02) Tampereelle kahdeksi päiväksi matkalle. Paluu siis tiistaina (2026-03-03) tai keskiviikkona (2026-03-04) laskutavasta riippuen."
  - Metatiedoksi temporaalityyppi "futuuri". Maanantaina → "preesens". Torstaina 2026-03-05 → "imperfekti".

### Muistojen spesifisyys ja epistemologia

- **Ensimmäisessä tallennuksessa muistojen tulee olla hyvin spesifejä.** "Jari kertoi" – ei "Jari menee". Temporaalisuus on inferoitu mutta epävarma; selviää kysymällä.
- Muisto assosioituu aikaan jolloin se on voimassa, ja **vielä voimakkaammin transitiopäiviin** → tulee helpommin kontekstiin.

### Konsolidaation kautta kuvaavammiksi

- Ensimmäisen matkan jälkeen: "Jari kertoi menevänsä"
- Toisen matkan jälkeen: "Jari sanoi olevansa matkalla"
- Nämä konsolidoituvat: "Jari oli matkalla"
- Kolmannen matkan jälkeen: "Jari on käynyt kolme kertaa matkalla"
- Uusien muistojen myötä syntyy **käsitys/tulkinta**: "Jari matkustaa usein Tampereelle"
- **Käsityksen/tulkinnan erottaminen varsinaisesta muistosta on oleellista**, mutta molemmat talletetaan samaan muistijärjestelmään.

### Sisäinen aikakäsite (tick)

- Agentic loopin jokaisella toiminnolla/stepillä on **tick-arvo** jota kasvatetaan yhdellä.
- Jokainen muistiinpalautus saa oman tick-arvon.
- Tätä kautta saadaan botin sisäiseen aikakokemukseen liittyvä etäisyys jokaiselle muistolle.

### Muisti-layout ja versiointi

- OpenClaw:n oletusmuistilayout = esim. `default-layout`
- Talletetaan MEMORY.md frontmatteriin.
- Assosiatiivisen muistin layout = esim. `associative-layout-v1`

### Aggressiivisempi muistiin kirjoitus

- Kaikki keskustelut kirjoitetaan muistiin ja käydään läpi konsolidaation yhteydessä.
- Kun muistojen ja keskustelujen määrä kasvaa, botti voi kysyä: "Olemme nyt käyneet paljon keskusteluja ja minun pitäisi saada nukkua hetken aikaa, jolloin voin konsolidoida muistojani. Sopiiko, että teen sen nyt? Siinä kestää tyypillisesti noin 2min, jona aikana en vastaa sinulle."
- Botti voisi myös tunnistaa inaktiivisia jaksoja (esim. käyttäjä nukkuu) ja konsolidoida silloin.
