/** Hook: Camera frame capture + sampling → WS */

import { useRef, useCallback, useEffect } from "react";
import { type CameraView } from "expo-camera";
import { FrameSampler } from "../services/frameSampler";
import { wsService } from "../services/websocket";
import { useSessionStore } from "../stores/session";

const FPS = 3;
const JPEG_QUALITY = 0.8;

export function useCamera(cameraRef: React.RefObject<CameraView | null>) {
  const sampler = useRef(new FrameSampler({ phash_threshold: 12, min_interval_ms: 200 }));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActive = useSessionStore((s) => s.isActive);
  const isCameraActive = useSessionStore((s) => s.isCameraActive);
  const touchActivity = useSessionStore((s) => s.touchActivity);

  const captureAndSend = useCallback(async () => {
    if (!cameraRef.current || !wsService.isConnected) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: JPEG_QUALITY,
        base64: true,
        skipProcessing: true,
      });
      if (!photo?.base64) return;

      const { send, hash } = sampler.current.shouldSend(photo.base64);
      if (send) {
        wsService.send("frame", {
          timestamp: Date.now() / 1000,
          frame_bytes: photo.base64,
          frame_hash: hash,
        });
        touchActivity();
      }
    } catch (e) {
      // Camera might not be ready yet
      console.warn("[Camera] Capture failed:", e);
    }
  }, [cameraRef, touchActivity]);

  useEffect(() => {
    if (isActive && isCameraActive) {
      intervalRef.current = setInterval(captureAndSend, 1000 / FPS);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, isCameraActive, captureAndSend]);

  return { sampler: sampler.current };
}
