import React, { useState, useRef, useEffect } from "react";
import {
  Modal,
  View,
  Image,
  StyleSheet,
  Pressable,
  Text,
  PanResponder,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

const { width: SW, height: SH } = Dimensions.get("window");
const BTN_AREA_H = 80;
const IMG_AREA_H = SH - BTN_AREA_H;
const HANDLE = 26;
const MIN_BOX = 60;
const OVERLAY = "rgba(0,0,0,0.55)";

interface Box { x: number; y: number; w: number; h: number }

interface Props {
  uri: string | null;
  onDone: (croppedUri: string) => void;
  onCancel: () => void;
}

export function CropModal({ uri, onDone, onCancel }: Props) {
  const [fit, setFit] = useState({ scale: 1, offX: 0, offY: 0, w: 0, h: 0 });
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: 0, h: 0 });
  const [saving, setSaving] = useState(false);

  const fitRef = useRef(fit);
  const boxRef = useRef(box);

  useEffect(() => { fitRef.current = fit; }, [fit]);
  useEffect(() => { boxRef.current = box; }, [box]);

  useEffect(() => {
    if (!uri) return;
    setSaving(false);
    Image.getSize(uri, (origW, origH) => {
      const scale = Math.min(SW / origW, IMG_AREA_H / origH);
      const fitW = origW * scale;
      const fitH = origH * scale;
      const offX = (SW - fitW) / 2;
      const offY = (IMG_AREA_H - fitH) / 2;
      const f = { scale, offX, offY, w: fitW, h: fitH };
      setFit(f);
      fitRef.current = f;
      const initBox: Box = {
        x: fitW * 0.1,
        y: fitH * 0.1,
        w: fitW * 0.8,
        h: fitH * 0.8,
      };
      setBox(initBox);
      boxRef.current = initBox;
    });
  }, [uri]);

  const clamp = (b: Box): Box => {
    const { w: fw, h: fh } = fitRef.current;
    let { x, y, w, h } = b;
    w = Math.max(w, MIN_BOX);
    h = Math.max(h, MIN_BOX);
    x = Math.max(0, Math.min(x, fw - w));
    y = Math.max(0, Math.min(y, fh - h));
    return { x, y, w, h };
  };

  const update = (next: Box) => {
    const b = clamp(next);
    boxRef.current = b;
    setBox(b);
  };

  // --- Move (drag box body) ---
  const movePR = useRef(() => {
    let sx = 0, sy = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        sx = boxRef.current.x;
        sy = boxRef.current.y;
      },
      onPanResponderMove: (_, g) => {
        update({ ...boxRef.current, x: sx + g.dx, y: sy + g.dy });
      },
    });
  }).current();

  // --- Corner handles ---
  const cornerPR = useRef((corner: "tl" | "tr" | "bl" | "br") => {
    let sx = 0, sy = 0, sw = 0, sh = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const b = boxRef.current;
        sx = b.x; sy = b.y; sw = b.w; sh = b.h;
      },
      onPanResponderMove: (_, g) => {
        const b = boxRef.current;
        switch (corner) {
          case "tl": update({ x: sx + g.dx, y: sy + g.dy, w: sw - g.dx, h: sh - g.dy }); break;
          case "tr": update({ x: sx,        y: sy + g.dy, w: sw + g.dx, h: sh - g.dy }); break;
          case "bl": update({ x: sx + g.dx, y: sy,        w: sw - g.dx, h: sh + g.dy }); break;
          case "br": update({ x: sx,        y: sy,        w: sw + g.dx, h: sh + g.dy }); break;
        }
      },
    });
  }).current;

  const tlPR = useRef(cornerPR("tl")).current;
  const trPR = useRef(cornerPR("tr")).current;
  const blPR = useRef(cornerPR("bl")).current;
  const brPR = useRef(cornerPR("br")).current;

  const handleConfirm = async () => {
    if (!uri || !fit.scale) return;
    setSaving(true);
    try {
      const crop = {
        originX: Math.round(box.x / fit.scale),
        originY: Math.round(box.y / fit.scale),
        width:   Math.round(box.w / fit.scale),
        height:  Math.round(box.h / fit.scale),
      };
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ crop }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      onDone(result.uri);
    } catch {
      onDone(uri); // fallback: use original
    }
  };

  if (!uri) return null;

  const { offX, offY, w: fw, h: fh } = fit;
  const { x: bx, y: by, w: bw, h: bh } = box;

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={styles.root}>
        {/* Image */}
        <View style={styles.imgArea}>
          <Image
            source={{ uri }}
            style={[styles.img, { left: offX, top: offY, width: fw, height: fh }]}
            resizeMode="cover"
          />

          {/* Dark overlay: top */}
          <View style={[styles.overlay, { left: offX, top: offY, width: bx + bw, height: by }]} />
          {/* Dark overlay: left */}
          <View style={[styles.overlay, { left: offX, top: offY + by, width: bx, height: bh }]} />
          {/* Dark overlay: right */}
          <View style={[styles.overlay, { left: offX + bx + bw, top: offY + by, width: fw - bx - bw, height: bh }]} />
          {/* Dark overlay: bottom */}
          <View style={[styles.overlay, { left: offX, top: offY + by + bh, width: fw, height: fh - by - bh }]} />

          {/* Crop box border */}
          <View
            style={[styles.cropBorder, {
              left: offX + bx, top: offY + by, width: bw, height: bh,
            }]}
          />

          {/* Move handle (invisible, covers center of crop box) */}
          <View
            {...movePR.panHandlers}
            style={[styles.moveArea, {
              left: offX + bx + HANDLE,
              top: offY + by + HANDLE,
              width: Math.max(bw - HANDLE * 2, 10),
              height: Math.max(bh - HANDLE * 2, 10),
            }]}
          />

          {/* Corner handles */}
          {([
            ["tl", offX + bx - HANDLE / 2,      offY + by - HANDLE / 2,      tlPR],
            ["tr", offX + bx + bw - HANDLE / 2,  offY + by - HANDLE / 2,      trPR],
            ["bl", offX + bx - HANDLE / 2,       offY + by + bh - HANDLE / 2, blPR],
            ["br", offX + bx + bw - HANDLE / 2,  offY + by + bh - HANDLE / 2, brPR],
          ] as const).map(([id, left, top, pr]) => (
            <View
              key={id}
              {...(pr as any).panHandlers}
              style={[styles.handle, { left, top }]}
            />
          ))}
        </View>

        {/* Buttons */}
        <View style={styles.btnRow}>
          <Pressable onPress={onCancel} style={styles.cancelBtn}>
            <Ionicons name="close" size={22} color="white" />
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
          <Pressable onPress={handleConfirm} style={styles.confirmBtn} disabled={saving}>
            {saving
              ? <ActivityIndicator color="white" size="small" />
              : <>
                  <Ionicons name="checkmark" size={22} color="white" />
                  <Text style={styles.btnText}>Use Photo</Text>
                </>
            }
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  imgArea: {
    width: SW,
    height: IMG_AREA_H,
    overflow: "hidden",
  },
  img: {
    position: "absolute",
  },
  overlay: {
    position: "absolute",
    backgroundColor: OVERLAY,
  },
  cropBorder: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: "white",
  },
  moveArea: {
    position: "absolute",
  },
  handle: {
    position: "absolute",
    width: HANDLE,
    height: HANDLE,
    backgroundColor: "white",
    borderRadius: 4,
  },
  btnRow: {
    flexDirection: "row",
    height: BTN_AREA_H,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    backgroundColor: "#111",
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#22c55e",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  btnText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },
});
