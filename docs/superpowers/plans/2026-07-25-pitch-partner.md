# FLUX Pitch Partner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pitch.html` — the FLUX AI voice pitch partner per spec `docs/superpowers/specs/2026-07-25-pitch-partner-design.md`.

**Architecture:** Single self-contained HTML PWA (repo pattern, like `edgelab.html`). Browser connects directly to Gemini Live API over WebSocket (key in localStorage). All meeting data in IndexedDB. Assets from `pitch-assets/` (owner's `library.xlsx` + curated manifest), rendered as TOOLFLUX-branded plates.

**Tech Stack:** Vanilla JS, Web Audio (AudioWorklet), MediaRecorder, IndexedDB, Gemini Live API (`v1beta BidiGenerateContent` WS) + REST `generateContent` for minutes, SheetJS (vendored) for xlsx, pdf.js (vendored) for flyers.

**Testing reality:** Repo has no test framework; app is browser/hardware/API-bound. Each task ends with a browser verification step via the preview server instead of unit tests. Pure-logic pieces (library parser, luminance picker, spec parsing) get console self-tests behind `?selftest=1`.

---

### Task 1: Shell, design tokens, screens skeleton, PWA files

**Files:**
- Create: `pitch.html`, `pitch.webmanifest`, `pitch-sw.js`
- Create: `pitch-assets/` (folder), `pitch-assets/logo-light.png`, `pitch-assets/logo-dark.png` (copy TOOLFLUX logo from site assets; generate light/dark variants)

- [ ] **Step 1:** Create `pitch.html` skeleton: `<meta name="robots" content="noindex,nofollow">`, viewport, manifest link, CSS custom properties from locked palette:

```css
:root{ --bg:#121013; --panel:#17151a; --line:#2a262a; --bone:#EEE8DC; --bone-dim:#a9a193;
  --teal:#3DB8A7; --ochre:#E0A949; --rust:#C9634A; --rec:#c0564c;
  --font:'Segoe UI Variable Display','Segoe UI',system-ui,-apple-system,'Inter',sans-serif; }
```
Five screen `<section>`s toggled by a tiny router: `#screen-setup`, `#screen-home`, `#screen-meeting`, `#screen-summary`, `#screen-history`. Meta tags for standalone PWA (apple-mobile-web-app-capable etc.).

- [ ] **Step 2:** `pitch.webmanifest` (name "TOOLFLUX FLUX", display standalone, bg `#121013`, reuse `icon-192.png`/`icon-512.png`), and `pitch-sw.js` cache-first for the shell + `pitch-assets/` (cache name `flux-v1`, scope limited so existing `sw.js` is untouched).

- [ ] **Step 3:** Verify in preview: page loads dark, no console errors, router switches screens via temporary nav buttons.

- [ ] **Step 4:** Commit `feat(pitch): shell, tokens, PWA scaffolding`.

### Task 2: Settings + IndexedDB storage layer

**Files:** Modify `pitch.html`

- [ ] **Step 1:** `Settings` object in localStorage key `flux_settings`: `{apiKey, voice, ownerName, mode:'balanced'}` with `loadSettings()/saveSettings()`.

- [ ] **Step 2:** IndexedDB `flux_db` v1, stores:

```js
// customers: {id, name, nameLower, createdAt, lastMeetingAt}
// meetings:  {id, customerId, startedAt, endedAt, rehearsal, pushIds:[], signals:[],
//             contacts:[], transcript:[{t, who:'room'|'flux', text}],
//             summary:{customer, internal}|null, audioMime, status:'live'|'done'}
// chunks:    {id, meetingId, seq, blob}   // incremental MediaRecorder output
```
Promise wrapper: `dbPut(store,obj)`, `dbGet`, `dbAll(store, indexRange)`, `dbDelete`. Indexes: meetings by customerId, chunks by meetingId.

- [ ] **Step 3:** `?selftest=1` console test: put/get/delete round-trip on all stores logs `SELFTEST storage OK`.

- [ ] **Step 4:** Verify in preview console; commit `feat(pitch): settings + IndexedDB layer`.

### Task 3: Setup screen (key, voice, connection test)

**Files:** Modify `pitch.html`

- [ ] **Step 1:** Setup UI: API-key field (masked), voice picker of male prebuilt Live voices `["Puck","Fenrir","Charon","Orus","Enceladus"]` default **Fenrir**, "Hear sample" button, "Test connection", "Reload library", owner name field.

- [ ] **Step 2:** Test connection = REST `GET https://generativelanguage.googleapis.com/v1beta/models?key=K` → shows ok/error. Hear sample = short Live WS session sending a text turn ("Namaskara! Flux here, ready when you are.") and playing the audio reply — this also validates the full Live path. Verify actual endpoint/model names against current docs during build (WebSearch) and pin them in one `const GEMINI = {...}` block.

- [ ] **Step 3:** First-run routing: no key → Setup; else Home. Verify in preview with real key absent (error paths render). Commit `feat(pitch): setup screen`.

### Task 4: Asset registry (curated cards + library.xlsx + media + logo contrast)

**Files:**
- Create: `pitch-assets/manifest.json` (curated cards: 6 product families + 7 TFX grades from verified facts, fields matching Products columns)
- Create: `pitch-assets/library-template.xlsx` note → instead ship `pitch-assets/LIBRARY-README.md` + app button "Download blank library.xlsx" generated via SheetJS
- Modify: `pitch.html` (vendor SheetJS min inside a `<script>` block; pdf.js vendored lazily as separate files `pitch-assets/pdf.min.js`, `pitch-assets/pdf.worker.min.js`)

- [ ] **Step 1:** Loader: fetch `manifest.json`; try fetch `pitch-assets/library.xlsx` → SheetJS parse sheets **Products** (`id,name,family,spec1..spec6,pitch_line,promote`) and **Media** (`id,file,say_when_asked,caption`). Merge into registry `{products:Map, media:Map}`; curated cards use ids like `family-udrill`, `grade-tfx-m35`. Cache parsed registry in localStorage `flux_library_cache` with file Last-Modified.

- [ ] **Step 2:** Plate renderer `renderPlate(product)` → SIGNATURE plate DOM (24px title, spec grid teal/ochre accents, photo `<img>` `pitch-assets/<id>.jpg` object-fit:contain with onerror hide, PLATE NN tag, TOOLFLUX logo). Logo contrast: draw photo (or panel bg) to 8×8 canvas, average luminance `L=0.2126R+0.7152G+0.0722B`; `L>140` → dark logo else light.

- [ ] **Step 3:** Media: `renderMedia(m)` → `<video controls playsinline>` for mp4/webm, pdf.js page-flip viewer for pdf (owner TOOLFLUX flyers only). Alias table from `say_when_asked` (comma split, lowercased) for tool-call resolution.

- [ ] **Step 4:** `?selftest=1`: parse a synthetic workbook built in-memory, assert product count/aliases; luminance picker on black/white fixtures. Verify plates visually in preview (temporary gallery route `#gallery`). Commit `feat(pitch): asset registry + plates`.

### Task 5: Home screen (customer + today's push)

**Files:** Modify `pitch.html`

- [ ] **Step 1:** Customer input with autocomplete over `customers.nameLower` (`startsWith`), create-on-enter; recent customers as tappable chips.

- [ ] **Step 2:** "Today's push": checkbox chips of all products, `promote=yes` pre-checked; selection → `meeting.pushIds`.

- [ ] **Step 3:** Rehearsal toggle; Start Meeting button (disabled until customer chosen or rehearsal). Verify flows in preview. Commit `feat(pitch): home screen`.

### Task 6: Audio engine (capture, playback, recorder)

**Files:** Modify `pitch.html`

- [ ] **Step 1:** `AudioEngine.start()`: `getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})`; `AudioContext` (16k capture path): AudioWorklet (inline module via Blob URL) downsamples to PCM16 @16 kHz, posts 20 ms Int16 frames → `onFrame(base64)`.

- [ ] **Step 2:** Playback: 24 kHz queue — decode base64 PCM16 → Float32 → `AudioBufferSourceNode` chained at `nextStartTime`; `bargeIn()` clears queue (model interruption); output also routed into a `MediaStreamDestination`.

- [ ] **Step 3:** Recorder: mix mic stream + model output destination in one `MediaStreamDestination` → `MediaRecorder` (`audio/webm;codecs=opus`, fallback `audio/mp4`), `ondataavailable` every 4 s → `chunks` store with `seq`. Wake lock (`navigator.wakeLock.request('screen')`, re-acquire on visibilitychange).

- [ ] **Step 4:** Verify in preview: mic permission, speak → level meter debug readout moves, chunks accumulate in IndexedDB, playback of a test tone works. Commit `feat(pitch): audio engine`.

### Task 7: Gemini Live client

**Files:** Modify `pitch.html`

- [ ] **Step 1:** `LiveClient` over `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=K`. On open send setup:

```js
{ setup: {
  model: GEMINI.liveModel, // native-audio live model, pinned in Task 3
  generationConfig: { responseModalities:["AUDIO"],
    speechConfig:{ voiceConfig:{ prebuiltVoiceConfig:{ voiceName: settings.voice } } } },
  systemInstruction: { parts:[{ text: buildSystemPrompt(meeting) }] },
  tools: [{ functionDeclarations: TOOL_DECLS }],
  inputAudioTranscription: {}, outputAudioTranscription: {},
  proactivity: { proactiveAudio: true },
  sessionResumption: { handle: resumeHandle || undefined },
  contextWindowCompression: { slidingWindow: {} },
  realtimeInputConfig: { automaticActivityDetection: {} } } }
```
Then stream mic frames as `{realtimeInput:{audio:{data,mimeType:"audio/pcm;rate=16000"}}}`.

- [ ] **Step 2:** Handle messages: `serverContent.modelTurn.parts[].inlineData.data` → playback; `serverContent.interrupted` → `bargeIn()`; `inputTranscription`/`outputTranscription` → transcript append (who: room/flux); `toolCall.functionCalls[]` → dispatch → reply `{toolResponse:{functionResponses:[{id,name,response:{result}}]}}`; `sessionResumptionUpdate.newHandle` → save; `goAway` → proactive reconnect.

- [ ] **Step 3:** `TOOL_DECLS`: `show_asset(id)`, `show_media(id_or_alias)`, `hide_stage()`, `log_signal(kind ∈ interest|objection|next_step, note)`, `capture_contact(name?,phone?,email?,company?)` — with descriptions steering usage per spec (videos: own cue allowed AND on-name mandatory).

- [ ] **Step 4:** `buildSystemPrompt(meeting)`: verified facts block (families, TFX grade table, dispatch, Hubli, contacts), Balanced co-pilot interjection rules, greeting/day-ask, witty identity answers, positive + machining humour gated on room mood, language mirroring (kn/hi/en), push list `meeting.pushIds` with "only inside an existing current" rule, asset catalog digest (id → name/family/pitch_line) so the model knows what it can show, contact-ask during wrap-up, mute/quiet etiquette.

- [ ] **Step 5:** Reconnect: exponential backoff (1s→10s cap), resume handle, "reconnecting" state event; hard failure → `degraded` state (recorder-only). Commit `feat(pitch): Gemini Live client`.

### Task 8: Meeting stage UI (SIGNATURE, live)

**Files:** Modify `pitch.html`

- [ ] **Step 1:** Stage per locked mockup: header row (`TOOLFLUX · MEETING NN` + customer, `● REC mm:ss`), ribbon `<canvas>` full-width — animated dashed gradient path (teal→ochre→rust), amplitude-modulated by live mic/flux levels (idle = gentle undulation, speech = tighter/taller); quote line bottom-left = last transcript line (21px, speaker tag); intel column bottom-right from `log_signal` events (teal Interest / ochre Objection / rust Next).

- [ ] **Step 2:** Asset stage: plate/media container; on `show_asset` ribbon eases to slim top strip (CSS transition ~400 ms) and plate slides up; `hide_stage()` reverses. Manual swipe/arrow to page PDFs, tap-outside to dismiss.

- [ ] **Step 3:** Controls: mute-Flux (tap = mute voice, long-press 600 ms = quiet mode until name heard — implemented as mute + system message via `{realtimeInput:{text:...}}` note "owner engaged quiet mode: stay silent unless addressed as Flux"), End Meeting (confirm sheet). Status banners (reconnecting / quota / degraded recorder) as top toasts in plain English.

- [ ] **Step 4:** Verify full loop in preview with real key: talk, watch transcript + ribbon; ask Flux to show a plate and play a video by name. Commit `feat(pitch): meeting stage`.

### Task 9: End meeting → minutes + contacts

**Files:** Modify `pitch.html`

- [ ] **Step 1:** Finalize: stop recorder, close WS, `meeting.status='done'`, stitch chunks lazily (Blob concat on demand for playback/download).

- [ ] **Step 2:** Summary via REST `POST /v1beta/models/{GEMINI.textModel}:generateContent` with transcript + signals + push list, `responseMimeType:"application/json"` + `responseSchema`:

```js
{ customer_mom: { discussed:[...], suggestions:[{item, why, data}], next_steps:[...] },
  internal_debrief: { objections:[...], buying_signals:[...], price_sensitivity, followups:[{what,when}] },
  contacts: [{name,phone,email,company}] }
```
Customer-safe rule in prompt: nothing internal (costs, hesitation reads) in `customer_mom`; suggestions must carry supporting data.

- [ ] **Step 3:** Summary screen: two tabs (Customer MoM styled SIGNATURE large-type; Internal debrief), editable contact card, actions: Share (Web Share API), Print (print stylesheet → PDF), Regenerate, Save. Commit `feat(pitch): minutes + contacts`.

### Task 10: History (customer-first), storage meter, degraded/rehearsal polish

**Files:** Modify `pitch.html`

- [ ] **Step 1:** History screen: customer list (last meeting date) → meetings → detail (audio `<audio>` from stitched blob, both docs, downloads: audio + transcript .txt + MoM .html + meeting .json export). Rehearsal meetings under a separate "Rehearsals" pseudo-customer, excluded from real history.

- [ ] **Step 2:** Storage meter (`navigator.storage.estimate()`), per-customer "Download all & clear" (zip-less: sequential file downloads then delete after confirm).

- [ ] **Step 3:** Crash recovery: on load, any meeting `status='live'` → "Resume or close & summarise?" sheet (summarise = transcribe stored audio via REST `generateContent` with audio parts if transcript has gaps).

- [ ] **Step 4:** Full pass of spec §7 failure banners; register SW; Lighthouse-ish manual check on phone viewport. Commit `feat(pitch): history + resilience`.

### Task 11: Ship checklist

- [ ] `LIBRARY-README.md` for the owner (how to fill library.xlsx, name videos, drop photos).
- [ ] Rehearsal end-to-end on laptop preview with real key: mixed-language chat, plate + named video, mute/quiet, kill-WiFi reconnect, end → both docs render, share/print.
- [ ] Confirm `noindex`, absent from nav/sitemap. Commit `feat(pitch): ship`.

---

## Self-review

Spec coverage: §1-§10 all mapped (persona/prompt T7; assets/branding T4; customer records T5/T10; push T5/T7; personality T7; recording T6; minutes T9; failure T7/T8/T10; rehearsal T5/T10; access T1/T11). No placeholders beyond deliberate build-time pinning of model ids (verified via docs in Task 3). Names consistent: `show_asset/show_media/hide_stage/log_signal/capture_contact`, `GEMINI` const, stores `customers/meetings/chunks`.
