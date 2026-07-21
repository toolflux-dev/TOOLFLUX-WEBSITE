# Onboarding a Doctor to NANDI Med

Everything you need to hand a doctor the app and get them running the same day.

---

## What you send

One link. That is the whole delivery.

```
https://toolflux-dev.github.io/nandimed/nandimed.html
```

Send it on WhatsApp. Nothing to download, nothing to install from a store, no account for them to create, no settings for them to configure. The backend is already wired into the app.

**Suggested WhatsApp message:**

> Namaste Dr. [Name],
>
> Here is NANDI Med, the clinic register I mentioned.
>
> https://toolflux-dev.github.io/nandimed/nandimed.html
>
> Open it on your phone in Chrome, then choose "Add to Home Screen" so it becomes an app icon. Fill in your clinic name once and it is ready.
>
> Free for 15 days, then ₹299 a month. Nothing to install, works without internet.
>
> Call me if anything is unclear.

---

## Where it lives on their device

**On an Android phone or tablet.** Open the link in Chrome, tap the ⋮ menu, tap **Install app**. An icon lands on the home screen. It opens fullscreen with no browser bar and behaves like any other app.

**On an iPhone or iPad.** It must be **Safari**, not Chrome. Apple only allows installing from Safari. Tap the Share button at the bottom, scroll down, tap **Add to Home Screen**, then **Add**.

**On a Windows PC.** Open the link in Chrome or Edge. An install icon appears at the right edge of the address bar, a small screen with a down arrow. Click it, then **Install**. The app opens in its own window and gets a Start Menu entry. It also runs fine as a normal browser tab if they prefer.

The app itself tells them which steps apply to their device. Settings → **App & help** shows instructions matched to the device they are holding.

---

## What happens the first time they open it

1. A registration screen asks for clinic name, doctor name, registration number, discipline, email, phone, and address. Only clinic name, doctor name, and email are required.
2. The 15-day trial starts the moment they submit.
3. A 16-step tutorial runs on its own, walking through every feature against the real screens. They can skip it and replay it later from Settings → App & help → **Replay the tutorial**.

Nothing else. They can see a patient within two minutes of opening the link.

---

## The five things to tell them out loud

Say these in person or on a call. They matter more than the feature list.

**1. Records live on the phone, and a copy syncs to a Google Sheet I hold.**

Be straight about this. Patient data is stored on their device and also syncs to a Google Sheet in your Google account, so you can restore their records if the phone dies. They should know that before entering a single patient. If a doctor is not comfortable with that, do not sign them up until you have set them up with their own separate backend.

**2. Two boxes are private and never reach the patient.**

The Prescription/Dilution box and the Consultation Fee box are for their records only. Neither is printed, neither appears in the WhatsApp message. Everything under "Doctor's advice" is what the patient receives. Show them this distinction on screen, because it is the thing they will worry about.

**3. WhatsApp needs one tap from them.**

The app writes the message and opens WhatsApp with it ready. They press send. It is not automatic, and that is deliberate: automatic sending needs a paid WhatsApp Business account. One tap per patient.

**4. Voice notes need Chrome and internet.**

Dictation works in Chrome on Android and on a PC. On an iPhone it will not work, because Apple does not allow it in installed web apps. They can always type instead. The rest of the app works with no internet at all.

**5. Take a backup once a week.**

Settings → **Export backup** saves a file. If they clear their browser data or lose the phone without a backup, the local copy is gone. The Google Sheet copy covers them, but a personal backup takes ten seconds and costs nothing.

---

## Getting paid

Day 1 to 15 is free with no card and no payment details. A banner counts down the days remaining.

On day 16 the app locks to a payment screen. Existing records stay safe and exportable.

**Right now, activate them by hand:**

1. They pay you by UPI, cash, or transfer.
2. Open your Google Sheet, go to the `_Subscriptions` tab, add a row:

   | Email | Status | ExpiresAt | Plan |
   |---|---|---|---|
   | `theirdoctor@email.com` | `active` | `2026-12-31` | `monthly` |

3. Tell them: **Settings → Already paid? Activate by email**, enter that same email, tap Activate.

The email must match the row exactly. To renew, change the `ExpiresAt` date.

Once you finish the Razorpay setup (Part 3 of the setup guide), this becomes automatic and you stop touching the sheet.

---

## First-week check-in

Call after a week and ask four things:

- Did they get through registration without help?
- Have they sent a WhatsApp advice message to a patient?
- Has any patient uploaded a report through the link?
- What is annoying them?

The fourth question is the valuable one. Write the answers down and send them to me, and I will fix what comes up.

---

## When something goes wrong

| They say | Cause | Fix |
|---|---|---|
| "Voice button does nothing" | iPhone, or no internet | Type instead. Voice needs Chrome plus internet. |
| "My patients are gone" | Cleared browser data, or a different browser | Settings → Import backup. Otherwise restore from your Google Sheet. |
| "It won't install" | iPhone opened in Chrome | Reopen the link in Safari. |
| "WhatsApp didn't open" | WhatsApp not installed on that device | Install WhatsApp, or send from the phone that has it. |
| "It says my trial ended" | Day 16, no payment | Add their row to `_Subscriptions`, then activate by email. |
| "Nothing loads" | No internet on first ever open | The first open needs internet. After that it works offline. |
| "The upload link is dead" | Patient opened it after you changed the deployment | Resend the advice message to generate a fresh link. |

---

## Before you sign up doctor number two

Two decisions worth making early.

**Where patient data sits.** Every clinic currently syncs into one Google Sheet in your account. That makes you the custodian of every clinic's patient records. The alternative is giving each doctor their own Apps Script and Sheet in their own Google account, which costs about ten minutes per clinic and keeps their patients entirely theirs. For a paid medical product I would lean that way, and "your records never leave your own Google account" is easier to sell than the opposite.

**Legal footing.** You are storing other people's patient health records. India's DPDP Act applies. Worth one conversation with someone who knows it before you take money from strangers.

Neither blocks your first doctor, especially if that doctor is someone you know. Both matter before the fifth.
