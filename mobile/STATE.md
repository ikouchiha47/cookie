# Mobile State Model

Everything the app needs to know about session state, what drives UI, what triggers side effects, and what cancels in-flight work.

---

## 1. State Variables

### Store (Zustand — persists across re-renders)

| Variable | Type | Source of truth |
|---|---|---|
| `isActive` | `boolean` | user started a session |
| `phase` | `discovery \| cooking \| paused \| done` | recipe selection / server step updates |
| `cameraMode` | `off \| streaming \| paused` | camera widget + frame-sending lifecycle |
| `connectionStatus` | `disconnected \| connecting \| connected` | WS lifecycle |
| `epoch` | `number` | bumped on every phase/step/recipe transition |
| `sessionId` | `string \| null` | assigned by server via `session_init` |
| `recipePlan` | `RecipePlan \| null` | set on recipe selection |
| `currentStep` | `number` | active step index |
| `stepInstruction` | `string` | sent with every frame as context |
| `expectedVisualState` | `string` | sent with every frame as context |
| `watchFor` | `string` | sent with every frame as context |
| `criticality` | `low \| medium \| high` | server-pushed via `cooking_observation` |
| `expression` | `ExpressionName` | server-pushed via guidance/discovery |
| `isListening` | `boolean` | mic recording in progress |
| `isSpeaking` | `boolean` | TTS playing |
| `latestGuidance` | `GuidanceMessage \| null` | last server guidance message |
| `discoveredItems` | `string[]` | last discovery result |
| `recipeSuggestions` | `RecipeSuggestion[]` | last discovery result |
| `chatLoading` | `boolean` | waiting for chat response |

> **Note:** `isCameraActive: boolean` and the local `isAutoScanning: boolean` are replaced by a single `cameraMode` enum. No local state needed — all camera lifecycle is store-owned.

---

## 2. Camera Mode State Machine (Discovery)

```
         startStreaming()
              │
              ▼
  ┌──────────────────────┐
  │       streaming      │  ← preview visible, 60s auto-fire ticking
  │  preview: on         │
  │  auto-fire: armed    │
  └──────┬───────────────┘
         │ pauseStreaming()          snapNow() fires one burst
         ▼                          (available in streaming or paused)
  ┌──────────────────────┐
  │        paused        │  ← preview still visible, auto-fire stopped
  │  preview: on         │
  │  auto-fire: stopped  │
  └──────┬───────────────┘
         │ stopStreaming()
         │ OR abort (×) OR session ends
         ▼
  ┌──────────────────────┐
  │         off          │  ← camera widget hidden
  └──────────────────────┘
```

- **streaming → paused**: user taps Pause
- **paused → streaming**: user taps Resume
- **paused → off**: user taps Stop (full close)
- **any → off**: abort session (×), `handleFinish`, `handleAbort`
- **off → streaming**: user taps Start (opens camera + arms 60s timer)

In **cooking** phase, `cameraMode` follows the same transitions but with different UI controls exposed (see §9).

---

## 2b. Camera Mode State Machine (Cooking)

```
  recipe selected → entry forces streaming
              │
              ▼
  ┌──────────────────────┐
  │       streaming      │  ← criticality-adaptive interval
  │  interval: low=10s   │    low=10s  medium=3s  high=1s
  │          medium=3s   │
  │            high=1s   │
  └──────┬───────────────┘
         │ pauseSession() (user steps away)
         ▼
  ┌──────────────────────┐
  │        paused        │  ← phase="paused", preview visible,
  │  preview: on         │    sampling stopped, TTS stopped
  │  sampling: stopped   │
  └──────┬───────────────┘
         │ resumeSession()
         ▼
  (back to streaming)

  abort (×) or handleFinish() from any mode → off
```

- No **Start** button — camera is automatic on cooking entry
- No **Snap** — continuous sampling makes it redundant
- No **Stop** — only full abort/finish can close the camera
- **Pause/Resume** — user-initiated, maps to `phase: paused ↔ cooking`

---

## 3. Phase State Machine

```
                    ┌─────────────────────────────────┐
                    │                                 │
         startSession()                    setPhase("discovery")
                    │                     (Add Ingredients)
                    ▼                                 │
    ┌─────────────────────────┐            ┌──────────┴──────────┐
    │       discovery         │──recipe──▶│       cooking        │
    │  cameraMode: user-driven│  selected  │  cameraMode: forced  │
    │  (off/streaming/paused) │            │  streaming on entry  │
    └─────────────────────────┘            └──────────┬──────────┘
                    │                                 │
               endSession()                    setPhase("paused")
               / handleAbort()                        │
                    │                                 ▼
                    │                    ┌────────────────────────┐
                    │                    │        paused          │
                    │                    │  sampling: stopped     │
                    │                    └────────────┬───────────┘
                    │                                 │
                    │                         setPhase("cooking")
                    │                                 │
                    ▼                                 ▼
          ┌──────────────────┐             (back to cooking)
          │       done       │◀── endSession() ── cooking
          └──────────────────┘
```

`epoch` bumps on every arrow in the diagram, plus on each step advance. This is the cancellation signal to the server.

---

## 4. Truth Table — What State Drives What

### Camera widget (`CameraIndicator`)

| `cameraMode` | `device` available | Result |
|---|---|---|
| `off` | any | hidden |
| `streaming \| paused` | `false` | hidden (no device) |
| `streaming \| paused` | `true` | visible with live preview |

### Frame sampling (background timers)

| `isActive` | `phase` | `cameraMode` | Sampling behaviour |
|---|---|---|---|
| `false` | any | any | nothing — all timers stopped |
| `true` | `discovery` | `off` | nothing |
| `true` | `discovery` | `streaming` | 60s auto-fire ticking; `snapNow()` sends 2 frames on demand |
| `true` | `discovery` | `paused` | all timers stopped; `snapNow()` still available |
| `true` | `cooking` | `streaming` | criticality-adaptive interval (low=10s, medium=3s, high=1s) |
| `true` | `cooking` | `paused` | all timers stopped (phase also = "paused") |
| `true` | `paused \| done` | any | all timers stopped |

### Discovery panel camera controls

**Snap is always visible.** It works in all modes — if camera is off, it briefly activates for the snap then returns to off (no auto-fire armed).

| `cameraMode` | Buttons shown |
|---|---|
| `off` | **Stream** · **Snap** |
| `streaming` | **Pause** · **Snap** |
| `paused` | **Stop** · **Resume** · **Snap** |

### Cooking panel camera controls

| `cameraMode` | `phase` | Buttons shown |
|---|---|---|
| `streaming` | `cooking` | **Pause** |
| `paused` | `paused` | **Resume** |
| `off` | any | — (abort/finish already triggered) |

### Bottom panel rendered

| `phase` | Panel |
|---|---|
| `discovery` | `DiscoveryPanel` |
| `cooking` | `CookingPanel` (step, voice orb, finish) |
| `paused` | `CookingPanel` (same) |
| `done` | `DonePanel` (start new) |

### Abort button (top bar ×)

| `isActive` | Shown |
|---|---|
| `false` | hidden |
| `true` | visible, red — forces `cameraMode → off` on press |

### TTS

| `phase` | Event | Speaks |
|---|---|---|
| `cooking` | `latestGuidance` changes | guidance text |
| `discovery` | `discoveredItems` changes | "I can see X. How about Y?" |
| any | `handleAbort` / `handleFinish` | stopped immediately |

### WS send gate (`sendFrame`)

| `wsService.isConnected` | `camera` ref populated | Sends frame |
|---|---|---|
| `false` | any | no |
| `true` | `false` | no |
| `true` | `true` | yes |

---

## 5. Effects and Their Triggers

### `useEffect([phase, isActive])` — sampling orchestrator

Fires when phase or isActive changes. The single place that starts/stops timers.

| Condition | Actions |
|---|---|
| `!isActive` | `stopAllSampling()`, `setCameraMode("off")` |
| `cooking` | `stopAutoFire()`, `setCameraMode("streaming")`, `startCookingSampling(criticality)` |
| `discovery` | `stopCookingSampling()` — cameraMode unchanged (user-driven) |
| `paused` | `stopCookingSampling()`, `stopAutoFire()`, `setCameraMode("paused")` |
| `done` | `stopCookingSampling()`, `stopAutoFire()`, `setCameraMode("off")` |

### `useEffect([criticality])` — cooking interval adjustment

Fires when server pushes a new criticality during cooking. Restarts the interval at the new rate without changing cameraMode.

| `phase` | `cameraMode` | Action |
|---|---|---|
| `cooking` | `streaming` | restart interval: low=10s, medium=3s, high=1s |
| other | any | no-op |

### `useEffect([cameraMode])` — auto-fire orchestrator (discovery only)

Fires when cameraMode changes. Manages 60s auto-fire independently of cooking interval.

| Condition | Actions |
|---|---|
| `streaming && phase === "discovery"` | `scheduleAutoFire()` |
| `paused \| off` | `stopAutoFire()` |

### `useEffect([latestGuidance])` — speak guidance

Only speaks during `cooking`. No cleanup — speech runs to completion unless `stopSpeech()` is called explicitly (abort/finish).

### `useEffect([discoveredItems])` — speak discovery

Only speaks during `discovery`. Same pattern.

### `useEffect([isActive, lastActivityAt])` — idle detection

Polls every 5s. Sets `expression = "idle"` after 60s of no activity. No side effect on sampling.

---

## 6. In-Flight Cancellation Points

| What's cancelled | Trigger | Mechanism |
|---|---|---|
| Server discovery/cooking inference | `epoch` bump (any phase/step transition) | Server worker's `anyio.CancelScope` torn down on next frame submission |
| Server worker task entirely | `handleAbort` | `worker.stop()` → `asyncio.Task.cancel()` → `CancelledError` into dspy HTTP call |
| 1fps cooking interval | `stopCookingSampling()` | `clearInterval` |
| 60s discovery auto-fire | `stopAutoFire()` | `clearTimeout` + `autoFireEnabled = false` |
| TTS | `stopSpeech()` | `expo-speech` stop |
| Mic recording | `stopAndSend()` | `Audio.Recording.stopAndUnloadAsync()` |
| In-flight chat `fetch` | none currently | **Gap** — no AbortController on chat WS send |

---

## 7. Known Gaps / Issues

1. **`handleChatResponse` sets `phase = "cooking"` directly** — bypasses `setPhase` so epoch is not bumped. Discovery frames in flight could arrive after cooking has started.

2. **Chat WS send not cancellable** — if user selects a recipe while a chat response is in-flight, both arrive. No mechanism to drop the stale chat response. Low priority since chat is not in the hot path.

3. **`handleAbort` via WS without screen mounted** — `onAbort` callback from `useWebSocket` calls `stopSideEffects`. If abort arrives when screen not mounted, camera and timers may stay live.

---

## 8. Camera Controls — Component Contract

Camera controls are **not a shared visual component**. `CameraIndicator` (top-left preview pip) stays as-is. Controls are buttons rendered inside each phase panel, wired via props from `index.tsx`.

### Props passed to `DiscoveryPanel`

| Prop | Type | When called |
|---|---|---|
| `cameraMode` | `"off" \| "streaming" \| "paused"` | read-only, drives button visibility |
| `onStart` | `() => void` | user taps Start (off → streaming) |
| `onPause` | `() => void` | user taps Pause (streaming → paused) |
| `onResume` | `() => void` | user taps Resume (paused → streaming) |
| `onStop` | `() => void` | user taps Stop (paused → off) |
| `onSnap` | `() => void` | user taps Snap (fires 2-frame burst, no mode change) |

### Props passed to `CookingPanel`

| Prop | Type | When called |
|---|---|---|
| `cameraMode` | `"off" \| "streaming" \| "paused"` | read-only, drives button visibility |
| `onPause` | `() => void` | user taps Pause → `setPhase("paused")` + `setCameraMode("paused")` |
| `onResume` | `() => void` | user taps Resume → `setPhase("cooking")` + `setCameraMode("streaming")` |

`index.tsx` owns all handlers. Panels render buttons conditionally based on `cameraMode`.

---

## 9. Actions → State Mutations

| Action | `isActive` | `phase` | `cameraMode` | `epoch` | Timers |
|---|---|---|---|---|---|
| `startSession()` | `true` | `discovery` | `off` | unchanged | phase effect fires |
| `onStart` (discovery) | unchanged | unchanged | `streaming` | unchanged | autoFire armed |
| `onPause` (discovery) | unchanged | unchanged | `paused` | unchanged | autoFire stopped |
| `onResume` (discovery) | unchanged | unchanged | `streaming` | unchanged | autoFire armed |
| `onStop` (discovery) | unchanged | unchanged | `off` | unchanged | autoFire stopped |
| `onSnap` (discovery, off) | `true` (if was false) | unchanged | `streaming` briefly then `off` | unchanged | no auto-fire armed |
| `onSnap` (discovery, streaming) | unchanged | unchanged | unchanged | unchanged | 2-frame burst; resets 60s timer to now |
| `onSnap` (discovery, paused) | unchanged | unchanged | unchanged | unchanged | 2-frame burst; timer already off |
| `onPause` (cooking) | unchanged | `paused` | `paused` | `+1` | sampling stopped |
| `onResume` (cooking) | unchanged | `cooking` | `streaming` | `+1` | sampling restarts at criticality rate |
| `setRecipePlan()` | unchanged | `cooking` | `streaming` | `+1` | phase effect fires, criticality-adaptive sampling starts |
| `handleAddIngredients()` | unchanged | `discovery` | unchanged | `+1` | phase effect fires |
| `updateStep(active)` | unchanged | unchanged | unchanged | `+1` | interval restarted at new criticality |
| `handleFinish()` | `false` | `done` | `off` | unchanged | all stopped |
| `handleStartNew()` | `true` | `discovery` | `off` | unchanged | phase effect fires |
| `handleAbort()` | `false` | `discovery` | `off` | `0` reset | all stopped |
| `endSession()` | `false` | `done` | `off` | unchanged | phase effect fires |
| `setPhase(p)` | unchanged | `p` | unchanged | `+1` | phase effect fires |
