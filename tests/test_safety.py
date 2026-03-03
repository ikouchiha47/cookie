"""Tests for safety knowledge base."""

from cookie.knowledge.safety import SafetyChecker
from cookie.models import UserProfile


def test_allergen_check():
    checker = SafetyChecker()
    profile = UserProfile(allergies=["peanuts"])
    result = checker.check_allergens("peanut_oil", profile)
    assert result is not None
    assert result["severity"] == "critical"


def test_allergen_check_safe():
    checker = SafetyChecker()
    profile = UserProfile(allergies=["peanuts"])
    result = checker.check_allergens("olive_oil", profile)
    assert result is None


def test_household_check():
    checker = SafetyChecker()
    profile = UserProfile(household=["infant"])
    result = checker.check_household("raw_honey", profile)
    assert result is not None
    assert result["severity"] == "critical"


def test_quantity_check():
    checker = SafetyChecker()
    result = checker.check_quantity("nutmeg", "3 tbsp")
    assert result is not None
    assert "myristicin" in result["effect"]


def test_recovery():
    checker = SafetyChecker()
    fixes = checker.find_recovery("too_much_salt", "liquid, not_full")
    assert len(fixes) > 0
    assert "dilute" in fixes[0].fix.lower()
