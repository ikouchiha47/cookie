/** Zustand store — single source of truth for the session */

import { create } from "zustand";
import { upsertSessionDebounced, loadLatestIncompleteSession, markSessionDone } from "../services/sessionDb";
import type { RecipePlan as RecipePlanType } from "../types/protocol";
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
import type { ExpressionName } from "../characters/protocol";

// Re-export so components don't need to import from two places
export type Expression = ExpressionName;

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
  initFromDb: () => Promise<{ resumed: boolean; sessionId: string | null }>;
  persistSession: () => void;

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

  // Phase / vigilance (sent to server with every frame — client is source of truth)
  phase: "discovery" | "cooking" | "paused";
  currentStep: number;
  stepInstruction: string;
  expectedVisualState: string;
  watchFor: string;
  criticality: "low" | "medium" | "high";
  setPhase: (p: "discovery" | "cooking" | "paused") => void;
  setVigilance: (watchFor: string, criticality: "low" | "medium" | "high") => void;
  setCurrentStep: (step: number, instruction: string, expectedVisualState: string) => void;

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
      phase: "discovery",
      currentStep: 0,
      stepInstruction: "",
      expectedVisualState: "",
      watchFor: "",
      criticality: "medium",
    }),
  endSession: () => {
    const { sessionId } = get();
    if (sessionId) markSessionDone(sessionId).catch(() => {});
    set({ isActive: false, phase: "discovery" });
  },

  initFromDb: async () => {
    const row = await loadLatestIncompleteSession();
    if (!row) return { resumed: false, sessionId: null };

    const recipePlan = row.recipe_plan_json ? JSON.parse(row.recipe_plan_json) : null;
    const discoveredItems = JSON.parse(row.discovered_items_json ?? "[]");

    set({
      sessionId: row.session_id,
      sessionStartedAt: row.started_at,
      isActive: false, // user must explicitly resume
      phase: row.phase as any,
      currentStep: row.current_step,
      stepInstruction: row.step_instruction,
      expectedVisualState: row.expected_visual_state,
      watchFor: row.watch_for,
      criticality: row.criticality as any,
      recipePlan,
      discoveredItems,
      expression: "default",
    });

    return { resumed: true, sessionId: row.session_id };
  },

  persistSession: () => {
    const s = get();
    if (!s.sessionId) return;
    upsertSessionDebounced({
      session_id: s.sessionId,
      phase: s.phase,
      started_at: s.sessionStartedAt ?? Date.now(),
      recipe_title: s.recipePlan?.title ?? "",
      recipe_plan_json: s.recipePlan ? JSON.stringify(s.recipePlan) : null,
      current_step: s.currentStep,
      step_instruction: s.stepInstruction,
      expected_visual_state: s.expectedVisualState,
      watch_for: s.watchFor,
      criticality: s.criticality,
      discovered_items_json: JSON.stringify(s.discoveredItems),
    });
  },

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
  setRecipePlan: (plan) => {
    const first = plan.steps[0];
    set({
      recipePlan: plan,
      phase: "cooking",
      currentStep: 0,
      stepInstruction: first?.instruction ?? "",
      expectedVisualState: first?.expected_visual_state ?? "",
      watchFor: "",
      criticality: "medium",
    });
    get().persistSession();
  },
  updateStep: (index, status) => {
    const prev = get().stepStatuses;
    const newStatuses = { ...prev, [index]: status };
    const updates: Partial<SessionStore> = { stepStatuses: newStatuses };

    if (status === "active") {
      updates.currentStepIndex = index;
      updates.stepTimerStart = Date.now();
    }
    if (status === "done") {
      const plan = get().recipePlan;
      if (plan && index + 1 < plan.steps.length) {
        const next = plan.steps[index + 1];
        updates.currentStepIndex = index + 1;
        updates.currentStep = index + 1;
        updates.stepInstruction = next.instruction;
        updates.expectedVisualState = next.expected_visual_state ?? "";
        updates.watchFor = "";
        updates.criticality = "medium";
        updates.stepTimerStart = Date.now();
        newStatuses[index + 1] = "active";
      }
    }
    set(updates);
    get().persistSession();
  },

  // Phase / vigilance
  phase: "discovery",
  currentStep: 0,
  stepInstruction: "",
  expectedVisualState: "",
  watchFor: "",
  criticality: "medium",
  setPhase: (p) => set({ phase: p }),
  setVigilance: (watchFor, criticality) => {
    set({ watchFor, criticality });
    get().persistSession();
  },
  setCurrentStep: (step, instruction, expectedVisualState) =>
    set({ currentStep: step, stepInstruction: instruction, expectedVisualState }),

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
    set((s) => {
      const chatMessages = s.chatMessages
        .map((m) => (m.status === "pending" || m.status === "failed") ? { ...m, status: "sent" as const } : m)
        .concat([{ id: Date.now().toString(), role: "assistant" as const, text: msg.text, status: "sent" as const, suggestions: msg.suggestions?.length ? msg.suggestions : undefined }]);
      return {
        chatMessages,
        chatLoading: false,
        discoveredItems: msg.items.length > 0 ? msg.items : s.discoveredItems,
        recipeSuggestions: msg.items.length > 0 ? msg.suggestions : s.recipeSuggestions,
        recipePlan: msg.recipe_plan ?? s.recipePlan,
      };
    });
  },

  // Idle
  lastActivityAt: Date.now(),
  touchActivity: () => set({ lastActivityAt: Date.now() }),
}));
