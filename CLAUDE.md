# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server (usually ports 5173–5175)
npm run build      # Production build
npm run preview    # Preview production build
npm test           # Run Jest test suite (66 tests — see Testing section)
npm run test:coverage  # Same + coverage report

# Standalone Node scripts (copy of the algorithm — useful for quick iteration without a browser)
node test-scenarios.mjs   # Normal mode: 5-guard compositions
node test-shortage.mjs    # Shortage mode: 4-guard + cfg variations
node test-doubles.mjs     # Double guard (כפולה): 21 scenarios
```

There is no linter configured.

## ⚡ Automatic Testing — REQUIRED

**After every change to the scheduling algorithm** (`generate`, `tryGen`, `postFix`,
`validateSched`, `cicoLimit`, or any helper they call in `src/App.jsx`):

1. **Ensure deps are installed** — run `npm install` if `node_modules/jest` is absent
   (needed after a fresh clone, or whenever `package.json` devDependencies change).
2. **Run the full test suite** — `npm test`
3. **Do not commit** until `npm test` exits with 0 failures.

> Node binary path (if `node`/`npm` are not on PATH):
> `export PATH="/Users/edishteinberg/.local/share/cursor-agent/versions/2025.10.02-bd871ac:$PATH"`

## Architecture

**Everything lives in `src/App.jsx`** — one large file (~1755 lines). There are no separate modules. The file is structured top-to-bottom:

1. PIN screen + session auth (`APP_PIN`, `SESSION_KEY` → `sessionStorage`)
2. Constants: `HOURS`, station labels `SL`, station colors `SC`, `REST` set
3. Scheduling algorithm (pure JS functions, no React)
4. Helper functions
5. React components
6. Main `App` component

`src/main.jsx` just renders `<App />` inside `<PinScreen>`.

### Guard Data Model

Each guard object: `{ name, level, isGate, isDouble, isAbsent }`

- `level`: `"strong"` (ותיק) | `"mid"` (חדש) | `"achmash"` (אחמ"ש) — **used only by the scheduling algorithm**, not for the attendance report
- `isGate`: occupies שוער station hours 07–10, then CICO for the rest
- `isDouble`: כפולה — must have CICO in the last hour (14:00–15:00)
- `isAbsent`: marks shortage mode; only one guard may be absent at a time

### Scheduling Algorithm Pipeline

`generate(guards, cfg)` → `tryGen(seed, guards, cfg)` → `postFix(sched, guards, cfg)` → `validateSched(sched, guards, cfg)`

- Uses `mulberry32` seeded PRNG; tries up to 3000 seeds, keeps the best result
- `cfg` object: `{ gateDown, cicoDown, isShortage, maxRest }`
- Station assignment order in `tryGen`: gate/double pre-fill → CICO → Lenel → Bosh → Malshinon → fill remaining
- `postFix` runs up to 20 improvement passes (5 pass types) to reduce validation errors
- In shortage mode (`isShortage: true`), malshinon requirement is relaxed and rest cap is removed (fairness enforced by balance check instead)

### Shortage Mode Station Logic

| gateDown | cicoDown | Malshinon hours | Active stations |
|----------|----------|-----------------|-----------------|
| false | false | 07, 10–14 | all |
| true | false | 07, 10–14 | no שוער |
| false | true | 07, 10–14 | no CICO |
| true | true | all 8 hours | Lenel + Bosh only |

### Name Display: Two Functions

- `guardDisplayName(g, i, total)` — returns full name; used in the attendance report
- `guardFirstName(g, i, allGuards)` — returns first name only for the schedule table; disambiguates duplicate first names by appending last-name initial: `עידן י.` / `עידן מ.`

### Profile (Shift Commander)

The shift's אחמ"ש/אחמ"שית is stored separately from the guard list:
- `localStorage` key `"mgr_profile_v1"`, shape `{ name: string, role: 'אחמ"ש' | 'אחמ"שית' }`
- Rendered by `ProfileSection` at the top of the app
- Always entry #1 in the attendance report (locked, cannot be changed per-report)

### Attendance Report (`AttendanceReport` component)

- Only morning shift (בוקר) is currently implemented; shift selector was intentionally removed
- Total count: 1 (profile) + guards.length + 2 (חמושים placeholders) = 8 normally
- Armed guards (חמושים) are **not** in the schedule — they appear as `_____________` blanks in the generated report text for manual fill-in
- תקן auto-sets: `"מלא"` normally, `"חוסר מאבטח לא חמוש בין 07:00–15:00"` in shortage mode
- Report is an editable textarea; user can tweak before copying/WhatsApp sharing

### Session Auth

PIN (`APP_PIN = "1234"`) + `sessionStorage` key `"mgr_auth_v1"`. Auth resets on tab close. Exported as `PinScreen` and `SESSION_KEY` for use in `main.jsx`.

### Canvas Image Export

`buildScheduleCanvas(sched, guards)` draws the schedule to an off-screen `<canvas>` at 2× scale for retina. Shared via Web Share API on mobile or downloaded as PNG on desktop.

## Testing

### Jest (primary — `npm test`)

`src/__tests__/scheduling.test.js` — **66 tests**, organised into four suites:

| Suite | Tests | What is verified |
|-------|-------|-----------------|
| `cicoLimit` | 9 | CICO cap per guard level, deficit math, achmash |
| `validateSched` | 7 | Error detection: duplicates, CICO-no-break, >3 consec, double rules |
| `generate — normal` | 17 | All standard 5-guard compositions (mirrors `test-scenarios.mjs`) |
| `generate — doubles` | 23 | 1–5 כפולה in all compositions + no-duplicate assertions (mirrors `test-doubles.mjs`) |
| `generate — shortage` | 14 | All חוסר cfg combinations + station-presence assertions (mirrors `test-shortage.mjs`) |

Setup files (required once after fresh clone):
- `babel.config.cjs` — transforms ESM + JSX → CJS for Jest
- `jest.config.cjs` — `testEnvironment: node`, `transform: babel-jest`

The scheduling functions are exported from `App.jsx` **for testing only** at the bottom of the file:
```js
export { generate, validateSched, tryGen, postFix, cicoLimit, mulberry32, assignable };
```

### Standalone Node scripts (secondary)

`test-scenarios.mjs`, `test-shortage.mjs`, `test-doubles.mjs` contain **copied** versions of the scheduling logic and run directly with `node`. They are useful for rapid algorithm iteration without a browser or Jest install.

> ⚠️ When the algorithm in `App.jsx` changes, these copies may become stale. Always keep them in sync and verify with `npm test` as the authoritative check.

## Key Domain Constants

```js
// Stations
SL = { cico, lenel, bosh, break, malshinon, shaar }
REST = new Set(["break", "malshinon", "shaar"])  // non-active stations

// תקן strings
TAKKEN_FULL    = "מלא"
TAKKEN_SHORTAGE = "חוסר מאבטח לא חמוש בין 07:00–15:00"

// Storage keys
SESSION_KEY = "mgr_auth_v1"   // sessionStorage
PROFILE_KEY = "mgr_profile_v1"  // localStorage
```

## Styling Notes

- Tailwind CSS utility classes + inline `style` objects for dynamic values
- Dark GitHub-inspired theme: bg `#0d1117`, card `#161b22`, border `#30363d`
- RTL layout: `direction: "rtl"` on containers; Hebrew UI throughout
- iOS zoom prevention: all `<input>` and `<select>` elements must have `fontSize: 16` (inline style)
- Mobile-first; uses `100dvh` for full-screen views and `env(safe-area-inset-*)` for notch/home-bar padding
