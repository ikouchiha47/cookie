# Character System — Author Guide

This document explains how to design, extract, and wire up a new character, and how to build an alternative renderer. Read it top-to-bottom the first time; use the section headers to jump back in later.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Schema — what it is and how it's built](#2-the-schema)
3. [Inkscape Authoring Rules](#3-inkscape-authoring-rules)
4. [Expressions — transforms vs overlay shapes](#4-expressions)
5. [Adding a New Character (same renderer)](#5-adding-a-new-character-same-renderer)
6. [Adding a New Renderer](#6-adding-a-new-renderer)
7. [Protocol Reference](#7-protocol-reference)
8. [Common Mistakes](#8-common-mistakes)

---

## 1. Architecture Overview

```
Inkscape SVG
    │
    ▼ scripts/extract_schema.ts
character_v1.json  (CharacterSchema)
    │
    ├──► engine/mapping.ts       ExpressionParams → ResolvedControls
    │
    ├──► robot/expressions.ts    ExpressionName → Partial<ExpressionParams>
    │
    └──► robot/index.tsx         ResolvedControls → animated SVG on screen
              ▲
              │
         registry.ts   (CharacterRenderer interface)
              ▲
              │
         session store  (expression: ExpressionName)
              ▲
              │
         LLM / server   (string like "happy", "confused", …)
```

**Three things stay fixed regardless of which character or renderer you use:**

| Fixed | Where |
|---|---|
| Expression names | `protocol.ts → ExpressionName` |
| Normalized param contract | `protocol.ts → ExpressionParams` |
| Schema shape | `engine/types.ts → CharacterSchema` |

Everything below those layers is swappable.

---

## 2. The Schema

### What it is

`character_v1.json` is a machine-readable description of one character's rig. It tells the renderer *where* every animated part lives in the SVG coordinate space and *what ranges* are legal.

### Top-level fields

```jsonc
{
  "schemaVersion": "1.0",
  "characterId": "robot",       // must match registry key
  "svgFile": "character_v1.svg",
  "viewBox": "0 0 132.60208 167.38486",
  "rootTransform": "translate(374.65544,-79.140871)",  // the SVG root group transform
  "controls": { … }
}
```

`rootTransform` comes from Inkscape's outermost group. It offsets every coordinate. The renderer uses it to convert *schema coords* (viewBox space) to *Inkscape space* with:

```ts
function ix(sx: number) { return sx - 374.65544; }
function iy(sy: number) { return sy + 79.140871; }
```

These are character-specific constants — re-derive them when you make a new character.

### `controls` block — animatable parts

```
controls
├── brows
│   ├── left   { pivot, range, restAngle, stroke, strokeWidth }
│   └── right  { … }
├── eyes
│   ├── left   { anchor, rx, ry, opennessRange, lookXRange, lookYRange }
│   └── right  { … }
├── mouth      { x1, x2, y, halfWidth, controlX, controlY_rest, controlY_min, controlY_max, … }
├── signal     { orbCenter, glowRange, colors: { idle, excited, alert, error } }
└── emotions   { blush: EmotionLayer, tears: EmotionLayer, confused: EmotionLayer, … }
```

### `controls` block — static parts (not in types.ts but used by robot renderer)

```
controls
├── body   { paths: [ { fill, stroke, strokeWidth, strokeLinecap }, … ] }
├── head   { paths: [ … ] }
├── hands  { paths: [ … ] }
└── ears   { paths: [ … ] }
```

These hold paint attributes only. The path data (`d=`) is baked into the renderer as string constants — extracting bezier soup at runtime is unnecessary.

### How it's generated

```
cd mobile
npx ts-node scripts/extract_schema.ts src/characters/robot/character_v1.svg
```

The extractor reads the SVG XML and outputs JSON. It handles:
- Group label → schema key mapping (see §3)
- Parsing `transform="translate(…)"` and `matrix(…)` to find pivot points
- Reading `cx`/`cy`/`rx`/`ry` from `<ellipse>` elements for eyes
- Parsing cubic bezier `c` path commands to derive mouth endpoints and control point
- Reading SVG fill/stroke attributes directly for colors

**Edit the schema by hand only for quick tuning** (ranges, colors). Re-run the extractor after any SVG geometry change.

---

## 3. Inkscape Authoring Rules

### Layer / group naming convention

The extractor maps **Inkscape group labels** to schema keys. The mapping is rigid — use these exact labels:

| Inkscape label (Layer or Group) | Schema key | Purpose |
|---|---|---|
| `body` | `controls.body` | Torso static shapes |
| `head` | `controls.head` | Head shell + screen |
| `hands` | `controls.hands` | Left + right hands |
| `ears` | `controls.ears` | Ear stumps |
| `brows` / `left_brow` / `right_brow` | `controls.brows.left/right` | Eyebrow lines — **must** be `<path>` |
| `eyes` / `left_eye` / `right_eye` | `controls.eyes.left/right` | Eye fill — **must** be `<ellipse>` |
| `mouth` | `controls.mouth` | Mouth bezier — **must** be a single `<path>` |
| `signal` / `antenna_orb` | `controls.signal` | Glowing orb — **must** be `<circle>` |
| Any label used as emotion key | `controls.emotions[label]` | Toggle-on overlay group |

Emotion overlay groups — labels that are **not** one of the structural keys above — are captured as `EmotionLayer` objects. The renderer toggles them on/off based on `ExpressionParams` booleans.

**Current emotion group labels and their params:**

| Inkscape label | `ExpressionParams` field | Triggered by expressions |
|---|---|---|
| `excited` | `heartFloat` | excited |
| `confused` | *(unused — asymmetric eyes cover this)* | — |
| `blush` | `blush` | embarrassed |
| `concerned` | *(unused — antenna covers this)* | — |
| `tears` | `tearDrop` | sad |

### Coordinate system

Inkscape works in a document coordinate space offset by `rootTransform`. When you measure a point in Inkscape (Object > Transform > Position), that position is in the document coordinate system. The schema stores viewBox coordinates — subtract/add the root offset as described in §2.

### What to keep as path data, what to extract

| Part | How handled |
|---|---|
| Body, head, hands, ears | Path `d=` strings baked as TS constants. Paint from schema. |
| Brows | Drawn procedurally from pivot + length at runtime. Only pivot + color extracted. |
| Eyes | Drawn as animated `<Ellipse>` from anchor + rx/ry. |
| Mouth | Drawn as animated bezier from x1/x2/y/halfWidth/controlPoints. |
| Signal orb | Drawn as animated `<Circle>` + `<radialGradient>` glow filter. |
| Emotions | Full path `d=` + paint baked into `elements[]` array in schema JSON. |

### Making emotion overlays

1. Draw the overlay in Inkscape in its own named layer/group.
2. Position it using the same coordinate space as the rest of the character.
3. Re-run the extractor — it copies the `d=` and style attributes verbatim.
4. The renderer renders it when the matching `ExpressionParams` boolean is `true`.
5. Wire the boolean in `expressions.ts` (see §4).

---

## 4. Expressions

### Two kinds of expression effect

**Transform expressions** — the renderer animates geometry:

| Param | What the renderer does |
|---|---|
| `eyeOpenness` / `eyeRightOpenness` | Scale eye ellipse Y axis |
| `eyeLookX` / `eyeLookY` | Translate eye center |
| `mouthCurve` | Move bezier control point Y |
| `mouthOpen` | Switch to O-mouth ellipse |
| `antennaLight` | Change orb color + glow radius |
| `pulseSpeed` | Glow pulse animation speed |
| `screenTint` | Overlay color on head screen |

**Overlay expressions** — toggle pre-drawn groups on/off:

| Param | Inkscape group | Visual |
|---|---|---|
| `blush: true` | `blush` | Pink heart-shaped cheeks |
| `tearDrop: true` | `tears` | Cyan tear drops |
| `heartFloat: true` | `excited` | Yellow lightning/star sparks |

### Expression map file

`robot/expressions.ts` exports `ROBOT_EXPRESSIONS: ExpressionMap` — a record from every `ExpressionName` to a `Partial<ExpressionParams>`. Only override what differs from `DEFAULT_PARAMS` in `protocol.ts`.

```ts
// expressions.ts
export const ROBOT_EXPRESSIONS: ExpressionMap = {
  happy: {
    eyeOpenness: 1,
    eyeRightOpenness: 1,
    mouthCurve: 1,
    mouthOpen: 0.15,
    antennaLight: "idle",
  },
  // …
};
```

The registry merges this with `DEFAULT_PARAMS` at runtime:

```ts
function buildParams(expression, map) {
  return { ...DEFAULT_PARAMS, ...(map[expression] ?? {}) };
}
```

### Brow angles are derived, not set directly

`mapping.ts` derives brow rotation from `mouthCurve` + `eyeOpenness` automatically — you do not need to set a brow param in `expressions.ts`. The derivation rules are:

- `mouthCurve < -0.5` + `eyeOpenness < 0.5` → angry brows `\ /`
- `mouthCurve < -0.3` (else) → sad/worried brows `/ \`
- `eyeOpenness > 1.1` → raised surprise brows
- `mouthCurve > 0.3` → slightly lifted happy brows

Override by editing `deriveBrowAngles()` in `engine/mapping.ts`.

---

## 5. Adding a New Character (same renderer)

Use this path when your new character has the same parts as the robot (eyes, brows, mouth, antenna, emotion overlays) and you want to reuse the existing React component.

### Step 1 — Create the SVG in Inkscape

Follow the naming rules in §3. Minimum required layers:

- `head` — outer shell shape
- `left_eye` + `right_eye` (or `eyes` group containing two ellipses)
- `left_brow` + `right_brow`
- `mouth`
- `signal` / `antenna_orb`

Static layers (`body`, `hands`, `ears`) are optional — the renderer renders nothing if they're absent.

### Step 2 — Extract the schema

```bash
cd mobile
npx ts-node scripts/extract_schema.ts src/characters/<name>/character_v1.svg
# → writes src/characters/<name>/character_v1.json
```

Edit the output JSON to:
- Set `characterId` to your character's key
- Tune `opennessRange`, `lookXRange`, `lookYRange` if the eye geometry is different
- Tune `controlY_min`/`controlY_max` for the mouth
- Set `signal.colors` if you want different antenna colors

### Step 3 — Write `expressions.ts`

```ts
// src/characters/<name>/expressions.ts
import type { ExpressionMap } from "../protocol";

export const MY_CHARACTER_EXPRESSIONS: ExpressionMap = {
  default:    { eyeOpenness: 0.9, mouthCurve: 0.3, antennaLight: "idle" },
  idle:       { eyeOpenness: 0.35, mouthCurve: 0 },
  happy:      { eyeOpenness: 1, mouthCurve: 1, antennaLight: "idle" },
  confused:   { eyeOpenness: 1, eyeRightOpenness: 0.3, mouthCurve: -0.2 },
  sad:        { eyeOpenness: 0.5, mouthCurve: -0.8, tearDrop: true },
  angry:      { eyeOpenness: 0.4, mouthCurve: -0.9, screenTint: "#2a0a0a", antennaLight: "alert" },
  embarrassed:{ mouthCurve: 0.6, blush: true },
  wink:       { eyeOpenness: 1, eyeRightOpenness: 0.04, mouthCurve: 0.5 },
  concerned:  { mouthCurve: -0.3, antennaLight: "alert", pulseSpeed: 1.5 },
  excited:    { eyeOpenness: 1, mouthCurve: 1, heartFloat: true, antennaLight: "excited", pulseSpeed: 0.8 },
};
```

Every `ExpressionName` must have an entry. If an expression is identical to `default`, copy it.

### Step 4 — Create `index.tsx`

Option A — **reuse `RobotCharacter` component unchanged**:

```tsx
// src/characters/<name>/index.tsx
export { RobotCharacter as MyCharacter } from "../robot";
```

This works if the geometry is close enough (same coordinate ranges). The robot renderer reads all geometry from the schema it is initialized with — pass the new schema JSON.

> Note: You'll need to fork `robot/index.tsx` if you want to change which schema file it imports. A cleaner approach is to make the schema injectable via a prop — see §6 for the full renderer refactor.

Option B — **fork `robot/index.tsx`**:

Copy the file, change the import:
```ts
import SCHEMA_JSON from "./character_v1.json";  // ← your schema
```

Everything else works the same.

### Step 5 — Register

```ts
// src/characters/registry.ts
import { MY_CHARACTER_EXPRESSIONS } from "./<name>/expressions";
import { MyCharacter } from "./<name>";

const myRenderer: CharacterRenderer = {
  id: "<name>",
  name: "Display Name",
  getParams: (expr) => buildParams(expr, MY_CHARACTER_EXPRESSIONS),
  Component: MyCharacter,
};

const CHARACTERS = {
  robot: robotRenderer,
  "<name>": myRenderer,   // ← add here
};
```

The character is now selectable. The store field `characterId` drives which entry is used.

---

## 6. Adding a New Renderer

Use this path when you want to:
- Add a body part the current renderer ignores (e.g. fingers, tail)
- Change how an existing part animates (e.g. Skia shader eyes instead of SVG ellipses)
- Support a completely different visual style (2D sprite, 3D model)

### The contract

Any renderer is just a React component that accepts `CharacterComponentProps`:

```ts
interface CharacterComponentProps {
  params: ExpressionParams;   // normalized, character-agnostic
  size: number;               // bounding box in logical pixels
}
```

It reads the schema directly and calls `mapParamsToControls(params, schema)` to get concrete values, then renders them however it likes.

### Minimum scaffold

```tsx
// src/characters/<name>/index.tsx
import { mapParamsToControls } from "../engine/mapping";
import type { CharacterComponentProps } from "../protocol";
import SCHEMA from "./character_v1.json";

export function MyCharacter({ params, size }: CharacterComponentProps) {
  const ctrl = mapParamsToControls(params, SCHEMA as any);

  // ctrl.eyes.left.scaleY  — 0.1–1.3 (eye open/close)
  // ctrl.eyes.left.dx      — pixels, eye look horizontal
  // ctrl.eyes.left.dy      — pixels, eye look vertical
  // ctrl.eyes.left.color   — hex string
  // ctrl.mouth.controlY    — Y of bezier control point in Inkscape units
  // ctrl.signal.color      — hex string
  // ctrl.signal.glowRadius — blur radius in SVG units
  // ctrl.overlay.blush / tearDrop / heartFloat / screenTint

  return (
    // Your rendering code here
  );
}
```

### Adding a new body part (e.g. fingers)

1. **Schema** — add the new control to `CharacterSchema.controls` in `engine/types.ts`:

   ```ts
   controls: {
     // existing…
     fingers?: {
       left:  { anchor: Vec2; spread: number };
       right: { anchor: Vec2; spread: number };
     };
   }
   ```

2. **Extractor** — add parsing in `scripts/extract_schema.ts` for the new Inkscape group label (e.g. `left_fingers`).

3. **ResolvedControls** — add the output field in `engine/types.ts`:

   ```ts
   fingers?: {
     left:  { spread: number };
     right: { spread: number };
   };
   ```

4. **Mapping** — add derivation logic in `engine/mapping.ts`. Decide which `ExpressionParams` field drives finger spread (or add a new param to `protocol.ts`).

5. **Renderer** — read `ctrl.fingers` and animate it.

   > The root structure stays the same. Other characters that don't have fingers will have `ctrl.fingers === undefined` — guard with `if (ctrl.fingers)`.

6. **Protocol** — if you added a new `ExpressionParams` field, add a sensible default in `DEFAULT_PARAMS` and handle it in `expressions.ts` for every existing character.

### The root structure never changes

`CharacterSchema.controls` is additive. New fields are optional. Existing renderers ignore keys they don't understand. This means:

- You can add `fingers` to a new character's schema without breaking the robot renderer.
- You can build a Skia renderer that uses `ctrl.eyes` exactly the same way the SVG renderer does.
- The LLM output (`ExpressionName`) and `ExpressionParams` are the stable API surface — never couple them to a specific renderer.

---

## 7. Protocol Reference

### Expression names (fixed — defined in `protocol.ts`)

| Name | Semantic |
|---|---|
| `default` | Friendly idle, eyes open, slight smile |
| `idle` | Neutral / half-lidded |
| `happy` | Full smile, open eyes |
| `confused` | One eye narrowed |
| `sad` | Frown, tears |
| `angry` | Squint + frown + red tint |
| `embarrassed` | Smile + blush hearts |
| `wink` | One eye closed |
| `concerned` | Slight frown, pulsing alert antenna |
| `excited` | Full smile + sparks + orange antenna |

To add a new expression: add the literal to `ExpressionName` in `protocol.ts`, add an entry in every character's `expressions.ts`, and update the server's dspy signature so the LLM knows it can emit it.

### `AntennaLightState` values

| Value | Visual | Used by |
|---|---|---|
| `idle` | Cyan `#00ffff`, no pulse | default, happy, confused, etc. |
| `excited` | Orange `#F5A623`, slow pulse | excited |
| `alert` | Red-orange `#E05040`, fast pulse | concerned, angry |
| `error` | Red `#FF0000` | (reserved) |

These must match the `colors` keys in `signal.colors` inside the schema JSON.

### Normalized value conventions

| Range | Meaning |
|---|---|
| `0 → 1` | Off → fully on (openness, mouthOpen, pulseSpeed) |
| `-1 → 1` | Opposite → opposite (eyeLookX, eyeLookY, mouthCurve) |
| `string \| null` | Explicit value or "use character default" (screenTint) |
| `boolean` | Toggle (blush, tearDrop, heartFloat, …) |

---

## 8. Common Mistakes

**Mouth is too low / too high**
The extractor captures `mouth.y` as the *start point* of the bezier (top of arc), not the bottom. If the mouth looks displaced, re-run the extractor and check that `y` matches the visual top of the drawn mouth path in Inkscape.

**Antenna appears grey**
`signal.colors.idle` defaults to `"#3a3d4a"` (Inkscape layer color) if the extractor can't read the SVG `fill` from the orb element. Verify the antenna orb is a `<circle>` with an explicit `fill` style attribute, not a class reference.

**Eyes snap instead of animate**
Eye animation uses Reanimated shared values. If they appear to snap on expression change, confirm `useEffect` dependencies are correct and `withTiming`/`withSpring` targets are updating, not re-creating the shared value.

**Expression not showing**
Check: (1) the expression name is spelled correctly in `ExpressionName`, (2) your character's `expressions.ts` has an entry for it, (3) the registry `getParams` is calling `buildParams` with the right map.

**Schema coord mismatch**
If a rendered element is offset from where it should be, you have a coordinate space issue. Print `ix(schema.controls.eyes.left.anchor.x)` and compare to the Inkscape X reading. The formula is: `inkscape_x = schema_x - rootTranslateX`, `inkscape_y = schema_y + rootTranslateY` (note the sign flip on Y — SVG Y is down, Inkscape shows positive Y up).

**New emotion overlay doesn't show**
Check: (1) the Inkscape group label matches the key in `controls.emotions`, (2) the renderer reads that key from the schema, (3) the expression sets the matching `ExpressionParams` boolean to `true`.
