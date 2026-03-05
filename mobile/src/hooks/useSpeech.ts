/** Hook: TTS via expo-speech */

import { useCallback } from "react";
import * as Speech from "expo-speech";
import { useSessionStore } from "../stores/session";

export function useSpeech() {
  const setSpeaking = useSessionStore((s) => s.setSpeaking);

  const speak = useCallback(
    (text: string) => {
      Speech.speak(text, {
        language: "en-US",
        rate: 0.95,
        onStart: () => setSpeaking(true),
        onDone: () => setSpeaking(false),
        onError: () => setSpeaking(false),
      });
    },
    [setSpeaking]
  );

  const stop = useCallback(() => {
    Speech.stop();
    setSpeaking(false);
  }, [setSpeaking]);

  return { speak, stop };
}
