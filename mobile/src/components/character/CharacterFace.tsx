import React from "react";
import { useWindowDimensions } from "react-native";
import { useSessionStore } from "../../stores/session";
import { getCharacter } from "../../characters/registry";
import type { ExpressionName } from "../../characters/protocol";

export function CharacterFace() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const size = isLandscape
    ? Math.min(height * 0.55, width * 0.38)
    : width * 0.72;

  const expression = useSessionStore((s) => s.expression) as ExpressionName;
  const characterId = useSessionStore((s) => s.characterId ?? "robot");

  const character = getCharacter(characterId);
  const params    = character.getParams(expression);

  return <character.Component params={params} size={size} />;
}
