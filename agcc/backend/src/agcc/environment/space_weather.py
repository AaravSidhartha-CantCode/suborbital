"""Space-weather provider protocol and implementations.

SpaceWeatherSnapshot is stored for display and anomaly context only.
This module must not assign capacity multipliers.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from agcc.domain.environment import SpaceWeatherSnapshot, canonical_payload_hash
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


def _verify_space_weather_hash(record: dict[str, Any]) -> None:
    """Verify that record['raw_payload_hash'] matches canonical_payload_hash(record)."""
    stored = record.get("raw_payload_hash", "")
    expected = canonical_payload_hash(record)
    if stored != expected:
        snapshot_id = record.get("snapshot_id", "<unknown>")
        raise ValueError(
            f"raw_payload_hash mismatch for space-weather snapshot '{snapshot_id}': "
            f"stored='{stored}', expected='{expected}'"
        )


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
            _verify_space_weather_hash(raw)
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
            _verify_space_weather_hash(raw)
            snap = SpaceWeatherSnapshot.model_validate(raw)
            if snap.valid_until <= start or snap.valid_from >= end:
                continue
            result.append(snap)
        result.sort(key=lambda s: s.valid_from)
        return result


class NotConfiguredLiveSpaceWeatherProvider:
    """Placeholder that always raises SpaceWeatherUnavailable.

    Required configuration (not supplied here):
      - AGCC_SPACE_WEATHER_API_URL: endpoint for live space-weather data
      - AGCC_SPACE_WEATHER_API_KEY: API key for authentication
    """

    REQUIRED_CONFIG_NAMES: tuple[str, ...] = (
        "AGCC_SPACE_WEATHER_API_URL",
        "AGCC_SPACE_WEATHER_API_KEY",
    )

    async def snapshots_for(
        self,
        start: datetime,
        end: datetime,
    ) -> list[SpaceWeatherSnapshot]:
        raise SpaceWeatherUnavailable(
            external_data_unavailable(_SPACE_WEATHER_LIVE_NOT_CONFIGURED)
        )
