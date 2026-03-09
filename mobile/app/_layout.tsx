import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSessionStore } from "../src/stores/session";

export default function RootLayout() {
  const initFromDb = useSessionStore((s) => s.initFromDb);

  useEffect(() => {
    initFromDb().then(({ resumed, sessionId }) => {
      if (resumed) console.log("[DB] Resumed session:", sessionId);
      else console.log("[DB] No incomplete session found.");
    });
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#1a1a2e" },
          headerTintColor: "white",
          contentStyle: { backgroundColor: "#1a1a2e" },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="history/index" options={{ title: "History" }} />
        <Stack.Screen name="history/[id]" options={{ title: "Session" }} />
        <Stack.Screen name="chat" options={{ title: "Chat" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="expressions" options={{ title: "Expressions" }} />
      </Stack>
    </>
  );
}
