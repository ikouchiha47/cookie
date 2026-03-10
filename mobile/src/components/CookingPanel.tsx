import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CurrentStep } from "./CurrentStep";
import { CheckpointLog } from "./CheckpointLog";
import { VoiceOrb } from "./VoiceOrb";
import { useSessionStore } from "../stores/session";

interface Props {
  onAddIngredients: () => void;
  onFinish: () => void;
  onVoicePressIn: () => void;
  onVoicePressOut: () => void;
}

export function CookingPanel({ onAddIngredients, onFinish, onVoicePressIn, onVoicePressOut }: Props) {
  const phase = useSessionStore((s) => s.phase);
  const setPhase = useSessionStore((s) => s.setPhase);
  const recipePlan = useSessionStore((s) => s.recipePlan);
  const currentStepIndex = useSessionStore((s) => s.currentStepIndex);
  const updateStep = useSessionStore((s) => s.updateStep);

  const isPaused = phase === "paused";
  const totalSteps = recipePlan?.steps.length ?? 0;
  const isLastStep = currentStepIndex >= totalSteps - 1;

  const togglePause = () => setPhase(isPaused ? "cooking" : "paused");

  const handleNext = () => {
    if (isLastStep) {
      onFinish();
    } else {
      updateStep(currentStepIndex, "done");
    }
  };

  return (
    <View style={styles.container}>
      <CurrentStep />
      <CheckpointLog />
      <View style={styles.controls}>
        <View style={styles.topRow}>
          <VoiceOrb onPressIn={onVoicePressIn} onPressOut={onVoicePressOut} />
          <Pressable style={[styles.pauseBtn, isPaused && styles.pauseBtnActive]} onPress={togglePause}>
            <Ionicons name={isPaused ? "play" : "pause"} size={20} color="white" />
          </Pressable>
        </View>
        <View style={styles.actions}>
          <Pressable style={styles.secondaryBtn} onPress={onAddIngredients}>
            <Ionicons name="arrow-back" size={16} color="rgba(255,255,255,0.7)" />
            <Text style={styles.secondaryText}>Add Ingredients</Text>
          </Pressable>
          <Pressable style={styles.nextBtn} onPress={handleNext}>
            <Text style={styles.nextBtnText}>{isLastStep ? "Finish" : "Next Step"}</Text>
            <Ionicons name={isLastStep ? "checkmark" : "arrow-forward"} size={16} color="white" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 4,
  },
  controls: {
    alignItems: "center",
    gap: 12,
    paddingBottom: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  pauseBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  pauseBtnActive: {
    backgroundColor: "#eab308",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  secondaryText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "500",
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#22c55e",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  nextBtnText: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },
});
