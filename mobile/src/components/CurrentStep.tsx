import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useSessionStore } from "../stores/session";
import { wsService } from "../services/websocket";

export function CurrentStep() {
  const recipePlan = useSessionStore((s) => s.recipePlan);
  const currentStepIndex = useSessionStore((s) => s.currentStepIndex);
  const stepTimerStart = useSessionStore((s) => s.stepTimerStart);
  const latestGuidance = useSessionStore((s) => s.latestGuidance);
  const discoveredItems = useSessionStore((s) => s.discoveredItems);
  const recipeSuggestions = useSessionStore((s) => s.recipeSuggestions);
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

  // --- Discovery mode (no recipe) ---
  if (!recipePlan) {
    if (discoveredItems.length > 0) {
      return (
        <View style={styles.container}>
          <Text style={styles.discoveryLabel}>I CAN SEE</Text>
          <Text style={styles.instruction} numberOfLines={2}>
            {discoveredItems.join(", ")}
          </Text>
          <View style={styles.suggestionsContainer}>
            {recipeSuggestions.map((s, i) => (
              <Pressable key={i} style={styles.suggestionCard} onPress={() => {
                const msg = `Let's make ${s.name}:\n${s.description}`;
                useSessionStore.getState().addChatMessage("user", msg);
                useSessionStore.getState().setChatLoading(true);
                wsService.send("chat", { text: msg });
              }}>
                <View style={styles.suggestionHeader}>
                  <Text style={styles.suggestionName}>{s.name}</Text>
                  <Text style={styles.confidenceBadge}>{s.confidence}</Text>
                </View>
                <Text style={styles.suggestionDesc} numberOfLines={2}>
                  {s.description}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <Text style={styles.hint}>
          {latestGuidance?.text ?? "point camera at your ingredients"}
        </Text>
      </View>
    );
  }

  // --- Cooking mode ---
  const step = recipePlan.steps[currentStepIndex];
  const totalSteps = recipePlan.steps.length;
  const displayText = step?.instruction ?? latestGuidance?.text ?? "Point your camera at what you're cooking";

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
  discoveryLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  hint: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 13,
    textAlign: "center",
    letterSpacing: 0.5,
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
  suggestionsContainer: {
    marginTop: 16,
    gap: 10,
  },
  suggestionCard: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 14,
  },
  suggestionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  suggestionName: {
    color: "white",
    fontSize: 17,
    fontWeight: "600",
  },
  confidenceBadge: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    textTransform: "uppercase",
  },
  suggestionDesc: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    lineHeight: 20,
  },
});
