/** Hook: Camera frame capture → WS
 *
 * Discovery: snapNow (2-frame burst) + 60s auto-fire when cameraMode=streaming
 * Cooking:   criticality-adaptive interval (low=10s, medium=3s, high=1s)
 */

import { useCallback, useEffect, useRef } from "react";
import { type Camera } from "react-native-vision-camera";
import { readAsStringAsync } from "expo-file-system/legacy";
import { wsService } from "../services/websocket";
import { useSessionStore } from "../stores/session";

const DISCOVERY_AUTO_MS = 60_000;
const SNAP_FRAMES = 2;

const CRITICALITY_INTERVAL: Record<"low" | "medium" | "high", number> = {
  low: 10_000,
  medium: 3_000,
  high: 1_000,
};

async function captureFrame(camera: Camera): Promise<string | null> {
  try {
    const snapshot = await camera.takeSnapshot({ quality: 80 });
    const uri = snapshot.path.startsWith("file://") ? snapshot.path : `file://${snapshot.path}`;
    return await readAsStringAsync(uri, { encoding: "base64" });
  } catch {
    return null;
  }
}

function buildContext() {
  const s = useSessionStore.getState();
  return {
    session_id: s.sessionId ?? "mock-session",
    epoch: s.epoch,
    phase: s.phase,
    current_step: s.currentStep,
    step_instruction: s.stepInstruction,
    expected_visual_state: s.expectedVisualState,
    expected_texture: s.expectedTexture,
    expected_taste_smell: s.expectedTasteSmell,
    watch_for: s.watchFor,
    criticality: s.criticality,
    recipe_title: s.recipePlan?.title ?? "",
    discovered_items: s.discoveredItems,
  };
}

export function useCamera(cameraRef: React.RefObject<Camera | null>) {
  const cookingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const discoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCapturing = useRef(false);
  const autoFireEnabled = useRef(false);

  const sendFrame = useCallback(async () => {
    if (isCapturing.current) return;
    const camera = cameraRef.current;
    if (!camera || !wsService.isConnected) return;
    if (!useSessionStore.getState().isActive) return;
    isCapturing.current = true;
    try {
      const base64 = await captureFrame(camera);
      if (!base64) return;
      const sent = wsService.send("frame", {
        timestamp: Date.now() / 1000,
        frame_bytes: base64,
        frame_hash: "",
        context: buildContext(),
      });
      if (sent) {
        useSessionStore.getState().setChatLoading(true);
        // Safety: clear spinner if server never responds
        setTimeout(() => useSessionStore.getState().setChatLoading(false), 30_000);
      }
      useSessionStore.getState().touchActivity();
    } finally {
      isCapturing.current = false;
    }
  }, [cameraRef]);

  const snapNow = useCallback(async () => {
    for (let i = 0; i < SNAP_FRAMES; i++) {
      await sendFrame();
      if (i < SNAP_FRAMES - 1) await new Promise((r) => setTimeout(r, 500));
    }
  }, [sendFrame]);

  const startCookingSampling = useCallback((criticality: "low" | "medium" | "high") => {
    if (cookingInterval.current) {
      clearInterval(cookingInterval.current);
      cookingInterval.current = null;
    }
    cookingInterval.current = setInterval(sendFrame, CRITICALITY_INTERVAL[criticality]);
  }, [sendFrame]);

  const stopCookingSampling = useCallback(() => {
    if (cookingInterval.current) {
      clearInterval(cookingInterval.current);
      cookingInterval.current = null;
    }
  }, []);

  const scheduleAutoFire = useCallback(() => {
    autoFireEnabled.current = true;
    if (discoveryTimer.current) clearTimeout(discoveryTimer.current);
    discoveryTimer.current = setTimeout(async () => {
      if (!autoFireEnabled.current) return;
      const { phase, cameraMode } = useSessionStore.getState();
      if (phase === "discovery" && cameraMode === "streaming") {
        await snapNow();
        scheduleAutoFire();
      }
    }, DISCOVERY_AUTO_MS);
  }, [snapNow]);

  const stopAutoFire = useCallback(() => {
    autoFireEnabled.current = false;
    if (discoveryTimer.current) {
      clearTimeout(discoveryTimer.current);
      discoveryTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopCookingSampling();
      stopAutoFire();
    };
  }, []);

  return { snapNow, startCookingSampling, stopCookingSampling, scheduleAutoFire, stopAutoFire };
}
