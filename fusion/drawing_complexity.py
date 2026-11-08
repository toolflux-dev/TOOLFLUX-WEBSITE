# Drawing to STEP: how busy is this order's drawing? Used to pick the light or the full Claude model.
#
#   python -I fusion/drawing_complexity.py "<order folder>"   -> one line of JSON
#
# sheets       PDF pages + images
# vectorPaths  line/arc/curve groups on the PDF pages (a CAD export draws every edge and dimension as paths)
# words        text words on the PDF pages (dimensions, notes, title block)
# raster       true when any sheet is a photo or scan (no vector data to judge it by)
import json
import os
import sys

try:
    import pymupdf as fitz
except ImportError:
    import fitz


def measure(order_dir):
    src = os.path.join(order_dir, 'drawing')
    out = {'sheets': 0, 'vectorPaths': 0, 'words': 0, 'raster': False, 'files': 0}
    for name in sorted(os.listdir(src)):
        path = os.path.join(src, name)
        ext = os.path.splitext(name)[1].lower()
        if not os.path.isfile(path):
            continue
        out['files'] += 1
        if ext in ('.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'):
            out['sheets'] += 1
            out['raster'] = True
        elif ext == '.pdf':
            doc = fitz.open(path)
            for page in doc:
                out['sheets'] += 1
                paths = len(page.get_drawings())
                words = len(page.get_text('words'))
                out['vectorPaths'] += paths
                out['words'] += words
                if page.get_images() and paths < 50:   # a scanned page: a picture of the drawing inside a PDF
                    out['raster'] = True
            doc.close()
    return out


if __name__ == '__main__':
    print(json.dumps(measure(sys.argv[1])))
