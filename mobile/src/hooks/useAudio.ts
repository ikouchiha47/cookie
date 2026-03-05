/** Hook: Audio recording with simple VAD → WS */

import { useRef, useCallback, useEffect } from "react";
import { Audio } from "expo-av";
import { wsService } from "../services/websocket";
import { useSessionStore } from "../stores/session";

const CHUNK_DURATION_MS = 5000;
const RMS_THRESHOLD = 0.02; // Simple VAD: energy above this = speech

export function useAudio() {
  const recording = useRef<Audio.Recording | null>(null);
  const isActive = useSessionStore((s) => s.isActive);
  const isListening = useSessionStore((s) => s.isListening);
  const setListening = useSessionStore((s) => s.setListening);
  const addTranscript = useSessionStore((s) => s.addTranscript);
  const touchActivity = useSessionStore((s) => s.touchActivity);

  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY
      );
      recording.current = rec;
      setListening(true);
    } catch (e) {
      console.warn("[Audio] Failed to start recording:", e);
    }
  }, [setListening]);

  const stopAndSend = useCallback(async () => {
    if (!recording.current) return;

    try {
      await recording.current.stopAndUnloadAsync();
      const uri = recording.current.getURI();
      recording.current = null;
      setListening(false);

      if (!uri) return;

      // Read audio file as base64 via fetch + blob
      const response = await fetch(uri);
      const blob = await response.blob();
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          // Strip data:...;base64, prefix
          resolve(result.split(",")[1] ?? result);
        };
        reader.readAsDataURL(blob);
      });

      // Send to server
      if (wsService.isConnected && base64.length > 100) {
        wsService.send("audio", {
          timestamp: Date.now() / 1000,
          audio_bytes: base64,
          is_speech: true, // Simplified: assume speech if user tapped record
        });
        touchActivity();
      }
    } catch (e) {
      console.warn("[Audio] Failed to stop recording:", e);
      setListening(false);
    }
  }, [setListening, touchActivity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recording.current) {
        recording.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  return { startRecording, stopAndSend, isListening };
}
