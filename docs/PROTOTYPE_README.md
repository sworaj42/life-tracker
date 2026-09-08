# Prototype

`spiralout.dc.html` is the design. Open it in a browser — it runs, with seeded data, in
an iPhone frame. Every screen, interaction and number in SPEC.md is live in this file.

- `support.js` — the runtime it loads. Must sit next to it.
- `ios-frame.jsx` — the phone bezel. Cosmetic; not part of the app.
- `Splash.dc.html` + `assets/` — splash and icon reference.

## How to read it

The file is one HTML document: a template (markup, inline styles only) and a
`class Component` holding all logic. Read the class first — every derived number
in the UI is computed in `renderVals()` and the formulas are commented where they
are not obvious (maintenance calories, caffeine decay, water goal, runway, sleep debt).

Search the class for these to find the rules quickly:
`writeSession` (midnight split), `inB` (what counts against the budget),
`saveTimers` / `TIMER_KEY` (timer persistence), `toBS` (Nepali date),
`localISO` (Kathmandu-day rule).

Colours, spacing and copy are exact — port them rather than reinterpreting.
