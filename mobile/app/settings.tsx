import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useSessionStore } from "../src/stores/session";

export default function SettingsScreen() {
  const router = useRouter();
  const serverUrl = useSessionStore((s) => s.serverUrl);
  const setServerUrl = useSessionStore((s) => s.setServerUrl);
  const userProfile = useSessionStore((s) => s.userProfile);
  const setUserProfile = useSessionStore((s) => s.setUserProfile);

  const [urlDraft, setUrlDraft] = useState(serverUrl);
  const [allergies, setAllergies] = useState(userProfile.allergies.join(", "));
  const [skillLevel, setSkillLevel] = useState(userProfile.skill_level);

  const save = () => {
    setServerUrl(urlDraft);
    setUserProfile({
      allergies: allergies
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      skill_level: skillLevel,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Server</Text>
      <TextInput
        style={styles.input}
        value={urlDraft}
        onChangeText={setUrlDraft}
        placeholder="ws://server:8420/ws"
        placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.sectionTitle}>Profile</Text>

      <Text style={styles.label}>Skill Level</Text>
      <View style={styles.pillRow}>
        {["beginner", "intermediate", "advanced"].map((level) => (
          <Pressable
            key={level}
            style={[styles.pill, skillLevel === level && styles.pillActive]}
            onPress={() => setSkillLevel(level)}
          >
            <Text
              style={[
                styles.pillText,
                skillLevel === level && styles.pillTextActive,
              ]}
            >
              {level}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Allergies (comma-separated)</Text>
      <TextInput
        style={styles.input}
        value={allergies}
        onChangeText={setAllergies}
        placeholder="e.g. peanuts, shellfish"
        placeholderTextColor="rgba(255,255,255,0.3)"
      />

      <Pressable style={styles.saveBtn} onPress={save}>
        <Text style={styles.saveBtnText}>Save</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Developer</Text>
      <Pressable style={styles.devBtn} onPress={() => router.push("/expressions")}>
        <Text style={styles.devBtnText}>Expression Board</Text>
      </Pressable>
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
  sectionTitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 12,
  },
  label: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    color: "white",
    fontSize: 15,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  pillRow: {
    flexDirection: "row",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  pillActive: {
    backgroundColor: "#22c55e",
  },
  pillText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    textTransform: "capitalize",
  },
  pillTextActive: {
    color: "white",
    fontWeight: "600",
  },
  saveBtn: {
    backgroundColor: "#3b82f6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 32,
  },
  saveBtnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  devBtn: {
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  devBtnText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 15,
    fontWeight: "500",
  },
});
