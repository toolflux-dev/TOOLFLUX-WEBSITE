# NANDI Med — Setup, Start to Finish

*by Flux · patient register for Ayurveda / Homeopathy / Electro-homeopathy / Physiotherapy OPD.*

Follow the parts **in order**. Each part produces a value the next part needs. Do not skip ahead — if you do them out of order you will have to redo work.

Total time: about 30 minutes.

---

## Values you will collect

Keep this open in Notepad and fill it in as you go. Every later step pulls from here.

```
1. SHEET ID          = ______________________________________
2. EXEC URL          = ______________________________________
3. PUBLIC URL        = ______________________________________
4. RAZORPAY LINK     = ______________________________________

Secrets (already generated for you, just copy):
TOKEN_HMAC_SECRET = <YOUR_TOKEN_HMAC_SECRET>
WEBHOOK_SECRET    = <YOUR_WEBHOOK_SECRET>
```

---

# PART 1 — Google Sheet
*Gives you: **SHEET ID***

1. Go to **sheets.new** — a blank spreadsheet opens.
2. Click the title top-left, rename it **NANDI Med — Data**.
3. Look at the address bar:
   `https://docs.google.com/spreadsheets/d/`**`1A2b3C4d5E6f7...`**`/edit#gid=0`
4. Copy the part between `/d/` and `/edit`. **That is your SHEET ID.** Write it in your notepad as value 1.

Do not create any tabs. The script builds them automatically.

---

# PART 2 — Apps Script backend
*Needs: SHEET ID · Gives you: **EXEC URL***

1. Go to **script.google.com** → **New project** (top-left).
2. You will see a file `Code.gs` with a few lines. Click in it, press **Ctrl+A**, then **Delete**.
3. On your PC open `nandimed-sync.gs` (in `Documents\GitHub\TOOLFLUX-WEBSITE`) with Notepad. Press **Ctrl+A**, **Ctrl+C**.
4. Click back in the script editor and press **Ctrl+V**.
5. Find **line 18**, which reads:
   ```
   var SPREADSHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';
   ```
   Replace `PASTE_YOUR_SHEET_ID_HERE` with your SHEET ID. **Keep the quote marks.** Result looks like:
   ```
   var SPREADSHEET_ID = '1A2b3C4d5E6f7...';
   ```
6. Click the **save icon** (or Ctrl+S).
7. Left sidebar → **gear icon (Project Settings)**.
8. Scroll to **Script Properties** → **Add script property**. Add the **first** one:
   - Property: `TOKEN_HMAC_SECRET`
   - Value: `<YOUR_TOKEN_HMAC_SECRET>`
9. Click **Add script property** again for the **second**:
   - Property: `WEBHOOK_SECRET`
   - Value: `<YOUR_WEBHOOK_SECRET>`
10. Click **Save script properties**. You should now see **two** rows.
11. Top-right → **Deploy** → **New deployment**.
12. Click the **gear** next to "Select type" → choose **Web app**.
13. Set:
    - **Execute as:** `Me`
    - **Who has access:** `Anyone`
14. Click **Deploy**.
15. Click **Authorize access** → choose your Google account.
16. A warning appears: *"Google hasn't verified this app."* This is normal for your own script.
    Click **Advanced** (bottom-left) → **Go to NANDI Med — Data (unsafe)** → **Allow**.
17. Copy the **Web app URL**. It ends in `/exec`. **That is your EXEC URL.** Write it in as value 2.

**Check it worked:** paste your EXEC URL into a browser tab and add `?action=ping` on the end. You should see:
`{"ok":true,"service":"nandimed","hasSecret":true}`
If `hasSecret` says `false`, step 8 did not save correctly.

---

# PART 3 — Razorpay subscription
*Needs: EXEC URL · Gives you: **RAZORPAY LINK***

Skip this part entirely if you are not charging yet. Everything else works without it.

### 3a. Create the plan
1. Log in to **dashboard.razorpay.com**.
2. **Subscriptions → Plans → Create Plan**.
3. Set: Billing frequency **Monthly**, every **1** month.
4. Amount **299**, currency INR. Plan name: `NANDI Med Monthly`.
5. **Create Plan**.

### 3b. Create the subscription link
1. **Subscriptions → Subscription Links → Create Subscription Link**.
2. Select the plan you just made.
3. **Turn ON "Collect customer email."** This is not optional — the app matches doctors by email, and without it nobody can ever activate.
4. Leave total billing cycles blank (or set a high number) for open-ended monthly billing.
5. Create it, then copy the link (`https://rzp.io/rzp/XXXXXXX`). **That is your RAZORPAY LINK.** Write it in as value 4.

### 3c. Connect the webhook
1. **Settings → Webhooks → Add New Webhook**.
2. **Webhook URL:** your EXEC URL with `?wh=1` added on the end. For example:
   `https://script.google.com/macros/s/AKfy..../exec?wh=1`
3. **Secret:** `<YOUR_WEBHOOK_SECRET>`
4. Under **Active Events**, tick exactly these six:
   - `subscription.activated`
   - `subscription.charged`
   - `subscription.halted`
   - `subscription.cancelled`
   - `subscription.completed`
   - `subscription.pending`
5. **Create Webhook**.

> Test this in Razorpay **Test Mode** first. It fires real webhooks without real money.

---

# PART 4 — Edit two files on your PC
*Needs: EXEC URL, RAZORPAY LINK*

Do both edits now, before publishing, so you only publish once.

**File 1 — `nandimed-upload.html`** (open in Notepad)
Find **line 60**:
```
var BACKEND_URL = 'PASTE_YOUR_EXEC_URL_HERE';
```
Replace `PASTE_YOUR_EXEC_URL_HERE` with your EXEC URL. Keep the quotes. **Save.**

**File 2 — `nandimed.js`** (skip if you skipped Part 3)
Find **line 15**:
```
const RAZORPAY_PLAN_LINK = 'https://rzp.io/rzp/REPLACE_ME';
```
Replace the whole web address with your RAZORPAY LINK. Keep the quotes. **Save.**

---

# PART 5 — Publish on GitHub Pages
*Gives you: **PUBLIC URL***

A separate repo is cleaner, since this is personal and not part of the TOOLFLUX site.

1. On **github.com** click **+** (top right) → **New repository**.
2. Name it `nandimed`. Select **Public** (free Pages requires public). Click **Create repository**.
3. On the new repo page click **uploading an existing file**.
4. From `Documents\GitHub\TOOLFLUX-WEBSITE`, drag in these **7 files**:
   - `nandimed.html`
   - `nandimed.js`
   - `nandimed-upload.html`
   - `nandimed-sw.js`
   - `nandimed.webmanifest`
   - `nandimed-icon-192.png`
   - `nandimed-icon-512.png`

   **Do not upload `nandimed-sync.gs`** — that already lives in Apps Script.
5. Click **Commit changes**.
6. Go to **Settings → Pages**.
7. Under **Source** choose **Deploy from a branch**; branch **main**; folder **/ (root)**. **Save.**
8. Wait about a minute, then refresh. GitHub shows your address.

Your app is at:
`https://YOURNAME.github.io/nandimed/nandimed.html`

**PUBLIC URL** = `https://YOURNAME.github.io/nandimed/` (with the trailing slash). Write it in as value 3.

---

# PART 6 — Connect the app
*Needs: EXEC URL, PUBLIC URL*

1. On your **phone**, open your PUBLIC URL + `nandimed.html`.
2. Register your clinic. The tutorial runs automatically — follow it.
3. Go to **Settings** (gear, bottom-right).
4. Under **App & help**, install it: tap **Install now**, or follow the on-screen steps for your phone.
5. Scroll to **Google Sheet backup**:
   - **Backend URL** → paste your EXEC URL
   - **Public app URL** → paste your PUBLIC URL
6. Tap **Test connection** → expect green **"Connected."**
7. Tap **Sync now**.
8. Open your Google Sheet. New tabs should have appeared with your clinic's name.

---

# PART 7 — Prove it all works

Do this once, end to end, before trusting it with real patients.

1. Add a test patient with a medicine and a follow-up date. Save.
2. Tap **Send advice on WhatsApp** → send it to your own number.
3. Confirm the message contains the medicine, and does **not** contain your fee or your private prescription.
4. Open the upload link in that message → attach a photo → send.
5. In your Google Sheet, check the `... | Documents` tab for the file link.
6. Check the `... | Visits` tab shows the consultation.
7. If using Razorpay: make a **test-mode** payment, then check `_Subscriptions` shows the email as `active`.

If all seven pass, you are live.

---

## Ongoing: how to change things later

**Changing the app** (`nandimed.html` / `nandimed.js`): upload the changed file to the `nandimed` repo again. Every doctor gets it the next time they open the app online.

**Changing the backend** (`nandimed-sync.gs`): paste the new code into Apps Script, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. Editing alone does nothing; the old version keeps running until you redeploy.

**⚠️ Never rename or remove a data field** without asking me first. There is no migration system, so a field rename would blank out every doctor's existing patient records.

---

## When someone pays you outside Razorpay

Open the Sheet's `_Subscriptions` tab and add a row:

| Email | Status | ExpiresAt | Plan |
|---|---|---|---|
| `doctor@email.com` | `active` | `2026-12-31` | `monthly` |

Then in their app: **Settings → Already paid? Activate by email**.

---

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| Voice notes do nothing, no mic prompt | You opened the file directly instead of the web address. Voice needs `https://`. Use your PUBLIC URL. |
| "Test connection" fails | EXEC URL wrong, or you did not redeploy after editing the script. Check `?action=ping` in a browser. |
| Patient upload page says "not configured" | Part 4, File 1 was missed, or you published before editing it. |
| A doctor cannot activate after paying | The email they typed differs from the one Razorpay collected. Check `_Subscriptions`. |
| Your change did not appear | Hard-refresh with **Ctrl+Shift+R**. Installed apps update on next open. |
| `hasSecret: false` on ping | Script Properties did not save. Redo Part 2 steps 7–10. |

---

## What this costs

Google Sheets, Apps Script, GitHub Pages, and WhatsApp click-to-send are all free. Razorpay charges roughly 2% + GST per transaction, only when a doctor actually pays you.
