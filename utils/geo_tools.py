"""
KilimoSmart Maize – Geo / Location Module
==========================================
GPS-based nearest-miller lookup using the ``geopy`` library
and the local ``data/millers.csv`` registry.
"""

from __future__ import annotations

import functools
import logging
import pathlib
from typing import Dict, List, Optional

import pandas as pd
from geopy.distance import geodesic

logger = logging.getLogger(__name__)

_CSV_PATH = pathlib.Path("data/millers.csv")


def _to_native(d: dict) -> dict:
    """Convert numpy / pandas scalar types to native Python types for JSON serialisation."""
    return {k: (v.item() if hasattr(v, 'item') else v) for k, v in d.items()}


@functools.lru_cache(maxsize=1)
def _load_millers(csv_path: str = str(_CSV_PATH)) -> pd.DataFrame:
    """Load the millers CSV once and cache it in memory."""
    return pd.read_csv(csv_path, dtype={"contact": str})


def find_nearest_miller(
    user_lat: float,
    user_lon: float,
    csv_path: str = str(_CSV_PATH),
    top_n: int = 1,
) -> Dict | List[Dict]:
    """
    Find the closest miller(s) to the user's GPS coordinates.

    Parameters
    ----------
    user_lat, user_lon : float
        User's latitude and longitude.
    csv_path : str
        Path to the millers CSV file.
    top_n : int
        Number of nearest millers to return (default 1).

    Returns
    -------
    dict  when *top_n == 1* – single miller record with ``distance_km``.
    list[dict]  when *top_n > 1*.
    """
    df = _load_millers(csv_path).copy()

    if df.empty:
        logger.error("Millers CSV is empty or could not be loaded.")
        return {} if top_n == 1 else []

    user_coords = (user_lat, user_lon)
    df["distance_km"] = df.apply(
        lambda row: round(geodesic(user_coords, (row["lat"], row["lon"])).km, 2),
        axis=1,
    )
    df = df.sort_values("distance_km").reset_index(drop=True)

    if top_n == 1:
        return _to_native(df.iloc[0].to_dict())

    return [_to_native(row) for row in df.head(top_n).to_dict(orient="records")]