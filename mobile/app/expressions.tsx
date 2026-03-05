import React, { useState } from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions,
} from "react-native";
import { RobotCharacter } from "../src/characters/robot";
import { ROBOT_EXPRESSIONS } from "../src/characters/robot/expressions";
import { DEFAULT_PARAMS } from "../src/characters/protocol";
import type { ExpressionName } from "../src/characters/protocol";

const EXPRESSION_NAMES = Object.keys(ROBOT_EXPRESSIONS) as ExpressionName[];

export default function ExpressionsScreen() {
  const { width } = useWindowDimensions();
  const cols = width > 500 ? 3 : 2;
  const cardW = (width - 16 * (cols + 1)) / cols;
  const charSize = cardW - 24;

  const [active, setActive] = useState<ExpressionName | null>(null);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.grid}>
      {EXPRESSION_NAMES.map((name) => {
        const params = { ...DEFAULT_PARAMS, ...ROBOT_EXPRESSIONS[name] };
        const isActive = active === name;
        return (
          <Pressable
            key={name}
            style={[styles.card, { width: cardW }, isActive && styles.cardActive]}
            onPress={() => setActive(isActive ? null : name)}
          >
            <RobotCharacter params={params} size={charSize} />
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {name.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f1117",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: "#14161f",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#22253a",
    paddingTop: 18,
    paddingBottom: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 10,
  },
  cardActive: {
    borderColor: "#5BC8E8",
    backgroundColor: "#161922",
  },
  label: {
    color: "#555",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  labelActive: {
    color: "#5BC8E8",
  },
});
