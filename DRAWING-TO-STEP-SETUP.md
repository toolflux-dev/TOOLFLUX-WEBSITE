# Drawing to STEP: setup and daily use

Free for every machine shop, fully automatic. A customer uploads a drawing on `drawing-to-step.html`; the desk app on this PC picks it up, Claude models it in Fusion 360, measures it against the drawing, and the STEP is emailed from toolflux@gmail.com. If any check fails, the order is **held** and Roo gets an email instead.

| Piece | File | Runs where |
| --- | --- | --- |
| Customer page | `drawing-to-step.html`, `dts-order.js`, `assets/dts/` | toolflux.co.in (GitHub Pages, `main`) |
| Order backend | `dts-sync.gs` | Google Apps Script project "Drawing to STEP", as toolflux@gmail.com |
| Desk app + automation | `dts-desk.js`, `dts-auto.js`, `DRAWING-TO-STEP.cmd` | this PC, http://localhost:7781 |
| Modelling playbook | `.claude/skills/drawing-to-step/SKILL.md` | Claude Code (started by the desk) + Fusion |
| Fusion library + direct client | `fusion/dts_library.py`, `fusion/fx.js` | Fusion on this PC |

## What has to be running
1. **Fusion**, signed in as toolflux@gmail.com, with Preferences > General > API > **Fusion MCP Server** ticked.
2. **The desk app.** It checks for orders every 2 minutes and models them one at a time. If Fusion or the Claude sign-in is not ready, it waits (dashboard banner) and starts as soon as they are.

## Running by itself (updated 2026-11-09)
Nothing to start by hand. At Windows login:
- `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Drawing to STEP desk.vbs` (copy: `tools/dts-run-desk-hidden.vbs`) starts `Documents\Drawing to STEP\run-desk.cmd` **hidden**: no window to close by accident. **Delete that Startup file to stop auto-start.**
- `run-desk.cmd` (copy: `tools/dts-run-desk.cmd`) runs the desk from `Documents\Drawing to STEP\_app`, a detached git worktree it updates to `origin/main` on every start, and restarts the desk 30 s after it stops. A second copy notices the first and exits. Log: `Documents\Drawing to STEP\desk-autostart.log`.
- The desk **opens Fusion** (Start Menu shortcut "Autodesk Fusion") when it is not running, then waits for it to answer.
- To stop it completely: Task Manager → end `node.exe` "dts-desk" and the `cmd.exe` running run-desk.cmd, or delete the Startup file and log off.
- Recreate `_app` if it is ever deleted: `git worktree add --detach "%USERPROFILE%\Documents\Drawing to STEP\_app" origin/main` from the repo.
- Dashboard: http://localhost:7781.

## Watchdog
Every desk check sends the backend a heartbeat with the desk's health. Every 15 minutes the backend (`watchdog`, trigger made by `setupWatchdog`) looks for orders queued over 30 minutes. If the desk has gone quiet, is paused (sign-in, usage limit), is switched off, or is waiting for Fusion, you get **one** email ("Orders are waiting") saying what to do. It repeats at most every 6 hours for the same problem.

## Light or full model
`fusion/drawing_complexity.py` measures the drawing. One vector sheet with up to 1,200 drawn paths goes to the light model (Sonnet) first; photos/scans, multi-sheet, bigger drawings and re-runs after a customer's answer use the full model (Opus). If the light model does not reach PASS, the full model re-runs the order before anything reaches the customer. Change with `DTS_MODEL_LIGHT`, `DTS_MODEL_FULL`, `DTS_LIGHT_MAX_PATHS`. The model used is in the desk log.

## Claude sign-in (one time)
The desk starts the **standalone Claude Code** to model orders. It signs in separately from the Claude app, and a desk job fails with "OAuth session expired" when it is signed out. The desk now checks this before every job (`node dts-desk.js --check-fusion`, line "Claude Code is signed in") and pauses with a banner instead of failing orders.
- **Sign in:** in a terminal run `"%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\<version>\<hash>\claude.exe" auth login` and finish the browser sign-in as toolflux@gmail.com. Check with `... claude.exe auth status` (`"loggedIn": true`).
- **Longer-lasting alternative:** `... claude.exe setup-token` creates a token valid for about a year. Store it as a Windows user variable `CLAUDE_CODE_OAUTH_TOKEN` (System Properties > Environment Variables), then restart the desk.
- After signing in, press **Retry automatic** in the desk (or restart it); paused orders are still queued.

## How an order flows
1. Customer presses **Send the drawing** → drawing saved to Drive, row in the [orders sheet](https://docs.google.com/spreadsheets/d/1FxonlXW6iH5d_UOD3S-DWmSrbGwznSQzCehIzcRqQN0), "Sit tight" email to the customer, "New order" email to Roo. Status **queued**.
2. Desk downloads it to `Documents\Drawing to STEP\<order> <part>\`, marks it **modelling**, and starts Claude Code unattended (`claude -p`, only file, Fusion and `fusion/fx.js` tools allowed).
3. Claude reads the drawing, writes `model\CHECK.md`, models and measures in Fusion, exports the STEP and preview, files the model in the Fusion library (newest 10 kept), and writes `model\VERDICT.json`.
4. **PASS** (every check passed, STEP present) → the desk emails the STEP to the customer, with a feedback request. **HOLD** → status **held**, Roo gets a "Needs you" email with the reason; the customer hears nothing yet.

For a held order: open the desk, read the reason and `CHECK.md`, then either fix the model yourself and press **Approve and send STEP**, ask the customer (**Ask customer**), or press **Model automatically again**. **Pause automatic** stops new jobs.

## Limits built in
- Up to 10 files, 10 MB each, 25 MB total; at least one PDF or image (a DXF/DWG alone is refused: dimensions are read from the drawing). Phone photos and HEIC are resized to 3200 px JPEG in the browser.
- Spam guard: 6 uploads an hour per email. No other limit.
- One modelling job at a time; a job is stopped after 45 minutes and the order held (`DTS_JOB_TIMEOUT_MIN` to change).
- Delivery: STEP required, 20 MB cap.

## Fusion connection
Fusion's own MCP server: `http://127.0.0.1:27182/mcp`. Registered directly in Claude Code (`claude mcp add --transport http --scope user fusion http://127.0.0.1:27182/mcp`), so app updates cannot wipe it. Check any time: `node dts-desk.js --check-fusion`. Sessions started before Fusion answers have no Fusion tools; Claude then uses `node fusion/fx.js`, which always works while Fusion runs.

## Backend changes
Edit `dts-sync.gs`, paste it into the Apps Script editor, save, then **Deploy ▸ Manage deployments ▸ Edit ▸ Version: New version ▸ Deploy**. The web-app URL stays the same.

## Tests
`node --test tests/dts-sync.test.js tests/dts-order.test.js tests/dts-desk.test.js tests/dts-auto.test.js` and `python -I tests/dts_library_test.py`.
On localhost, `drawing-to-step.html?demo=1` runs the page flow against a fake backend (`&fail=1` shows an upload error).
