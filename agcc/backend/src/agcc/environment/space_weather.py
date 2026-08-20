"""Space-weather provider protocol and implementations.

SpaceWeatherSnapshot is stored for display and anomaly context only.
This module must not assign capacity multipliers.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from agcc.domain.environment import SpaceWeatherSnapshot
from agcc.domain.errors import DomainError, external_data_unavailable

_SPACE_WEATHER_LIVE_NOT_CONFIGURED = "SPACE_WEATHER_LIVE_NOT_CONFIGURED"


class SpaceWeatherUnavailable(Exception):
    """Raised when space-weather data cannot be obtained."""

    def __init__(self, error: DomainError) -> None:
        super().__init__(error.message)
        self.error = error


class SpaceWeatherProvider(Protocol):
    """Abstract interface for space-weather data providers."""

    async def snapshots_for(
        self,
        start: datetime,
        end: datetime,
    ) -> list[SpaceWeatherSnapshot]:
        """Return all snapshots covering [start, end)."""
        ...


class FixtureSpaceWeatherProvider:
    """Returns deterministic fixture snapshots from a JSON file."""

    def __init__(self, fixture_path: Path) -> None:
        raw = json.loads(fixture_path.read_text(encoding="utf-8"))
        self._data: list[dict[str, Any]] = raw.get("snapshots", [])

    async def snapshots_for(
        self,
        start: datetime,
        end: datetime,
    ) -> list[SpaceWeatherSnapshot]:
        result: list[SpaceWeatherSnapshot] = []
        for raw in self._data:
            snap = SpaceWeatherSnapshot.model_validate(raw)
            if snap.valid_until <= start or snap.valid_from >= end:
                continue
            result.append(snap)
        result.sort(key=lambda s: s.valid_from)
        return result


class RecordedSpaceWeatherProvider:
    """Loads normalised snapshots from a recorded-data JSON file."""

    def __init__(self, recorded_path: Path) -> None:
        raw = json.loads(recorded_path.read_text(encoding="utf-8"))
        self._data: list[dict[str, Any]] = raw.get("snapshots", [])

    async def snapshots_for(
        self,
        start: datetime,
        end: datetime,
    ) -> list[SpaceWeatherSnapshot]:
        result: list[SpaceWeatherSnapshot] = []
        for raw in self._data:
            snap = SpaceWeatherSnapshot.model_validate(raw)
            if snap.valid_until <= start or snap.valid_from >= end:
                continue
            result.append(snap)
        result.sort(key=lambda s: s.valid_from)
        return result


class NotConfiguredLiveSpaceWeatherProvider:
    """Placeholder that always raises SpaceWeatherUnavailable.

    Required configuration (not supplied here):
      - SPACE_WEATHER_API_URL: endpoint for live space-weather data
      - SPACE_WEATHER_API_KEY: API key for authentication
    """

    REQUIRED_CONFIG_NAMES: tuple[str, ...] = (
        "SPACE_WEATHER_API_URL",
        "SPACE_WEATHER_API_KEY",
    )

    async def snapshots_for(
        self,
        start: datetime,
        end: datetime,
    ) -> list[SpaceWeatherSnapshot]:
        raise SpaceWeatherUnavailable(
            external_data_unavailable(_SPACE_WEATHER_LIVE_NOT_CONFIGURED)
        )
