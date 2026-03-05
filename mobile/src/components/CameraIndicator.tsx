import React from "react";
import { View, StyleSheet } from "react-native";
import { CameraView } from "expo-camera";
import { useSessionStore } from "../stores/session";

interface Props {
  cameraRef: React.RefObject<CameraView | null>;
}

export function CameraIndicator({ cameraRef }: Props) {
  const isCameraActive = useSessionStore((s) => s.isCameraActive);
  const connectionStatus = useSessionStore((s) => s.connectionStatus);

  if (!isCameraActive) return null;

  return (
    <View style={styles.container}>
      <View style={styles.preview}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      </View>
      <View
        style={[
          styles.dot,
          { backgroundColor: connectionStatus === "connected" ? "#22c55e" : "#ef4444" },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  preview: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  camera: {
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
