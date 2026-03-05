/** Hook: WebSocket connection lifecycle + message routing to Zustand */

import { useEffect, useRef } from "react";
import { wsService } from "../services/websocket";
import { useSessionStore } from "../stores/session";
import type { ChatResponse, DiscoveryMessage, Envelope, GuidanceMessage, StepUpdate, RecipePlan } from "../types/protocol";

export function useWebSocket() {
  const serverUrl = useSessionStore((s) => s.serverUrl);
  const setConnectionStatus = useSessionStore((s) => s.setConnectionStatus);
  const handleGuidance = useSessionStore((s) => s.handleGuidance);
  const handleDiscovery = useSessionStore((s) => s.handleDiscovery);
  const handleChatResponse = useSessionStore((s) => s.handleChatResponse);
  const updateStep = useSessionStore((s) => s.updateStep);
  const setRecipePlan = useSessionStore((s) => s.setRecipePlan);
  const setExpression = useSessionStore((s) => s.setExpression);
  const isActive = useSessionStore((s) => s.isActive);
  const started = useRef(false);

  useEffect(() => {
    wsService.setUrl(serverUrl);
    wsService.connect(); // always try to connect; ws auto-reconnects on failure
  }, [serverUrl]);

  useEffect(() => {
    wsService.onStatusChange = (status) => {
      setConnectionStatus(status);
      if (status === "disconnected") setExpression("default");
    };

    const unsub = wsService.onMessage((envelope: Envelope) => {
      switch (envelope.type) {
        case "guidance": {
          const msg = envelope.payload as unknown as GuidanceMessage;
          handleGuidance(msg);
          break;
        }
        case "step_update": {
          const msg = envelope.payload as unknown as StepUpdate;
          updateStep(msg.step_index, msg.status);
          break;
        }
        case "recipe_plan": {
          const plan = envelope.payload as unknown as RecipePlan;
          setRecipePlan(plan);
          break;
        }
        case "discovery": {
          const msg = envelope.payload as unknown as DiscoveryMessage;
          handleDiscovery(msg);
          break;
        }
        case "chat_response": {
          const msg = envelope.payload as unknown as ChatResponse;
          handleChatResponse(msg);
          break;
        }
        case "thinking": {
          setExpression("default");
          break;
        }
      }
    });

    return unsub;
  }, [handleGuidance, handleDiscovery, handleChatResponse, updateStep, setRecipePlan, setExpression, setConnectionStatus]);


  return { send: wsService.send.bind(wsService) };
}
