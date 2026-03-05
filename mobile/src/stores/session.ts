/** Zustand store — single source of truth for the session */

import { create } from "zustand";
import type {
  ChatResponse,
  DiscoveryMessage,
  GuidanceMessage,
  RecipePlan,
  RecipeSuggestion,
  Severity,
  StepStatus,
  UserProfile,
} from "../types/protocol";

// --- Character expressions ---
// Must stay in sync with ExpressionName in src/characters/protocol.ts

export type Expression =
  | "default" | "idle" | "happy" | "confused"
  | "sad" | "angry" | "embarrassed" | "wink"
  | "concerned" | "excited";

export interface CheckpointItem {
  id: string;
  t: number;
  type: "success" | "warning" | "fix";
  text: string;
}

export interface TranscriptItem {
  t: number;
  role: "user" | "system" | "guidance";
  text: string;
}

// --- Connection state ---

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// --- Store shape ---

export interface SessionStore {
  // Connection
  serverUrl: string;
  connectionStatus: ConnectionStatus;
  setServerUrl: (url: string) => void;
  setConnectionStatus: (s: ConnectionStatus) => void;

  // Session
  sessionId: string | null;
  sessionStartedAt: number | null;
  isActive: boolean;
  startSession: () => void;
  endSession: () => void;

  // Character
  expression: Expression;
  characterId: string;
  setExpression: (e: Expression) => void;
  setCharacterId: (id: string) => void;

  // Recipe / Steps
  recipePlan: RecipePlan | null;
  currentStepIndex: number;
  stepStatuses: Record<number, StepStatus>;
  stepTimerStart: number | null;
  setRecipePlan: (plan: RecipePlan) => void;
  updateStep: (index: number, status: StepStatus) => void;

  // Discovery
  discoveredItems: string[];
  recipeSuggestions: RecipeSuggestion[];
  handleDiscovery: (msg: DiscoveryMessage) => void;

  // Guidance
  latestGuidance: GuidanceMessage | null;
  handleGuidance: (msg: GuidanceMessage) => void;

  // Checkpoints
  checkpoints: CheckpointItem[];
  addCheckpoint: (type: CheckpointItem["type"], text: string) => void;

  // Transcript (background log)
  transcript: TranscriptItem[];
  addTranscript: (role: TranscriptItem["role"], text: string) => void;

  // Voice
  isListening: boolean;
  isSpeaking: boolean;
  setListening: (v: boolean) => void;
  setSpeaking: (v: boolean) => void;

  // Camera
  isCameraActive: boolean;
  setCameraActive: (v: boolean) => void;

  // User profile
  userProfile: UserProfile;
  setUserProfile: (p: Partial<UserProfile>) => void;

  // Chat
  chatMessages: { id: string; role: "user" | "assistant"; text: string; imageUris?: string[]; status: "pending" | "failed" | "sent"; payload?: Record<string, unknown>; suggestions?: RecipeSuggestion[] }[];
  chatLoading: boolean;
  addChatMessage: (role: "user" | "assistant", text: string, imageUris?: string[], payload?: Record<string, unknown>) => string;
  markMessageFailed: (id: string) => void;
  setChatLoading: (v: boolean) => void;
  handleChatResponse: (msg: ChatResponse) => void;

  // Idle tracking
  lastActivityAt: number;
  touchActivity: () => void;
}

let checkpointCounter = 0;

export const useSessionStore = create<SessionStore>((set, get) => ({
  // Connection
  serverUrl: process.env.EXPO_PUBLIC_WS_URL ?? "ws://localhost:8420/ws",
  connectionStatus: "disconnected",
  setServerUrl: (url) => set({ serverUrl: url }),
  setConnectionStatus: (s) => set({ connectionStatus: s }),

  // Session
  sessionId: null,
  sessionStartedAt: null,
  isActive: false,
  startSession: () =>
    set({
      sessionId: `session_${Date.now()}`,
      sessionStartedAt: Date.now(),
      isActive: true,
      checkpoints: [],
      transcript: [],
      recipePlan: null,
      currentStepIndex: 0,
      stepStatuses: {},
      latestGuidance: null,
      discoveredItems: [],
      recipeSuggestions: [],
      expression: "default",
    }),
  endSession: () => set({ isActive: false }),

  // Character
  expression: "default" as Expression,
  characterId: "robot",
  setExpression: (e) => set({ expression: e }),
  setCharacterId: (id) => set({ characterId: id }),

  // Recipe / Steps
  recipePlan: null,
  currentStepIndex: 0,
  stepStatuses: {},
  stepTimerStart: null,
  setRecipePlan: (plan) => set({ recipePlan: plan }),
  updateStep: (index, status) => {
    const prev = get().stepStatuses;
    const newStatuses = { ...prev, [index]: status };
    const updates: Partial<SessionStore> = { stepStatuses: newStatuses };

    if (status === "active") {
      updates.currentStepIndex = index;
      updates.stepTimerStart = Date.now();
    }
    if (status === "done") {
      // Auto-advance
      const plan = get().recipePlan;
      if (plan && index + 1 < plan.steps.length) {
        updates.currentStepIndex = index + 1;
        updates.stepTimerStart = Date.now();
        newStatuses[index + 1] = "active";
      }
    }
    set(updates);
  },

  // Discovery
  discoveredItems: [],
  recipeSuggestions: [],
  handleDiscovery: (msg) => {
    set({
      discoveredItems: msg.items,
      recipeSuggestions: msg.suggestions,
      expression: "default",
      lastActivityAt: Date.now(),
    });
    get().addTranscript("system", `Discovered: ${msg.items.join(", ")}`);
  },

  // Guidance
  latestGuidance: null,
  handleGuidance: (msg) => {
    const VALID: Set<Expression> = new Set(["default","idle","happy","confused","sad","angry","embarrassed","wink","concerned","excited"]);
    const expr: Expression = VALID.has(msg.expression as Expression) ? (msg.expression as Expression) : "default";
    set({
      latestGuidance: msg,
      expression: expr,
      lastActivityAt: Date.now(),
    });
    // Also log to transcript
    get().addTranscript("guidance", msg.text);
    // Add checkpoint
    const typeMap: Record<Severity, CheckpointItem["type"]> = {
      info: "success",
      warning: "warning",
      critical: "fix",
    };
    get().addCheckpoint(typeMap[msg.severity], msg.text);
  },

  // Checkpoints
  checkpoints: [],
  addCheckpoint: (type, text) =>
    set((s) => ({
      checkpoints: [
        { id: `cp_${++checkpointCounter}`, t: Date.now(), type, text },
        ...s.checkpoints,
      ].slice(0, 50),
    })),

  // Transcript
  transcript: [],
  addTranscript: (role, text) =>
    set((s) => ({
      transcript: [...s.transcript, { t: Date.now(), role, text }],
    })),

  // Voice
  isListening: false,
  isSpeaking: false,
  setListening: (v) => set({ isListening: v }),
  setSpeaking: (v) => set({ isSpeaking: v }),

  // Camera
  isCameraActive: false,
  setCameraActive: (v) => set({ isCameraActive: v }),

  // User profile
  userProfile: {
    allergies: [],
    conditions: [],
    household: [],
    skill_level: "beginner",
  },
  setUserProfile: (p) =>
    set((s) => ({ userProfile: { ...s.userProfile, ...p } })),

  // Chat
  chatMessages: [],
  chatLoading: false,
  addChatMessage: (role, text, imageUris, payload) => {
    const id = Date.now().toString();
    set((s) => ({
      chatMessages: [...s.chatMessages, { id, role, text, imageUris: imageUris?.length ? imageUris : undefined, status: role === "user" ? "pending" : "sent", payload }],
    }));
    return id;
  },
  markMessageFailed: (id) =>
    set((s) => ({
      chatMessages: s.chatMessages.map((m) => m.id === id ? { ...m, status: "failed" } : m),
      chatLoading: false,
    })),
  setChatLoading: (v) => set({ chatLoading: v }),
  handleChatResponse: (msg) => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        (m.status === "pending" || m.status === "failed") ? { ...m, status: "sent" } : m
      ).concat([{ id: Date.now().toString(), role: "assistant", text: msg.text, status: "sent", suggestions: msg.suggestions?.length ? msg.suggestions : undefined }]),
      chatLoading: false,
      ...(msg.items.length > 0
        ? { discoveredItems: msg.items, recipeSuggestions: msg.suggestions }
        : {}),
      ...(msg.recipe_plan ? { recipePlan: msg.recipe_plan } : {}),
    }));
  },

  // Idle
  lastActivityAt: Date.now(),
  touchActivity: () => set({ lastActivityAt: Date.now() }),
}));
