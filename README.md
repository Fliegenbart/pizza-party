# Krossmail

B2B Cold-Outreach-Tool für **Chriss Kross Pizza** — Excel rein, personalisierte Mails raus.

## Wie's funktioniert

1. **Upload**: Excel mit den Spalten `Vorname`, `Nachname`, `Email`, `Firma` (optional `Website`).
2. **Scraping**: Für jeden Lead wird die Firmen-Website gefetched (Startseite + Über-uns/Leistungen/News). Fehlt die Website-Spalte, wird die Domain aus der E-Mail-Adresse abgeleitet — Freemailer (gmail, web.de, …) werden ignoriert.
3. **Claude schreibt**: Sonnet 4.5 generiert `Subject` + `Mail-Body` im Chriss-Kross-Ton (frech, kurz, Chuzpe, Sixt-Style). Der System-Prompt ist mit Prompt Caching markiert — die Beispiel-Mails + Regeln kosten dich nur einmal, danach zahlst du pro Lead nur für den Lead-Kontext.
4. **Review**: Alle Mails erscheinen in einer Liste. Du kannst jede Mail inline editieren, einzeln neu generieren (neuer Variant-Seed) oder freigeben.
5. **Export**: CSV mit allen Feldern — ready für Gmail-Mailmerge, Outlook-Import oder dein Tool der Wahl.

## Setup

```bash
cp .env.local.example .env.local
# ANTHROPIC_API_KEY eintragen (aus https://console.anthropic.com/)
npm install
npm run dev
```

Dann [http://localhost:3000](http://localhost:3000) öffnen.

Prüfen, ob der Key geladen ist: `curl localhost:3000/api/health` sollte `"hasApiKey": true` liefern.

Optional kannst du `ENRICH_RATE_LIMIT_PER_HOUR` setzen. Standard sind 120 Generierungen pro IP und Stunde.

## Beispieldatei

`sample-leads.xlsx` im Repo enthält 5 Test-Leads (Otto, Statista, hei. Hamburg, Jung von Matt, XING). Reinladen, "Mails generieren" klicken — in ~30-60 Sekunden sind alle fünf Mails da.

## Excel-/CSV-Format

Spaltennamen werden heuristisch erkannt (case-insensitive):

| Feld       | Erkannte Keys                                         |
| ---------- | ----------------------------------------------------- |
| Vorname    | `vorname`, `firstname`, `first name`                  |
| Nachname   | `nachname`, `lastname`, `name`, `surname`             |
| Email      | `email`, `e-mail`, `mail`                             |
| Firma      | `firma`, `company`, `unternehmen`, `organization`     |
| Website    | `website`, `url`, `webseite`, `homepage`, `domain` *(optional)* |

Erste Zeile = Header. Gender wird aus dem Vornamen geraten (Heuristik + Name-List). Bei unsicheren Fällen → "Hallo {Vorname} {Nachname}" statt "Sehr geehrte/r …" — passt eh zum frechen Ton.

## Architektur

```
app/
  page.tsx              Upload + Review-UI (alles Client-State)
  api/upload/           Excel → Lead[]
  api/enrich/           Ein Lead + Scrape → Lead mit Subject/Body
  api/export/           Lead[] → CSV
  api/health/           Sanity-Check (hat der Server einen API-Key?)
  api/debug/scrape/     Dev-only: Scraper-Output für eine URL inspizieren
lib/
  excel.ts              Parser + Heuristiken
  scraper.ts            Fetch + Cheerio + Sub-Page-Discovery
  claude.ts             Anthropic SDK + Prompt Caching
  types.ts
```

Pro Lead: 1 Scrape-Request + 1 Claude-Call. Enrichment läuft mit `CONCURRENCY = 3` parallel (in [`app/page.tsx`](app/page.tsx)).

## Was bewusst *nicht* drin ist (weil Prototyp)

- **Kein direkter Mailversand** — CSV reicht für den ersten Lauf. Grund: DSGVO/Impressum/Spam-Reputation willst du bewusst setzen, nicht dem Agenten überlassen.
- **Keine Persistenz** — State lebt im Browser. Tab zu = alles weg. Für den ersten Lauf reicht das, für 2.0 kommt SQLite oder Vercel KV.
- **Kein Bounce-Check / MX-Lookup** — wer seine Liste nicht kennt, sollte die vorher durch NeverBounce o.Ä. jagen.
- **Kein Gmail-Drafts-Push** — lässt sich via Google OAuth nachrüsten (1-2h Arbeit), wenn der erste Lauf gut aussieht.
- **Keine A/B-Varianten pro Lead** — "Neu generieren" gibt dir eine neue Variante. Zwei automatisch und einen Picker daneben wäre die nächste Iteration.

## Ton tunen

Der Prompt steckt in [`lib/claude.ts`](lib/claude.ts), Konstante `SYSTEM_PROMPT`. Dort kannst du:

- Beispiel-Mails austauschen (few-shot). **Das ist der wirksamste Hebel für den Ton.** Schick mir 2-3 Mails, die dir wirklich gefallen, und ich tune sie rein.
- Branchen-Tonalität feiner abstufen (Agentur vs. Versicherung).
- Harte Regeln schärfen (max. Wörter, Subject-Länge, CTA-Stil).

## Bekannte Kanten

- Einige Websites blocken den User-Agent oder antworten mit JS-only (SPA). Dann bekommt Claude weniger Kontext und schreibt generischer. Lösung für v2: Playwright statt `fetch`, aber langsamer.
- Die Gender-Heuristik kennt ca. 80 Namen. Internationale oder ambige Namen fallen auf "Hallo {Vorname} {Nachname}" zurück.
- Wenn ein Lead keine Firma und keine Email hat, wird er still übersprungen.
