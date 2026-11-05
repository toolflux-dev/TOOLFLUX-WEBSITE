---
name: drawing-to-step
description: Model a paid Drawing to STEP order in Fusion 360 from the customer's 2D drawing, check it dimension by dimension, and export the STEP for Roo to approve. Use when Roo says "model order DTS-…", "do the drawing to STEP orders", or points at a folder in Documents\Drawing to STEP.
---

# Drawing to STEP: modelling an order

A machine shop paid ₹79 and will cut metal from this model. **A wrong dimension costs them a scrapped part.** Your job is a correct model plus an honest check sheet. Roo approves and sends; you never email anyone.

Orders live in `%USERPROFILE%\Documents\Drawing to STEP\<orderId> <part>\` (the desk app `dts-desk.js` creates them):
`BRIEF.md` · `order.json` · `drawing\` (customer files) · `model\` (your output).

## 1. Read before touching Fusion
1. Read `BRIEF.md` and `order.json`: units, material, the customer's notes (e.g. "mid-tolerance", "ignore the keyway").
2. Read every file in `drawing\` (PDF and images with the Read tool; a DXF is text: read entities if useful). Zoom into crops if text is small.
3. **Scope check.** ₹79 covers one simple prismatic or turned part from one sheet. If it is an assembly, a casting with draft/freeform surfaces, or needs more than one sheet: stop and tell Roo in two lines (he quotes on WhatsApp).
4. Write `model\CHECK.md` **first**: a table of every dimension and feature: `| # | feature | value | tolerance | view it comes from |`. Include hole counts, PCDs, angles, chamfers, fillets, threads, depths.
5. **Missing or contradictory dimension?** Do not guess. Write the exact question at the top of CHECK.md and stop; Roo presses "Ask customer" in the desk.

## 2. Model (fusion_mcp_execute, featureType "script")
- New document: `app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)`, parametric design. Do not save it to the cloud unless Roo asks.
- **Fusion API lengths are centimetres.** Write `mm = 0.1` and multiply. For inch drawings, `inch = 2.54`.
- Build like a machinist would: base sketch + extrude for prismatic parts; a half-profile + revolve for turned parts; then holes/pockets as cuts; chamfers and fillets last.
- Model **nominal** sizes unless the notes ask for mid-tolerance. Threads: tap-drill diameter, list the thread in CHECK.md (STEP carries no thread data).
- One body, named after the part. Known trap: the root component's name cannot be changed (RuntimeError 3); name the body instead.
- Do not catch exceptions in scripts; if a script fails, read the error and fix it.

## 3. Check it like an inspector
Run a `readOnly: true` script that measures: bounding box (mm), volume, every cylindrical face's diameter and axis position, hole count. Compare against the CHECK.md table, then fill a result column with ✓ or ✗ and the measured value. Also calculate the volume by hand where the shape allows (as a sanity check, within ~1% before chamfers).
Fix every ✗ before exporting. At the end of CHECK.md write one line per assumption you made.

## 4. Export
- STEP: `em = design.exportManager; em.execute(em.createSTEPExportOptions(<model\\Part name.step>, design.rootComponent))`.
- Preview for the desk: `model\preview.png`, 1600×1200, transparent background. Known trap: setting `camera.viewOrientation` does **not** move the camera when saving images; set `camera.eye`, `camera.target`, `camera.upVector`, `isFitView = True`, then `viewport.camera = cam`, `viewport.refresh()`, `adsk.doEvents()`, then `viewport.saveAsImageFileWithOptions(opts)` with `opts.isBackgroundTransparent = True`.
- Give the body a light appearance ("Steel - Satin") so edges read in the preview.

## 5. Hand over
Tell Roo in three lines: order id, ✓ count / anything he must look at, "ready in the desk app to approve". Leave the Fusion document open for him to inspect. Never call the deliver API yourself.
