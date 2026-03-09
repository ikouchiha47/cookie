/** Hook: Silent frame sampling from live video stream → WS
 *
 * Uses react-native-vision-camera's takeSnapshot() — reads directly from
 * the preview buffer with no shutter sound, no flash, no UI interruption.
 * Runs on the JS thread via setInterval; no worklet boundary issues.
 */

import { useCallback, useRef } from "react";
import { type Camera } from "react-native-vision-camera";
import { readAsStringAsync } from "expo-file-system/legacy";
import { wsService } from "../services/websocket";
import { useSessionStore } from "../stores/session";

const SAMPLE_INTERVAL_MS = 1000; // 1fps — LLM latency is the bottleneck

export function useCamera(cameraRef: React.RefObject<Camera | null>) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCapturing = useRef(false);

  const startSampling = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(async () => {
      if (isCapturing.current) return; // skip if previous capture still running
      const camera = cameraRef.current;
      if (!camera) return;
      const { isActive, isCameraActive, touchActivity } = useSessionStore.getState();
      if (!isActive || !isCameraActive || !wsService.isConnected) return;

      isCapturing.current = true;
      try {
        const snapshot = await camera.takeSnapshot({ quality: 80 });
        const uri = snapshot.path.startsWith("file://") ? snapshot.path : `file://${snapshot.path}`;
        const base64 = await readAsStringAsync(uri, { encoding: "base64" });

        const store = useSessionStore.getState();
        const context = {
          session_id: store.sessionId ?? "mock-session",
          phase: store.phase ?? "discovery",
          current_step: store.currentStep ?? 0,
          step_instruction: store.stepInstruction ?? "",
          expected_visual_state: store.expectedVisualState ?? "",
          watch_for: store.watchFor ?? "",
          criticality: store.criticality ?? "medium",
          recipe_title: store.recipePlan?.title ?? "",
          discovered_items: store.discoveredItems ?? [],
        };

        const sent = wsService.send("frame", {
          timestamp: Date.now() / 1000,
          frame_bytes: base64,
          frame_hash: "",
          context,
        });
        console.log("[useCamera] frame sent:", sent, "phase:", context.phase, "~", Math.round(base64.length * 0.75 / 1024), "KB");
        touchActivity();
      } catch (e) {
        console.warn("[useCamera] snapshot error:", e);
      } finally {
        isCapturing.current = false;
      }
    }, SAMPLE_INTERVAL_MS);
  }, [cameraRef]);

  const stopSampling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  return { startSampling, stopSampling };
}
