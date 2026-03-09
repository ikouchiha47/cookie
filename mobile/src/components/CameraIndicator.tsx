import React from "react";
import { View, StyleSheet } from "react-native";
import { Camera, useCameraFormat, type CameraDevice } from "react-native-vision-camera";
import { useSessionStore } from "../stores/session";

interface Props {
  cameraRef: React.RefObject<Camera | null>;
  device: CameraDevice;
}

export function CameraIndicator({ cameraRef, device }: Props) {
  const isCameraActive = useSessionStore((s) => s.isCameraActive);
  const connectionStatus = useSessionStore((s) => s.connectionStatus);
  // Pick a 720p-ish format so takeSnapshot captures at real resolution, not view size
  const format = useCameraFormat(device, [{ videoResolution: { width: 1280, height: 720 } }]);

  if (!isCameraActive) return null;

  return (
    <View style={styles.container}>
      <View style={styles.preview}>
        <Camera
          ref={cameraRef}
          style={styles.camera}
          device={device}
          isActive={isCameraActive}
          format={format}
        />
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
    width: 80,
    height: 60,
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
