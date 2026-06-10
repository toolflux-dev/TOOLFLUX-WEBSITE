# Product

## Register

product

## Users

Two distinct users, one dataset:

- **Machine operators** on the shop floor of a small/medium Indian machining works. Standing at a shared PC or tablet next to a CNC lathe or VMC, possibly gloved, under bright workshop lighting, in the middle of a production run. Their job: log component counts, record when a carbide insert is rotated to a fresh edge or replaced, and file end-of-shift production numbers. They will not tolerate more than ~30 seconds of data entry per action.
- **The owner**, monitoring from home or on the move (often on a phone). Wants to know at a glance: is production on target, which inserts are near end of life, what changed on each machine and when, and what insert consumption actually costs.

## Product Purpose

A digital tool-life register and production logbook for the shop ("TOOLFLUX Tool Life Register"). It replaces the handwritten sheet taped to the machine: tracks insert life edge by edge with timestamps for every rotation and replacement, records per-shift production counts, and gives the owner a remote monitoring dashboard. It also *prints* a machine-side datasheet, because the paper card on the machine is still part of the workflow, not a relic.

Success: operators log every insert change because it's faster than the paper card; the owner trusts the numbers enough to make purchasing decisions from them.

## Brand Personality

Precise, industrial, engineering-grade. TOOLFLUX's line is "Engineering Precision. Every Cut." The tone is a confident toolmaker, not a SaaS startup: terse uppercase micro-labels, exact numbers, no fluff.

## Anti-references

- Generic SaaS admin dashboards: purple gradients, identical KPI card grids, hero metrics with sparkles.
- Dark "mission control" dashboards. This is a workshop document under fluorescent light, not a cockpit at 2am.
- Consumer-app playfulness: confetti, mascots, rounded-everything.

## Design Principles

1. **Logbook honesty.** The UI reads like an engineering document: ruled lines, stamped timestamps, registered numbers. If it couldn't plausibly be printed and signed, it doesn't belong.
2. **Glove-friendly speed.** Shop-floor actions are one large tap plus one confirm. Forms remember the operator. Nothing requires precision pointing.
3. **Numbers are the interface.** Counts, life percentages, and timestamps are the content; render them large, tabular, and glanceable.
4. **Print is a first-class surface.** The machine-side tool card must print perfectly in black and white on A4, with blank ruled rows for handwritten entries.
5. **Trust through traceability.** Every change carries a timestamp and an operator name. The owner never wonders "who did this, when".

## Accessibility & Inclusion

- High contrast (bright, glare-prone shop lighting); WCAG AA minimum on all text.
- Touch targets ≥ 44px for primary floor actions (gloved hands).
- Status never conveyed by color alone: pair with labels and counts.
- Tabular numerals everywhere numbers align.
- Works on a phone (owner) and an old shop PC (operator); no build step, no heavy dependencies.
- Respect `prefers-reduced-motion`.
