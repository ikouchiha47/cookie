import React from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { useSessionStore, type CheckpointItem } from "../stores/session";

const ICONS: Record<CheckpointItem["type"], string> = {
  success: "\u2705",
  warning: "\u26a0\ufe0f",
  fix: "\ud83d\udd27",
};

export function CheckpointLog() {
  const checkpoints = useSessionStore((s) => s.checkpoints);
  const visible = checkpoints.slice(0, 5);

  if (visible.length === 0) return null;

  return (
    <View style={styles.container}>
      {visible.map((cp) => (
        <View key={cp.id} style={styles.row}>
          <Text style={styles.icon}>{ICONS[cp.type]}</Text>
          <Text style={styles.text} numberOfLines={1}>
            {cp.text}
          </Text>
        </View>
      ))}
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
  icon: {
    fontSize: 14,
  },
  text: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    flex: 1,
  },
});
