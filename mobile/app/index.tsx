import React, { useRef, useEffect, useCallback, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Camera, useCameraPermission, useCameraDevice } from "react-native-vision-camera";
import { CharacterFace } from "../src/components/character/CharacterFace";
import { CameraIndicator } from "../src/components/CameraIndicator";
import { DiscoveryPanel } from "../src/components/DiscoveryPanel";
import { CookingPanel } from "../src/components/CookingPanel";
import { DonePanel } from "../src/components/DonePanel";
import { useWebSocket } from "../src/hooks/useWebSocket";
import { wsService } from "../src/services/websocket";
import { useCamera } from "../src/hooks/useCamera";
import { useAudio } from "../src/hooks/useAudio";
import { useSpeech } from "../src/hooks/useSpeech";
import { useSessionStore } from "../src/stores/session";

const IDLE_TIMEOUT_MS = 60_000;

export default function MainScreen() {
  const cameraRef = useRef<Camera>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");

  const phase = useSessionStore((s) => s.phase);
  const isActive = useSessionStore((s) => s.isActive);
  const cameraMode = useSessionStore((s) => s.cameraMode);
  const criticality = useSessionStore((s) => s.criticality);
  const setExpression = useSessionStore((s) => s.setExpression);
  const startSession = useSessionStore((s) => s.startSession);
  const endSession = useSessionStore((s) => s.endSession);
  const setPhase = useSessionStore((s) => s.setPhase);
  const setCameraMode = useSessionStore((s) => s.setCameraMode);
  const lastActivityAt = useSessionStore((s) => s.lastActivityAt);
  const latestGuidance = useSessionStore((s) => s.latestGuidance);
  const discoveredItems = useSessionStore((s) => s.discoveredItems);
  const recipeSuggestions = useSessionStore((s) => s.recipeSuggestions);
  const connectionStatus = useSessionStore((s) => s.connectionStatus);

  const cameraExpanded = useSessionStore((s) => s.cameraExpanded);
  const setCameraExpanded = useSessionStore((s) => s.setCameraExpanded);
  const [muted, setMuted] = useState(false);

  const { snapNow, startCookingSampling, stopCookingSampling, scheduleAutoFire, stopAutoFire } = useCamera(cameraRef);
  const { startRecording, stopAndSend } = useAudio();
  const { speak, stop: stopSpeech } = useSpeech();

  const stopSideEffects = useCallback(() => {
    stopCookingSampling();
    stopAutoFire();
    stopSpeech();
    setCameraMode("off");
  }, [stopCookingSampling, stopAutoFire, stopSpeech, setCameraMode]);

  useWebSocket(stopSideEffects);

  // speak guidance only during cooking
  useEffect(() => {
    if (phase !== "cooking") return;
    if (latestGuidance?.text && !muted) speak(latestGuidance.text);
  }, [latestGuidance]);

  // speak discovery results only during discovery
  useEffect(() => {
    if (phase !== "discovery") return;
    if (discoveredItems.length === 0) return;
    const itemsList = discoveredItems.join(", ");
    const top = recipeSuggestions[0]?.name;
    if (!muted) speak(top ? `I can see ${itemsList}. How about making ${top}?` : `I can see ${itemsList}.`);
  }, [discoveredItems]);

  // idle detection
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) setExpression("idle");
    }, 5000);
    return () => clearInterval(interval);
  }, [isActive, lastActivityAt, setExpression]);

  // phase/isActive → sampling orchestrator
  useEffect(() => {
    if (!isActive) {
      stopCookingSampling();
      stopAutoFire();
      setCameraMode("off");
      return;
    }
    if (phase === "cooking") {
      stopAutoFire();
      setCameraMode("streaming");
      startCookingSampling(criticality);
    } else if (phase === "discovery") {
      // cameraMode is user-driven in discovery
    } else if (phase === "paused") {
      stopCookingSampling();
      stopAutoFire();
      setCameraMode("paused");
    } else {
      stopCookingSampling();
      stopAutoFire();
      setCameraMode("off");
    }
  }, [phase, isActive]);

  // criticality change → restart cooking interval at new rate
  useEffect(() => {
    if (phase !== "cooking" || cameraMode !== "streaming") return;
    startCookingSampling(criticality);
  }, [criticality]);

  // cameraMode → arm/disarm discovery auto-fire
  useEffect(() => {
    if (phase !== "discovery") return;
    if (cameraMode === "streaming") scheduleAutoFire();
    else stopAutoFire();
  }, [cameraMode]);

  const ensurePermission = useCallback(async () => {
    if (hasPermission) return true;
    return requestPermission();
  }, [hasPermission, requestPermission]);

  // Discovery camera controls
  const handleOpenSnap = useCallback(async () => {
    const ok = await ensurePermission();
    if (!ok) return;
    if (!isActive) startSession();
    setCameraMode("snap");
  }, [isActive, ensurePermission, startSession, setCameraMode]);

  const handleSnapSend = useCallback(async () => {
    await snapNow();
  }, [snapNow]);

  const handleStream = useCallback(async () => {
    const ok = await ensurePermission();
    if (!ok) return;
    if (!isActive) startSession();
    setCameraMode("streaming");
    await snapNow();
  }, [isActive, ensurePermission, startSession, setCameraMode, snapNow]);

  const handlePauseDiscovery = useCallback(() => {
    setCameraMode("paused");
  }, [setCameraMode]);

  const handleResumeDiscovery = useCallback(() => {
    setCameraMode("streaming");
  }, [setCameraMode]);

  const handleStop = useCallback(() => {
    stopAutoFire();
    setCameraMode("off");
  }, [stopAutoFire, setCameraMode]);

  const handleCancelCamera = useCallback(() => {
    stopAutoFire();
    stopCookingSampling();
    stopSpeech();
    setCameraMode("off");
  }, [stopAutoFire, stopCookingSampling, stopSpeech, setCameraMode]);

  // Cooking camera controls
  const handlePauseCooking = useCallback(() => {
    stopCookingSampling();
    stopSpeech();
    setPhase("paused");
    // cameraMode set by phase effect
  }, [stopCookingSampling, stopSpeech, setPhase]);

  const handleResumeCooking = useCallback(() => {
    setPhase("cooking");
    // phase effect restarts sampling + sets cameraMode streaming
  }, [setPhase]);

  const handleAddIngredients = useCallback(() => {
    setPhase("discovery");
  }, [setPhase]);

  const handleFinish = useCallback(() => {
    stopSideEffects();
    endSession();
  }, [stopSideEffects, endSession]);

  const handleStartNew = useCallback(() => {
    stopSpeech();
    endSession();
    startSession();
  }, [stopSpeech, endSession, startSession]);

  const handleAbort = useCallback(async () => {
    stopSideEffects();
    // Always reset locally immediately — don't wait for server ack
    useSessionStore.getState().handleAbort();
    // Best-effort notify server
    if (connectionStatus === "connected") {
      wsService.send("abort", {});
    }
  }, [stopSideEffects, connectionStatus]);

  const statusColor =
    connectionStatus === "connected" ? "#22c55e" :
    connectionStatus === "connecting" ? "#eab308" : "#ef4444";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft} />
        <View style={styles.topBarRight}>
          <Ionicons name="wifi" size={18} color={statusColor} />
          <Pressable onPress={() => { setMuted(m => !m); if (!muted) stopSpeech(); }} style={styles.iconBtn}>
            <Ionicons name={muted ? "volume-mute" : "volume-medium-outline"} size={20} color={muted ? "#ef4444" : "rgba(255,255,255,0.65)"} />
          </Pressable>
          <Pressable onPress={() => router.push("/chat")} style={styles.iconBtn}>
            <Ionicons name="chatbubble-outline" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
          <Pressable onPress={() => router.push("/settings")} style={styles.iconBtn}>
            <Ionicons name="settings-outline" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
          {(cameraMode !== "off" || isActive) && (
            <Pressable onPress={handleAbort} style={styles.iconBtn} accessibilityLabel="Cancel">
              <Ionicons name="close-circle-outline" size={22} color="#ef4444" />
            </Pressable>
          )}
        </View>
      </View>

      {device && (
        <CameraIndicator
          cameraRef={cameraRef}
          device={device}
          expanded={cameraExpanded}
          onToggleExpand={() => setCameraExpanded(v => !v)}
        />
      )}

      <View style={[styles.heroArea, cameraMode !== "off" && cameraExpanded && styles.heroAreaSmall]}>
        <CharacterFace />
      </View>

      <View style={styles.phaseArea}>
        {phase === "discovery" && (
          <DiscoveryPanel
            cameraMode={cameraMode}
            onSnap={handleOpenSnap}
            onSnapSend={handleSnapSend}
            onStream={handleStream}
            onPause={handlePauseDiscovery}
            onResume={handleResumeDiscovery}
            onStop={handleStop}
          />
        )}
        {(phase === "cooking" || phase === "paused") && (
          <CookingPanel
            onAddIngredients={handleAddIngredients}
            onFinish={handleFinish}
            onVoicePressIn={startRecording}
            onVoicePressOut={stopAndSend}
            onPause={handlePauseCooking}
            onResume={handleResumeCooking}
          />
        )}
        {phase === "done" && (
          <DonePanel onStartNew={handleStartNew} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f1117",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  topBarLeft: {
    flex: 1,
  },
  iconBtn: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  heroArea: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  heroAreaSmall: {
    transform: [{ scale: 0.45 }],
    height: 80,
    marginVertical: -20,
  },
  phaseArea: {
    flex: 1,
    justifyContent: "flex-end",
    paddingBottom: 20,
  },
});
