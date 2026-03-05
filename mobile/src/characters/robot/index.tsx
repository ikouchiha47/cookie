/**
 * Robot character renderer — React Native (SVG).
 *
 * Uses actual Inkscape path data from character_v1.svg for static layers.
 * Animated elements (eyes, brows, mouth, signal orb) use Inkscape coordinates
 * converted from schema values via: ink_x = schema_x - 374.65544, ink_y = schema_y + 78.890901
 *
 * Coordinate space: viewBox "0 0 132.60208 167.63483", root group translate(374.65544,-78.890901)
 */

import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, {
  G, Path, Ellipse, Circle, Defs,
  Filter, FeGaussianBlur, FeMerge, FeMergeNode,
  RadialGradient, Stop,
} from "react-native-svg";
import Animated, {
  useSharedValue, useAnimatedProps, useAnimatedStyle,
  withTiming, withRepeat, withSequence, withSpring, Easing,
} from "react-native-reanimated";
import type { CharacterComponentProps } from "../protocol";
import type { CharacterSchema } from "../engine/types";
import { mapParamsToControls } from "../engine/mapping";
import SCHEMA_JSON from "./character_v1.json";

const SCHEMA = SCHEMA_JSON as unknown as CharacterSchema;

// ─── Root transform ────────────────────────────────────────────────────────────
const ROOT_T = "translate(374.65544,-79.140871)";

// Convert schema coords (viewBox space) → Inkscape space (inside rootTransform group)
function ix(sx: number) { return sx - 374.65544; }
function iy(sy: number) { return sy + 79.140871; }

// ─── Static path data (extracted from character_v1.svg) ────────────────────────

// Body (head shell outer + inner highlight)
const BODY_OUTER = "m -278.43527,231.20004 c -8.29543,9.75048 -20.00751,14.27434 -29.46623,14.39631 -6.32015,-0.40228 -15.28041,-1.33822 -22.55648,-6.99498 -12.57591,-9.7771 -24.0342,-31.67273 -24.25768,-44.64413 -0.36612,-21.25069 28.40264,-29.73711 45.77214,-32.07082 18.07268,1.35639 46.4063,12.4128 48.01656,28.4875 -1.377,13.74338 -10.00445,31.70772 -17.50831,40.82612 z";
const BODY_INNER = "m -323.12337,231.50561 c -23.972,-3.4755 -29.6851,-24.34928 -29.44212,-38.4537 0.33584,-19.49491 22.85747,-28.83178 40.22697,-31.16549 14.22501,1.80906 28.7876,-1.04343 30.13623,17.6235 1.07707,14.90823 -0.59357,33.56928 -8.08802,43.27239 -7.50381,9.71523 -20.83958,10.46213 -32.83306,8.7233 z";

// Hands
const HAND_L_OUTER = "m -360.47671,227.92616 c -2.42901,-0.38458 -4.97746,-2.05935 -6.53401,-4.8796 -3.22955,-5.85147 -3.32212,-16.84085 -2.54184,-25.74295 1.09136,-12.45108 8.34009,-19.91188 14.66752,-20.83165 2.21209,-0.10309 3.75082,0.0717 5.09763,1.02464 0.57069,0.40382 1.37346,1.15407 1.70521,1.77333 3.82856,7.14651 1.70334,22.13975 1.3611,24.65682 -1.18298,7.55943 -3.41061,15.31436 -6.43774,19.80449 -2.1129,3.13405 -4.66283,4.34463 -7.31786,4.19488 z";
const HAND_L_INNER = "m -367.81093,219.40561 c -1.13678,-4.43444 -1.76283,-13.3984 -1.10147,-22.30205 0.83581,-11.25212 7.85997,-19.07166 14.1874,-19.99143 2.21209,-0.10309 2.6288,-0.45011 4.89759,1.22469 2.26878,1.67481 -0.3088,18.05757 -2.01503,25.42989 -1.70628,7.37231 -2.32904,8.88682 -5.23743,13.88294 -3.52788,6.06029 -9.04296,3.76523 -10.73106,1.75596 z";
const HAND_R_OUTER = "m -256.56792,228.23241 c 2.42901,-0.38458 4.97746,-2.05935 6.53401,-4.8796 3.22955,-5.85147 3.32212,-16.84085 2.54184,-25.74295 -1.09136,-12.45108 -8.34009,-19.91188 -14.66752,-20.83165 -2.21209,-0.10309 -3.75082,0.0717 -5.09763,1.02464 -0.57069,0.40382 -1.37346,1.15407 -1.70521,1.77333 -3.82856,7.14651 -1.70334,22.13975 -1.3611,24.65682 1.18298,7.55943 3.41061,15.31436 6.43774,19.80449 2.1129,3.13405 4.66283,4.34463 7.31786,4.19488 z";
const HAND_R_INNER = "m -258.50201,220.20445 c 6.8883,-3.41132 7.83364,-15.80934 7.31574,-22.51195 -0.996,-10.5472 -5.37481,-21.28721 -13.92563,-20.11291 -7.05951,0.96949 -5.25832,20.59449 -5.06228,22.74681 0.57511,6.31433 1.87407,13.07843 4.64698,16.88404 1.96208,2.12532 4.84659,4.07293 7.02519,2.99401 z";

// Head (outer shell + screen)
const HEAD_OUTER = "m -252.34214,131.59211 c 0,9.93388 1.91756,26.93787 -7.04132,35.38144 -11.31776,10.66675 -33.99806,12.34718 -52.57272,12.34718 -19.18503,0 -37.03183,-2.65981 -47.32346,-13.32838 -7.09261,-7.35237 -6.20099,-24.17683 -6.20099,-33.69835 0,-22.48335 24.09256,-30.5323 57.37051,-30.5323 33.27795,0 55.76798,7.34705 55.76798,29.83041 z";
const SCREEN_PATH = "m -264.73246,134.23218 c 0,7.00329 1.48026,18.99095 -5.43553,24.94358 -8.73672,7.51997 -26.24471,8.70466 -40.58338,8.70466 -14.80983,0 -28.58662,-1.87515 -36.53122,-9.39639 -5.47512,-5.18335 -4.78684,-17.04444 -4.78684,-23.75702 0,-15.85056 18.59819,-21.52499 44.28702,-21.52499 25.68883,0 43.04995,5.1796 43.04995,21.03016 z";

// Ears
const EAR_R = "m -245.73371,129.25226 c 0,0 -2.48554,-3.72233 -5.32551,-4.28129 -2.22455,-0.43783 -4.43556,1.66364 -4.997,13.76354 -0.0682,1.30342 -0.14641,4.95196 0.20771,8.10635 0.49589,4.41719 1.59777,8.44573 2.63516,8.81384 2.51056,0.89086 6.62687,-2.48514 7.08304,-3.49274 m -3.05005,-11.69591 c 0,6.4038 1.0052,11.35618 2.85273,11.76587 1.311,0.29072 3.64526,-5.58504 3.64526,-11.98884 0,-6.4038 -1.82873,-11.12278 -3.72114,-11.12277 -1.89241,-1e-5 -2.77684,4.94194 -2.77685,11.34574 z";
const EAR_L = "m -370.97509,129.25226 c 0,0 2.48554,-3.72233 5.32551,-4.28129 2.22455,-0.43783 4.43556,1.66364 4.997,13.76354 0.0682,1.30342 0.14641,4.95196 -0.20771,8.10635 -0.49589,4.41719 -1.59777,8.44573 -2.63516,8.81384 -2.51056,0.89086 -6.62687,-2.48514 -7.08304,-3.49274 m 3.05005,-11.69591 c 0,6.4038 -1.0052,11.35618 -2.85273,11.76587 -1.311,0.29072 -3.64526,-5.58504 -3.64526,-11.98884 0,-6.4038 1.82873,-11.12278 3.72114,-11.12277 1.89241,-1e-5 2.77684,4.94194 2.77685,11.34574 z";

// Signal stem
const SIGNAL_STEM = "m -308.52718,91.163991 v 9.686739";

// ─── Animated components ────────────────────────────────────────────────────────
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedPath    = Animated.createAnimatedComponent(Path);
const AnimatedCircle  = Animated.createAnimatedComponent(Circle);

// ─── Antenna glow colours ───────────────────────────────────────────────────────
const ANTENNA_GLOW: Record<string, string> = {
  idle:     "rgba(91,200,232,0.2)",
  thinking: "rgba(245,166,35,0.45)",
  alert:    "rgba(224,80,64,0.55)",
  error:    "rgba(192,48,48,0.4)",
};

// ─── Eye/brow anchors in Inkscape space ────────────────────────────────────────
// Derived from schema via ix()/iy() — do NOT hardcode independently.
const SC = SCHEMA.controls;
const L_EYE_CX = ix(SC.eyes.left.anchor.x);   // -331.06
const L_EYE_CY = iy(SC.eyes.left.anchor.y);   //  136.80
const R_EYE_CX = ix(SC.eyes.right.anchor.x);  // -286.18
const R_EYE_CY = iy(SC.eyes.right.anchor.y);  //  136.80
const EYE_RX   = SC.eyes.left.rx;             //    6.17
const EYE_RY   = SC.eyes.left.ry;             //    7.87

const L_BROW_PIV_X = ix(SC.brows.left.pivot.x);
const L_BROW_PIV_Y = iy(SC.brows.left.pivot.y);
const R_BROW_PIV_X = ix(SC.brows.right.pivot.x);
const R_BROW_PIV_Y = iy(SC.brows.right.pivot.y);
const BROW_LEN = 8.37;
const BROW_STROKE  = (SC.brows.left as any).stroke ?? "#00ffff";
const BROW_SW      = (SC.brows.left as any).strokeWidth ?? 1.258;

// Structural path styles from schema
const _body  = ((SC as any).body?.paths  ?? []) as any[];
const _head  = ((SC as any).head?.paths  ?? []) as any[];
const _hands = ((SC as any).hands?.paths ?? []) as any[];
const _ears  = ((SC as any).ears?.paths  ?? []) as any[];
const BODY_OUTER_STYLE  = _body[0]  ?? { strokeWidth: 1.858 };
const BODY_INNER_FILL   = _body[1]?.fill  ?? "#eef4fb";
const HEAD_OUTER_STYLE  = _head[0]  ?? { strokeWidth: 1.435 };
const HEAD_SCREEN_STYLE = _head[1]  ?? { strokeWidth: 1.435 };
const HAND_OUTER_STYLE  = _hands[0] ?? { strokeWidth: 1.258 };
const EAR_STYLE         = _ears[0]  ?? { strokeWidth: 1.258 };

// Mouth anchors in Inkscape space
const MOUTH_CX  = (ix(SC.eyes.left.anchor.x) + ix(SC.eyes.right.anchor.x)) / 2;
const MOUTH_HW  = (SC.mouth as any).halfWidth ?? 8;
const MY        = iy(SC.mouth.y);
const MOUTH_SW  = (SC.mouth as any).strokeWidth ?? 1.2;

// Signal orb in Inkscape space
const ORB_CX = ix(SC.signal.orbCenter.x); // -308.44
const ORB_CY = iy(SC.signal.orbCenter.y); //   85.32

const MS = 350;

export function RobotCharacter({ params, size }: CharacterComponentProps) {
  const svgH = size * (183.63483 / 148.60208); // padded viewBox aspect ratio
  const cfg  = { duration: MS, easing: Easing.bezier(0.25, 0.1, 0.25, 1) };

  const ctrl = mapParamsToControls(params, SCHEMA);

  // ── Shared animation values ──────────────────────────────────────────────────
  const eyeL      = useSharedValue(params.eyeOpenness);
  const eyeR      = useSharedValue(params.eyeRightOpenness);
  const eyeYShift = useSharedValue(params.eyeLookY);
  const eyeXShift = useSharedValue(0);
  const mCurve    = useSharedValue(params.mouthCurve);
  const mOpen     = useSharedValue(params.mouthOpen);
  const antScale  = useSharedValue(1);
  const pulse     = useSharedValue(1);
  const bobY      = useSharedValue(0);
  const wiggleR   = useSharedValue(0);

  const [antOrbColor,  setAntOrbColor]  = useState(ctrl.signal.color ?? "#5BC8E8");
  const [antGlowColor, setAntGlowColor] = useState(ANTENNA_GLOW[params.antennaLight] ?? ANTENNA_GLOW.idle);
  const [eyeColor,     setEyeColor]     = useState("#5BC8E8");
  const [screenTint,   setScreenTint]   = useState(ctrl.overlay.screenTint);

  useEffect(() => {
    const c = mapParamsToControls(params, SCHEMA);

    eyeL.value      = withTiming(params.eyeOpenness,      cfg);
    eyeR.value      = withTiming(params.eyeRightOpenness, cfg);
    eyeYShift.value = withTiming(params.eyeLookY,         cfg);
    mCurve.value    = withTiming(params.mouthCurve,       cfg);
    mOpen.value     = withTiming(params.mouthOpen,        cfg);

    setAntOrbColor(c.signal.color ?? eyeColor);
    setAntGlowColor(ANTENNA_GLOW[params.antennaLight] ?? ANTENNA_GLOW.idle);
    setScreenTint(c.overlay.screenTint);
    setEyeColor(c.eyes.left.color === "#E05040" ? "#E05040" : "#5BC8E8");

    // Antenna pulse
    if (params.antennaLight === "excited") {
      antScale.value = withRepeat(
        withSequence(withTiming(1.7, { duration: 600 }), withTiming(1, { duration: 600 })),
        -1, true
      );
    } else if (params.antennaLight === "alert") {
      antScale.value = withRepeat(
        withSequence(withTiming(2.0, { duration: 260 }), withTiming(1, { duration: 260 })),
        -1, true
      );
    } else {
      antScale.value = withTiming(1, { duration: 300 });
    }

    // Body opacity pulse
    if (params.pulseSpeed > 0) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 500 / params.pulseSpeed }),
          withTiming(1,   { duration: 500 / params.pulseSpeed })
        ),
        -1, true
      );
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }

    // Side-to-side eye wander (default expression only) — smooth ping-pong, no snap
    if (params.eyeOpenness === 1 && params.mouthCurve === 0.5 && params.antennaLight === "idle" && !params.heartFloat) {
      eyeXShift.value = -1;
      eyeXShift.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        -1, true
      );
    } else {
      eyeXShift.value = withTiming(0, { duration: 400 });
    }
  }, [params]);

  // Idle float bob — runs once on mount, never restarts
  useEffect(() => {
    bobY.value = -1;
    bobY.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      -1, true
    );
  }, []);

  // ── Animated props ───────────────────────────────────────────────────────────
  const leftEyeProps = useAnimatedProps(() => {
    const ry = Math.max(EYE_RY * eyeL.value, 1);
    return { ry, cy: L_EYE_CY + eyeYShift.value * -5, cx: L_EYE_CX + eyeXShift.value * 1.5 };
  });
  const rightEyeProps = useAnimatedProps(() => {
    const ry = Math.max(EYE_RY * eyeR.value, 1);
    return { ry, cy: R_EYE_CY + eyeYShift.value * -5, cx: R_EYE_CX + eyeXShift.value * 1.5 };
  });

  const mouthProps = useAnimatedProps(() => {
    const c = Math.min(Math.max(mCurve.value, -1), 1);
    // Fixed offsets: smile pushes control DOWN (+Y), frown pushes UP (-Y)
    const ctrlY = MY + 20 * c;
    const openDip = mOpen.value * 12;
    const x1 = MOUTH_CX - MOUTH_HW;
    const x2 = MOUTH_CX + MOUTH_HW;
    if (c === 0 && mOpen.value === 0) {
      return { d: `M ${x1} ${MY} L ${x2} ${MY}` };
    }
    return { d: `M ${x1} ${MY} Q ${MOUTH_CX} ${ctrlY + openDip} ${x2} ${MY} Z` };
  });

  const leftHighlightProps = useAnimatedProps(() => ({
    cx: L_EYE_CX + eyeXShift.value * 1.5 - 1.5,
    cy: L_EYE_CY + eyeYShift.value * -5 - 2,
  }));
  const rightHighlightProps = useAnimatedProps(() => ({
    cx: R_EYE_CX + eyeXShift.value * 1.5 - 1.5,
    cy: R_EYE_CY + eyeYShift.value * -5 - 2,
  }));

  const antGlowProps = useAnimatedProps(() => ({
    r: 3.5 * antScale.value,
    opacity: 0.4 / antScale.value,
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [
      { translateY: bobY.value * 7 },
      { rotate: `${wiggleR.value}deg` },
    ],
  }));

  const shadowStyle = useAnimatedStyle(() => {
    // bobY in [-1, 1]: -1 = highest (small shadow), +1 = lowest (large shadow)
    const scale   = 0.875 + 0.125 * bobY.value;
    const opacity = 0.14  + 0.06  * bobY.value;
    return { transform: [{ scaleX: scale }], opacity };
  });

  function onPress() {
    wiggleR.value = withSequence(
      withTiming( 6, { duration: 80 }),
      withTiming(-5, { duration: 80 }),
      withTiming( 4, { duration: 70 }),
      withTiming(-3, { duration: 70 }),
      withSpring(0,  { damping: 6, stiffness: 200 }),
    );
  }

  const shadowW = size * 0.5;
  const shadowH = size * 0.06;

  // Brow color and line width
  const browColor = params.antennaLight === "alert" ? "#E05040" : BROW_STROKE;
  const browW = params.mouthCurve < -0.5 ? BROW_SW * 1.3 : BROW_SW;

  // Brow rotation: render as rotated lines around pivot
  function browPath(x1: number, x2: number, y: number, angle: number, pivotX: number) {
    const rad = (angle * Math.PI) / 180;
    const dx1 = x1 - pivotX, dx2 = x2 - pivotX;
    const rx1 = pivotX + dx1 * Math.cos(rad), ry1 = y + dx1 * Math.sin(rad);
    const rx2 = pivotX + dx2 * Math.cos(rad), ry2 = y + dx2 * Math.sin(rad);
    return `M ${rx1} ${ry1} L ${rx2} ${ry2}`;
  }

  const lBrowD = browPath(
    L_BROW_PIV_X - BROW_LEN, L_BROW_PIV_X,
    L_BROW_PIV_Y, ctrl.brows.left.angle, L_BROW_PIV_X
  );
  const rBrowD = browPath(
    R_BROW_PIV_X, R_BROW_PIV_X + BROW_LEN,
    R_BROW_PIV_Y, ctrl.brows.right.angle, R_BROW_PIV_X
  );

  return (
    <Pressable onPress={onPress} style={{ alignItems: "center" }}>
      <Animated.View style={containerStyle}>
        <Svg width={size} height={svgH} viewBox="-8 -12 148.60208 183.63483">
          <Defs>
            <Filter id="eyeGlow" x="-60%" y="-60%" width="220%" height="220%">
              <FeGaussianBlur stdDeviation="1.5" result="blur" />
              <FeMerge><FeMergeNode in="blur" /><FeMergeNode in="SourceGraphic" /></FeMerge>
            </Filter>
            <Filter id="antGlow" x="-100%" y="-100%" width="300%" height="300%">
              <FeGaussianBlur stdDeviation="1.2" result="blur" />
              <FeMerge><FeMergeNode in="blur" /><FeMergeNode in="SourceGraphic" /></FeMerge>
            </Filter>
          </Defs>

          <G transform={ROOT_T}>
            {/* ── Body (bottom) ── */}
            <Path d={BODY_OUTER} fill={BODY_OUTER_STYLE.fill ?? "#d3ddeb"} stroke="#000" strokeWidth={BODY_OUTER_STYLE.strokeWidth} strokeLinecap="round" />
            <Path d={BODY_INNER} fill={BODY_INNER_FILL} />

            {/* ── Hands ── */}
            <Path d={HAND_L_OUTER} fill={HAND_OUTER_STYLE.fill ?? "#d0dae8"} stroke="#000" strokeWidth={HAND_OUTER_STYLE.strokeWidth} strokeLinecap="round" />
            <Path d={HAND_L_INNER} fill={BODY_INNER_FILL} />
            <Path d={HAND_R_OUTER} fill={HAND_OUTER_STYLE.fill ?? "#d0dae8"} stroke="#000" strokeWidth={HAND_OUTER_STYLE.strokeWidth} strokeLinecap="round" />
            <Path d={HAND_R_INNER} fill={BODY_INNER_FILL} />

            {/* ── Head outer shell ── */}
            <Path d={HEAD_OUTER} fill={HEAD_OUTER_STYLE.fill ?? "#eef4fb"} stroke="#000" strokeWidth={HEAD_OUTER_STYLE.strokeWidth} fillRule="evenodd" />

            {/* ── Screen ── */}
            <Path d={SCREEN_PATH}
              fill={screenTint ?? "#222c3c"}
              stroke="#000" strokeWidth={HEAD_SCREEN_STYLE.strokeWidth ?? 1.435} fillRule="evenodd"
            />

            {/* ── Ears ── */}
            <Path d={EAR_R} fill={EAR_STYLE.fill ?? "#88cff4"} stroke="#000" strokeWidth={EAR_STYLE.strokeWidth} strokeLinecap="round" />
            <Path d={EAR_L} fill={EAR_STYLE.fill ?? "#87cff4"} stroke="#000" strokeWidth={EAR_STYLE.strokeWidth} strokeLinecap="round" />

            {/* ── Signal stem ── */}
            <Path d={SIGNAL_STEM} fill="none" stroke="#000" strokeWidth={1.977} strokeLinecap="round" />

            {/* ── Signal orb glow + orb ── */}
            <AnimatedCircle cx={ORB_CX} cy={ORB_CY} fill={antGlowColor} animatedProps={antGlowProps} />
            <Circle cx={ORB_CX} cy={ORB_CY} r={5.07} fill={antOrbColor} stroke="#000" strokeWidth={1} filter="url(#antGlow)" />
            <Circle cx={ORB_CX - 1.5} cy={ORB_CY - 1.5} r={1.5} fill="rgba(255,255,255,0.45)" />

            {/* ── Eyes ── */}
            <AnimatedEllipse cx={L_EYE_CX} cy={L_EYE_CY} rx={EYE_RX} ry={EYE_RY} fill={eyeColor} animatedProps={leftEyeProps} />
            <AnimatedEllipse cx={R_EYE_CX} cy={R_EYE_CY} rx={EYE_RX} ry={EYE_RY} fill={eyeColor} animatedProps={rightEyeProps} />
            <AnimatedEllipse cx={L_EYE_CX} cy={L_EYE_CY} rx={EYE_RX * 0.35} ry={EYE_RY * 0.3} fill="rgba(255,255,255,0.5)" animatedProps={leftHighlightProps} />
            <AnimatedEllipse cx={R_EYE_CX} cy={R_EYE_CY} rx={EYE_RX * 0.35} ry={EYE_RY * 0.3} fill="rgba(255,255,255,0.5)" animatedProps={rightHighlightProps} />

            {/* ── Brows ── */}
            <Path d={lBrowD} stroke={browColor} strokeWidth={browW} strokeLinecap="round" fill="none" />
            <Path d={rBrowD} stroke={browColor} strokeWidth={browW} strokeLinecap="round" fill="none" />

            {/* ── Mouth ── */}
            <AnimatedPath animatedProps={mouthProps}
              fill={params.mouthCurve > 0 ? eyeColor : "none"} stroke="#000" strokeWidth={MOUTH_SW} strokeLinecap="round"
            />

            {/* ── Blush ── */}
            {ctrl.overlay.blush && (
              <>
                <Path d="m -347.08358,140.51433 c 0,2.97542 -3.05092,5.98715 -5.45745,6.63198 -2.35604,-0.6313 -5.45745,-3.65656 -5.45745,-6.63198 0,-2.97543 3.31952,-4.20289 5.45745,-1.93944 1.9524,-2.33766 5.45745,-1.03599 5.45745,1.93944 z"
                  fill="#E87070" fillRule="evenodd" />
                <Path d="m -259.42666,140.51433 c 0,2.97542 -3.05092,5.98715 -5.45745,6.63198 -2.35604,-0.6313 -5.45745,-3.65656 -5.45745,-6.63198 0,-2.97543 3.31952,-4.20289 5.45745,-1.93944 1.9524,-2.33766 5.45745,-1.03599 5.45745,1.93944 z"
                  fill="#E87070" fillRule="evenodd" />
              </>
            )}

            {/* ── Tear drops ── */}
            {ctrl.overlay.tearDrop && (
              <>
                <Path d="m -288.62008,154.15786 c 0,-1.40985 3.01231,-7.49856 3.01231,-7.49856 0,0 2.91727,6.06125 2.91727,7.44661 0,1.40987 -0.97013,3.46377 -3.01231,3.39949 -2.04217,-0.0643 -2.91727,-1.96216 -2.91727,-3.34754 z"
                  fill="#88CCEE" fillRule="evenodd" />
                <Path d="m -334.03186,154.15785 c 0,-1.40985 3.01231,-7.49856 3.01231,-7.49856 0,0 2.91727,6.06125 2.91727,7.44661 0,1.40987 -0.97013,3.46377 -3.01231,3.39949 -2.04217,-0.0643 -2.91727,-1.96216 -2.91727,-3.34754 z"
                  fill="#88CCEE" fillRule="evenodd" />
              </>
            )}

            {/* ── Sweat drop (concerned) ── */}
            {ctrl.overlay.sweatDrop && (
              <Path
                d="m -334.03186,154.15785 c 0,-1.40985 3.01231,-7.49856 3.01231,-7.49856 0,0 2.91727,6.06125 2.91727,7.44661 0,1.40987 -0.97013,3.46377 -3.01231,3.39949 -2.04217,-0.0643 -2.91727,-1.96216 -2.91727,-3.34754 z"
                transform="translate(56.253039,-31.715967)"
                fill="#88CCEE" stroke="#000080" strokeWidth={0.9} fillRule="evenodd"
              />
            )}

            {/* ── Excited sparks ── */}
            {ctrl.overlay.heartFloat && (
              <>
                <G transform="matrix(0.75964537,0,0,0.77791692,-90.098795,25.147881)" fill="#fffa57" stroke="#000080" strokeWidth={0.135274}>
                  <Path d="m -411.85304,126.48921 16.90282,7.73483 -2.07065,-8.68773 18.01086,8.15489 -21.99463,-15.23899 2.47515,11.58862 z" />
                  <Path d="m -401.69455,169.66577 15.16083,-10.75554 -8.55653,-2.55927 16.0794,-11.50418 -24.2062,11.40396 11.26992,3.66215 z" />
                  <Path d="m -378.97676,137.43543 -9.52179,-0.15278 2.75841,3.65048 -10.1281,-0.12198 13.45433,2.62654 -3.54484,-4.9284 z" strokeWidth={0.0693013} />
                </G>
                <G transform="matrix(-0.7596321,0,0,0.77746019,-527.97488,25.199618)" fill="#fffa57" stroke="#000080" strokeWidth={0.135274}>
                  <Path d="m -411.85304,126.48921 16.90282,7.73483 -2.07065,-8.68773 18.01086,8.15489 -21.99463,-15.23899 2.47515,11.58862 z" />
                  <Path d="m -401.69455,169.66577 15.16083,-10.75554 -8.55653,-2.55927 16.0794,-11.50418 -24.2062,11.40396 11.26992,3.66215 z" />
                  <Path d="m -378.97676,137.43543 -9.52179,-0.15278 2.75841,3.65048 -10.1281,-0.12198 13.45433,2.62654 -3.54484,-4.9284 z" strokeWidth={0.0693013} />
                </G>
              </>
            )}
          </G>
        </Svg>
      </Animated.View>

      {/* Floating ground shadow */}
      <Animated.View style={[{
        width: shadowW, height: shadowH,
        borderRadius: shadowH / 2,
        backgroundColor: "#5BC8E8",
        marginTop: 4,
        opacity: 0.25,
      }, shadowStyle]} />
    </Pressable>
  );
}
