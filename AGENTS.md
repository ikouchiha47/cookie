# Agent Guide — Cookie

This file is for AI coding agents and developers working on this codebase. Read it before making any changes.

---

## 1. Project in One Paragraph

Cookie is a real-time cooking assistant. A Python server receives camera frames and audio from a client device, runs vision + reasoning pipelines (via DSPy + LLMs), and streams guidance back over WebSocket. A React Native / Expo mobile app connects to the same socket, renders an animated character, and provides a chat interface. State is fully managed in a Zustand store on the mobile side; all server state lives in per-session `SessionManager` objects.

---

## 2. Repository Layout

```
cookie/
├── src/cookie/               # Python server package
│   ├── server.py             # Main orchestration — start here for server logic
│   ├── models.py             # All Pydantic data models (wire protocol + internal)
│   ├── config.py             # Config loading (.env + YAML)
│   ├── history.py            # HistoryManager — in-memory multi-turn chat history
│   ├── transport/
│   │   └── ws_server.py      # WebSocket server; ClientSession send helpers
│   ├── state/
│   │   └── manager.py        # SessionManager — hot/warm/cold memory per session
│   ├── perception/
│   │   ├── engine.py         # Dispatches frames/audio to backends
│   │   ├── backends/         # VLM, YOLO, composite backends
│   │   ├── scene.py          # CLIP-based scene change detection
│   │   └── audio.py          # Faster-Whisper speech-to-text
│   ├── reasoning/
│   │   ├── engine.py         # Trigger logic + guidance generation
│   │   ├── signatures.py     # DSPy signatures (structured LLM prompts)
│   │   ├── router.py         # ModelRouter (role → dspy.LM) + SessionRouter
│   │   ├── character.py      # Character emotional state from reasoning output
│   │   └── character_service.py  # Runs guidance + character state in parallel
│   ├── knowledge/
│   │   ├── recipes.py        # RecipeGenerator (DSPy)
│   │   └── safety.py         # Allergen + quantity safety checks
│   ├── edge/
│   │   ├── client.py         # Edge device client (camera + mic → server)
│   │   ├── frame_sampler.py  # pHash dedup + throttle
│   │   └── audio_capture.py  # VAD-filtered audio chunks
│   └── harness/
│       └── runner.py         # Offline evaluation via YouTube video URL
│
├── config/
│   └── default.yaml          # Server config — models, perception, safety thresholds
│
├── tests/                    # pytest unit tests
│
├── mobile/
│   ├── app/                  # Expo Router screens
│   │   ├── _layout.tsx       # Root navigation stack
│   │   ├── index.tsx         # Main screen (camera + character)
│   │   ├── chat.tsx          # Chat screen (text + image messages)
│   │   ├── settings.tsx      # Server URL + user profile
│   │   ├── expressions.tsx   # Character expression debugger
│   │   └── history/          # Past session browser
│   ├── src/
│   │   ├── stores/
│   │   │   └── session.ts    # Zustand store — single source of truth
│   │   ├── services/
│   │   │   ├── websocket.ts  # WebSocketService + singleton wsService
│   │   │   ├── envelope.ts   # Wire protocol encode/decode
│   │   │   └── frameSampler.ts  # Camera frame capture + pHash
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts  # Connects WS, routes messages → store
│   │   │   ├── useCamera.ts
│   │   │   ├── useAudio.ts
│   │   │   └── useSpeech.ts
│   │   ├── components/
│   │   │   ├── CurrentStep.tsx   # Recipe step display + discovery mode UI
│   │   │   ├── CropModal.tsx     # Image crop before sending
│   │   │   ├── VoiceOrb.tsx
│   │   │   └── CameraIndicator.tsx
│   │   ├── types/
│   │   │   └── protocol.ts   # TypeScript mirror of models.py — keep in sync
│   │   └── characters/       # Character animation system
│   │       ├── protocol.ts   # ExpressionName, ExpressionParams, CharacterRenderer
│   │       ├── registry.ts   # Register characters here
│   │       ├── engine/
│   │       │   ├── types.ts      # CharacterSchema, ResolvedControls
│   │       │   └── mapping.ts    # ExpressionParams → ResolvedControls
│   │       ├── robot/
│   │       │   ├── index.tsx     # Robot SVG renderer (Reanimated)
│   │       │   ├── expressions.ts  # ExpressionName → Partial<ExpressionParams>
│   │       │   └── character_v1.json  # Extracted character schema
│   │       └── CHARACTERS.md   # Full guide to adding characters/renderers
│   └── scripts/
│       └── extract_schema.ts # Extracts character schema from Inkscape SVG
│
├── .env                      # API keys (never commit)
├── pyproject.toml            # Python deps + entry points
├── README.md
└── AGENTS.md                 # This file
```

---

## 3. Running the Project

### Server

```bash
# Install Python deps
uv sync

# Copy and fill in API keys
cp .env.example .env   # set GROK_API_KEY / XAI_API_KEY

# Start server (port 8420)
uv run cookie-server
```

Server config lives in `config/default.yaml`. Override per-field by editing that file — no code changes needed for model selection, ports, thresholds.

### Mobile App

```bash
cd mobile
npm install

# Set server address
echo 'EXPO_PUBLIC_WS_URL=ws://<your-ip>:8420/ws' > .env.local

npx expo start
# Scan QR with Expo Go, or press i/a for simulator
```

The WebSocket URL can also be changed at runtime in the app's Settings screen — useful for switching between local and remote servers without rebuilding.

### Edge Client (optional — camera/mic on separate device)

```bash
uv run cookie-edge
# Reads server address from config/default.yaml
```

---

## 4. Testing Without a Physical Device

### Harness — replay a cooking video

The harness downloads a YouTube video, extracts frames, and drives the full server pipeline offline. This is the fastest way to test perception + reasoning changes without a live camera.

```bash
uv run cookie-harness --url "https://www.youtube.com/watch?v=<id>"
```

What it does:
1. Downloads the video via `yt-dlp`
2. Extracts frames at 3fps via `ffmpeg`
3. Sends each frame through `PerceptionEngine` → `ReasoningEngine` exactly as a live session would
4. Prints guidance output, severity, expression, and step progress for each frame
5. Saves a run report to `harness_output/`

### Batch screenshot testing — simulate the chat endpoint

To test the chat handler (vision LLM, recipe generation, multi-image parsing) without the mobile app, send base64-encoded frames directly over WebSocket:

```python
import asyncio, base64, json, pathlib, websockets

async def test():
    async with websockets.connect("ws://localhost:8420/ws") as ws:
        # Load one or more screenshots
        images = [pathlib.Path(p).read_bytes() for p in ["frame1.jpg", "frame2.jpg"]]

        payload = {
            "type": "chat",
            "payload": {
                "text": "What can I make with these ingredients?",
                # Single image:
                "image_bytes": base64.b64encode(images[0]).decode(),
                # Or multiple images:
                # "image_bytes_list": [base64.b64encode(img).decode() for img in images],
            },
            "timestamp": 0,
        }
        await ws.send(json.dumps(payload))
        response = await ws.recv()
        print(json.loads(response))

asyncio.run(test())
```

Similarly for frame messages (discovery mode):

```python
payload = {
    "type": "frame",
    "payload": {
        "timestamp": 0,
        "frame_bytes": base64.b64encode(image_bytes).decode(),
        "frame_hash": "test",
    },
    "timestamp": 0,
}
```

---

## 5. Wire Protocol

All messages — both directions — use a JSON envelope:

```json
{ "type": "chat", "payload": { … }, "timestamp": 1234567890 }
```

**Mobile → Server:**

| type | payload fields | handler |
|---|---|---|
| `frame` | `timestamp`, `frame_bytes` (b64 JPEG), `frame_hash` | `_handle_frame` |
| `audio` | `timestamp`, `audio_bytes` (b64), `is_speech` | `_handle_audio` |
| `interrupt` | `timestamp`, `type`, `text?` | `_handle_interrupt` |
| `chat` | `text`, `image_bytes?` (b64), `image_bytes_list?` | `_handle_chat` |

**Server → Mobile:**

| type | payload | handled by |
|---|---|---|
| `guidance` | `text`, `severity`, `expression`, `tts_audio_bytes?` | `useWebSocket.ts` → `handleGuidance` |
| `step_update` | `step_index`, `status` | → `updateStep` |
| `discovery` | `items[]`, `suggestions[]` | → `handleDiscovery` |
| `chat_response` | `text`, `items[]`, `suggestions[]`, `recipe_plan?` | → `handleChatResponse` |
| `thinking` | *(empty)* | → sets expression to `"default"` |

The TypeScript types for all of these live in `mobile/src/types/protocol.ts`. The Python models live in `src/cookie/models.py`. **Keep them in sync manually** — there is no codegen.

---

## 6. Where to Make Common Changes

### Change which LLM model is used

Edit `config/default.yaml`:
```yaml
models:
  reasoning: xai/grok-3-mini        # text-only guidance
  vision: xai/grok-4-fast-non-reasoning  # frame + chat with images
  router: xai/grok-4-fast-non-reasoning  # session classification
```

No code changes needed. `ModelRouter` in `reasoning/router.py` reads this at startup.

### Change the guidance prompt / reasoning behaviour

Edit the DSPy signatures in `reasoning/signatures.py`. Each signature has an `Instructions` docstring that acts as the system prompt. Output fields with `dspy.OutputField(desc=…)` shape the LLM's response structure.

### Change what the character expresses for an emotion

Edit `mobile/src/characters/robot/expressions.ts`. Each `ExpressionName` maps to a `Partial<ExpressionParams>` — only override what differs from `DEFAULT_PARAMS`.

### Add a new message type (server → mobile)

1. Add a method to `ClientSession` in `transport/ws_server.py`
2. Add the Pydantic model to `models.py`
3. Add the TypeScript interface to `mobile/src/types/protocol.ts`
4. Add a `case` in `useWebSocket.ts` to route it to the store
5. Add a handler in `mobile/src/stores/session.ts`

### Add a new screen to the mobile app

Create `mobile/app/<screen>.tsx`. Expo Router picks it up automatically. Link to it with `router.push("/<screen>")`.

### Change perception thresholds

Edit `config/default.yaml` under `perception:`. The `clip.similarity_threshold` controls how sensitive scene change detection is (lower = more sensitive). `reasoning.heartbeat_seconds` controls how often the server generates guidance with no new events.

### Change the server port

Edit `config/default.yaml`:
```yaml
server:
  port: 8420
```
Update `EXPO_PUBLIC_WS_URL` in `mobile/.env.local` to match.

---

## 7. Debugging

### Server-side — add logging before guessing

The server uses Python's `logging` module. Every module has `log = logging.getLogger(__name__)`. Add `log.info(…)` or `log.debug(…)` before assuming what a value is.

```python
log.info("Chat payload: text=%r images=%d", chat_msg.text[:80], len(images))
log.debug("Discovery result: items=%r suggestions=%r", result.items, result.suggestions)
```

Run the server with `DEBUG` level to see all output:
```bash
LOG_LEVEL=DEBUG uv run cookie-server
```

Key things to log when debugging:
- Input payload fields and their types (especially `image_bytes` — is it `str` or `bytes`?)
- LLM response fields before Pydantic validation
- Session ID on every handler call (sessions are per-connection, not per-user)

### Mobile-side — check the store before the UI

The Zustand store is the single source of truth. Before debugging a UI issue, verify the store has the right data. In development, install React Native DevTools or add a temporary log:

```ts
useEffect(() => {
  console.log("[store] chatMessages", chatMessages);
}, [chatMessages]);
```

For WebSocket message routing issues, add a log at the top of the `onMessage` handler in `useWebSocket.ts`:

```ts
console.log("[ws] received", envelope.type, envelope.payload);
```

### Connection issues

1. Confirm server is running: `curl http://<ip>:8420/` — should get a connection refused (no HTTP), meaning the port is open.
2. Check `EXPO_PUBLIC_WS_URL` in `mobile/.env.local` — must be `ws://` not `https://`.
3. Both devices must be on the same network. VPNs often block local traffic.
4. The app Settings screen lets you change the URL at runtime without rebuilding.

### LLM errors

DSPy exceptions are caught at the handler level — check server logs for `Chat handler failed` or `Discovery mode failed` tracebacks. The most common causes:
- Wrong API key in `.env`
- Model name typo in `config/default.yaml`
- LLM returning a field type the Pydantic model doesn't accept (e.g. `float` for a `Literal["high","medium","low"]` field) — check `signatures.py`

---

## 8. Key Invariants — Do Not Break These

- **`models.py` ↔ `protocol.ts`**: These must stay in sync. If you add a field to `ChatResponse` in Python, add it to the TypeScript interface too.
- **`ExpressionName` literals**: Defined in `mobile/src/characters/protocol.ts`. The server emits these strings; the store passes them to the renderer. If you add one, update: the type, every character's `expressions.ts`, and the server's DSPy signature instructions.
- **`AntennaLightState` values** must match the keys in `signal.colors` in `character_v1.json`. They are: `"idle"`, `"excited"`, `"alert"`, `"error"`.
- **Image bytes are base64 strings** on the wire, never raw binary. `ChatMessage.image_bytes` is `str | None` in Python. Do not change it to `bytes`.
- **Session IDs are per WebSocket connection**, not per user. Each reconnect creates a new session.

---

## 9. Before Making a Decision

1. **Read the relevant file first.** Don't assume field names, types, or behaviour — check `models.py`, `protocol.ts`, and the store shape.
2. **Add a log and run it** before writing a fix. Confirm the actual value causing the problem rather than the assumed value.
3. **Check both sides of the wire.** A bug that looks like a UI problem is often a type mismatch in the payload — compare `models.py` to `protocol.ts`.
4. **Run the harness** to validate server-side reasoning changes without needing the mobile app.
5. **Test with batch screenshots** (see §4) to validate vision + chat changes in isolation.
