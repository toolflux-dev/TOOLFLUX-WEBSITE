---
name: drawing-to-step
description: Model a Drawing to STEP order in Fusion 360 from the customer's 2D drawing, check it dimension by dimension, export the STEP, file it in the Fusion "Drawing to STEP" library (newest 10 kept), and write the PASS/HOLD verdict the desk app acts on. Used unattended by the desk app for every order, or when Roo says "model order DTS-…".
---

# Drawing to STEP: modelling an order

The service is free and fully automatic. A machine shop will cut metal from this model, and **when your verdict is PASS the STEP is emailed to them with no human check**. So: model carefully, measure everything, and HOLD whenever you are not sure. A held order costs Roo a few minutes; a wrong model costs the customer a scrapped part. Never write customer-facing text about how the model is made.

Orders live in `%USERPROFILE%\Documents\Drawing to STEP\<orderId> <part>\` (the desk app creates them):
`BRIEF.md` · `order.json` · `drawing\` (customer files, up to 10) · `model\` (your output).

## 0. Fusion connection
- Run `node dts-desk.js --check-fusion`. All four lines must read OK; otherwise write a HOLD verdict with the failing line as the reason and stop.
- Fusion tools may appear as `mcp__fusion__*`. If they are missing (the session started before Fusion answered), run every script through `node fusion/fx.js <script.py>` (`--ro` for read-only). Write each script to a `.py` file in the order's `model\` folder with `def run(_context: str):`.

## 1. Read before touching Fusion
1. Read `BRIEF.md` and `order.json`: units, material, the customer's notes (e.g. "mid-tolerance", "ignore the keyway").
2. Read the drawing from **`drawing\_pages\`**: the desk renders every PDF page and image there before you start, as `<name>-pN.png` (whole sheet) and `<name>-pN-rRcC.png` (3 × 3 close-ups, 3× sharper). Read the overview first, then every close-up that holds dimensions, tolerances, sections or notes; small text is legible in the close-ups. (Only if `_pages` is missing, read the originals in `drawing\`; a DXF is text.) Multi-sheet orders: every sheet before modelling.
   If `order.json` notes contain **"Customer answer"**, this order was asked a question before: use the answer (and any new files it lists).
3. **Any drawing is accepted**: turned, prismatic, castings and forgings, assemblies, multi-sheet. An assembly becomes one design with one component (and body) per part, positioned as drawn; export the whole design as one STEP.
4. Write `model\CHECK.md` **first**: `| # | feature | value | tol | view it comes from | measured | ✓/✗ |` covering every dimension and feature: hole counts, PCDs, angles, chamfers, fillets, threads, depths, draft angles, derived sizes (e.g. spigot height = overall − flange).
5. **Missing or contradictory dimension, unreadable text, a sketch without the sizes you need?** Do not guess: finish with a **QUESTION** verdict, and the customer is emailed your question with a link to answer it. A *minor reading* (e.g. which edges "outer edges" means, an unstated general chamfer covered by the title-block note) is not a question: record it under **Assumptions**, model the most ordinary reading, and mention it in `customerNote`. Standards the drawing names (ISO 2768, DIN 3852, thread standards) are information you have: use them rather than asking.

## 2. Model (fusion execute tool or fx.js, featureType "script")
- New document: `app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)`, parametric design, display units mm (or inch to match the drawing).
- **Fusion API lengths are centimetres.** `mm = 0.1`, `inch = 2.54`.
- Build like a machinist would: half-profile + **revolve** for turned parts (sketch on XZ, place points with `sketch.modelToSketchSpace(Point3D(r, 0, z))`); base sketch + extrude for prismatic parts; holes/pockets as cuts; draft on cast faces where drawn; chamfers and fillets last, selecting edges by measured radius and height, not by index.
- Nominal sizes unless the notes ask for mid-tolerance. Threads: tap-drill diameter, thread listed in CHECK.md and in `customerNote` (STEP carries no thread data).
- Name bodies/components after the parts; hide sketches. Known trap: the root component's name cannot be changed.
- Do not catch exceptions in scripts; read errors and fix. Print timeline health at the end (all 0 = healthy).

## 3. Check it like an inspector
A read-only script measures: body count and solidity, bounding box (mm), volume, every cylindrical face's diameter, axis offset, angle and z-range, cone (chamfer) and plane counts as relevant. Fill the measured and ✓/✗ columns. Hand-calculate the volume where the shape allows, under **Volume cross-check**; within 1%. Fix every ✗ you can; a ✗ you cannot fix is a HOLD. End CHECK.md with `Result: N / N ✓`.

## 4. Export
- "Steel - Satin" appearance on all bodies.
- STEP: `em.execute(em.createSTEPExportOptions(<model\\Part name.step>, design.rootComponent))`.
- Preview `model\preview.png`, 1600×1200, transparent. Trap: `camera.viewOrientation` does not move the camera for saved images; set `eye`/`target`/`upVector`, `isFitView = True`, `viewport.camera = cam`, `viewport.refresh()`, `adsk.doEvents()`, then `saveAsImageFileWithOptions` with `isBackgroundTransparent = True`.
- Look at preview.png yourself (Read tool) before the verdict: does it look like the drawing?

## 5. File it in the Fusion library
Copy `fusion/dts_library.py` to the order's `model\`, set its `ORDER` and `PART` lines, run it. It saves the design to the Fusion project **"Drawing to STEP"** and keeps only the newest **10** order models (older `DTS-…` files deleted; other files and open files never touched).

## 6. Verdict (always the last action)
Write `model\VERDICT.json`, exactly one of:
```json
{ "verdict": "PASS", "checks": "12/12", "assumptions": ["…"], "customerNote": "Threaded holes M8 are modelled at the 6.8 mm tap-drill size." }
{ "verdict": "QUESTION", "question": "Section A-A gives no depth for the Ø12 counterbore. What depth should it be, and is the bottom flat or drill-point?", "reason": "counterbore depth missing" }
{ "verdict": "HOLD", "reason": "Fusion script error in the revolve I could not fix: …" }
```
- **PASS** only if every check passed (`checks` is `N/N`), the STEP file exists in `model\`, and the preview matches the drawing. The desk emails the STEP with `customerNote` (short, factual, about the model only; omit if nothing to say).
- **QUESTION** when the customer must supply something: missing or conflicting dimensions, unreadable text, an undimensioned feature. The desk emails `question` to the customer **word for word**, with an answer link; their answer re-queues the order. Write it for a machinist: name the feature and view, say exactly what you need, and offer a sensible option where there is one ("…or should we model the plain body without the pockets?"). One email, all questions in it. Polite, no internal details (no mention of Claude, Fusion, scripts or logs).
- **HOLD** only for problems on our side (Fusion or tool errors, a shape our tools cannot build). The desk emails Roo, not the customer.

## Automatic runs
The desk app starts you with `claude -p` for each queued order. Nobody is watching: never ask questions, never wait for input, never email or call the backend. If the drawing lacks information, write a QUESTION verdict; if you get stuck on our side (tool error you cannot fix, Fusion not answering), write a HOLD verdict. Then finish.
