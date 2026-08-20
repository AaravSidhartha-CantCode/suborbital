"""Weather attenuation model: protocol and implementations.

The production configured model raises WEATHER_ATTENUATION_TABLE_MISSING until
the team supplies approved coefficients in the versioned JSON lookup table.

NoWeatherAttenuationModel is allowed in tests only and must be flagged as an
assumption in every CapacityEstimate that uses it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

# ---------------------------------------------------------------------------
# Sentinel error code
# ---------------------------------------------------------------------------

WEATHER_ATTENUATION_TABLE_MISSING = "WEATHER_ATTENUATION_TABLE_MISSING"

# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


class WeatherAttenuationModel(Protocol):
    """Returns a dimensionless attenuation factor in [0, 1]."""

    def factor(
        self,
        frequency_ghz: float,
        elevation_deg: float,
        precipitation_mm_per_hr: float,
    ) -> float:
        """Return attenuation factor in [0, 1].

        A factor of 1.0 means no attenuation.
        A factor of 0.0 means total attenuation.
        Must raise ValueError if the returned value is outside [0, 1].
        """
        ...


# ---------------------------------------------------------------------------
# No-weather model — test use only
# ---------------------------------------------------------------------------


class NoWeatherAttenuationModel:
    """Always returns factor 1.0 (no attenuation).

    PERMITTED IN TESTS ONLY.  Any CapacityEstimate computed with this model
    must include "NoWeatherAttenuationModel" in its assumptions list.
    """

    ASSUMPTION_LABEL = "NoWeatherAttenuationModel"

    def factor(
        self,
        frequency_ghz: float,
        elevation_deg: float,
        precipitation_mm_per_hr: float,
    ) -> float:
        return 1.0


# ---------------------------------------------------------------------------
# Configured model — production
# ---------------------------------------------------------------------------


class ConfiguredWeatherAttenuationModel:
    """Looks up attenuation factor from a versioned JSON table.

    Table format (JSON):
    {
      "version": "<string>",
      "entries": [
        {
          "freq_min_ghz": <float>,
          "freq_max_ghz": <float>,
          "rain_min_mm_per_hr": <float>,
          "rain_max_mm_per_hr": <float>,
          "elev_min_deg": <float>,
          "elev_max_deg": <float>,
          "factor": <float in [0,1]>
        },
        ...
      ]
    }

    Lookup: find the first entry whose ranges include the three input values.
    If no entry matches, raise ValueError.
    All factor values outside [0, 1] are rejected at load time.
    The model is immutable once loaded.
    """

    def __init__(self, table_path: Path) -> None:
        raw = json.loads(table_path.read_text(encoding="utf-8"))
        self._version: str = raw["version"]
        self._entries: list[dict[str, float]] = raw["entries"]
        # Validate all factors at load time
        for entry in self._entries:
            f = entry["factor"]
            if not (0.0 <= f <= 1.0):
                raise ValueError(
                    f"Weather attenuation table contains factor {f} outside [0, 1] "
                    f"in table version '{self._version}'"
                )

    @property
    def version(self) -> str:
        return self._version

    def factor(
        self,
        frequency_ghz: float,
        elevation_deg: float,
        precipitation_mm_per_hr: float,
    ) -> float:
        for entry in self._entries:
            rain_ok = (
                entry["rain_min_mm_per_hr"]
                <= precipitation_mm_per_hr
                <= entry["rain_max_mm_per_hr"]
            )
            if (
                entry["freq_min_ghz"] <= frequency_ghz <= entry["freq_max_ghz"]
                and rain_ok
                and entry["elev_min_deg"] <= elevation_deg <= entry["elev_max_deg"]
            ):
                return float(entry["factor"])
        raise ValueError(
            f"No attenuation entry matches frequency={frequency_ghz} GHz, "
            f"elevation={elevation_deg} deg, rain={precipitation_mm_per_hr} mm/hr "
            f"in table version '{self._version}'"
        )


# ---------------------------------------------------------------------------
# Not-configured placeholder — production default until table is supplied
# ---------------------------------------------------------------------------


class NotConfiguredWeatherAttenuationModel:
    """Blocks calculation until approved attenuation coefficients are provided.

    Required configuration (not supplied here):
      - A weather_attenuation.json file with approved scientific coefficients.

    Raises RuntimeError with WEATHER_ATTENUATION_TABLE_MISSING on any call to
    factor(), preventing silent use of uninitialised physics.
    """

    def factor(
        self,
        frequency_ghz: float,
        elevation_deg: float,
        precipitation_mm_per_hr: float,
    ) -> float:
        raise RuntimeError(
            f"{WEATHER_ATTENUATION_TABLE_MISSING}: Production weather attenuation "
            "coefficients have not been provided. Supply a versioned "
            "weather_attenuation.json table to use ConfiguredWeatherAttenuationModel."
        )
