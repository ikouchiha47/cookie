#!/usr/bin/env npx ts-node
/**
 * extract_schema.ts
 *
 * Parses an Inkscape SVG conforming to the robot_v1 schema contract:
 *   layers: body, head, hands/left+right, ears/left+right,
 *           eyes/left+right, brows/left+right, mouth, signal
 *
 * Applies full transform chains to produce symbol-space coordinates.
 * Outputs a .schema.json sidecar next to the SVG file.
 *
 * Usage:
 *   npx ts-node scripts/extract_schema.ts ../Desktop/bot_2_color.svg
 */

import * as fs from "fs";
import * as path from "path";
import { DOMParser } from "@xmldom/xmldom";

// ─── Matrix math ──────────────────────────────────────────────────────────────

type Matrix = [number, number, number, number, number, number]; // [a,b,c,d,e,f]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function parseTransform(t: string | null): Matrix {
  if (!t) return IDENTITY;
  const translate = t.match(/translate\(\s*([-\d.e]+)[,\s]+([-\d.e]+)\s*\)/);
  if (translate) return [1, 0, 0, 1, parseFloat(translate[1]), parseFloat(translate[2])];
  const matrix = t.match(/matrix\(\s*([-\d.e]+)[,\s]+([-\d.e]+)[,\s]+([-\d.e]+)[,\s]+([-\d.e]+)[,\s]+([-\d.e]+)[,\s]+([-\d.e]+)\s*\)/);
  if (matrix) return matrix.slice(1, 7).map(Number) as Matrix;
  return IDENTITY;
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function attr(el: Element, name: string): string | null {
  return el.getAttribute(name) ?? el.getAttribute(name.toLowerCase()) ?? null;
}

function findByLabel(parent: Element, label: string): Element | null {
  const children = Array.from(parent.childNodes) as Element[];
  for (const el of children) {
    if (el.nodeType !== 1) continue;
    const lbl = attr(el, "inkscape:label");
    if (lbl === label) return el;
    const found = findByLabel(el, label);
    if (found) return found;
  }
  return null;
}

function collectTransformChain(el: Element, root: Element): Matrix {
  const chain: Matrix[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root.parentNode) {
    const t = attr(cur, "transform");
    if (t) chain.unshift(parseTransform(t));
    cur = cur.parentNode as Element | null;
  }
  return chain.reduce(multiply, IDENTITY);
}

// ─── Geometry extractors ──────────────────────────────────────────────────────

function extractLineEndpoints(el: Element, m: Matrix) {
  const d = attr(el, "d") ?? "";
  // relative move: m x,y h width  OR  absolute M x,y H x2
  const rel = d.match(/m\s*([-\d.]+)[,\s]+([-\d.]+)\s*h\s*([-\d.]+)/);
  if (rel) {
    const x1 = parseFloat(rel[1]), y1 = parseFloat(rel[2]), w = parseFloat(rel[3]);
    const p1 = applyMatrix(m, x1, y1);
    const p2 = applyMatrix(m, x1 + w, y1);
    return { p1: { x: p1[0], y: p1[1] }, p2: { x: p2[0], y: p2[1] } };
  }
  return null;
}

function extractEllipse(el: Element, m: Matrix) {
  const cx = parseFloat(attr(el, "cx") ?? "0");
  const cy = parseFloat(attr(el, "cy") ?? "0");
  const rx = parseFloat(attr(el, "rx") ?? "0");
  const ry = parseFloat(attr(el, "ry") ?? "0");
  const center = applyMatrix(m, cx, cy);
  return { cx: center[0], cy: center[1], rx, ry };
}

function extractMouthAnchor(el: Element, m: Matrix) {
  const d = attr(el, "d") ?? "";
  // Parse all absolute/relative coordinates to find bounding box
  const nums = d.match(/([-\d.]+)/g)?.map(Number) ?? [];
  // Grab start point (first two numbers after m/M)
  const moveMatch = d.match(/[mM]\s*([-\d.]+)[,\s]+([-\d.]+)/);
  if (!moveMatch) return null;
  const startX = parseFloat(moveMatch[1]);
  const startY = parseFloat(moveMatch[2]);

  // Find the widest x extent and lowest y (bottom of bowl)
  // The mouth path has 3 key nodes: top-left, bottom-center, top-right
  // Extract all coordinate pairs from cubic bezier segments
  const pairs: [number, number][] = [];
  let cx = startX, cy = startY;
  // Walk cubic bezier control points - last pair of each c segment is endpoint
  const segments = d.split(/(?=[cCmMzZ])/);
  for (const seg of segments) {
    const m2 = seg.match(/^[mM]\s*([-\d.]+)[,\s]+([-\d.]+)/);
    if (m2) { cx = parseFloat(m2[1]); cy = parseFloat(m2[2]); pairs.push([cx, cy]); continue; }
    const c = seg.match(/^c([\s\S]*)/);
    if (c) {
      const ns = (c[1].match(/([-\d.]+)/g) ?? []).map(Number);
      // Each cubic bezier takes 6 numbers; a single c command can chain multiple
      for (let i = 0; i + 5 < ns.length; i += 6) {
        cx += ns[i + 4]; cy += ns[i + 5];
        pairs.push([cx, cy]);
      }
    }
  }

  // bottom node = highest y value
  const transformed = pairs.map(([x, y]) => applyMatrix(m, x, y));
  const bottomNode = transformed.reduce((a, b) => (b[1] > a[1] ? b : a));
  const leftNode = transformed.reduce((a, b) => (b[0] < a[0] ? b : a));
  const rightNode = transformed.reduce((a, b) => (b[0] > a[0] ? b : a));

  // Start point (top of arc) — transform the raw start coords
  const startPt = applyMatrix(m, startX, startY);
  const halfWidth = (rightNode[0] - leftNode[0]) / 2;

  return {
    x1: round(leftNode[0]),
    x2: round(rightNode[0]),
    y: round(startPt[1]),          // TOP of arc (where path starts), not bottom
    halfWidth: round(halfWidth),
    controlX: round((leftNode[0] + rightNode[0]) / 2),
    controlY_rest: round(bottomNode[1]),
    controlY_min: round(bottomNode[1] - 13),  // frown
    controlY_max: round(bottomNode[1] + 6),   // big smile
  };
}

function round(n: number) { return Math.round(n * 100) / 100; }
function r2(n: number) { return Math.round(n * 100) / 100; }

// ─── Emotion layer extractor ──────────────────────────────────────────────────

function styleAttr(el: Element, prop: string): string | null {
  const style = attr(el, "style") ?? "";
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : attr(el, prop);
}

function extractEmotionElement(el: Element): import("../src/characters/engine/types").EmotionElement | null {
  const tag = el.tagName?.toLowerCase();
  if (!["path", "ellipse", "circle", "rect"].includes(tag)) return null;

  // Normalize: treat circle as ellipse for the output type
  const outTag = tag === "circle" ? "ellipse" : tag;
  const base: Record<string, any> = { type: outTag };

  // geometry
  if (tag === "path") base.d = attr(el, "d") ?? undefined;
  if (tag === "ellipse") {
    base.cx = parseFloat(attr(el, "cx") ?? "0");
    base.cy = parseFloat(attr(el, "cy") ?? "0");
    base.rx = parseFloat(attr(el, "rx") ?? "0");
    base.ry = parseFloat(attr(el, "ry") ?? "0");
  }
  if (tag === "circle") {
    base.cx = parseFloat(attr(el, "cx") ?? "0");
    base.cy = parseFloat(attr(el, "cy") ?? "0");
    const r = parseFloat(attr(el, "r") ?? "0");
    base.rx = r;
    base.ry = r;
  }
  if (tag === "rect") {
    base.x = parseFloat(attr(el, "x") ?? "0");
    base.y = parseFloat(attr(el, "y") ?? "0");
    base.width  = parseFloat(attr(el, "width")  ?? "0");
    base.height = parseFloat(attr(el, "height") ?? "0");
  }

  // style — prefer inline style attr, fall back to presentation attr
  const fill = styleAttr(el, "fill");
  if (fill && fill !== "none") base.fill = fill;
  const fillOpacity = styleAttr(el, "fill-opacity");
  if (fillOpacity) base.fillOpacity = parseFloat(fillOpacity);
  const fillRule = styleAttr(el, "fill-rule");
  if (fillRule) base.fillRule = fillRule;
  const stroke = styleAttr(el, "stroke");
  if (stroke && stroke !== "none") base.stroke = stroke;
  const sw = styleAttr(el, "stroke-width");
  if (sw) base.strokeWidth = parseFloat(sw);

  // element-local transform (not the root chain — just what's on this element)
  const t = attr(el, "transform");
  if (t) base.transform = t;

  return base as any;
}

function extractEmotionLayer(layerEl: Element): { id: string; elements: any[] } {
  const id = attr(layerEl, "id") ?? "";
  const elements: any[] = [];

  function walk(el: Element) {
    const tag = el.tagName?.toLowerCase();
    if (["path", "ellipse", "circle", "rect"].includes(tag)) {
      const e = extractEmotionElement(el);
      if (e) elements.push(e);
    } else {
      // group — carry its transform into child elements
      const groupTransform = attr(el, "transform");
      for (const child of Array.from(el.childNodes) as Element[]) {
        if (child.nodeType !== 1) continue;
        if (groupTransform && !attr(child, "transform")) {
          // propagate group transform to child so elements are self-contained
          (child as any)._inheritedTransform = groupTransform;
        }
        walk(child);
      }
    }
  }

  // Handle groups that carry their own transform
  function walkWithInheritedTransform(el: Element, inheritedTransform?: string) {
    const tag = el.tagName?.toLowerCase();
    if (["path", "ellipse", "rect"].includes(tag)) {
      const e = extractEmotionElement(el);
      if (e) {
        // Merge inherited group transform with element transform
        if (inheritedTransform && !e.transform) {
          e.transform = inheritedTransform;
        } else if (inheritedTransform && e.transform) {
          e.transform = `${inheritedTransform} ${e.transform}`;
        }
        elements.push(e);
      }
    } else {
      const groupTransform = attr(el, "transform") ?? undefined;
      const combined = inheritedTransform && groupTransform
        ? `${inheritedTransform} ${groupTransform}`
        : groupTransform ?? inheritedTransform;
      for (const child of Array.from(el.childNodes) as Element[]) {
        if (child.nodeType !== 1) continue;
        walkWithInheritedTransform(child, combined);
      }
    }
  }

  walkWithInheritedTransform(layerEl, undefined);
  return { id, elements };
}

// ─── Presentation attribute extractor ────────────────────────────────────────

function extractPresentation(el: Element) {
  const fill       = styleAttr(el, "fill");
  const stroke     = styleAttr(el, "stroke");
  const sw         = styleAttr(el, "stroke-width");
  const slc        = styleAttr(el, "stroke-linecap");
  const fillRule   = styleAttr(el, "fill-rule");
  return {
    ...(fill     && fill !== "none"  ? { fill }                          : {}),
    ...(stroke   && stroke !== "none"? { stroke }                        : {}),
    ...(sw                           ? { strokeWidth: parseFloat(sw) }   : {}),
    ...(slc                          ? { strokeLinecap: slc }            : {}),
    ...(fillRule                     ? { fillRule }                       : {}),
  };
}

// For a layer group, collect presentation from ALL direct-child paths and de-dup
function layerPresentation(groupEl: Element): Record<string, any>[] {
  return (Array.from(groupEl.childNodes) as Element[])
    .filter(n => n.nodeType === 1)
    .map(n => extractPresentation(n));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function extract(svgPath: string) {
  const src = fs.readFileSync(svgPath, "utf8");
  const doc = new DOMParser().parseFromString(src, "image/svg+xml");
  const svg = doc.documentElement;

  // Find root group g4551
  const root = Array.from(svg.childNodes as any).find(
    (n: any) => n.nodeType === 1 && n.getAttribute?.("id") === "g4551"
  ) as Element;
  if (!root) throw new Error("g4551 root group not found");

  const rootMatrix = collectTransformChain(root, svg);

  function matrix(el: Element): Matrix {
    return collectTransformChain(el, svg);
  }

  // ── brows ──────────────────────────────────────────────────────────────────
  const browsLayer = findByLabel(root, "brows")!;
  const leftBrowGroup = findByLabel(browsLayer, "left")!;
  const rightBrowGroup = findByLabel(browsLayer, "right")!;

  const leftBrowPath = Array.from(leftBrowGroup.childNodes as any)
    .find((n: any) => n.nodeType === 1) as Element;
  const rightBrowPath = Array.from(rightBrowGroup.childNodes as any)
    .find((n: any) => n.nodeType === 1) as Element;

  const lbm = matrix(leftBrowPath);
  const rbm = matrix(rightBrowPath);
  const lbEnds = extractLineEndpoints(leftBrowPath, lbm)!;
  const rbEnds = extractLineEndpoints(rightBrowPath, rbm)!;

  // inner endpoint = closer to face center (x ≈ 66)
  const faceCenter = 66;
  const lbInner = Math.abs(lbEnds.p1.x - faceCenter) < Math.abs(lbEnds.p2.x - faceCenter)
    ? lbEnds.p1 : lbEnds.p2;
  const rbInner = Math.abs(rbEnds.p1.x - faceCenter) < Math.abs(rbEnds.p2.x - faceCenter)
    ? rbEnds.p1 : rbEnds.p2;

  // ── eyes ───────────────────────────────────────────────────────────────────
  const eyesLayer = findByLabel(root, "eyes")!;
  const leftEyeGroup = findByLabel(eyesLayer, "left")!;
  const rightEyeGroup = findByLabel(eyesLayer, "right")!;

  const leftEllipse = Array.from(leftEyeGroup.childNodes as any)
    .find((n: any) => n.nodeType === 1) as Element;
  const rightEllipse = Array.from(rightEyeGroup.childNodes as any)
    .find((n: any) => n.nodeType === 1) as Element;

  const le = extractEllipse(leftEllipse, matrix(leftEllipse));
  const re = extractEllipse(rightEllipse, matrix(rightEllipse));

  // ── structural layer presentation attrs ────────────────────────────────────
  const bodyLayer  = findByLabel(root, "body");
  const headLayer  = findByLabel(root, "head");
  const handsLayer = findByLabel(root, "hands");
  const earsLayer  = findByLabel(root, "ears");

  const bodyPresentation  = bodyLayer  ? layerPresentation(bodyLayer)  : [];
  const headPresentation  = headLayer  ? layerPresentation(headLayer)  : [];
  const handsPresentation = handsLayer ? layerPresentation(handsLayer) : [];
  const earsPresentation  = earsLayer  ? layerPresentation(earsLayer)  : [];

  // brow presentation
  const lbPresentation = extractPresentation(leftBrowPath);
  const rbPresentation = extractPresentation(rightBrowPath);

  // ── mouth ──────────────────────────────────────────────────────────────────
  const mouthLayer = findByLabel(root, "mouth")!;
  const mouthPath = Array.from(mouthLayer.childNodes as any)
    .find((n: any) => n.nodeType === 1) as Element;
  const mouth = extractMouthAnchor(mouthPath, matrix(mouthPath))!;
  const mouthPresentation = extractPresentation(mouthPath);

  // ── signal ─────────────────────────────────────────────────────────────────
  const signalLayer = findByLabel(root, "signal")!;
  const signalPaths = Array.from(signalLayer.childNodes as any)
    .filter((n: any) => n.nodeType === 1) as Element[];
  // Orb is the first path (circle drawn as 4 arcs).
  // d="m -303.36695,85.324791 a 5.0696955,4.9339004 ..." → startX=-303.36695, rx=5.0697
  const orbPath = signalPaths[0];
  const orbD = attr(orbPath, "d") ?? "";
  const orbMove = orbD.match(/[mM]\s*([-\d.e]+)[,\s]+([-\d.e]+)/);
  const orbArc  = orbD.match(/a\s*([\d.e]+)[,\s]+([\d.e]+)/);
  const orbStartX = orbMove ? parseFloat(orbMove[1]) : -303.36695;
  const orbStartY = orbMove ? parseFloat(orbMove[2]) : 85.324791;
  const orbRx     = orbArc  ? parseFloat(orbArc[1])  : 5.0697;
  const orbCenter = applyMatrix(rootMatrix, orbStartX - orbRx, orbStartY);
  // Read idle orb color from SVG fill (source of truth)
  const orbIdleColor = styleAttr(orbPath, "fill") ?? "#00ffff";

  // ── emotions ───────────────────────────────────────────────────────────────
  // The "emotions" group contains named hidden layers — one per overlay param.
  // Keys must match ResolvedControls.overlay keys: blush, tearDrop, sweatDrop,
  // heartFloat, and any extras (confused, excited, etc.)
  const emotions: Record<string, any> = {};
  const emotionsGroup = findByLabel(root, "emotions");
  if (emotionsGroup) {
    for (const child of Array.from(emotionsGroup.childNodes) as Element[]) {
      if (child.nodeType !== 1) continue;
      const label = attr(child, "inkscape:label");
      if (!label) continue;
      emotions[label] = extractEmotionLayer(child);
    }
  }

  // ── viewBox ────────────────────────────────────────────────────────────────
  const viewBox = attr(svg, "viewBox") ?? "0 0 132.60208 167.63483";
  const rootTransform = attr(root, "transform") ?? "";

  const schema = {
    schemaVersion: "1.0",
    characterId: "robot",
    svgFile: path.basename(svgPath),
    viewBox,
    rootTransform,
    controls: {
      body:  { paths: bodyPresentation },
      head:  { paths: headPresentation },
      hands: { paths: handsPresentation },
      ears:  { paths: earsPresentation },
      brows: {
        left: {
          pivot: { x: r2(lbInner.x), y: r2(lbInner.y) },
          range: { min: -35, max: 35 },
          restAngle: 0,
          ...lbPresentation,
        },
        right: {
          pivot: { x: r2(rbInner.x), y: r2(rbInner.y) },
          range: { min: -35, max: 35 },
          restAngle: 0,
          ...rbPresentation,
        },
      },
      eyes: {
        left: {
          anchor: { x: r2(le.cx), y: r2(le.cy) },
          rx: r2(le.rx),
          ry: r2(le.ry),
          opennessRange: { min: 0.1, max: 1.3 },
          lookXRange: { min: -3, max: 3 },
          lookYRange: { min: -3, max: 3 },
        },
        right: {
          anchor: { x: r2(re.cx), y: r2(re.cy) },
          rx: r2(re.rx),
          ry: r2(re.ry),
          opennessRange: { min: 0.1, max: 1.3 },
          lookXRange: { min: -3, max: 3 },
          lookYRange: { min: -3, max: 3 },
        },
      },
      mouth: { ...mouth, ...mouthPresentation },
      signal: {
        orbCenter: { x: r2(orbCenter[0]), y: r2(orbCenter[1]) },
        glowRange: { min: 0, max: 15 },
        colors: {
          idle: orbIdleColor,
          excited: "#F5A623",
          alert: "#E05040",
          error: "#FF0000",
        },
      },
      emotions,
    },
  };

  const outPath = svgPath.replace(/\.svg$/, ".json");
  fs.writeFileSync(outPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Schema written to ${outPath}`);
  console.log(JSON.stringify(schema, null, 2));
}

// ─── Run ──────────────────────────────────────────────────────────────────────
const svgFile = process.argv[2];
if (!svgFile) {
  console.error("Usage: npx ts-node scripts/extract_schema.ts <path/to/file.svg>");
  process.exit(1);
}
extract(path.resolve(svgFile));
