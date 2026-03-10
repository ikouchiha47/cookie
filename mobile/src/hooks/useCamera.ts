/** Hook: Camera frame capture → WS
 *
 * Discovery: on-demand snapshots (scanNow) + 60s auto-fire
 * Cooking:   continuous 1fps sampling for real-time guidance
 */

import { useCallback, useEffect, useRef } from "react";
import { type Camera } from "react-native-vision-camera";
import { readAsStringAsync } from "expo-file-system/legacy";
import { wsService } from "../services/websocket";
import { useSessionStore } from "../stores/session";

const COOKING_INTERVAL_MS = 1000;
const DISCOVERY_AUTO_MS = 60_000;
const SCAN_FRAMES = 2;

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
    phase: s.phase,
    current_step: s.currentStep,
    step_instruction: s.stepInstruction,
    expected_visual_state: s.expectedVisualState,
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
  const autoScanEnabled = useRef(false);

  const sendFrame = useCallback(async () => {
    if (isCapturing.current) return;
    const camera = cameraRef.current;
    if (!camera || !wsService.isConnected) return;
    isCapturing.current = true;
    try {
      const base64 = await captureFrame(camera);
      if (!base64) return;
      wsService.send("frame", {
        timestamp: Date.now() / 1000,
        frame_bytes: base64,
        frame_hash: "",
        context: buildContext(),
      });
      useSessionStore.getState().touchActivity();
    } finally {
      isCapturing.current = false;
    }
  }, [cameraRef]);

  const scanNow = useCallback(async () => {
    for (let i = 0; i < SCAN_FRAMES; i++) {
      await sendFrame();
      if (i < SCAN_FRAMES - 1) await new Promise((r) => setTimeout(r, 500));
    }
  }, [sendFrame]);

  const startCookingSampling = useCallback(() => {
    if (cookingInterval.current) return;
    cookingInterval.current = setInterval(sendFrame, COOKING_INTERVAL_MS);
  }, [sendFrame]);

  const stopCookingSampling = useCallback(() => {
    if (cookingInterval.current) {
      clearInterval(cookingInterval.current);
      cookingInterval.current = null;
    }
  }, []);

  const scheduleAutoScan = useCallback(() => {
    autoScanEnabled.current = true;
    if (discoveryTimer.current) clearTimeout(discoveryTimer.current);
    discoveryTimer.current = setTimeout(async () => {
      if (!autoScanEnabled.current) return;
      const { phase, isCameraActive } = useSessionStore.getState();
      if (phase === "discovery" && isCameraActive) {
        await scanNow();
        scheduleAutoScan();
      }
    }, DISCOVERY_AUTO_MS);
  }, [scanNow]);

  const stopAutoScan = useCallback(() => {
    autoScanEnabled.current = false;
    if (discoveryTimer.current) {
      clearTimeout(discoveryTimer.current);
      discoveryTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopCookingSampling();
      stopAutoScan();
    };
  }, []);

  return { scanNow, startCookingSampling, stopCookingSampling, scheduleAutoScan, stopAutoScan };
}
