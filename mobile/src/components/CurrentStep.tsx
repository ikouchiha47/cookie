import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSessionStore } from "../stores/session";

export function CurrentStep() {
  const recipePlan = useSessionStore((s) => s.recipePlan);
  const currentStepIndex = useSessionStore((s) => s.currentStepIndex);
  const stepTimerStart = useSessionStore((s) => s.stepTimerStart);
  const latestGuidance = useSessionStore((s) => s.latestGuidance);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!stepTimerStart) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - stepTimerStart) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [stepTimerStart]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (!recipePlan) return null;

  const step = recipePlan.steps[currentStepIndex];
  const totalSteps = recipePlan.steps.length;
  const displayText = step?.instruction ?? latestGuidance?.text ?? "";

  return (
    <View style={styles.container}>
      {totalSteps > 0 && (
        <Text style={styles.stepLabel}>
          STEP {currentStepIndex + 1}/{totalSteps}
        </Text>
      )}
      <Text style={styles.instruction} numberOfLines={3}>
        {displayText}
      </Text>
      {stepTimerStart && (
        <Text style={styles.timer}>{formatTime(elapsed)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  stepLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  instruction: {
    color: "white",
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 23,
  },
  timer: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 16,
    fontFamily: "monospace",
    marginTop: 6,
  },
});
