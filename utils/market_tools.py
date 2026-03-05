"""
KilimoSmart Maize – Market / Negotiation Module
=================================================
Implements Kenyan maize grading (KEBS EAS 2:2017-aligned) and
KES price negotiation logic for the marketplace.

Grade 1 (Premium)  : Healthy grain → base + 5 %  (KES bonus)
Grade 2 (Standard) : Minor disease detected → base price (no adjustment)
Grade 3 (Reject)   : Severe disease → base − 20 % (animal-feed channel)
"""

from __future__ import annotations

from typing import Dict, Tuple

# ---------------------------------------------------------------------------
# Bilingual explanation templates
# ---------------------------------------------------------------------------
_EXPLANATIONS: Dict[int, Dict[str, str]] = {
    1: {
        "en": (
            "Grade 1 – Premium: Clean, disease-free maize. "
            "You earned a 5 % bonus above the base price."
        ),
        "sw": (
            "Daraja 1 – Bora: Mahindi safi, bila magonjwa. "
            "Umepata bonasi ya 5 % zaidi ya bei ya msingi."
        ),
    },
    2: {
        "en": (
            "Grade 2 – Standard: Minor infection detected ({disease}). "
            "Accepted at the market base price with no adjustment."
        ),
        "sw": (
            "Daraja 2 – Kawaida: Ugonjwa mdogo umegunduliwa ({disease}). "
            "Imekubaliwa kwa bei ya msingi ya soko bila marekebisho."
        ),
    },
    3: {
        "en": (
            "Grade 3 – Reject: Significant quality issue ({disease}). "
            "Routed to animal-feed channel at −20 % discount."
        ),
        "sw": (
            "Daraja 3 – Imekataliwa: Tatizo kubwa la ubora ({disease}). "
            "Imeelekezwa kwa malisho ya wanyama kwa punguzo la 20 %."
        ),
    },
}

# ---------------------------------------------------------------------------
# Grading rules
# ---------------------------------------------------------------------------
_GRADE_MAP: Dict[str, int] = {
    "Healthy": 1,
    "Common Rust": 2,
    "Gray Leaf Spot": 2,
    "Northern Leaf Blight": 3,
}

_GRADE_ADJUSTMENTS: Dict[int, float] = {
    1: 0.05,   # +5 %
    2: 0.00,   #  0 %
    3: -0.20,  # −20 %
}


def negotiate_price(
    base_price: float,
    disease_name: str,
    lang: str = "en",
) -> Tuple[int, float, str]:
    """
    Determine the final KES price per 90 kg bag based on AI-detected quality.

    Parameters
    ----------
    base_price : float
        Miller's quoted base price in KES.
    disease_name : str
        One of the recognized class names from the vision module.
    lang : str, optional
        ``"en"`` or ``"sw"`` – controls the explanation language (default ``"en"``).

    Returns
    -------
    (grade, final_price_kes, explanation)
    """
    grade = _GRADE_MAP.get(disease_name, 3)
    adjustment = _GRADE_ADJUSTMENTS[grade]
    final_price = round(base_price * (1 + adjustment), 2)

    template = _EXPLANATIONS[grade].get(lang, _EXPLANATIONS[grade]["en"])
    explanation = template.format(disease=disease_name)

    return grade, final_price, explanation