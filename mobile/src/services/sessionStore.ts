/** Persist session data to AsyncStorage */

import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSIONS_KEY = "cookie_sessions";

export interface SessionMeta {
  id: string;
  startedAt: number;
  endedAt?: number;
  recipeName?: string;
  stepCount?: number;
  checkpointCount?: number;
}

export interface SessionData extends SessionMeta {
  transcript: TranscriptEntry[];
  checkpoints: CheckpointEntry[];
}

export interface TranscriptEntry {
  t: number;
  role: "user" | "system" | "guidance";
  text: string;
}

export interface CheckpointEntry {
  t: number;
  type: "success" | "warning" | "fix";
  text: string;
}

export async function listSessions(): Promise<SessionMeta[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveSession(data: SessionData): Promise<void> {
  // Save full session data keyed by ID
  await AsyncStorage.setItem(`session_${data.id}`, JSON.stringify(data));

  // Save metadata index
  const sessions = await listSessions();
  const meta: SessionMeta = {
    id: data.id,
    startedAt: data.startedAt,
    endedAt: data.endedAt,
    recipeName: data.recipeName,
    stepCount: data.stepCount,
    checkpointCount: data.checkpointCount,
  };
  sessions.unshift(meta);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export async function loadSession(id: string): Promise<SessionData | null> {
  const raw = await AsyncStorage.getItem(`session_${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function deleteSession(id: string): Promise<void> {
  await AsyncStorage.removeItem(`session_${id}`);
  const sessions = await listSessions();
  const filtered = sessions.filter((s) => s.id !== id);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(filtered));
}
