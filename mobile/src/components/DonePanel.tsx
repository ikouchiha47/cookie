import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useSessionStore } from "../stores/session";

interface Props {
  onStartNew: () => void;
}

export function DonePanel({ onStartNew }: Props) {
  const recipePlan = useSessionStore((s) => s.recipePlan);

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🎉</Text>
      {recipePlan && (
        <Text style={styles.title}>{recipePlan.title}</Text>
      )}
      <Text style={styles.subtitle}>All done!</Text>
      <Pressable style={styles.btn} onPress={onStartNew}>
        <Text style={styles.btnText}>Start New Session</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 12,
    paddingBottom: 8,
  },
  emoji: {
    fontSize: 48,
  },
  title: {
    color: "white",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  subtitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
  },
  btn: {
    backgroundColor: "#22c55e",
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 28,
    marginTop: 8,
  },
  btnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
});
