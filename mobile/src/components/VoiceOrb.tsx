import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSessionStore } from "../stores/session";

interface Props {
  onPressIn: () => void;
  onPressOut: () => void;
}

export function VoiceOrb({ onPressIn, onPressOut }: Props) {
  const isListening = useSessionStore((s) => s.isListening);
  const isSpeaking = useSessionStore((s) => s.isSpeaking);
  const scale = useSharedValue(1);

  React.useEffect(() => {
    if (isListening) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 600 }),
          withTiming(1, { duration: 600 })
        ),
        -1,
        true
      );
    } else {
      scale.value = withSpring(1);
    }
  }, [isListening]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const color = isListening ? "#ef4444" : isSpeaking ? "#3b82f6" : "rgba(255,255,255,0.15)";

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut}>
      <Animated.View style={[styles.orb, { backgroundColor: color }, animatedStyle]}>
        <Ionicons
          name={isSpeaking ? "volume-high" : "mic"}
          size={26}
          color="white"
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  orb: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
