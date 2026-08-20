# Joie BeLux Store Locator — automatische Google Sheets-sync

Dit pakket is de GitHub Pages-versie van de tweetalige Joie store locator voor België en Luxemburg.

De bestaande teksten, winkelzoekfunctie, locatiezoekopdracht, kaart, winkelkaarten, Instagram-sectie, footer en juridische pagina’s zijn behouden. In de header staan nu uitsluitend het gecentreerde Joie-logo en de NL/FR-taalkeuze. De promotiebalk, productmenu’s, mobiele menuknop en actie-iconen zijn verwijderd.

## Publiceren op GitHub Pages

1. Pak het ZIP-bestand uit.
2. Upload **de volledige inhoud** naar de root van de GitHub-repository.
3. Behoud de verborgen map `.github`, de map `scripts` en het bestand `.nojekyll`.
4. Ga in GitHub naar **Settings → Pages**.
5. Kies als bron de branch `main` en de map `/ (root)`.
6. Controleer onder **Settings → Actions → General** dat workflows inhoud mogen schrijven wanneer de organisatie dit centraal beperkt.
7. Open **Actions → Sync Joie BeLux stores from Google Sheets → Run workflow** voor een eerste handmatige test.

## Automatische synchronisatie

De workflow `.github/workflows/sync-stores.yml` haalt de winkelpunten rechtstreeks uit deze spreadsheet:

https://docs.google.com/spreadsheets/d/1MtK53tDgZuLw_553Tm8uskSa9mZSUrVpUcJ7Vh0iWGU/edit?gid=0#gid=0

De koppeling gebruikt spreadsheet-ID `1MtK53tDgZuLw_553Tm8uskSa9mZSUrVpUcJ7Vh0iWGU` en tabblad-ID `0`.

- De sync draait ieder uur op minuut 17.
- Een handmatige run is altijd mogelijk via GitHub Actions.
- Bij wijzigingen worden `stores.json`, `stores-nl.json` en `stores-fr.json` opnieuw opgebouwd en automatisch gecommit.
- Als er geen wijzigingen zijn, wordt niets gecommit.
- Lege rijen en lege kolommen worden genegeerd.
- Kolommen zoals `Unnamed: ...` worden niet in de JSON opgenomen.
- De sync stopt met een fout voordat bestanden worden overschreven wanneer verplichte kolommen ontbreken of de spreadsheet niet leesbaar is.

### Vereiste instelling van de spreadsheet

De GitHub-runner moet de CSV zonder Google-login kunnen downloaden. Zet de spreadsheet daarom op:

**Delen → Algemene toegang → Iedereen met de link → Kijker**

Bewerken blijft alleen mogelijk voor de personen die daarvoor expliciet toegang hebben.

## Verwachte spreadsheetkolommen

Verplicht:

- `name`
- `address`
- `postalCode`
- `city`
- `country`
- `lat`
- `lng`

De bestaande aanvullende velden, zoals `website_nl`, `website_fr`, `google_maps_url`, `name_fr`, `address_fr`, `city_fr`, `country_fr` en `category_fr`, worden automatisch meegenomen.

## Header

Op desktop en mobiel bevat de sticky header alleen:

- NL/FR-taalkeuze;
- gecentreerd Joie-logo.

Op de juridische pagina’s schakelt NL/FR voortaan naar dezelfde pagina in de andere taal, in plaats van altijd naar de startpagina.

## Belangrijkste bestanden

- `joie-design-system.css` — globale Joie-variabelen, vereenvoudigde header en footer
- `joie-store-locator.css` — store locator, kaart, zoekfunctie, knoppen en winkelkaarten
- `joie-legal-pages.css` — informatie-, privacy-, cookie- en OpenStreetMap-pagina’s
- `joie-shell.js` — terug-naar-bovenknop
- `joie-store-locator.js` — store-locatorlogica
- `scripts/sync_stores.py` — download, validatie, opschoning en JSON-export
- `.github/workflows/sync-stores.yml` — uurlijkse en handmatige GitHub Actions-sync
- `stores.json`, `stores-nl.json`, `stores-fr.json` — actuele winkeldata
- `assets/joie-logo.webp` — Joie-logo

## Typografie

Lexend wordt als webfont geladen. De aangeleverde Figma-export bevatte geen gelicentieerde Mikado- of Colfax-webfontbestanden. Voor koppen blijft daarom de fallback Fredoka actief, gevolgd door Lexend.

## Controle na upload

- Start de sync eenmaal handmatig in GitHub Actions.
- Controleer dat de run groen eindigt.
- Voeg daarna tijdelijk een testwinkel toe of wijzig een veld in de spreadsheet.
- Start opnieuw handmatig of wacht op de uurlijkse run.
- Controleer de automatische commit van de drie JSON-bestanden.
- Verwijder de testwijziging en controleer nogmaals de sync.
- Test daarna Nederlands, Frans, zoeken, huidige locatie, kaartmarkers, routes en webshoplinks.
