import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";
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
  onPause: () => void;
  onResume: () => void;
}

export function CookingPanel({ onAddIngredients, onFinish, onVoicePressIn, onVoicePressOut, onPause, onResume }: Props) {
  const phase = useSessionStore((s) => s.phase);
  const recipePlan = useSessionStore((s) => s.recipePlan);
  const currentStepIndex = useSessionStore((s) => s.currentStepIndex);
  const updateStep = useSessionStore((s) => s.updateStep);
  const cookingNotes = useSessionStore((s) => s.cookingNotes);
  const setCookingNotes = useSessionStore((s) => s.setCookingNotes);

  const [showNotes, setShowNotes] = useState(false);

  const isPaused = phase === "paused";
  const totalSteps = recipePlan?.steps.length ?? 0;
  const isLastStep = currentStepIndex >= totalSteps - 1;

  const togglePause = () => isPaused ? onResume() : onPause();

  const handleNext = () => {
    if (isLastStep) {
      onFinish();
    } else {
      updateStep(currentStepIndex, "done");
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <CurrentStep />
      <CheckpointLog />

      {showNotes && (
        <View style={styles.notesContainer}>
          <TextInput
            style={styles.notesInput}
            value={cookingNotes}
            onChangeText={setCookingNotes}
            placeholder="Add modifications or notes…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            multiline
            autoFocus
          />
        </View>
      )}

      <View style={styles.controls}>
        <View style={styles.topRow}>
          <VoiceOrb onPressIn={onVoicePressIn} onPressOut={onVoicePressOut} />
          <Pressable style={[styles.iconBtn, showNotes && styles.iconBtnActive]} onPress={() => setShowNotes(!showNotes)}>
            <Ionicons name="pencil" size={20} color="white" />
          </Pressable>
          <Pressable style={[styles.iconBtn, isPaused && styles.iconBtnPaused]} onPress={togglePause}>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 4,
  },
  notesContainer: {
    marginHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  notesInput: {
    color: "white",
    fontSize: 14,
    padding: 12,
    minHeight: 72,
    lineHeight: 20,
  },
  controls: {
    alignItems: "center",
    gap: 12,
    paddingBottom: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnActive: {
    backgroundColor: "#3b82f6",
  },
  iconBtnPaused: {
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
