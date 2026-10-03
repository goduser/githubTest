# Werkbonnen & Offertes

Een installeerbare webapp (PWA) voor telefoon en tablet. Werkbonnen maken, offertes opstellen, klanten en prijslijst beheren. Werkt offline, alle gegevens blijven op het apparaat.

## Functies
- **Werkbonnen**: klant, locatie, werkzaamheden, start/eind/pauze (uren automatisch), materialen, voorrijkosten, foto's, handtekening van de klant
- **Offertes**: regels met aantal/eenheid/prijs, arbeid tegen uurtarief, korting, BTW, geldigheid, voorwaarden, status (concept, verzonden, akkoord, afgewezen)
- **Offerte naar werkbon** met één knop, en dupliceren
- **PDF/afdrukken**, delen en e-mailen vanuit het voorbeeld
- **Klanten** en **artikelen/prijslijst** (prijs wordt automatisch ingevuld)
- Bedrijfsgegevens en logo, automatische nummering (WB-2026-0001, OF-2026-0001)
- Back-up downloaden en terugzetten (JSON)

## Gebruiken
Zet de map op een https-host (bijv. GitHub Pages: Settings, Pages, deploy van deze branch of main). Open de link op je telefoon of tablet en kies "Zet op beginscherm" (iOS Safari) of "App installeren" (Android Chrome).

Lokaal testen: `python3 -m http.server 8000` en open http://localhost:8000.
