import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSessionStore, type CheckpointItem } from "../stores/session";

const ICONS: Record<CheckpointItem["type"], { name: string; color: string }> = {
  success: { name: "checkmark-circle", color: "#22c55e" },
  warning: { name: "warning",          color: "#eab308" },
  fix:     { name: "build",            color: "#ef4444" },
};

export function CheckpointLog() {
  const checkpoints = useSessionStore((s) => s.checkpoints);
  const visible = checkpoints.slice(0, 5);

  if (visible.length === 0) return null;

  return (
    <View style={styles.container}>
      {visible.map((cp) => {
        const icon = ICONS[cp.type];
        return (
          <View key={cp.id} style={styles.row}>
            <Ionicons name={icon.name as any} size={14} color={icon.color} />
            <Text style={styles.text} numberOfLines={1}>{cp.text}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    flex: 1,
  },
});
