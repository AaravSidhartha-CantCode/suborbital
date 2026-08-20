"""Station catalog loading and the external-provider protocol.

The catalog loader reads a JSON file whose schema matches the StationCatalog
domain contract. The NotConfiguredStationCatalogProvider raises
ExternalDataUnavailable with code STATION_CATALOG_NOT_CONFIGURED.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

from agcc.domain.errors import DomainError, external_data_unavailable
from agcc.domain.stations import GroundStation, StationCatalog

_CATALOG_NOT_CONFIGURED_SOURCE = "STATION_CATALOG_NOT_CONFIGURED"


class ExternalDataUnavailable(Exception):
    """Raised when an external data source is not available."""

    def __init__(self, error: DomainError) -> None:
        super().__init__(error.message)
        self.error = error


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------

class StationCatalogProvider(Protocol):
    """Abstract interface for obtaining a station catalog."""

    def load(self) -> StationCatalog:
        """Return the current station catalog."""
        ...


# ---------------------------------------------------------------------------
# Not-configured placeholder
# ---------------------------------------------------------------------------

class NotConfiguredStationCatalogProvider:
    """Placeholder raised when no real catalog provider has been wired up."""

    def load(self) -> StationCatalog:
        raise ExternalDataUnavailable(
            external_data_unavailable(_CATALOG_NOT_CONFIGURED_SOURCE)
        )


# ---------------------------------------------------------------------------
# JSON file loader
# ---------------------------------------------------------------------------

def load_catalog_from_file(path: Path) -> StationCatalog:
    """Load and validate a StationCatalog from a JSON file.

    Stations are sorted deterministically by station_id after loading.
    Raises ValueError if the file cannot be parsed or any station is invalid.
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    stations_raw: list[object] = raw.get("stations", [])
    stations = [GroundStation.model_validate(s) for s in stations_raw]
    stations.sort(key=lambda s: s.station_id)

    # Build catalog — pass all top-level fields from the JSON file
    return StationCatalog.model_validate({
        **{k: v for k, v in raw.items() if k not in ("stations", "_comment")},
        "stations": [s.model_dump(mode="python") for s in stations],
    })
