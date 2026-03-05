import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { router } from "expo-router";
import { listSessions, type SessionMeta } from "../../src/services/sessionStore";

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);

  useEffect(() => {
    listSessions().then(setSessions);
  }, []);

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <View style={styles.container}>
      {sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No cooking sessions yet</Text>
          <Text style={styles.emptySubtext}>Start a session to see your history here</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/history/${item.id}`)}
            >
              <Text style={styles.recipeName}>
                {item.recipeName ?? "Cooking Session"}
              </Text>
              <Text style={styles.date}>{formatDate(item.startedAt)}</Text>
              {item.stepCount != null && (
                <Text style={styles.meta}>
                  {item.stepCount} steps \u00b7 {item.checkpointCount ?? 0} checkpoints
                </Text>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },
  emptySubtext: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    marginTop: 8,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.05)",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
  },
  recipeName: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  date: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    marginTop: 4,
  },
  meta: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    marginTop: 4,
  },
});
