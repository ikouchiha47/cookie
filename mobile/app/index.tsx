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
import { useCamera } from "../src/hooks/useCamera";
import { useAudio } from "../src/hooks/useAudio";
import { useSpeech } from "../src/hooks/useSpeech";
import { useSessionStore } from "../src/stores/session";

const IDLE_TIMEOUT_MS = 60_000;

export default function MainScreen() {
  const cameraRef = useRef<Camera>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  const [isAutoScanning, setIsAutoScanning] = useState(false);

  const phase = useSessionStore((s) => s.phase);
  const isActive = useSessionStore((s) => s.isActive);
  const setExpression = useSessionStore((s) => s.setExpression);
  const startSession = useSessionStore((s) => s.startSession);
  const endSession = useSessionStore((s) => s.endSession);
  const setPhase = useSessionStore((s) => s.setPhase);
  const setCameraActive = useSessionStore((s) => s.setCameraActive);
  const lastActivityAt = useSessionStore((s) => s.lastActivityAt);
  const latestGuidance = useSessionStore((s) => s.latestGuidance);
  const discoveredItems = useSessionStore((s) => s.discoveredItems);
  const recipeSuggestions = useSessionStore((s) => s.recipeSuggestions);
  const connectionStatus = useSessionStore((s) => s.connectionStatus);

  const { scanNow, startCookingSampling, stopCookingSampling, scheduleAutoScan, stopAutoScan } = useCamera(cameraRef);
  useWebSocket();
  const { startRecording, stopAndSend } = useAudio();
  const { speak, stop: stopSpeech } = useSpeech();

  // speak guidance only during cooking
  useEffect(() => {
    if (phase !== "cooking") return;
    if (latestGuidance?.text) speak(latestGuidance.text);
  }, [latestGuidance]);

  // speak discovery results only during discovery
  useEffect(() => {
    if (phase !== "discovery") return;
    if (discoveredItems.length === 0) return;
    const itemsList = discoveredItems.join(", ");
    const top = recipeSuggestions[0]?.name;
    speak(top ? `I can see ${itemsList}. How about making ${top}?` : `I can see ${itemsList}.`);
  }, [discoveredItems]);

  // idle detection
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) setExpression("idle");
    }, 5000);
    return () => clearInterval(interval);
  }, [isActive, lastActivityAt, setExpression]);

  // sampling control based on phase
  useEffect(() => {
    if (!isActive) {
      stopCookingSampling();
      stopAutoScan();
      setIsAutoScanning(false);
      return;
    }
    if (phase === "cooking") {
      stopAutoScan();
      setIsAutoScanning(false);
      startCookingSampling();
    } else if (phase === "discovery") {
      stopCookingSampling();
      scheduleAutoScan();
      setIsAutoScanning(true);
    } else {
      // paused or done
      stopCookingSampling();
      stopAutoScan();
      setIsAutoScanning(false);
    }
  }, [phase, isActive]);

  const ensurePermission = useCallback(async () => {
    if (hasPermission) return true;
    return requestPermission();
  }, [hasPermission, requestPermission]);

  const handleScan = useCallback(async () => {
    const ok = await ensurePermission();
    if (!ok) return;
    if (!isActive) {
      startSession();
      setCameraActive(true);
    }
    await scanNow();
  }, [isActive, ensurePermission, startSession, setCameraActive, scanNow]);

  const handleStopScan = useCallback(() => {
    stopAutoScan();
    setIsAutoScanning(false);
  }, [stopAutoScan]);

  const handleAddIngredients = useCallback(() => {
    setPhase("discovery");
  }, [setPhase]);

  const handleFinish = useCallback(() => {
    stopCookingSampling();
    stopAutoScan();
    stopSpeech();
    endSession();
  }, [stopCookingSampling, stopAutoScan, stopSpeech, endSession]);

  const handleStartNew = useCallback(() => {
    stopSpeech();
    endSession();
    startSession();
    setCameraActive(true);
  }, [stopSpeech, endSession, startSession, setCameraActive]);

  const statusColor =
    connectionStatus === "connected" ? "#22c55e" :
    connectionStatus === "connecting" ? "#eab308" : "#ef4444";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        {device && <CameraIndicator cameraRef={cameraRef} device={device} />}
        <View style={styles.topBarRight}>
          <Ionicons name="wifi" size={18} color={statusColor} />
          <Pressable onPress={() => router.push("/chat")} style={styles.iconBtn}>
            <Ionicons name="chatbubble-outline" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
          <Pressable onPress={() => router.push("/settings")} style={styles.iconBtn}>
            <Ionicons name="settings-outline" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
        </View>
      </View>

      <View style={styles.heroArea}>
        <CharacterFace />
      </View>

      <View style={styles.phaseArea}>
        {phase === "discovery" && (
          <DiscoveryPanel
            onScan={handleScan}
            onStopScan={handleStopScan}
            isAutoScanning={isAutoScanning}
          />
        )}
        {(phase === "cooking" || phase === "paused") && (
          <CookingPanel
            onAddIngredients={handleAddIngredients}
            onFinish={handleFinish}
            onVoicePressIn={startRecording}
            onVoicePressOut={stopAndSend}
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
  phaseArea: {
    flex: 1,
    justifyContent: "flex-end",
    paddingBottom: 20,
  },
});
