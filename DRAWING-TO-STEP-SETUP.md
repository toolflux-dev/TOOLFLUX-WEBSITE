# Drawing to STEP: setup and daily use

Customer uploads a drawing on `drawing-to-step.html`, pays ₹79 by Razorpay (the first 25 parts are free), the drawing lands on this PC, Claude models it in Fusion 360, Roo approves, and the STEP is emailed from toolflux@gmail.com.

| Piece | File | Runs where |
| --- | --- | --- |
| Customer page | `drawing-to-step.html`, `dts-order.js`, `assets/dts/` | toolflux.co.in (GitHub Pages) |
| Order backend | `dts-sync.gs` | Google Apps Script, as toolflux@gmail.com |
| Desk app | `dts-desk.js`, `DRAWING-TO-STEP.cmd` | this PC, http://localhost:7781 |
| Modelling playbook | `.claude/skills/drawing-to-step/SKILL.md` | Claude Code + Fusion MCP on this PC |

## One-time setup (about 15 minutes)

1. **Apps Script.** script.google.com → New project → name it *Drawing to STEP* → paste all of `dts-sync.gs`.
2. Run **`setup`** once (Run ▸ setup, allow the permissions). The log prints the **DESK_KEY** and the orders sheet link. It creates the Drive folder *Drawing to STEP orders*, the sheet, and a daily cleanup at 3 am.
3. **Razorpay keys.** Razorpay dashboard ▸ Account & Settings ▸ API keys. Start in **Test mode**. Project Settings ▸ Script Properties: add `RZP_KEY_ID` and `RZP_KEY_SECRET`. (The secret never leaves Apps Script; the page only gets the key id.)
4. **Deploy.** Deploy ▸ New deployment ▸ Web app ▸ Execute as *Me*, access *Anyone*. Copy the `/exec` URL.
5. **Website.** Paste the URL into `DTS_URL` at the top of `dts-order.js`. Until it is set, the page sends people to WhatsApp instead.
6. **Desk.** Double-click `DRAWING-TO-STEP.cmd` → paste the `/exec` URL and the DESK_KEY.
7. **Test end to end with Razorpay test mode:** upload a drawing on the live page, pay with a test card, see it in the desk, deliver a STEP to your own email. Then switch Script Properties to the **live** keys and redeploy (Manage deployments ▸ edit ▸ New version, so the URL stays the same).

No webhook is needed: the payment is confirmed by the signature Razorpay hands the page, and any order still showing "awaiting payment" is re-checked with Razorpay's API when the desk refreshes and before the nightly cleanup.

## Free launch (first 25 parts)
The first 25 orders are free, one per customer (matched by email or phone). They skip payment and arrive in the desk like paid orders, marked FREE in your email. After the 25th, the page switches itself to paid ordering.
- You can launch free **before** setting up Razorpay (skip step 3). With no Razorpay keys, once the free parts are gone the page sends customers to WhatsApp instead of taking payment.
- Change the number with the Script Property `FREE_LIMIT` (`0` = paid from the start).
- Free customers get a feedback request in the delivery email.

## Fusion connection (keeps working across updates)
Claude talks to Fusion through Fusion's own MCP server on `http://127.0.0.1:27182/mcp`.
- **In Fusion:** Preferences > General > API > tick **Fusion MCP Server**. (Stored in `%APPDATA%\Autodesk\Neutron Platform\Options\NMachineSpecificOptions.xml`, a UTF-16 file.)
- **In Claude Code:** registered directly, so it no longer depends on the Claude Desktop extension and its `mcp-remote` relay, which an app update can wipe. Done on 2026-11-05 with:
  `claude mcp add --transport http --scope user fusion http://127.0.0.1:27182/mcp`
  On this PC `claude` lives at `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\<version>\<hash>\claude.exe`.
- **Check it any time:** `node dts-desk.js --check-fusion` (the desk app also shows it as a banner). Each failing line prints its fix.
- **Startup order no longer matters.** Claude Code connects to MCP servers only when a session starts, so a session opened while Fusion was still loading has no Fusion tools. Claude then uses `node fusion/fx.js`, which talks to Fusion directly whenever it is running (`node fusion/fx.js --ping` to test). Fusion takes a minute after launch before it answers.

## Fusion library
Every finished model is saved to the Fusion project **Drawing to STEP** as `<order> <part>`. Only the newest **10** order models are kept; older `DTS-…` files are deleted automatically. Files you add to that project yourself, and any file open in Fusion, are never touched. Change the number with `KEEP` in `fusion/dts_library.py`.

## Daily use

1. Open the desk (`DRAWING-TO-STEP.cmd`). Paid orders download into `Documents\Drawing to STEP\<order> <part>\`. You also get an email for each order.
2. Open Fusion, then in Claude Code (this repo): **"model order DTS-…"**. Claude checks the Fusion connection, reads the drawing, writes `model\CHECK.md`, models and measures the part, exports `model\<part>.step` and `model\preview.png`, and files the model in the Fusion library.
3. In the desk: look at the preview, open the check sheet, check the model in Fusion yourself. Add a note if needed (for example "threads modelled at tap-drill size").
4. **Approve and send STEP.** The customer gets the STEP by email; the order folder moves to `_delivered`.

Unclear drawing: **Ask customer** marks the order *query* and opens an email to them. A refund goes through the Razorpay dashboard; then mark the row *refunded* in the sheet.

## Limits built in
- Up to 3 files, 10 MB each, 15 MB total; at least one PDF or image (a DXF or DWG alone is refused, because Claude reads dimensions from the drawing). Phone photos and HEIC are resized to 3200 px JPEG in the browser.
- At most 6 orders per email per hour. Unpaid uploads are deleted after 3 days.
- Delivery: STEP required, 20 MB cap (Gmail attachment limit 25 MB).

## Tests
`node --test tests/dts-sync.test.js tests/dts-order.test.js tests/dts-desk.test.js` and `python -I tests/dts_library_test.py`
On localhost, `drawing-to-step.html?demo=1` runs the whole order flow against a fake backend and checkout.
