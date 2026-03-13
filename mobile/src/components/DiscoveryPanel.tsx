import React, { useRef } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSessionStore } from "../stores/session";
import { wsService } from "../services/websocket";

interface Props {
  cameraMode: "off" | "snap" | "streaming" | "paused";
  onSnap: () => void;
  onSnapSend: () => Promise<void>;
  onStream: () => Promise<void>;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function DiscoveryPanel({ cameraMode, onSnap, onSnapSend, onStream, onPause, onResume, onStop }: Props) {
  const discoveredItems = useSessionStore((s) => s.discoveredItems);
  const recipeSuggestions = useSessionStore((s) => s.recipeSuggestions);
  const chatLoading = useSessionStore((s) => s.chatLoading);
  const clearDiscovery = useSessionStore((s) => s.clearDiscovery);
  const acting = useRef(false);

  const wrap = (fn: () => Promise<void> | void) => async () => {
    if (acting.current || chatLoading) return;
    acting.current = true;
    try { await fn(); } finally { acting.current = false; }
  };

  const selectRecipe = (name: string, description: string) => {
    if (chatLoading) return;
    const msg = `Let's make ${name}:\n${description}`;
    useSessionStore.getState().addChatMessage("user", msg);
    useSessionStore.getState().setChatLoading(true);
    wsService.send("chat", { text: msg });
  };

  return (
    <View style={styles.container}>
      {discoveredItems.length > 0 && (
        <View style={styles.itemsRow}>
          <View style={styles.itemsHeader}>
            <Text style={styles.label}>I CAN SEE</Text>
            <Pressable onPress={clearDiscovery} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </Pressable>
          </View>
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

      {discoveredItems.length === 0 && cameraMode === "off" && (
        <Text style={styles.hint}>point camera at your ingredients</Text>
      )}

      {/* Button bar */}
      {cameraMode === "off" && (
        <View style={styles.btnRow}>
          <Pressable style={styles.vertBtn} onPress={onSnap}>
            <Ionicons name="camera" size={40} color="white" />
            <Text style={styles.vertBtnTextLg}>Snap</Text>
          </Pressable>
          <Pressable style={styles.vertBtn} onPress={wrap(onStream)}>
            <Ionicons name="videocam" size={40} color="white" />
            <Text style={styles.vertBtnTextLg}>Stream</Text>
          </Pressable>
        </View>
      )}

      {cameraMode === "snap" && (
        <View style={styles.btnRow}>
          <Pressable style={styles.vertBtn} onPress={() => {}}>
            <Ionicons name="images-outline" size={28} color="rgba(255,255,255,0.5)" />
          </Pressable>
          <Pressable
            style={[styles.vertBtnPrimary, chatLoading && styles.btnDisabled]}
            onPress={wrap(onSnapSend)}
            disabled={chatLoading}
          >
            {chatLoading
              ? <ActivityIndicator color="white" size="small" />
              : <Ionicons name="camera" size={36} color="white" />}
          </Pressable>
          <Pressable style={styles.vertBtn} onPress={wrap(onStream)}>
            <Ionicons name="videocam" size={28} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
      )}

      {(cameraMode === "streaming" || cameraMode === "paused") && (
        <View style={styles.btnRow}>
          <Pressable style={styles.vertBtn} onPress={wrap(onSnapSend)} disabled={chatLoading}>
            <Ionicons name="camera" size={28} color={chatLoading ? "rgba(255,255,255,0.3)" : "white"} />
          </Pressable>
          <Pressable
            style={styles.vertBtnPrimary}
            onPress={cameraMode === "streaming" ? onPause : wrap(onStream)}
          >
            <Ionicons name={cameraMode === "streaming" ? "pause" : "play"} size={36} color="white" />
          </Pressable>
          <Pressable style={styles.vertBtn} onPress={onStop}>
            <Ionicons name="stop-circle-outline" size={28} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
      )}
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
  itemsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  clearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  clearBtnText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.5,
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
    maxHeight: 260,
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
    gap: 24,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  vertBtn: {
    alignItems: "center",
    gap: 4,
    minWidth: 56,
  },
  vertBtnText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "500",
    textAlign: "center",
  },
  vertBtnTextLg: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  vertBtnPrimary: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#22c55e",
    borderRadius: 36,
    width: 72,
    height: 72,
  },
  vertBtnPrimaryText: {
    color: "white",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  btnDisabled: {
    backgroundColor: "rgba(255,255,255,0.15)",
  },
});
