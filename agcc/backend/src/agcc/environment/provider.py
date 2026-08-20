"""Weather provider protocol and implementations.

Providers normalise all external data into WeatherSnapshot objects.
Core algorithms must never consume raw third-party payloads.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from agcc.domain.environment import WeatherSnapshot, canonical_payload_hash, payload_hash
from agcc.domain.errors import DomainError, external_data_unavailable
from agcc.domain.stations import GroundStation

_WEATHER_LIVE_NOT_CONFIGURED = "WEATHER_LIVE_NOT_CONFIGURED"

# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------

class WeatherUnavailable(Exception):
    """Raised when weather data cannot be obtained."""

    def __init__(self, error: DomainError) -> None:
        super().__init__(error.message)
        self.error = error


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------

class WeatherProvider(Protocol):
    """Abstract interface for weather data providers."""

    async def snapshots_for(
        self,
        station: GroundStation,
        start: datetime,
        end: datetime,
    ) -> list[WeatherSnapshot]:
        """Return all snapshots covering [start, end) for the given station."""
        ...


# ---------------------------------------------------------------------------
# Fixture provider — deterministic, in-process
# ---------------------------------------------------------------------------

class FixtureWeatherProvider:
    """Returns deterministic fixture snapshots loaded from a JSON file.

    The fixture file maps station_id → list of snapshot dicts.
    Snapshots whose valid_until <= start or valid_from >= end are filtered out.
    """

    def __init__(self, fixture_path: Path) -> None:
        raw = json.loads(fixture_path.read_text(encoding="utf-8"))
        self._data: dict[str, list[dict[str, Any]]] = raw.get("stations", {})
        self._path = fixture_path

    async def snapshots_for(
        self,
        station: GroundStation,
        start: datetime,
        end: datetime,
    ) -> list[WeatherSnapshot]:
        raw_list = self._data.get(station.station_id, [])
        result: list[WeatherSnapshot] = []
        for raw in raw_list:
            _verify_weather_hash(raw)
            snap = WeatherSnapshot.model_validate(raw)
            if snap.valid_until <= start or snap.valid_from >= end:
                continue
            result.append(snap)
        result.sort(key=lambda s: s.valid_from)
        return result


# ---------------------------------------------------------------------------
# Recorded provider — load from recorded JSON file
# ---------------------------------------------------------------------------

class RecordedWeatherProvider:
    """Loads normalised snapshots from a recorded-data JSON file.

    The file schema is identical to the fixture format.
    Payloads are hashed at load time to detect changes.
    """

    def __init__(self, recorded_path: Path) -> None:
        raw_text = recorded_path.read_text(encoding="utf-8")
        raw = json.loads(raw_text)
        self._data: dict[str, list[dict[str, Any]]] = raw.get("stations", {})
        self._file_hash = payload_hash(raw_text)

    async def snapshots_for(
        self,
        station: GroundStation,
        start: datetime,
        end: datetime,
    ) -> list[WeatherSnapshot]:
        raw_list = self._data.get(station.station_id, [])
        result: list[WeatherSnapshot] = []
        for raw in raw_list:
            _verify_weather_hash(raw)
            snap = WeatherSnapshot.model_validate(raw)
            if snap.valid_until <= start or snap.valid_from >= end:
                continue
            result.append(snap)
        result.sort(key=lambda s: s.valid_from)
        return result


# ---------------------------------------------------------------------------
# Hash verification helper
# ---------------------------------------------------------------------------

def _verify_weather_hash(record: dict[str, Any]) -> None:
    """Verify that record['raw_payload_hash'] matches canonical_payload_hash(record).

    Raises ValueError on mismatch.
    """
    stored = record.get("raw_payload_hash", "")
    expected = canonical_payload_hash(record)
    if stored != expected:
        snapshot_id = record.get("snapshot_id", "<unknown>")
        raise ValueError(
            f"raw_payload_hash mismatch for snapshot '{snapshot_id}': "
            f"stored='{stored}', expected='{expected}'"
        )


# ---------------------------------------------------------------------------
# Live placeholder — never configured, always raises
# ---------------------------------------------------------------------------

class NotConfiguredLiveWeatherProvider:
    """Placeholder raised when no live weather provider has been wired up.

    Required configuration (not supplied here):
      - WEATHER_API_URL: endpoint for live weather data
      - WEATHER_API_KEY: API key for authentication

    Never contains a URL guess or credential.
    """

    # Names of the required configuration keys — exposed for documentation
    REQUIRED_CONFIG_NAMES: tuple[str, ...] = ("AGCC_WEATHER_API_URL", "AGCC_WEATHER_API_KEY")

    async def snapshots_for(
        self,
        station: GroundStation,
        start: datetime,
        end: datetime,
    ) -> list[WeatherSnapshot]:
        raise WeatherUnavailable(
            external_data_unavailable(_WEATHER_LIVE_NOT_CONFIGURED)
        )
