"""Test harness — evaluate pipeline on YouTube cooking videos."""

from __future__ import annotations

import json
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import dspy

from cookie.config import init as config_init
from cookie.knowledge.recipes import RecipeGenerator
from cookie.reasoning.engine import ReasoningEngine
from cookie.reasoning.router import configure_models
from cookie.state.manager import SessionManager

log = logging.getLogger(__name__)


class VideoHarness:
    """Offline evaluation: process a video through the full pipeline."""

    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or config_init()
        self.lms = configure_models(self.config.get("models", {}))
        self.reasoning = ReasoningEngine(self.lms, self.config.get("reasoning", {}))

    def download_video(self, url: str, output_dir: str | None = None) -> Path:
        out_dir = Path(output_dir or tempfile.mkdtemp(prefix="cookie_harness_"))
        out_dir.mkdir(parents=True, exist_ok=True)
        output_path = out_dir / "video.mp4"

        log.info("Downloading video ...")
        subprocess.run(
            ["yt-dlp", "-f", "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/mp4",
             "--merge-output-format", "mp4",
             "-o", str(output_path), url],
            check=True,
        )
        return output_path

    def extract_frames(self, video_path: Path, fps: float = 0.5) -> Path:
        frames_dir = video_path.parent / "frames"
        frames_dir.mkdir(exist_ok=True)

        log.info("Extracting frames at %.1f fps ...", fps)
        subprocess.run(
            ["ffmpeg", "-i", str(video_path),
             "-vf", f"fps={fps}", "-q:v", "2",
             str(frames_dir / "frame_%06d.jpg"), "-y"],
            check=True, capture_output=True,
        )
        count = len(list(frames_dir.glob("*.jpg")))
        log.info("Extracted %d frames", count)
        return frames_dir

    def run(
        self,
        video_source: str,
        recipe_intent: str = "",
        fps: float = 0.5,
        max_frames: int = 20,
    ) -> list[dict[str, Any]]:
        if video_source.startswith("http"):
            video_path = self.download_video(video_source)
        else:
            video_path = Path(video_source)

        frames_dir = self.extract_frames(video_path, fps)
        frame_files = sorted(frames_dir.glob("*.jpg"))

        if len(frame_files) > max_frames:
            step = len(frame_files) // max_frames
            frame_files = frame_files[::step][:max_frames]
            log.info("Subsampled to %d frames", len(frame_files))

        session_mgr = SessionManager("harness", str(video_path.parent))

        if recipe_intent:
            log.info("Generating recipe plan for: %s", recipe_intent)
            gen = RecipeGenerator(self.lms.get("reasoning"))
            plan = gen.generate(recipe_intent)
            session_mgr.set_recipe(plan)
            log.info("Recipe: %s (%d steps)", plan.title, len(plan.steps))
            for s in plan.steps:
                log.info("  Step %d: %s", s.index, s.instruction[:80])

        guidance_log: list[dict[str, Any]] = []

        for i, frame_file in enumerate(frame_files):
            timestamp = i / fps
            log.info("[%d/%d] t=%.1fs — analyzing frame ...", i + 1, len(frame_files), timestamp)

            image = dspy.Image(url=str(frame_file))

            output = self.reasoning.generate_guidance(
                session=session_mgr.state,
                trigger_event=f"Video frame at t={timestamp:.1f}s ({i+1}/{len(frame_files)})",
                image=image,
            )
            session_mgr.apply_reasoning(output)

            entry = {
                "t": round(timestamp, 1),
                "frame": frame_file.name,
                "guidance": output.guidance,
                "severity": output.severity.value,
                "step": session_mgr.state.current_step,
                "step_progress": output.step_progress,
            }
            guidance_log.append(entry)

            icon = {"info": "  ", "warning": "⚠️", "critical": "🚨"}.get(output.severity.value, "  ")
            print(f"  {icon} [{output.severity.value}] {output.guidance[:120]}")

            if output.safety_flag:
                print(f"  🚨 SAFETY: {output.safety_flag}")

        output_path = video_path.parent / "guidance_log.json"
        output_path.write_text(json.dumps(guidance_log, indent=2))
        session_mgr.save_session()

        print(f"\n{'='*60}")
        print(f"Done: {len(guidance_log)} guidance events from {len(frame_files)} frames")
        print(f"Results: {output_path}")
        return guidance_log


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Cookie test harness")
    parser.add_argument("video", help="YouTube URL or local video path")
    parser.add_argument("--recipe", default="", help="Recipe intent")
    parser.add_argument("--fps", type=float, default=0.5)
    parser.add_argument("--max-frames", type=int, default=20)
    parser.add_argument("--config", help="Config YAML override")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    config = config_init()
    if args.config:
        from cookie.config import load_config
        config = load_config(args.config)

    harness = VideoHarness(config)
    harness.run(args.video, args.recipe, args.fps, args.max_frames)


if __name__ == "__main__":
    main()
