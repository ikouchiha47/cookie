import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSessionStore } from "../stores/session";
import { saveRecipe } from "../services/sessionDb";

interface Props {
  onStartNew: () => void;
}

export function DonePanel({ onStartNew }: Props) {
  const recipePlan = useSessionStore((s) => s.recipePlan);
  const sessionId = useSessionStore((s) => s.sessionId);
  const cookingNotes = useSessionStore((s) => s.cookingNotes);

  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState(cookingNotes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!recipePlan || saving) return;
    setSaving(true);
    try {
      await saveRecipe({
        session_id: sessionId ?? "",
        title: recipePlan.title,
        recipe_json: JSON.stringify(recipePlan),
        modifications: notes,
        rating: rating > 0 ? rating : null,
        notes,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {recipePlan && (
        <Text style={styles.title}>{recipePlan.title}</Text>
      )}

      {/* Star rating */}
      <View style={styles.section}>
        <Text style={styles.label}>How did it turn out?</Text>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)}>
              <Ionicons
                name={n <= rating ? "star" : "star-outline"}
                size={32}
                color={n <= rating ? "#eab308" : "rgba(255,255,255,0.3)"}
              />
            </Pressable>
          ))}
        </View>
      </View>

      {/* Notes / modifications */}
      <View style={styles.section}>
        <Text style={styles.label}>Notes & modifications</Text>
        <TextInput
          style={styles.textInput}
          value={notes}
          onChangeText={setNotes}
          placeholder="What would you change next time?"
          placeholderTextColor="rgba(255,255,255,0.3)"
          multiline
          numberOfLines={4}
        />
      </View>

      {/* Save button */}
      {!saved ? (
        <Pressable style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={handleSave} disabled={saving || !recipePlan}>
          {saving ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Ionicons name="bookmark" size={18} color="white" />
          )}
          <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save Recipe"}</Text>
        </Pressable>
      ) : (
        <View style={styles.savedBadge}>
          <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
          <Text style={styles.savedText}>Saved</Text>
        </View>
      )}

      <Pressable style={styles.newBtn} onPress={onStartNew}>
        <Text style={styles.newBtnText}>Start New Session</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  title: {
    color: "white",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  section: {
    width: "100%",
    gap: 8,
  },
  label: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  stars: {
    flexDirection: "row",
    gap: 8,
  },
  textInput: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    color: "white",
    fontSize: 14,
    padding: 12,
    minHeight: 88,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#3b82f6",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: "white",
    fontSize: 15,
    fontWeight: "700",
  },
  savedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  savedText: {
    color: "#22c55e",
    fontSize: 15,
    fontWeight: "600",
  },
  newBtn: {
    paddingHorizontal: 36,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  newBtnText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    fontWeight: "500",
  },
});
