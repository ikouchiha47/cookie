# Cookie — System Design

## Core Principle
The app is a silent, watchful kitchen assistant. Voice is the primary interface.
The screen is glanceable, never demands interaction. Hands are always busy.

---

## State Machine

```
IDLE → DISCOVERY → CONFIRMING → RECIPE_SELECTION → COOKING → DONE
                                                       ↓
                                                    PAUSED
```

---

## IDLE
- App open, camera off
- "Start Cooking" is the only action

---

## DISCOVERY
**Trigger:** User taps "Start Cooking"

**What happens:**
- Camera turns on, frame sampling begins
- Debounce: every new item detected restarts an 8-10s timer
- Timer expires → run inference → identify items → speak result once
- Ask: *"I can see eggs and flour — is that everything?"*
  - User says yes → CONFIRMING → RECIPE_SELECTION
  - User says no → reset debounce, wait for more items
  - No reply in ~15s → treat as yes, proceed

**Key rules:**
- Only one inference in flight at a time (mailbox — latest frame always wins)
- If a second inference result arrives while first is showing → replace, don't stack
- Do NOT speak suggestions during discovery — wait until RECIPE_SELECTION
- Frame sampling: 1fps, server decides when to actually run inference based on debounce

---

## RECIPE_SELECTION
**What happens:**
- Suggestions shown on screen inline
- User taps OR speaks their choice
- If custom: voice/chat conversation
- Allergen/preference check before confirming
- Once confirmed → generate recipe plan → COOKING

---

## COOKING

### Inference Architecture

**Vigilance levels** (LLM sets, system translates to rate):
| Level | Rate | When |
|-------|------|------|
| low | 30s | stable state — boiling, resting, marinating |
| medium | 10s | slow changes — reducing, simmering |
| high | 3s | fast transitions — onions browning, oil temp, paste thickness |

**LLM inference response schema:**
```json
{
  "observation": "onions softening, not yet golden",
  "guidance": "keep stirring on medium heat",
  "watch_for": "onions turning golden at edges",
  "criticality": "high",
  "step_complete": false,
  "expression": "focused"
}
```

- LLM owns: what to watch for, how critical it is to catch
- System owns: actual polling rate based on criticality
- LLM does NOT set timing numbers — it doesn't know your stove

**State change detection:**
- Compare consecutive inference *outputs*, not raw frames
- Two identical observations → stable, no action needed
- Observation changes → act, speak, animate

**Mid-cook item addition:**
- User adds ingredient → do NOT re-run discovery
- Instead: "how does this fit into what I'm already making?"
- Integrate into current recipe context

**User pivots mid-cook:**
- "I want to make something else" / "I'm giving up"
- Handle gracefully, offer to save progress or start over

### Audio
- Always-on VAD (voice activity detection) — not always recording
- Wake word: "Cookie" — activates listening from any state
- After speaking to user: wait up to 2 min for response
- If response unclear or off → confirm before acting
- Detect acknowledgements: "got it", "okay", "yeah" → move on
- Ignore background noise, cooking sounds

### Idle / Pause detection
- No meaningful scene change for X minutes → PAUSED
- Screen shows: *"Say 'Cookie' to continue"*
- Character: sleeping expression
- Wake word → resume COOKING

### Recipe completion detection
- LLM signals step_complete per step
- Final step complete → ask for confirmation → DONE

---

## DONE
- "Looks like you're done! How did it turn out?"
- Feedback conversation — taste, difficulty, what they'd change
- Compensate for missing senses (can't taste/smell) through questions
- Save session to history

---

## PAUSED
- Triggered by: idle detection, user leaving frame, app backgrounded
- Screen: minimal — wake word prompt, character sleeping
- All inference stops
- Wake word or tap → resume last state

---

## UI Principles
- **Main screen:** current step (large), next step (small), character, one emergency button
- **Recipe suggestions:** tap → steps expand inline in content area, not a new screen
- **Next step:** voice-triggered ("next" / "done") or system-detected
- **Suggestions during discovery:** shown on screen but NOT spoken until user is ready
- **Everything else** (chat, history, settings) exists but never needed during cooking

---

## Open Questions
- Wake word: real detector (Picovoice Porcupine) or push-to-talk button?
- Debounce timer: fixed 8s or adaptive based on number of items detected?
- VAD library for React Native?
- How to detect "scene stable" server-side between inference calls?
