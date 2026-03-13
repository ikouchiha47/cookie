import React from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Camera, useCameraFormat, type CameraDevice } from "react-native-vision-camera";
import { Ionicons } from "@expo/vector-icons";
import { useSessionStore } from "../stores/session";

interface Props {
  cameraRef: React.RefObject<Camera | null>;
  device: CameraDevice;
  expanded: boolean;
  onToggleExpand: () => void;
}

export function CameraIndicator({ cameraRef, device, expanded, onToggleExpand }: Props) {
  const cameraMode = useSessionStore((s) => s.cameraMode);
  const chatLoading = useSessionStore((s) => s.chatLoading);
  const format = useCameraFormat(device, [{ videoResolution: { width: 1280, height: 720 } }]);

  if (cameraMode === "off") return null;

  if (!expanded) {
    // PiP: small floating preview, tap to expand
    return (
      <Pressable style={styles.pip} onPress={onToggleExpand}>
        <View style={styles.pipPortal}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={cameraMode === "streaming" || cameraMode === "snap"}
            format={format}
          />
          {chatLoading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="small" color="#22c55e" />
            </View>
          )}
          <View style={styles.pipExpandIcon}>
            <Ionicons name="expand-outline" size={14} color="white" />
          </View>
        </View>
      </Pressable>
    );
  }

  // Expanded: wrapper has no overflow:hidden so the button isn't clipped
  return (
    <View style={styles.wrapper}>
      <View style={styles.portal}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={cameraMode === "streaming" || cameraMode === "snap"}
          format={format}
        />
        {chatLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#22c55e" />
          </View>
        )}
      </View>
      {/* Minimize button: absolute on wrapper, top-right, outside the clipped portal */}
      <Pressable style={styles.minimizeBtn} onPress={onToggleExpand} hitSlop={12}>
        <Ionicons name="contract-outline" size={16} color="white" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    marginBottom: 8,
  },
  portal: {
    width: "100%",
    height: 200,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  // Sits outside portal so it won't be clipped
  minimizeBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },

  // PiP
  pip: {
    position: "absolute",
    top: 52,
    left: 12,
    zIndex: 100,
  },
  pipPortal: {
    width: 110,
    height: 80,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.25)",
  },
  pipExpandIcon: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 4,
    padding: 2,
  },
});
