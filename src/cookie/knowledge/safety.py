"""Safety knowledge base — dangerous quantities, allergens, recovery strategies."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from cookie.models import Severity, UserProfile


@dataclass
class QuantityLimit:
    safe_max: str
    toxic: str
    effect: str


@dataclass
class AllergenInfo:
    ingredient: str
    contains: list[str]


@dataclass
class MistakeFix:
    conditions: dict[str, str]
    fix: str
    severity: Severity = Severity.WARNING


DANGEROUS_QUANTITIES: dict[str, QuantityLimit] = {
    "nutmeg": QuantityLimit(
        safe_max="1 tsp / 4.5g", toxic="2 tbsp+", effect="myristicin poisoning"
    ),
    "cinnamon": QuantityLimit(
        safe_max="1 tsp / 2.6g", toxic="1 tbsp+ cassia", effect="coumarin liver damage"
    ),
    "salt": QuantityLimit(
        safe_max="2300mg daily", toxic="varies", effect="hypernatremia"
    ),
    "baking soda": QuantityLimit(
        safe_max="1 tsp per recipe", toxic="1 tbsp+", effect="metabolic alkalosis"
    ),
}

ALLERGEN_MAP: dict[str, list[str]] = {
    "peanut_oil": ["peanuts"],
    "soy_sauce": ["soy", "wheat"],
    "fish_sauce": ["fish"],
    "oyster_sauce": ["shellfish"],
    "worcestershire": ["fish", "soy"],
    "tahini": ["sesame"],
    "ghee": ["dairy"],
    "butter": ["dairy"],
    "cream": ["dairy"],
    "milk": ["dairy"],
    "cheese": ["dairy"],
    "yogurt": ["dairy"],
    "eggs": ["eggs"],
    "flour": ["wheat", "gluten"],
    "bread_crumbs": ["wheat", "gluten"],
}

UNSAFE_FOR_GROUPS: dict[str, dict[str, str]] = {
    "raw_honey": {"unsafe_for": "infants < 12 months", "reason": "botulism risk"},
    "raw_eggs": {"unsafe_for": "pregnant, elderly, immunocompromised", "reason": "salmonella"},
    "raw_fish": {"unsafe_for": "pregnant, immunocompromised", "reason": "parasites, bacteria"},
    "alcohol": {"unsafe_for": "pregnant, children", "reason": "fetal alcohol syndrome, intoxication"},
}

MISTAKE_RECOVERY: list[MistakeFix] = [
    MistakeFix(
        conditions={"mistake": "too_much_salt", "state": "liquid, not_full"},
        fix="Add more liquid to dilute, then reduce back down",
    ),
    MistakeFix(
        conditions={"mistake": "too_much_salt", "state": "liquid, full"},
        fix="Add a peeled potato to absorb excess salt, remove after 15 min",
    ),
    MistakeFix(
        conditions={"mistake": "too_much_salt", "state": "baked"},
        fix="Pivot: repurpose as croutons, breadcrumbs, or salad topping",
    ),
    MistakeFix(
        conditions={"mistake": "burnt_bottom", "state": "liquid"},
        fix="Carefully transfer the top portion to a new pot. Do NOT scrape the bottom.",
    ),
    MistakeFix(
        conditions={"mistake": "too_spicy"},
        fix="Add dairy (cream, yogurt), sugar, or acid (lime) to balance heat",
    ),
    MistakeFix(
        conditions={"mistake": "too_thin"},
        fix="Continue reducing, or add a cornstarch slurry (1 tbsp starch + 1 tbsp cold water)",
    ),
    MistakeFix(
        conditions={"mistake": "too_thick"},
        fix="Add small amounts of liquid (stock, water, milk) while stirring",
    ),
    MistakeFix(
        conditions={"mistake": "allergen_added"},
        fix="DISCARD the dish entirely. Cannot safely remove allergens once mixed.",
        severity=Severity.CRITICAL,
    ),
]


class SafetyChecker:
    """Checks quantities, allergens, and household safety constraints."""

    def check_quantity(self, ingredient: str, amount_str: str) -> dict[str, Any] | None:
        """Check if an ingredient quantity is dangerous. Returns warning dict or None."""
        ingredient_lower = ingredient.lower()
        for name, limit in DANGEROUS_QUANTITIES.items():
            if name in ingredient_lower:
                return {
                    "ingredient": ingredient,
                    "amount": amount_str,
                    "safe_max": limit.safe_max,
                    "toxic": limit.toxic,
                    "effect": limit.effect,
                    "severity": "warning",
                }
        return None

    def check_allergens(self, ingredient: str, profile: UserProfile) -> dict[str, Any] | None:
        """Check if ingredient contains user's allergens."""
        ingredient_lower = ingredient.lower().replace(" ", "_")
        allergens_in = ALLERGEN_MAP.get(ingredient_lower, [])

        for allergen in allergens_in:
            if allergen in [a.lower() for a in profile.allergies]:
                return {
                    "ingredient": ingredient,
                    "allergen": allergen,
                    "severity": "critical",
                    "message": f"ALLERGEN ALERT: {ingredient} contains {allergen}",
                }
        return None

    def check_household(self, ingredient: str, profile: UserProfile) -> dict[str, Any] | None:
        """Check ingredient against household safety (infants, pregnancy, etc)."""
        ingredient_lower = ingredient.lower().replace(" ", "_")
        info = UNSAFE_FOR_GROUPS.get(ingredient_lower)
        if not info:
            return None

        unsafe_for_terms = [t.strip().lower() for t in info["unsafe_for"].split(",")]
        for member in profile.household:
            member_lower = member.lower()
            if any(member_lower in term or term in member_lower for term in unsafe_for_terms):
                return {
                    "ingredient": ingredient,
                    "unsafe_for": member,
                    "reason": info["reason"],
                    "severity": "critical",
                }
        return None

    def find_recovery(self, mistake: str, state: str = "") -> list[MistakeFix]:
        """Find recovery strategies for a mistake given current state."""
        results = []
        for fix in MISTAKE_RECOVERY:
            if fix.conditions.get("mistake", "") in mistake:
                if not fix.conditions.get("state") or fix.conditions["state"] in state:
                    results.append(fix)
        return results
