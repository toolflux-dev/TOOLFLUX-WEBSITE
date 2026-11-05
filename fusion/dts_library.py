# Drawing to STEP: Fusion cloud library step.
#
# Saves the ACTIVE design into the Fusion project "Drawing to STEP" as "<ORDER> <PART>",
# then keeps only the newest KEEP order models there. Older ones are deleted.
# Only files whose names start with "DTS-" are ever touched; anything else Roo puts in
# the project is left alone, and so is any file that is open in Fusion.
#
# Run through the Fusion MCP (featureType "script"): send this file's text with the two
# lines below changed to the order's id and part name. Prints a short report.

ORDER = 'DTS-000000-XXXX'
PART = 'part name'

PROJECT = 'Drawing to STEP'
KEEP = 10

import time
try:
    import adsk.core, adsk.fusion
except ImportError:  # unit tests import plan() without Fusion
    adsk = None


def plan(files, keep, open_ids):
    """Which order models to keep and which to delete. files: objects with .name .id .dateCreated."""
    orders = sorted([f for f in files if f.name.startswith('DTS-')], key=lambda f: f.dateCreated, reverse=True)
    kept = orders[:keep]
    delete = [f for f in orders[keep:] if f.id not in open_ids]
    held = [f for f in orders[keep:] if f.id in open_ids]
    return kept, delete, held


def _project(app):
    hub = app.data.activeHub
    for i in range(hub.dataProjects.count):
        p = hub.dataProjects.item(i)
        if p.name == PROJECT:
            return p
    return hub.dataProjects.add(PROJECT)


def _clean(name):
    bad = '\\/:*?"<>|'
    return ''.join('_' if c in bad else c for c in name).strip()[:120]


def run(_context: str):
    app = adsk.core.Application.get()
    doc = app.activeDocument
    design = adsk.fusion.Design.cast(app.activeProduct)
    if design is None or design.rootComponent.bRepBodies.count == 0:
        raise RuntimeError('Active document has no solid: model the part before saving it to the library.')
    if not ORDER.startswith('DTS-'):
        raise RuntimeError('ORDER must be the order id, e.g. DTS-261105-X2DF')

    folder = _project(app).rootFolder
    name = _clean(ORDER + ' ' + PART)

    if doc.isSaved and doc.dataFile and doc.dataFile.parentFolder.parentProject.name == PROJECT:
        doc.save('Drawing to STEP: updated model')
        print('saved new version of', doc.dataFile.name)
    else:
        if not doc.saveAs(name, folder, 'Drawing to STEP order ' + ORDER, ''):
            raise RuntimeError('saveAs failed')
        print('saved as', name, 'in', PROJECT)

    # wait for the cloud upload so the rotation below sees this file
    for _ in range(120):
        adsk.doEvents()
        df = doc.dataFile
        if df and df.isComplete:
            break
        time.sleep(0.5)

    open_ids = set()
    for i in range(app.documents.count):
        d = app.documents.item(i)
        if d.dataFile:
            open_ids.add(d.dataFile.id)

    files = [folder.dataFiles.item(i) for i in range(folder.dataFiles.count)]
    kept, delete, held = plan(files, KEEP, open_ids)
    removed, skipped = [], [f.name + ' (open)' for f in held]
    for f in delete:
        if f.deleteMe():
            removed.append(f.name)
        else:
            skipped.append(f.name + ' (delete failed)')
    print('library now holds', len(kept), 'order models (keep', KEEP, ')')
    print('deleted:', removed or 'none')
    if skipped:
        print('not deleted:', skipped)
