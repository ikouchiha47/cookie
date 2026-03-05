import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { loadSession, type SessionData } from "../../src/services/sessionStore";

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<SessionData | null>(null);

  useEffect(() => {
    if (id) loadSession(id).then(setSession);
  }, [id]);

  if (!session) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>Loading...</Text>
      </View>
    );
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const ICONS = { success: "\u2705", warning: "\u26a0\ufe0f", fix: "\ud83d\udd27" };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{session.recipeName ?? "Cooking Session"}</Text>
      <Text style={styles.date}>
        {new Date(session.startedAt).toLocaleDateString()}
      </Text>

      {/* Checkpoints */}
      {session.checkpoints.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Checkpoints</Text>
          {session.checkpoints.map((cp, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.icon}>{ICONS[cp.type]}</Text>
              <View style={styles.rowText}>
                <Text style={styles.rowMain}>{cp.text}</Text>
                <Text style={styles.rowTime}>{formatTime(cp.t)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Transcript */}
      {session.transcript.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transcript</Text>
          {session.transcript.map((entry, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.roleTag}>{entry.role}</Text>
              <View style={styles.rowText}>
                <Text style={styles.rowMain}>{entry.text}</Text>
                <Text style={styles.rowTime}>{formatTime(entry.t)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  content: {
    padding: 16,
  },
  loading: {
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    marginTop: 40,
  },
  title: {
    color: "white",
    fontSize: 22,
    fontWeight: "700",
  },
  date: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    marginTop: 4,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  icon: {
    fontSize: 14,
    marginTop: 2,
  },
  roleTag: {
    color: "#3b82f6",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginTop: 3,
    width: 60,
  },
  rowText: {
    flex: 1,
  },
  rowMain: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    lineHeight: 20,
  },
  rowTime: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 11,
    marginTop: 2,
  },
});
