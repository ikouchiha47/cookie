import React, { useState, useRef, useCallback } from "react";

const SEND_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { CropModal } from "../src/components/CropModal";
import { useSessionStore } from "../src/stores/session";
import { wsService } from "../src/services/websocket";

function ImageGrid({ uris }: { uris: string[] }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [modalIndex, setModalIndex] = useState(0);

  if (uris.length === 0) return null;

  const openModal = (i: number) => { setModalIndex(i); setModalVisible(true); };

  const renderTile = (uri: string, i: number, style: object) => (
    <Pressable key={i} onPress={() => openModal(i)} style={style}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
    </Pressable>
  );

  let grid: React.ReactNode;
  if (uris.length === 1) {
    grid = (
      <View style={styles.gridSingle}>
        {renderTile(uris[0], 0, styles.gridSingle)}
      </View>
    );
  } else if (uris.length === 2) {
    grid = (
      <View style={styles.gridRow}>
        {renderTile(uris[0], 0, styles.gridHalf)}
        {renderTile(uris[1], 1, styles.gridHalf)}
      </View>
    );
  } else if (uris.length === 3) {
    grid = (
      <View style={styles.gridRow}>
        {renderTile(uris[0], 0, styles.gridHalf)}
        <View style={[styles.gridHalf, styles.gridCol]}>
          {renderTile(uris[1], 1, styles.gridQuarter)}
          {renderTile(uris[2], 2, styles.gridQuarter)}
        </View>
      </View>
    );
  } else {
    // 4+ images: 2x2 grid, [1][1] = +N more
    const extra = uris.length - 3;
    grid = (
      <View style={[styles.gridRow, { flexWrap: "wrap", gap: 2 }]}>
        {renderTile(uris[0], 0, styles.gridQuarter2)}
        {renderTile(uris[1], 1, styles.gridQuarter2)}
        {renderTile(uris[2], 2, styles.gridQuarter2)}
        <Pressable style={[styles.gridQuarter2, styles.gridMore]} onPress={() => openModal(3)}>
          <Text style={styles.gridMoreText}>+{extra}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.gridContainer}>
      {grid}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setModalVisible(false)}>
          <FlatList
            data={uris}
            horizontal
            pagingEnabled
            initialScrollIndex={modalIndex}
            getItemLayout={(_, i) => ({ length: 320, offset: 320 * i, index: i })}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <View style={styles.modalSlide}>
                <Image source={{ uri: item }} style={styles.modalImage} resizeMode="contain" />
              </View>
            )}
          />
        </Pressable>
      </Modal>
    </View>
  );
}

export default function ChatScreen() {
  const chatMessages = useSessionStore((s) => s.chatMessages);
  const chatLoading = useSessionStore((s) => s.chatLoading);
  const addChatMessage = useSessionStore((s) => s.addChatMessage);
  const markMessageFailed = useSessionStore((s) => s.markMessageFailed);
  const setChatLoading = useSessionStore((s) => s.setChatLoading);

  const [text, setText] = useState("");
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [cropUri, setCropUri] = useState<string | null>(null);
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const listRef = useRef<FlatList>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the timeout when a response arrives
  React.useEffect(() => {
    if (!chatLoading && pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, [chatLoading]);

  // Open crop modal for a new URI (camera or freshly picked image)
  const openCrop = useCallback((uri: string, replaceIndex?: number) => {
    setCropIndex(replaceIndex ?? null);
    setCropUri(uri);
  }, []);

  const handleCropDone = useCallback((croppedUri: string) => {
    setCropUri(null);
    if (cropIndex !== null) {
      // Replace existing image
      setImageUris((prev) => prev.map((u, i) => (i === cropIndex ? croppedUri : u)));
    } else {
      setImageUris((prev) => [...prev, croppedUri]);
    }
    setCropIndex(null);
  }, [cropIndex]);

  const handleCropCancel = useCallback(() => {
    setCropUri(null);
    setCropIndex(null);
  }, []);

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!result.canceled && result.assets[0]) {
      openCrop(result.assets[0].uri);
    }
  }, [openCrop]);

  const pickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 5,
      quality: 0.9,
    });
    if (!result.canceled && result.assets.length > 0) {
      // Queue them — crop first one immediately, rest added as-is
      // (user can tap thumbnails to crop individual ones)
      setImageUris((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setImageUris((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const cancelPending = useCallback(() => {
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
    setChatLoading(false);
    // Mark the most recent pending message as failed
    useSessionStore.getState().chatMessages
      .filter(m => m.status === "pending")
      .forEach(m => markMessageFailed(m.id));
  }, [setChatLoading, markMessageFailed]);

  const dispatchPayload = useCallback((msgId: string, payload: Record<string, unknown>) => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    setChatLoading(true);
    wsService.send("chat", payload);
    pendingTimerRef.current = setTimeout(() => {
      markMessageFailed(msgId);
    }, SEND_TIMEOUT_MS);
  }, [setChatLoading, markMessageFailed]);

  const send = useCallback(async () => {
    const msg = text.trim();
    if (!msg && imageUris.length === 0) return;

    const imageBytesList: string[] = [];
    for (const uri of imageUris) {
      try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: "base64",
        });
        imageBytesList.push(base64);
      } catch (e) {
        console.warn("Failed to read image:", e);
      }
    }

    const payload: Record<string, unknown> = { text: msg || "What do you see?" };
    if (imageBytesList.length === 1) payload.image_bytes = imageBytesList[0];
    else if (imageBytesList.length > 1) payload.image_bytes_list = imageBytesList;

    const msgId = addChatMessage("user", msg || "(images)", imageUris, payload);
    setText("");
    setImageUris([]);
    dispatchPayload(msgId, payload);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, [text, imageUris, addChatMessage, setChatLoading, dispatchPayload]);

  const retry = useCallback((payload: Record<string, unknown>, oldId: string) => {
    // Add a fresh pending message with the same payload
    const msgId = addChatMessage("user", (payload.text as string) || "(images)", undefined, payload);
    dispatchPayload(msgId, payload);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, [addChatMessage, dispatchPayload]);

  const renderMessage = ({ item }: { item: (typeof chatMessages)[0] }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
        <View style={styles.bubbleCol}>
          <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble, item.status === "failed" && styles.bubbleFailed]}>
            {item.imageUris && item.imageUris.length > 0 && (
              <ImageGrid uris={item.imageUris} />
            )}
            <Text style={[styles.bubbleText, isUser && styles.userBubbleText]}>
              {item.text}
            </Text>
          </View>
          {item.suggestions?.map((s, i) => (
            <Pressable key={i} style={styles.suggestionCard} onPress={() => {
              const msg = `Let's make ${s.name}:\n${s.description}`;
              wsService.send("chat", { text: msg });
            }}>
              <View style={styles.suggestionHeader}>
                <Text style={styles.suggestionName}>{s.name}</Text>
                <Text style={styles.confidenceBadge}>{s.confidence}</Text>
              </View>
              <Text style={styles.suggestionDesc}>{s.description}</Text>
            </Pressable>
          ))}
        </View>
        {item.status === "pending" && isUser && (
          <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" style={styles.statusIcon} />
        )}
        {item.status === "failed" && item.payload && (
          <Pressable onPress={() => retry(item.payload!, item.id)} style={styles.retryBtn}>
            <Ionicons name="refresh" size={14} color="#ef4444" />
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        {chatMessages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Chat Mode</Text>
            <Text style={styles.emptySubtitle}>
              Send photos of your kitchen or ingredients and ask what to make.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={chatMessages}
            renderItem={renderMessage}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {chatLoading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
            <Text style={styles.loadingText}>Thinking...</Text>
          </View>
        )}

        {imageUris.length > 0 && (
          <ScrollView
            horizontal
            style={styles.imagePreviewScroll}
            contentContainerStyle={styles.imagePreviewRow}
            showsHorizontalScrollIndicator={false}
          >
            {imageUris.map((uri, i) => (
              <View key={i} style={styles.imagePreviewContainer}>
                {/* Tap to crop */}
                <Pressable onPress={() => openCrop(uri, i)}>
                  <Image source={{ uri }} style={styles.imagePreview} />
                  <View style={styles.cropBadge}>
                    <Ionicons name="crop" size={10} color="white" />
                  </View>
                </Pressable>
                <Pressable onPress={() => removeImage(i)} style={styles.removeImage}>
                  <Ionicons name="close" size={12} color="white" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        <View style={styles.inputRow}>
          <Pressable onPress={takePhoto} style={styles.iconBtn}>
            <Ionicons name="camera-outline" size={22} color="rgba(255,255,255,0.75)" />
          </Pressable>
          <Pressable onPress={pickImages} style={styles.iconBtn}>
            <Ionicons name="images-outline" size={22} color="rgba(255,255,255,0.75)" />
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Ask about ingredients..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            multiline
            maxLength={500}
          />
          {chatLoading ? (
            <Pressable onPress={cancelPending} style={styles.sendBtn}>
              <Ionicons name="stop" size={18} color="white" />
            </Pressable>
          ) : (
            <Pressable
              onPress={send}
              style={[styles.sendBtn, (!text.trim() && imageUris.length === 0) && styles.sendBtnDisabled]}
              disabled={!text.trim() && imageUris.length === 0}
            >
              <Ionicons name="arrow-up" size={18} color="white" />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <CropModal uri={cropUri} onDone={handleCropDone} onCancel={handleCropCancel} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f1117",
  },
  flex: { flex: 1 },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptySubtitle: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  messageList: {
    padding: 16,
    gap: 8,
  },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginBottom: 2,
  },
  bubbleCol: {
    flexShrink: 1,
    maxWidth: "78%",
    gap: 6,
  },
  suggestionCard: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 12,
  },
  suggestionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  suggestionName: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  confidenceBadge: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    textTransform: "uppercase",
    marginLeft: 8,
  },
  suggestionDesc: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 18,
  },
  bubbleRowUser: {
    justifyContent: "flex-end",
  },
  bubble: {
    padding: 12,
    borderRadius: 16,
  },
  bubbleFailed: {
    opacity: 0.7,
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  statusIcon: {
    marginBottom: 4,
  },
  retryBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(239,68,68,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#3b82f6",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  bubbleText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    lineHeight: 21,
  },
  userBubbleText: { color: "white" },
  chatImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginBottom: 6,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  loadingText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
  },
  imagePreviewScroll: { maxHeight: 84 },
  imagePreviewRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  imagePreviewContainer: {
    position: "relative",
  },
  imagePreview: {
    width: 66,
    height: 66,
    borderRadius: 8,
  },
  cropBadge: {
    position: "absolute",
    bottom: 3,
    left: 3,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 4,
    padding: 2,
  },
  removeImage: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 9,
    width: 18,
    height: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  input: {
    flex: 1,
    color: "white",
    fontSize: 15,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#22c55e",
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.35 },
  gridContainer: { marginBottom: 6, borderRadius: 10, overflow: "hidden" },
  gridSingle: { width: 200, height: 150, overflow: "hidden", borderRadius: 10 },
  gridRow: { flexDirection: "row", gap: 2, borderRadius: 10, overflow: "hidden" },
  gridCol: { flexDirection: "column", gap: 2 },
  gridHalf: { width: 99, height: 130, overflow: "hidden", position: "relative" },
  gridQuarter: { width: 99, height: 64, overflow: "hidden", position: "relative" },
  gridQuarter2: { width: 99, height: 99, overflow: "hidden", position: "relative" },
  gridMore: { backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center" },
  gridMoreText: { color: "white", fontSize: 18, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" },
  modalSlide: { width: 320, justifyContent: "center", alignItems: "center", padding: 16 },
  modalImage: { width: 288, height: 400, borderRadius: 12 },
});
