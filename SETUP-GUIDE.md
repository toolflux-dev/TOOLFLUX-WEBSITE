# TOOLFLUX Machining Log — Complete Setup Guide

> Written for someone setting this up for the first time.
> Estimated time: 30–45 minutes for setup. Zero time after that — it runs itself.
> 7 parts. Read Part 1–3 first. Come back to the rest when you need them.

---

## Part 1 — What lives where

| Thing | Where it lives | Who touches it |
|---|---|---|
| `machlog-share.html` | Customer's laptop / USB drive | Customer opens it in Chrome |
| `machlog.js` | Same file (built into the HTML) | You (the developer) |
| `machlog-sync.gs` | Google Apps Script (script.google.com) | You deploy it once |
| Google Sheet | Google Drive (your account) | You view customer data here |
| GitHub | github.com | Just your code backup. Customers never touch this. |

**The app does NOT need GitHub to work.** GitHub is just where you store your code so you don't lose it. Your customers never connect to GitHub.

---

## Part 2 — One-time backend setup

### Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Click the big **+** (Blank spreadsheet)
3. Name it: `TOOLFLUX — Customer Data`
4. Look at the URL in your browser. It looks like:
   ```
   https://docs.google.com/spreadsheets/d/1F1oxUJGt62xyLylpx8zw1TtC9o7e3CM7IlaPtqR3_ww/edit
   ```
5. Copy the long ID in the middle (between `/d/` and `/edit`). That is your `SPREADSHEET_ID`. Save it.

---

### Step 2 — Set up Google Apps Script

1. Go to [script.google.com](https://script.google.com)
2. Click **New Project** (top left)
3. Name the project: `TOOLFLUX Sync`
4. Delete everything in the editor
5. Open the file `machlog-sync.gs` from your TOOLFLUX-WEBSITE folder
6. Copy the entire contents and paste into the Apps Script editor
7. Find this line near the top and paste in your spreadsheet ID:
   ```javascript
   const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';
   ```
   Replace `PASTE_YOUR_SPREADSHEET_ID_HERE` with the ID you copied in Step 1.
8. Click **Save** (disk icon or Ctrl+S)

---

### Step 3 — Set your secrets (IMPORTANT — do this before deploying)

This is where the security lives. You are storing passwords inside Google, not in your code.

1. In the Apps Script editor, click **Project Settings** (gear icon, left sidebar)
2. Scroll down to **Script Properties**
3. Click **Add script property** and add these four:

   | Property name | What to put |
   |---|---|
   | `TOKEN_HMAC_SECRET` | A random string you make up — 32+ characters. Example: `mK9xQ2vP8nL4rJ7wT3bH6yE5uC1sA0dF` |
   | `WEBHOOK_SECRET` | Another random string — different from the first. Example: `zR2mN8kX4pQ7vL1jW9cE5tY3hB6uD0gA` |
   | `RAZORPAY_KEY_ID` | Your Razorpay API key ID (find it in Razorpay Dashboard → Settings → API Keys) |
   | `RAZORPAY_KEY_SECRET` | Your Razorpay API key secret (same place) |

   > **How to make a random string:** Go to [passwordsgenerator.net](https://passwordsgenerator.net), set length to 32, include letters and numbers only (no symbols), click Generate. Copy and save each one somewhere safe.
   >
   > **IMPORTANT:** Save `TOKEN_HMAC_SECRET` somewhere permanent (your password manager). If you ever change it, all your customers will need to re-activate their license.

4. Click **Save script properties**

---

### Step 4 — Deploy the Apps Script as a web app

This gives you a URL that the app will talk to.

1. In Apps Script editor, click **Deploy** (top right) → **New deployment**
2. Click the gear icon next to "Select type" → choose **Web app**
3. Set these options:
   - **Description:** `TOOLFLUX Machining Log v1`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. Click **Deploy**
5. It will ask you to authorize — click **Authorize access** and follow the steps (you're authorizing your own script to access your own sheet)
6. Copy the **Web app URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```
   Save this. This is your `SYNC_URL`.

---

### Step 5 — Set up Razorpay

#### Create a subscription plan

1. Log in to your Razorpay dashboard
2. Go to **Products → Subscriptions → Plans**
3. Click **+ Create Plan**
   - Name: `TOOLFLUX Monthly`
   - Billing cycle: Monthly
   - Amount: ₹299
4. Save the plan

#### Create a Payment Link for subscriptions

1. Go to **Payment Links → + Create Payment Link**
2. Choose **Subscription** type
3. Select the plan you just created
4. Click **Create** → copy the link (looks like `https://rzp.io/l/xxxxxxxx`)
5. This is your `RAZORPAY_PLAN_LINK`

#### Set up the webhook

1. Go to **Settings → Webhooks → + Add New Webhook**
2. **Webhook URL:** Your GAS URL from Step 4, with your webhook secret added:
   ```
   https://script.google.com/macros/s/AKfycby.../exec?wh_secret=YOUR_WEBHOOK_SECRET
   ```
   Replace `YOUR_WEBHOOK_SECRET` with the `WEBHOOK_SECRET` value you set in Script Properties.
3. **Secret:** (leave blank — we're already passing the secret in the URL)
4. Check these events:
   - `subscription.charged`
   - `subscription.activated`
   - `subscription.cancelled`
   - `subscription.completed`
5. Click **Save**

---

### Step 6 — Update the app with your URLs

Open `machlog.js` in your code editor. Find these two lines near the top:

```javascript
const SYNC_URL = 'https://script.google.com/macros/s/.../exec';
const RAZORPAY_PLAN_LINK = 'https://rzp.io/l/YOUR_PLAN_LINK';
```

Replace both values with what you got in Steps 4 and 5.

---

### Step 7 — Build the share file

Open PowerShell in your TOOLFLUX-WEBSITE folder and run:

```powershell
.\build-share.ps1
```

This creates `machlog-share.html` — a single self-contained file with everything bundled in. This is what you send to customers.

---

## Part 3 — Distributing to customers

### What you send them

Just one file: **`machlog-share.html`**

You can send it via:
- WhatsApp (attach the file)
- Email attachment
- USB drive
- Google Drive / OneDrive shared link

No installation. No app store. They just open it in Chrome or Edge.

### What they do

1. **Open the file in Chrome or Edge** — on a laptop, or on an Android/iPhone.
   - On a phone: open Chrome, tap the three-dot menu → **Open file** → find `machlog-share.html`
   - Not Internet Explorer. Not Firefox. Chrome or Edge only.
2. **First time:** Fill in their workshop name, machine name, their name, email → tap **Start Free Trial**
3. **They get 14 days free.** A yellow bar at the top counts down.
4. **After 14 days:** The app shows a paywall. They can't use it until they subscribe.
5. **To subscribe:** Tap the button → Razorpay payment page opens → they pay ₹299
6. **After paying:** Go back to the app → type in the email they used to pay → tap **Activate** → app unlocks immediately

### One file per customer

If you want to track different customers separately in your Google Sheet, build a separate share file for each:

```powershell
.\build-share.ps1 -Customer "acme-tools"
.\build-share.ps1 -Customer "sharma-engineering"
```

Each customer gets their own tabs in your Google Sheet.

---

## Part 4 — Using the app on a mobile phone

The app is designed to work on both computers and phones. Your customer (the shop owner) will probably use it on their laptop. But the person doing the actual logging — the operator or supervisor on the floor — often only has a phone.

Here is what the phone experience looks like and why each thing was designed that way.

---

### The header (top bar)

On a computer, the top bar shows: the TOOLFLUX logo + "Machining Log" text + a clock.

On a phone, the "Machining Log" text and the date disappear. The logo is enough. This is not a bug — it frees up space so the breadcrumb (which page you are on) fits without squishing.

---

### Buttons are big

On a computer, a mouse cursor is a tiny precise pointer. On a phone, your finger is the cursor — and it's big. All buttons in the app are now at least 44 pixels tall. That is the minimum size that Apple and Google recommend so a finger can reliably tap something without missing.

---

### The "Log Production" screen

This is the most important screen for an operator. They come here at the end of a shift to record how many pieces they made.

**On a computer:** There is a number box on the left, with +5 / +10 / +25 / +100 quick-add buttons next to it on the right.

**On a phone:** The number box stretches across the full screen and the font is three times bigger. You can read it from arm's length. The quick-add buttons (+5, +10, +25, +100) sit below the number box in two rows, each button big enough to tap with a thumb.

---

### Forms go single-column

All the forms (like "New Job", "Add Station", "Settings") used to show two fields side by side. On a 375px phone screen, two fields side by side = each field is tiny. On a phone, every form now shows one field at a time, stacked from top to bottom.

---

### Text inputs don't zoom

This one is invisible but important. On an iPhone, if a text input has a font size smaller than 16px, Safari automatically zooms the entire page in when you tap the input. This is very annoying. Every text input in the app is now set to exactly 16px on mobile, which stops this from happening.

---

### Operator workflow on mobile (step by step)

Here is exactly how an operator at the machine would use the app on their phone at the end of a shift:

1. Open `machlog-share.html` in Chrome
2. The jobs list opens — they tap their component job
3. Tap **+ Log Production** (big teal button)
4. The big number box appears — they type in how many pieces they made, or tap +25 / +100 to add quickly
5. If they changed an insert today, they tick "Any tooling change this shift?" and select what happened (indexed / replaced / broken) for each station
6. Tap **Log Production** — done. The app saves locally and syncs to your Google Sheet in the background.

The whole process takes about 20 seconds.

---

### Phone recommendation for customers

- **Android:** Any phone with Chrome. Open the HTML file from WhatsApp or Files.
- **iPhone:** Use Safari or Chrome. To open an HTML file on iPhone, the easiest way is to share it via WhatsApp → hold the file → "Open in Chrome".
- **Add to home screen (optional):** In Chrome, tap the three-dot menu → "Add to Home screen." The app then appears like an app icon. It still works offline.

---

## Part 5 — What you (the developer / owner) see in your Google Sheet

Open your Google Sheet anytime. You'll see tabs like:

| Tab name | What it shows |
|---|---|
| `acme-tools \| Jobs` | All component jobs, total pieces made, insert cost, CPC |
| `acme-tools \| Log` | Every production log entry with operator, machine, quantity |
| `acme-tools \| CPC` | Cost per component breakdown per tooling station |
| `acme-tools \| Anomalies` | Inserts that broke abnormally early |
| `_Subscriptions` | All subscribers — email, status, expiry date |
| `_Sync Log` | Last sync time per customer |

---

## Part 6 — Troubleshooting

### Customer says the activation is not working

1. Open your Google Sheet → `_Subscriptions` tab
2. Check if their email is there
3. Check the `Status` column — should say `active`
4. If it says `cancelled` or is missing: the Razorpay webhook didn't fire. Check:
   - Razorpay → Settings → Webhooks → click the webhook → check "Recent Deliveries"
   - If failed, look at the error — usually the URL is wrong or the `wh_secret` doesn't match

### App shows "Internal error" when activating

The `TOKEN_HMAC_SECRET` is not set in Script Properties, or you deployed the Apps Script before setting it. Fix: set the property, then **redeploy** (Deploy → Manage deployments → Edit → new version).

### Customer's data isn't showing in the Sheet

1. The sync is silent and automatic — it happens 4 seconds after each save
2. The customer needs internet when syncing
3. Check `_Sync Log` tab — is their customer ID there? If not, the SYNC_URL might be wrong in the app.

### I need to update the app for existing customers

1. Make your changes to `machlog.js` or `machlog.html`
2. Run `.\build-share.ps1` again
3. Send the new `machlog-share.html` to your customers
4. They replace the old file with the new one
5. Their data (saved in their browser's localStorage) is NOT affected — it stays intact

---

## Part 7 — Security quick reference

| What is protected | How |
|---|---|
| Webhook can't be faked | Verified using a secret only you and Razorpay know |
| License tokens can't be guessed | Generated using HMAC-SHA256 with a 256-bit secret |
| Tokens aren't stored (can't be stolen from sheet) | Recalculated on-demand from email + your secret |
| Brute-force activation blocked | Max 5 attempts per 15 minutes per email |
| Replay attacks blocked | Each payment ID is stored; duplicates rejected |
| Live verification | At activation, Razorpay API is called to confirm subscription is real |
| Offline grace | If internet is down, license stays valid for 7 days |

---

## Quick reference — URLs and IDs to save

Keep these somewhere safe:

```
SPREADSHEET_ID:       ___________________________________
GAS Web App URL:      ___________________________________
RAZORPAY_PLAN_LINK:   ___________________________________
TOKEN_HMAC_SECRET:    ___________________________________  ← NEVER change after first use
WEBHOOK_SECRET:       ___________________________________
```
