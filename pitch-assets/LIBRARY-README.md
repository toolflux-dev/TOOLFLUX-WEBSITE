# FLUX asset library — how to feed it

Everything you add here shows up **TOOLFLUX-branded only**. Raw files you paste data from are never shown on screen — FLUX re-renders every product as a TOOLFLUX plate.

## 1. `library.xlsx` (this folder)

Get a blank one from the app: **Setup → Download blank library.xlsx**. Two sheets:

### Sheet "Products"
| column | meaning | example |
|---|---|---|
| id | short unique slug, no spaces | `ccmt-09t308-tpc35` |
| name | title shown on the plate | `CCMT 09T308 · TFX-TPC35` |
| family | Inserts / End Mills / Drills / Holders / U-Drill / Grade | `Inserts` |
| spec1…spec6 | one line each, format `Label: value` | `Vc steel: 180–260 m/min` |
| pitch_line | one sentence FLUX may say about it | `Finishing insert for steel, wiper-class finish.` |
| promote | put `yes` to pre-select it in "today's push" | `yes` |

### Sheet "Media"
| column | meaning | example |
|---|---|---|
| id | slug | `udrill-demo` |
| file | filename in this folder | `udrill-demo.mp4` |
| say_when_asked | comma-separated names you'll say aloud | `u-drill demo, drilling video` |
| caption | line shown under the video | `HYPER-U Ø32, 4140 steel, 3D depth` |

## 2. Files you drop in this folder

- **Photos**: name them `<id>.jpg` (or `.png`) matching a Products id → appears on that plate, uncropped.
- **Videos**: `.mp4` files listed in the Media sheet. FLUX plays them on its own cue when the talk calls for it, and always when you ask by a `say_when_asked` name.
- **PDFs**: TOOLFLUX flyers only (they render as-is — never drop another brand's PDF here).

## 3. After editing

Open the app → **Setup → Reload library**. Done.

**Caution:** whatever specs you load become TOOLFLUX claims in front of a customer — load data only for items you genuinely supply in that spec.
