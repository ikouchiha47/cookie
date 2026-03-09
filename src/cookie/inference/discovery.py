"""Discovery phase inference — identify items, suggest recipes."""

from __future__ import annotations

import io
import logging

import dspy
from PIL import Image

from cookie.models import CookingObservation, DiscoveryMessage, RecipeSuggestion, SessionContext
from cookie.reasoning.signatures import DiscoverIngredients
from cookie.transport.ws_server import ClientSession

log = logging.getLogger(__name__)


async def run_discovery(
    frame: bytes,
    context: SessionContext,
    client: ClientSession,
    lm: dspy.LM,
    discover_sig: dspy.ChainOfThought,
) -> None:
    await client.send_thinking()
    try:
        img = Image.open(io.BytesIO(frame))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        image = dspy.Image(buf.getvalue())

        with dspy.context(lm=lm):
            result = discover_sig(image=image, user_hint="")

        items = result.items or []
        if not items:
            log.info("Discovery [%s]: nothing found", client.session_id)
            return

        suggestions = [
            RecipeSuggestion(
                name=s.get("name", ""),
                description=s.get("description", ""),
                confidence=s.get("confidence", "medium"),
            )
            for s in (result.suggestions or [])
        ]
        discovery = DiscoveryMessage(items=items, suggestions=suggestions)
        log.info("Discovery [%s]: items=%s", client.session_id, items)
        await client.send_discovery(discovery)

    except Exception:
        log.exception("Discovery inference failed [%s]", client.session_id)
