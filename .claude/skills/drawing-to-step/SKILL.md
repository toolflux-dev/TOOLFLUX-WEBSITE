---
name: drawing-to-step
description: Model a Drawing to STEP order in Fusion 360 from the customer's 2D drawing, check it dimension by dimension, export the STEP, and file the model in the Fusion "Drawing to STEP" library (newest 10 kept) for Roo to approve. Use when Roo says "model order DTS-…", "do the drawing to STEP orders", or points at a folder in Documents\Drawing to STEP.
---

# Drawing to STEP: modelling an order

A machine shop will cut metal from this model. **A wrong dimension costs them a scrapped part.** Your job is a correct model plus an honest check sheet. Roo approves and sends; you never email anyone. Never write customer-facing text about how the model is made.

Orders live in `%USERPROFILE%\Documents\Drawing to STEP\<orderId> <part>\` (the desk app `dts-desk.js` creates them):
`BRIEF.md` · `order.json` · `drawing\` (customer files) · `model\` (your output).

## 0. Fusion connection
- Run `node dts-desk.js --check-fusion` from the TOOLFLUX-WEBSITE repo. Four lines must read OK; each failing line prints its fix. Do not start modelling on a FIX.
- Fusion tools appear as `mcp__fusion__*` (direct HTTP server in Claude Code's user config, the reliable one) and/or `mcp__Autodesk_Fusion__*` (Claude Desktop extension). Either works; they talk to the same Fusion on port 27182.
- **No Fusion tools in the session but the check is all OK?** The session started before Fusion had finished starting (Claude Code connects only at session start). Don't ask for a restart: run every script through the direct client instead, `node fusion/fx.js <script.py>` (add `--ro` for read-only scripts). Write each script to a scratch `.py` file with `def run(_context: str):`; output and errors come back exactly as from the MCP tool. `node fusion/fx.js --ping` confirms Fusion is answering.

## 1. Read before touching Fusion
1. Read `BRIEF.md` and `order.json`: units, material, the customer's notes (e.g. "mid-tolerance", "ignore the keyway").
2. Read every file in `drawing\` (PDF and images with the Read tool; a DXF is text: read entities if useful). Zoom into crops if text is small.
3. **Scope check.** One order covers one simple prismatic or turned part from one sheet. If it is an assembly, a casting with draft/freeform surfaces, or needs more than one sheet: stop and tell Roo in two lines (he quotes on WhatsApp).
4. Write `model\CHECK.md` **first**: a table of every dimension and feature: `| # | feature | value | tol | view it comes from | measured | ✓/✗ |`. Include hole counts, PCDs, angles, chamfers, fillets, threads, depths, and derived sizes (e.g. spigot height = overall − flange).
5. **Missing or contradictory dimension?** Do not guess. Write the exact question at the top of CHECK.md and stop; Roo presses "Ask customer" in the desk. A *minor reading* (e.g. which edges "outer edges" means) is not a stop: record it under **Assumptions** and model the most ordinary reading.

## 2. Model (fusion execute tool, featureType "script")
- New document: `app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)`, parametric design, display units set to mm (or inch to match the drawing).
- **Fusion API lengths are centimetres.** Write `mm = 0.1` and multiply. For inch drawings, `inch = 2.54`.
- Build like a machinist would: a half-profile + **revolve** for turned parts (sketch on XZ, map points with `sketch.modelToSketchSpace(Point3D(r, 0, z))` so the orientation is never guessed); base sketch + extrude for prismatic parts; then holes/pockets as cuts; chamfers and fillets last, selecting edges by measured radius and height, not by index.
- Model **nominal** sizes unless the notes ask for mid-tolerance. Threads: tap-drill diameter, list the thread in CHECK.md (STEP carries no thread data).
- One body, named after the part; hide the sketches. Known trap: the root component's name cannot be changed (RuntimeError 3).
- Do not catch exceptions in scripts; if a script fails, read the error and fix it. Print the timeline health at the end (all 0 = healthy).

## 3. Check it like an inspector
Run a `readOnly: true` script that measures: body count and solidity, bounding box (mm), volume, every cylindrical face's diameter, axis offset, angle and z-range, and the chamfer (cone) face count. Fill the measured and ✓/✗ columns of CHECK.md. Calculate the volume by hand where the shape allows and write both numbers under **Volume cross-check**; they should agree within 1%. Fix every ✗ before exporting. Finish CHECK.md with a **Result** line (e.g. `10 / 10 ✓`).

## 4. Export
- Give the body the "Steel - Satin" appearance so edges read in the preview.
- STEP: `em = design.exportManager; em.execute(em.createSTEPExportOptions(<model\\Part name.step>, design.rootComponent))`.
- Preview for the desk: `model\preview.png`, 1600×1200, transparent background. Known trap: `camera.viewOrientation` does **not** move the camera for saved images; set `camera.eye`, `camera.target`, `camera.upVector`, `isFitView = True`, then `viewport.camera = cam`, `viewport.refresh()`, `adsk.doEvents()`, then `viewport.saveAsImageFileWithOptions(opts)` with `opts.isBackgroundTransparent = True`.
- Look at preview.png yourself before handing over.

## 5. File it in the Fusion library
Run `fusion/dts_library.py` (repo root) with its `ORDER` and `PART` lines set to this order: copy it to a scratch file, edit those two lines, and send it with the MCP tool or `node fusion/fx.js <copy>.py`. It saves the active design to the Fusion project **"Drawing to STEP"** as `<orderId> <part>`, waits for the upload, and keeps only the **newest 10** order models there: older `DTS-…` files are deleted; anything else in the project, and any file open in Fusion, is never touched. Report its "deleted:" line to Roo.

## 6. Hand over
Tell Roo in three lines: order id, ✓ count / anything he must look at (assumptions), "ready in the desk app to approve". Leave the Fusion document open for him to inspect. Never call the deliver API yourself.
