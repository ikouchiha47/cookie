# Cookie Project

A mobile cooking assistant application with an interactive character system to guide users live through cooking, supported by a backend server.

## Server

The server can be run using `uv run cookie-server`.

## Mobile Application

To run the mobile application locally:

1. Install dependencies:
   ```bash
   cd mobile
   npm install
   ```
2. Ensure your mobile device and the server are on the same network.
3. Set the server URL — create `mobile/.env.local` and add:
   ```
   EXPO_PUBLIC_WS_URL=ws://<your-machine-ip>:8420/ws
   ```
   Alternatively, you can change the server address inside the app's settings at runtime.
4. Start the Expo dev server:
   ```bash
   npx expo start
   ```
5. Scan the QR code with the Expo Go app on your device, or press `i` for iOS simulator / `a` for Android emulator.

## Testing Without a Device

### Replay a cooking video

The harness downloads a YouTube video and drives the full server pipeline offline — no camera or mobile app needed:

```bash
uv run cookie-harness --url "https://www.youtube.com/watch?v=<id>"
```

It extracts frames at 3fps, runs them through perception + reasoning, and prints guidance output for each frame.

### Send screenshots in batch (test chat / vision)

With the server running, send base64-encoded images directly over WebSocket to test the chat and discovery endpoints:

```python
import asyncio, base64, json, pathlib, websockets

async def test():
    async with websockets.connect("ws://localhost:8420/ws") as ws:
        images = [pathlib.Path(p).read_bytes() for p in ["frame1.jpg", "frame2.jpg"]]
        payload = {
            "type": "chat",
            "payload": {
                "text": "What can I make with these ingredients?",
                "image_bytes_list": [base64.b64encode(img).decode() for img in images],
            },
            "timestamp": 0,
        }
        await ws.send(json.dumps(payload))
        print(json.loads(await ws.recv()))

asyncio.run(test())
```

Use `"image_bytes"` (single string) instead of `"image_bytes_list"` for a single image.

## Character System (Mobile)

The `mobile/src/characters/CHARACTERS.md` document provides a detailed guide on how to design, extract, and wire up new characters, and how to build alternative renderers for the mobile application. It covers:

- Architecture Overview
- Schema definition and generation from Inkscape SVG
- Inkscape authoring rules and naming conventions
- Expression types (transform and overlay) and their mapping
- Steps for adding new characters and renderers
- Protocol reference for expression names and normalized values
- Common mistakes and troubleshooting tips

## Screenshots

| Bot Screen | Chat Screen |
|:---:|:---:|
| <img src="screenshots/botscreen.jpeg" alt="Bot Screen" width="320"> | <img src="screenshots/chatscreen.jpeg" alt="Chat Screen" width="320"> |
