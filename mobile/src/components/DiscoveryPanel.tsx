import React, { useRef } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSessionStore } from "../stores/session";
import { wsService } from "../services/websocket";

interface Props {
  onScan: () => Promise<void>;
  onStopScan: () => void;
  isAutoScanning: boolean;
}

export function DiscoveryPanel({ onScan, onStopScan, isAutoScanning }: Props) {
  const discoveredItems = useSessionStore((s) => s.discoveredItems);
  const recipeSuggestions = useSessionStore((s) => s.recipeSuggestions);
  const chatLoading = useSessionStore((s) => s.chatLoading);
  const selecting = useRef(false);
  const scanning = useRef(false);

  const handleScan = async () => {
    if (scanning.current || chatLoading) return;
    scanning.current = true;
    try {
      await onScan();
    } finally {
      scanning.current = false;
    }
  };

  const selectRecipe = (name: string, description: string) => {
    if (selecting.current || chatLoading) return;
    selecting.current = true;
    const msg = `Let's make ${name}:\n${description}`;
    useSessionStore.getState().addChatMessage("user", msg);
    useSessionStore.getState().setChatLoading(true);
    wsService.send("chat", { text: msg });
  };

  return (
    <View style={styles.container}>
      {discoveredItems.length > 0 && (
        <View style={styles.itemsRow}>
          <Text style={styles.label}>I CAN SEE</Text>
          <Text style={styles.items} numberOfLines={2}>
            {discoveredItems.join(", ")}
          </Text>
        </View>
      )}

      {recipeSuggestions.length > 0 && (
        <ScrollView style={styles.suggestions} showsVerticalScrollIndicator={false}>
          {recipeSuggestions.map((s, i) => (
            <Pressable
              key={i}
              style={styles.card}
              onPress={() => selectRecipe(s.name, s.description)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardName}>{s.name}</Text>
                <Text style={styles.cardConfidence}>{s.confidence}</Text>
              </View>
              <Text style={styles.cardDesc} numberOfLines={2}>{s.description}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {discoveredItems.length === 0 && !isAutoScanning && (
        <Text style={styles.hint}>point camera at your ingredients</Text>
      )}

      <View style={styles.btnRow}>
        {/* Scan / scanning indicator */}
        <Pressable
          style={[styles.scanBtn, chatLoading && styles.scanBtnDisabled]}
          onPress={handleScan}
          disabled={chatLoading}
        >
          {chatLoading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Ionicons name="camera" size={20} color="white" />
          )}
          <Text style={styles.scanBtnText}>
            {chatLoading ? "Thinking…" : "Scan"}
          </Text>
        </Pressable>

        {/* Stop auto-scan */}
        {isAutoScanning && (
          <Pressable style={styles.stopBtn} onPress={onStopScan}>
            <Ionicons name="stop" size={18} color="rgba(255,255,255,0.7)" />
            <Text style={styles.stopBtnText}>Stop</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 12,
    paddingBottom: 8,
  },
  itemsRow: {
    alignItems: "center",
    gap: 4,
  },
  label: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  items: {
    color: "white",
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  hint: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 13,
    textAlign: "center",
  },
  suggestions: {
    width: "100%",
    maxHeight: 180,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  cardName: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  cardConfidence: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardDesc: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 18,
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#22c55e",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 28,
  },
  scanBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  scanBtnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  stopBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  stopBtnText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    fontWeight: "500",
  },
});
