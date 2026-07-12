# CONTRACT STRIKE — Setup Guide

Your business, played as a game. Zoho Books is the referee, Claude generates the trivia, and Agent SPAHAN only appears winning.

The game works **immediately with zero setup** (offline mode: missions, preps, offline trivia, treat shop). The 10-minute setup below turns on the good stuff: **Zoho auto-verification** (heists complete themselves when the invoice lands) and **AI insert-selection trivia**.

---

## Part 1 — Google Sheet (1 min)

1. Go to sheets.google.com → blank spreadsheet → name it **TOOLFLUX — CONTRACT STRIKE**.
2. Copy the spreadsheet ID from the URL (`docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`).

## Part 2 — Zoho self client (5 min, one time ever)

This gives the backend *read-only* access to your Zoho Books (invoices + contacts).

1. Open **https://api-console.zoho.in** (log in with toolflux@gmail.com).
2. **ADD CLIENT → Self Client → CREATE → OK**.
3. Copy the **Client ID** and **Client Secret** somewhere.
4. Go to the **Generate Code** tab:
   - Scope: `ZohoBooks.invoices.READ,ZohoBooks.contacts.READ`
   - Time duration: **10 minutes**
   - Description: anything → **CREATE** → copy the code shown.
5. Within 10 minutes, open a terminal (PowerShell is fine) and run (paste your three values in):

```
curl -X POST "https://accounts.zoho.in/oauth/v2/token" -d "grant_type=authorization_code" -d "client_id=YOUR_CLIENT_ID" -d "client_secret=YOUR_CLIENT_SECRET" -d "code=THE_CODE_YOU_COPIED"
```

6. From the JSON response, copy the **`refresh_token`** value. That token never expires — this is the last time you touch Zoho's console.

## Part 3 — Apps Script backend (3 min)

1. Go to **script.google.com** → **New project** → delete the placeholder → paste all of `contract-strike-sync.gs` → save (name it CONTRACT STRIKE).
2. At the top of the code, replace `PASTE_YOUR_SPREADSHEET_ID_HERE` with the Sheet ID from Part 1.
3. **Project Settings (⚙) → Script Properties → Add** these five:

| Property | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your `sk-ant-…` key (same one EDGE LAB uses) |
| `ZOHO_CLIENT_ID` | from Part 2 step 3 |
| `ZOHO_CLIENT_SECRET` | from Part 2 step 3 |
| `ZOHO_REFRESH_TOKEN` | from Part 2 step 6 |
| `ZOHO_ORG_ID` | `60021669308` |

4. **Deploy → New deployment → ⚙ Web app** → Execute as: **Me** · Who has access: **Anyone** → **Deploy** → authorize → copy the **`…/exec` URL**.

## Part 4 — Connect the game (1 min)

1. Open **contract-strike.html** on your phone (from your site, e.g. `toolflux.co.in/contract-strike.html`) → browser menu → **Add to Home Screen**.
2. In the game, tap **⚙ (top right)** → paste the `/exec` URL → **TEST** (should show `AI key: YES · Zoho: YES`) → **SYNC ZOHO NOW**.
3. Watch the offline banner disappear and your FLUX RATING calibrate. You're live.

---

## How the game verifies you (no cheating possible)

| Milestone | How it's checked |
|---|---|
| THE RECORD (beat ₹14.88L month) | Monthly invoice total from Zoho crosses ₹14,87,891 |
| Vendor-code heists | First invoice to that company name appears in Zoho |
| THE RECOVERY | Outstanding receivables drop below each ₹2L milestone |
| Monthly milestones (₹2L…₹12L) | Auto-awarded on sync, once per month |
| Prep missions & custom tasks | Honor system — you tick them |

Sync runs automatically when you open the app (max once per 6 h) or manually from SETUP. Every sync also logs a KPI row to your Sheet — a free business history log.

## Daily rhythm (3–5 minutes)

1. Open the app → **Report for duty** (streak + XP).
2. **RANGE** → answer 1–2 questions (5/day cap). Wrong answers teach you.
3. **Decision prompt** → pick today's target → it becomes a mission.
4. Tick missions as you actually do them. Zoho confirms the big ones.
5. Spend FLUX in the **SHOP** — and actually take the treat. That's the rule.

## Troubleshooting

- **TEST says Zoho: NO** → one of the 4 Zoho script properties is missing/typo'd.
- **Sync error "Zoho auth failed"** → refresh token was generated on the wrong DC. Make sure you used `accounts.zoho.in` (India), not `.com`.
- **AI trivia says offline bank** → `ANTHROPIC_API_KEY` missing, or no signal; the built-in bank covers you.
- **New phone / cleared browser** → SETUP → RESTORE ← SHEET (if you ever hit BACKUP → SHEET).
- **Rename heist targets** → SETUP → Heist targets (e.g. put the real product line name on OPERATION NEW STEEL).
