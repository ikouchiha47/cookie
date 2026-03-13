"""DSPy Modules for cooking guide inference.

A Module describes the agent — who it is, how it reasons across steps.
A Signature describes a single task — inputs, outputs, and rules.
"""

import dspy

from cookie.reasoning.signatures import DiscoverIngredients, ObserveCooking


class DiscoveryAgent(dspy.Module):
    """Kitchen scout agent. Observes a camera frame and surfaces what the user
    has available, then reasons about what they could make with it.

    <agent.identity>
    You are an attentive kitchen scout. You scan the visible scene carefully,
    cataloguing every ingredient, tool, and packaged item you can see. You do not
    guess at what might be in cupboards or off-camera — only what is visible.
    </agent.identity>

    <agent.process>
    1. Observe the frame and list everything visible.
    2. Cross-reference with any user hint to bias suggestions.
    3. Propose 2-3 practical recipes that could be made right now.
    4. Rate your confidence honestly — if ingredients are partial, say medium/low.
    </agent.process>
    """

    def __init__(self):
        super().__init__()
        self.observe = dspy.ChainOfThought(DiscoverIngredients)

    def forward(
        self,
        image: dspy.Image,
        user_hint: str = "",
        history: str = "",
    ) -> dspy.Prediction:
        return self.observe(image=image, user_hint=user_hint, history=history)

    async def aforward(
        self,
        image: dspy.Image,
        user_hint: str = "",
        history: str = "",
    ) -> dspy.Prediction:
        return await self.observe.acall(image=image, user_hint=user_hint, history=history)


class CookingAgent(dspy.Module):
    """Real-time cooking oversight agent. Watches a live camera frame during active
    cooking and decides whether to speak, what to say, and how urgently to check again.

    <agent.identity>
    You are a calm, experienced sous-chef watching over someone's shoulder as they cook.
    You see every frame but only speak when it matters — a good sous-chef does not
    narrate every stir. You notice problems early, celebrate completions, and stay
    silent during normal progress.
    </agent.identity>

    <agent.process>
    1. Compare the current frame against the expected visual state for this step.
    2. Check for safety concerns first — burning, boiling over, dangerous handling.
    3. If the step looks complete, signal done. If clearly wrong, provide correction.
    4. If everything looks fine, stay silent (empty guidance string).
    5. Set criticality based on risk: high only when something is about to go wrong.
    6. Name the next visual transition to watch for so the loop stays focused.
    </agent.process>
    """

    def __init__(self):
        super().__init__()
        self.observe = dspy.ChainOfThought(ObserveCooking)

    def forward(
        self,
        image: dspy.Image,
        recipe_title: str,
        step_instruction: str,
        expected_visual_state: str,
        expected_texture: str = "",
        expected_taste_smell: str = "",
        watch_for: str = "",
    ) -> dspy.Prediction:
        return self.observe(
            image=image,
            recipe_title=recipe_title,
            step_instruction=step_instruction,
            expected_visual_state=expected_visual_state,
            expected_texture=expected_texture,
            expected_taste_smell=expected_taste_smell,
            watch_for=watch_for,
        )
