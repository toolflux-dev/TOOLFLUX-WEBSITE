# FLUX — TOOLFLUX AI Pitch Partner: Design Spec

Date: 2026-07-25
Status: Approved design, pending owner review of this document

## 1. What this is

A voice-first AI sales co-pilot that sits in the room while the owner pitches TOOLFLUX to a customer. It listens continuously, speaks proactively (not only when asked), shows branded product assets on screen, records the meeting, and produces minutes + captured contact details afterwards. Web link only — no native app. Used on the owner's Windows laptop and phone.

**Assistant persona:** name **"Flux"**, energetic male voice. Conversationalist, not an appliance.

## 2. Locked decisions

| Topic | Decision |
|---|---|
| Languages | Mixed English / Hindi / Kannada with free code-switching |
| AI backend | Google Gemini Live API, browser → Gemini WebSocket **directly, zero backend** |
| API key | Owner's Gemini key, pasted once into Setup; stored in `localStorage` only; never in code or repo |
| Proactivity | **Balanced co-pilot**: speaks when addressed by name, when cued, and on clear openings; yields when owner or customer is mid-flow |
| Recording disclosure | Owner discloses manually; app shows an always-visible `● REC` indicator; no self-announcement |
| Storage | **On-device only** (IndexedDB + localStorage). No cloud, no email, no Sheets. Downloadable files |
| Minutes | **Two versions**: customer-facing MoM (customer-safe, suggestions highlighted with data) + private internal debrief |
| Hosting | Unlisted page on toolflux.co.in (`pitch.html`), `noindex`, not linked from site nav |
| UI direction | **SIGNATURE** (locked mockup: `.superpowers/brainstorm/1680-1784922832/content/signature-final.html`) |
| Fonts | Modern grotesque only — Segoe UI Variable / Inter / SF stack. No serifs |
| Palette | Charcoal `#121013`, bone `#EEE8DC`, teal `#3DB8A7`, ochre `#E0A949`, rust `#C9634A` |

## 3. Files

| File | Purpose |
|---|---|
| `pitch.html` | The entire app, single self-contained file (repo pattern, like `edgelab.html`) |
| `pitch.webmanifest` | PWA install (phone home-screen, full-screen) |
| `pitch-sw.js` | Service worker: offline shell + asset caching (own scope; does not touch existing `sw.js`) |
| `pitch-assets/library.xlsx` | Owner-maintained asset library (see §5) |
| `pitch-assets/*` | Photos (`<id>.jpg`), videos (`<id>.mp4`), TOOLFLUX flyer PDFs, TOOLFLUX logo light + dark variants |
| `pitch-assets/manifest.json` | Generated/maintained list of curated pitch cards built by Claude (product families + TFX grades from verified facts) |

Vendored libraries inside `pitch.html` or `pitch-assets/`: SheetJS (read `library.xlsx` in browser), pdf.js (render flyer PDFs onto the stage). No CDN dependencies at meeting time.

## 4. Live meeting pipeline

1. **Start**: owner opens page → picks/creates **customer name** (autocomplete from history) → ticks **"today's push"** products (pre-suggested from `promote` column) → Start Meeting. Wake-lock on, mic on (`getUserMedia` with echo cancellation + noise suppression), `● REC` on.
2. **Audio up**: AudioWorklet captures PCM16 @16 kHz → Gemini Live WebSocket. **Audio down**: 24 kHz PCM playback for Flux's voice.
3. **Model**: Gemini native-audio Live model (current native-audio preview at build time; half-cascade Live model as fallback). Enabled features: voice-activity detection, **proactive audio** (model chooses when not to respond), affective dialog, function calling, input + output transcription, session resumption, context-window compression (sliding window) for hour-long meetings.
4. **System prompt** encodes:
   - Verified TOOLFLUX facts only (6 product families, TFX grade table, same-day dispatch, on-site support, Hubli base, contact details). No invented claims, no competitor talk.
   - Balanced co-pilot interjection rules; humour rules (positive only, machining jokes welcome, read the room first).
   - Greeting behaviour: greet a new unheard voice, ask about their day.
   - Identity wit: when asked "what is this?", always a warm witty answer, never a robotic one.
   - Promoted products: **push only inside an existing current** — reinforce with data when owner + customer are already dwelling on that topic; never cold-pivot.
   - Language mirroring: answer in the language mix the room is using.
5. **Tool calls** (function declarations the model can invoke):
   - `show_asset(id)` — slide a product/grade plate onto the stage
   - `show_media(id)` — play a named video or open a flyer PDF (Flux may cue videos on its own judgement AND must play the one asked for by name)
   - `hide_stage()` — return to ribbon-only view
   - `log_signal(kind, note)` — interest / objection / next-step, feeds the intel column and the minutes
   - `capture_contact(name, phone, email, company)` — fills the contact card when the customer shares details (Flux asks for them during wrap-up, framed as "so we can send you the summary")
6. **Recording**: Web Audio graph mixes mic + Flux output → `MediaRecorder` (webm/opus; mp4 fallback on iPhone Safari) → incremental chunks flushed to IndexedDB every few seconds (crash-safe).
7. **Transcript**: input/output transcription events appended live with timestamps and speaker tags (room vs Flux).
8. **Controls on stage**: mute-Flux (instant; long-press = quiet mode until called by name), asset stage manual swipe, End Meeting.

## 5. Owner-built asset library

- **`pitch-assets/library.xlsx`**, two sheets:
  - **Products**: `id`, `name`, `family`, `spec1`…`spec6` (each a `label: value` string), `pitch_line`, `promote` (yes/blank)
  - **Media**: `id`, `file`, `say_when_asked` (comma-separated spoken aliases), `caption`
- Owner pastes downloaded data (any source, including other brands' datasheets) into the sheet.
- **Branding rule (hard):** raw source files are never rendered. Every product renders as a TOOLFLUX plate in the SIGNATURE template — TOOLFLUX logo only, auto light/dark logo variant chosen by computed background/photo luminance. No other brand name, mark, or layout ever reaches the screen. Only owner-supplied TOOLFLUX flyers render as PDFs.
- Photos: `pitch-assets/<id>.jpg` shown uncropped (`object-fit: contain`) on the plate.
- Library parse happens at app load and is cached; a Setup-tab "reload library" button re-reads it.

## 6. Post-meeting

1. End Meeting → recording finalised on-device.
2. Transcript → Gemini REST `generateContent` (JSON-schema output) → three artifacts:
   - **Customer-facing MoM** — customer-safe content only; TOOLFLUX suggestions highlighted with supporting data; agreed next steps. Rendered in SIGNATURE style, large type; share via Web Share API (WhatsApp) or print-to-PDF.
   - **Internal debrief** — objections, buying signals, price sensitivity, follow-ups with suggested timing.
   - **Contact card** — from `capture_contact` + transcript mining; owner-editable before save.
3. Everything files under the selected **customer**. Meetings tab is customer-first: customer → their meetings → audio playback, both documents, downloads.
4. Summaries are regenerable from the stored transcript at any time.
5. Storage meter with per-customer download-and-clear (≈20–40 hour-long meetings fit on a phone).

## 7. Failure handling

- **Network blip**: auto-reconnect with session resumption; ribbon dims + "reconnecting" tag; local recording never stops.
- **No network**: degrades to dumb recorder; Flux rejoins when network returns; transcript gaps patched at summary time by transcribing the stored audio.
- **Quota/key errors**: plain-English banner ("Flux is muted, recording continues"); never a dead screen.
- **Noise**: VAD tuned to ignore machine hum; when in doubt Flux stays silent.
- **Misbehaviour**: instant mute; long-press quiet mode.
- **Crash/battery**: incremental saves mean reopening offers "resume or close & summarise".
- **Session limits**: transparent resumption + context compression; owner never notices.

## 8. Privacy & access

- Page unlisted, `noindex`, absent from nav and sitemap.
- API key and all meeting data live only on the owner's devices; key revocable in Google console if a device is lost.
- Manual recording disclosure is the owner's responsibility; the persistent `● REC` indicator supports it.

## 9. Rehearsal mode & testing

- **Rehearsal mode**: identical experience, tagged practice, excluded from customer history.
- Test plan before first real pitch: mixed-language conversation test; asset/video cueing by name; interruption + mute behaviour; WiFi-kill mid-sentence (reconnect + resumption); phone install (PWA), wake-lock, tab-switch survival; storage meter and download-and-clear; MoM generation quality on a rehearsal transcript.

## 10. Out of scope (explicitly)

- No cloud sync, no email sending, no CRM integration (can be added later; storage layer keeps meetings exportable as JSON to leave the door open).
- No speaker diarisation beyond room-vs-Flux (individual customer voices not separately labelled in v1).
- No customer-facing web link; the customer sees the screen only in person.
