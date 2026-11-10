# Drawing to STEP: turn customer drawings into images Claude can read closely.
#
#   python -I fusion/render_drawings.py "<order folder>"
#
# For every PDF page and every image in <order>\drawing\ it writes into <order>\drawing\_pages\:
#   <name>-p<N>.png           the whole sheet, 2400 px on the long side (overview)
#   <name>-p<N>-r<R>c<C>.png  3 x 3 overlapping close-ups, each 3x the overview's detail
# so small dimension text, tolerances and section details are legible with the Read tool.
# Unattended runs have no shell for rendering, which is why the desk does this before Claude starts.
# Needs only PyMuPDF (fitz); it opens PDFs and images alike.
import os
import sys

try:
    import pymupdf as fitz  # PyMuPDF
except ImportError:
    import fitz

OVERVIEW_PX = 2400
GRID = 3
OVERLAP = 0.12
KINDS = ('.pdf', '.png', '.jpg', '.jpeg', '.webp')


def render(order_dir):
    src = os.path.join(order_dir, 'drawing')
    out = os.path.join(src, '_pages')
    os.makedirs(out, exist_ok=True)
    made = 0
    for name in sorted(os.listdir(src)):
        path = os.path.join(src, name)
        if not os.path.isfile(path) or os.path.splitext(name)[1].lower() not in KINDS:
            continue
        stem = os.path.splitext(name)[0].replace(' ', '_')[:60]
        doc = fitz.open(path)
        for n, page in enumerate(doc, start=1):
            rect = page.rect
            k = OVERVIEW_PX / max(rect.width, rect.height)          # overview scale
            page.get_pixmap(matrix=fitz.Matrix(k, k), alpha=False).save(os.path.join(out, '%s-p%d.png' % (stem, n)))
            made += 1
            kt = k * GRID                                            # close-up scale: 3x the detail
            tw, th = rect.width / GRID, rect.height / GRID
            ox, oy = tw * OVERLAP, th * OVERLAP
            for r in range(GRID):
                for c in range(GRID):
                    clip = fitz.Rect(rect.x0 + c * tw - ox, rect.y0 + r * th - oy,
                                     rect.x0 + (c + 1) * tw + ox, rect.y0 + (r + 1) * th + oy) & rect
                    page.get_pixmap(matrix=fitz.Matrix(kt, kt), clip=clip, alpha=False).save(
                        os.path.join(out, '%s-p%d-r%dc%d.png' % (stem, n, r + 1, c + 1)))
                    made += 1
        doc.close()
    print('rendered %d images into %s' % (made, out))
    return made


if __name__ == '__main__':
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        print('usage: python -I render_drawings.py "<order folder>"')
        sys.exit(2)
    sys.exit(0 if render(sys.argv[1]) else 1)
