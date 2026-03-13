import React from "react";
import { Text, View } from "react-native";
import { useWindowDimensions } from "react-native";
import { useSessionStore } from "../../stores/session";
import { getCharacter } from "../../characters/registry";
import type { ExpressionName } from "../../characters/protocol";

export function CharacterFace() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const size = isLandscape
    ? Math.min(height * 0.55, width * 0.38)
    : width * 0.54;

  const expression = useSessionStore((s) => s.expression) as ExpressionName;
  const characterId = useSessionStore((s) => s.characterId ?? "robot");

  const character = getCharacter(characterId);
  const params    = character.getParams(expression);

  return (
    <View style={{ alignItems: "center" }}>
      <character.Component params={params} size={size} />
      {__DEV__ && (
        <Text style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, letterSpacing: 1, marginTop: 2 }}>
          {expression}
        </Text>
      )}
    </View>
  );
}
