import React, { useRef, useEffect, useCallback } from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Camera, useCameraPermission, useCameraDevice } from "react-native-vision-camera";
import { CharacterFace } from "../src/components/character/CharacterFace";
import { CameraIndicator } from "../src/components/CameraIndicator";
import { CurrentStep } from "../src/components/CurrentStep";
import { CheckpointLog } from "../src/components/CheckpointLog";
import { VoiceOrb } from "../src/components/VoiceOrb";
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

  const isActive = useSessionStore((s) => s.isActive);
  const expression = useSessionStore((s) => s.expression);
  const setExpression = useSessionStore((s) => s.setExpression);
  const startSession = useSessionStore((s) => s.startSession);
  const endSession = useSessionStore((s) => s.endSession);
  const setCameraActive = useSessionStore((s) => s.setCameraActive);
  const lastActivityAt = useSessionStore((s) => s.lastActivityAt);
  const latestGuidance = useSessionStore((s) => s.latestGuidance);
  const discoveredItems = useSessionStore((s) => s.discoveredItems);
  const recipeSuggestions = useSessionStore((s) => s.recipeSuggestions);
  const connectionStatus = useSessionStore((s) => s.connectionStatus);

  const { startSampling, stopSampling } = useCamera(cameraRef);
  const { send } = useWebSocket();
  const { startRecording, stopAndSend } = useAudio();
  const { speak, stop: stopSpeech } = useSpeech();

  useEffect(() => {
    if (latestGuidance?.text) speak(latestGuidance.text);
  }, [latestGuidance]);

  useEffect(() => {
    if (discoveredItems.length === 0) return;
    const itemsList = discoveredItems.join(", ");
    const top = recipeSuggestions[0]?.name;
    speak(top ? `I can see ${itemsList}. How about making ${top}?` : `I can see ${itemsList}.`);
  }, [discoveredItems]);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) setExpression("sleeping");
    }, 5000);
    return () => clearInterval(interval);
  }, [isActive, lastActivityAt, setExpression]);

  const handleToggleSession = useCallback(async () => {
    if (isActive) {
      stopSampling();
      endSession();
      setCameraActive(false);
      stopSpeech();
      return;
    }
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) return;
    }
    startSession();
    setCameraActive(true);
    startSampling();
  }, [isActive, hasPermission, requestPermission, startSession, endSession, setCameraActive, stopSpeech, startSampling]);

  const statusColor =
    connectionStatus === "connected" ? "#22c55e" :
    connectionStatus === "connecting" ? "#eab308" : "#ef4444";
  const statusIcon =
    connectionStatus === "connected" ? "wifi" :
    connectionStatus === "connecting" ? "wifi" : "wifi-outline";

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar — minimal */}
      <View style={styles.topBar}>
        {device && <CameraIndicator cameraRef={cameraRef} device={device} />}
        <View style={styles.topBarRight}>
          <Ionicons name={statusIcon as any} size={18} color={statusColor} />
          <Pressable onPress={() => router.push("/chat")} style={styles.iconBtn}>
            <Ionicons name="chatbubble-outline" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
          <Pressable onPress={() => router.push("/history")} style={styles.iconBtn}>
            <Ionicons name="time-outline" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
          <Pressable onPress={() => router.push("/settings")} style={styles.iconBtn}>
            <Ionicons name="settings-outline" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
        </View>
      </View>

      {/* Character — hero of the screen, vertically centered in remaining space */}
      <View style={styles.heroArea}>
        <CharacterFace />
        <CurrentStep />
      </View>

      {/* Checkpoint log */}
      <View style={styles.checkpoints}>
        <CheckpointLog />
      </View>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        {isActive && (
          <VoiceOrb onPressIn={startRecording} onPressOut={stopAndSend} />
        )}
        <Pressable
          style={[styles.sessionBtn, isActive && styles.sessionBtnActive]}
          onPress={handleToggleSession}
        >
          <Text style={styles.sessionBtnText}>
            {isActive ? "Stop Cooking" : "Start Cooking"}
          </Text>
        </Pressable>
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
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  checkpoints: {
    maxHeight: 120,
  },
  bottomBar: {
    alignItems: "center",
    paddingBottom: 20,
    gap: 12,
  },
  sessionBtn: {
    backgroundColor: "#22c55e",
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 28,
  },
  sessionBtnActive: {
    backgroundColor: "#ef4444",
  },
  sessionBtnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
