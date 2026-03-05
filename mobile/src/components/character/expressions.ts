/** Expression state definitions for the Cookie character */

import type { Expression } from "../../stores/session";

export interface ExpressionParams {
  eyeOpenness: number;      // 0 = closed (line), 1 = fully open
  pupilY: number;           // -1 = up, 0 = center, 1 = down
  mouthCurve: number;       // -1 = frown, 0 = neutral, 1 = smile
  mouthOpen: number;        // 0 = closed, 1 = open
  eyeColor: string;         // hex
  bodyColor: string;        // cream body tint
  pulseSpeed: number;       // 0 = none, higher = faster
  antennaLight: "idle" | "thinking" | "alert" | "error";
  armLeftAngle: number;     // degrees, -30 to 30
  armRightAngle: number;    // degrees, -30 to 30
}

export const EXPRESSIONS: Record<Expression, ExpressionParams> = {
  sleeping: {
    eyeOpenness: 0.05,
    pupilY: 0,
    mouthCurve: 0.1,
    mouthOpen: 0,
    eyeColor: "#8a8070",
    bodyColor: "#E8E3D9",
    pulseSpeed: 0,
    antennaLight: "idle",
    armLeftAngle: 10,
    armRightAngle: -10,
  },
  happy: {
    eyeOpenness: 1,
    pupilY: 0,
    mouthCurve: 1,
    mouthOpen: 0.3,
    eyeColor: "#F5B942",
    bodyColor: "#EDE8DC",
    pulseSpeed: 0,
    antennaLight: "idle",
    armLeftAngle: -25,
    armRightAngle: 25,
  },
  thinking: {
    eyeOpenness: 0.5,
    pupilY: -0.7,
    mouthCurve: 0.1,
    mouthOpen: 0,
    eyeColor: "#F5B942",
    bodyColor: "#EDE8DC",
    pulseSpeed: 0,
    antennaLight: "thinking",
    armLeftAngle: -20,
    armRightAngle: 5,
  },
  concerned: {
    eyeOpenness: 0.65,
    pupilY: 0,
    mouthCurve: -0.6,
    mouthOpen: 0,
    eyeColor: "#F09030",
    bodyColor: "#EDE8DC",
    pulseSpeed: 0,
    antennaLight: "idle",
    armLeftAngle: 15,
    armRightAngle: 15,
  },
  alert: {
    eyeOpenness: 1,
    pupilY: 0,
    mouthCurve: -0.8,
    mouthOpen: 0.5,
    eyeColor: "#E05040",
    bodyColor: "#EDE8DC",
    pulseSpeed: 2.5,
    antennaLight: "alert",
    armLeftAngle: -28,
    armRightAngle: 28,
  },
};
