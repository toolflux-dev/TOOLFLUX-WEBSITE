# Design

Visual system observed in the existing TOOLFLUX site (index.html, shared.css) plus the Tool Life Register app conventions.

## Theme

Light. Paper-white surfaces tinted faintly toward the brand teal hue; near-black ink also tinted teal. The scene that forces it: an operator at a shared screen beside a running VMC under fluorescent + daylight, and a printed A4 card taped to the machine. Dark mode is wrong here.

## Color

Brand source values (hex, from shared.css) and their OKLCH working equivalents:

- `--teal: #0097B2` → oklch(0.62 0.105 215). Primary accent: actions, selection, links, brand rules.
- `--teal-dark: #004455` / `--navy: #012B42` → oklch(0.30 0.05 230). Strong ink, headers.
- `--ink: #08141a` → oklch(0.17 0.02 230). Footer/near-black.
- `--T: #0d1e26` → oklch(0.22 0.02 230). Body text.
- `--off: #f4f7f8`, `--off2: #e8ecee`, `--rule: #e2e8eb`. Tinted neutrals: panel fills, rules.
- `--spark: #ff6b1a` → oklch(0.70 0.19 45). Reserved: warnings / attention only.
- Critical/danger: oklch(0.55 0.19 27) (red, used sparingly for overdue/destructive).
- Success/ok: oklch(0.58 0.11 165) (restrained green for "in life" states).

Strategy: **Restrained**. Tinted neutrals carry the surface; teal ≤10% for primary actions and current selection; spark/red/green appear only as semantic state. Never #000 or #fff raw; whites are #FEFFFE-tinted.

## Typography

- UI family: **Inter** (Google Fonts, `display=swap`), fallback `'Segoe UI', system-ui, sans-serif`. One family carries everything.
- Data/stamps: system mono stack `ui-monospace, 'Cascadia Mono', Consolas, monospace` for timestamps, IDs, insert designations.
- `font-variant-numeric: tabular-nums` on all aligned numbers.
- Micro-labels: 0.6–0.7rem, weight 600–700, `letter-spacing: .18–.32em`, uppercase — the signature TOOLFLUX label style.
- Scale ratio ~1.2, fixed rem steps. Big numerals (2–3rem, weight 700) for live counts.

## Components & Layout

- Ruled-ledger rows over card grids. Hairline `1px var(--rule)` borders; section headers as stamped uppercase labels.
- Radius: 1–2px (site uses near-square corners; `border-radius: 1px` on CTAs).
- Buttons: square-ish, uppercase letterspaced 0.6–0.7rem labels; primary = teal fill, hover = teal-dark; secondary = 1px outline.
- Focus: 2px teal outline, offset 2px, on every interactive element.
- Elevation: flat by default; one soft shadow tier (`0 2px 24px rgba(0,0,0,.06)`) for sticky bars only.
- Print surfaces: pure black on white, hairline tables, blank ruled rows for handwriting; A4 portrait.

## Motion

- 150–200ms ease-out transitions on state change only (hover, panel expand, row highlight).
- No page-load choreography. `prefers-reduced-motion` disables non-essential transitions.
