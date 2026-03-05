/**
 * SVG Web Renderer
 *
 * Implements character animation for SVG elements in a browser.
 * Takes a CharacterSchema + ResolvedControls, drives SVG transforms directly.
 *
 * Usage:
 *   const renderer = new SvgCharacterRenderer(schema, svgElement);
 *   renderer.apply(resolvedControls);
 */

import type { CharacterSchema, ResolvedControls, MouthControls } from "../engine/types";

export class SvgCharacterRenderer {
  private schema: CharacterSchema;
  private root: SVGElement;

  constructor(schema: CharacterSchema, svgRootElement: SVGElement) {
    this.schema = schema;
    this.root = svgRootElement;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  apply(c: ResolvedControls): void {
    this.applyBrows(c);
    this.applyEyes(c);
    this.applyMouth(c);
    this.applySignal(c);
    this.applyOverlay(c);
  }

  // ─── Brows ───────────────────────────────────────────────────────────────────

  private applyBrows(c: ResolvedControls): void {
    const sc = this.schema.controls.brows;
    this.setTransform(
      "#brow-left",
      `rotate(${c.brows.left.angle}, ${sc.left.pivot.x}, ${sc.left.pivot.y})`
    );
    this.setTransform(
      "#brow-right",
      `rotate(${c.brows.right.angle}, ${sc.right.pivot.x}, ${sc.right.pivot.y})`
    );
  }

  // ─── Eyes ─────────────────────────────────────────────────────────────────

  private applyEyes(c: ResolvedControls): void {
    const sc = this.schema.controls.eyes;

    this.applyEye("#eye-left",  sc.left.anchor,  sc.left.rx,  sc.left.ry,  c.eyes.left);
    this.applyEye("#eye-right", sc.right.anchor, sc.right.rx, sc.right.ry, c.eyes.right);
  }

  private applyEye(
    selector: string,
    anchor: { x: number; y: number },
    rx: number,
    ry: number,
    vals: ResolvedControls["eyes"]["left"]
  ): void {
    const el = this.query(selector);
    if (!el) return;

    const cx = anchor.x + vals.dx;
    const cy = anchor.y + vals.dy;
    const ryActual = ry * vals.scaleY;

    if (vals.scaleY <= 0.08) {
      // Wink — replace with arc path
      el.setAttribute("d",
        `M ${cx - rx},${anchor.y} Q ${cx},${anchor.y - 4} ${cx + rx},${anchor.y}`
      );
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", vals.color);
      el.setAttribute("stroke-width", "2");
    } else if (el.tagName === "ellipse") {
      el.setAttribute("cx", String(cx));
      el.setAttribute("cy", String(cy));
      el.setAttribute("ry", String(ryActual));
      el.setAttribute("fill", vals.color);
    }

    // Specular highlight
    const spec = this.query(`${selector}-spec`);
    if (spec) {
      spec.setAttribute("cx", String(cx - rx * 0.28));
      spec.setAttribute("cy", String(cy - ryActual * 0.35));
      spec.setAttribute("ry", String(ryActual * 0.32));
    }
  }

  // ─── Mouth ────────────────────────────────────────────────────────────────

  private applyMouth(c: ResolvedControls): void {
    const mc = this.schema.controls.mouth;
    const el = this.query("#mouth");
    if (!el) return;

    switch (c.mouth.shape) {
      case "flat":
        el.setAttribute("d",
          `M ${mc.x1},${mc.y} L ${mc.x2},${mc.y}`
        );
        el.setAttribute("fill", "none");
        el.setAttribute("stroke", "#1a1c22");
        break;

      case "open":
        // Switch to ellipse representation
        el.setAttribute("d", this.openMouthPath(mc, c.mouth.openRy));
        el.setAttribute("fill", "#F5F0E8");
        el.setAttribute("stroke", "#1a1c22");
        break;

      case "bezier":
      default:
        el.setAttribute("d",
          `M ${mc.x1},${mc.y} Q ${mc.controlX},${c.mouth.controlY} ${mc.x2},${mc.y} Z`
        );
        el.setAttribute("fill", "#F5F0E8");
        el.setAttribute("stroke", "#1a1c22");
        break;
    }
  }

  private openMouthPath(mc: MouthControls, ry: number): string {
    const cx = mc.controlX;
    const rx = (mc.x2 - mc.x1) * 0.55;
    const cy = mc.controlY_rest - 2;
    return `M ${cx - rx},${cy} a ${rx},${Math.max(2, ry)} 0 1 0 ${rx * 2},0 a ${rx},${Math.max(2, ry)} 0 1 0 ${-rx * 2},0 Z`;
  }

  // ─── Signal ───────────────────────────────────────────────────────────────

  private applySignal(c: ResolvedControls): void {
    const orb = this.query("#signal-orb");
    if (orb) orb.setAttribute("fill", c.signal.color);

    const glow = this.query("#signal-glow");
    if (glow) {
      glow.setAttribute("fill", c.signal.color);
      glow.setAttribute("rx", String(c.signal.glowRadius));
      glow.setAttribute("ry", String(c.signal.glowRadius));
      glow.setAttribute("opacity", c.signal.glowRadius > 0 ? "0.4" : "0");
    }
  }

  // ─── Overlay ──────────────────────────────────────────────────────────────
  // Emotion layers are pre-drawn Inkscape groups toggled by layer id.
  // Mapping from ResolvedControls.overlay keys → emotion label in schema.

  private static readonly OVERLAY_TO_EMOTION: Record<string, string> = {
    blush:      "blush",
    tearDrop:   "tears",
    sweatDrop:  "concerned",
    heartFloat: "excited",
  };

  private applyOverlay(c: ResolvedControls): void {
    // Screen tint
    this.setDisplay("#screen-tint", !!c.overlay.screenTint);
    if (c.overlay.screenTint) {
      const el = this.query("#screen-tint");
      if (el) el.setAttribute("fill", c.overlay.screenTint);
    }

    // Build set of active emotion labels
    const active = new Set<string>();
    for (const [key, label] of Object.entries(SvgCharacterRenderer.OVERLAY_TO_EMOTION)) {
      if (c.overlay[key as keyof typeof c.overlay]) active.add(label);
    }

    // Toggle each emotion layer by its Inkscape id
    for (const [label, layer] of Object.entries(this.schema.controls.emotions ?? {})) {
      this.setDisplay(`#${layer.id}`, active.has(label));
    }
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  private query(selector: string): Element | null {
    return this.root.querySelector(selector);
  }

  private setTransform(selector: string, transform: string): void {
    const el = this.query(selector);
    if (el) el.setAttribute("transform", transform);
  }

  private setDisplay(selector: string, visible: boolean): void {
    const el = this.query(selector);
    if (el) (el as HTMLElement).style.display = visible ? "" : "none";
  }
}
