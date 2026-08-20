"""Orbit domain contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from agcc.domain.common import Provenance, _require_utc, _validate_id
from agcc.domain.enums import OrbitInputMode

# Fixed physical constants — not user-configurable
_ECCENTRICITY: float = 0.0
_ARGUMENT_OF_PERIGEE_DEG: float = 0.0
_EARTH_RADIUS_KM: float = 6378.137
_MU_KM3_S2: float = 398600.4418


class CustomCircularOrbit(BaseModel):
    """Canonical circular-LEO orbit representation."""

    model_config = {"frozen": True}

    altitude_km: float = Field(
        ge=200.0, le=2000.0, description="Orbital altitude in kilometers (200–2000)"
    )
    inclination_deg: float = Field(ge=0.0, le=180.0, description="Inclination in degrees")
    raan_deg: float = Field(
        ge=0.0, lt=360.0, description="Right ascension of ascending node in degrees [0,360)"
    )
    phase_deg: float = Field(
        ge=0.0, lt=360.0, description="Satellite phase (true anomaly) in degrees [0,360)"
    )
    epoch: datetime = Field(description="Epoch of orbital elements (UTC)")

    # Derived — set automatically; must not be supplied independently
    direction: str = Field(default="", description="PROGRADE or RETROGRADE (derived)")

    # Fixed — always equal to the module constants above
    eccentricity: float = Field(default=_ECCENTRICITY, frozen=True)
    argument_of_perigee_deg: float = Field(default=_ARGUMENT_OF_PERIGEE_DEG, frozen=True)
    earth_radius_km: float = Field(default=_EARTH_RADIUS_KM, frozen=True)
    mu_km3_s2: float = Field(default=_MU_KM3_S2, frozen=True)

    input_mode: OrbitInputMode = OrbitInputMode.CUSTOM_CIRCULAR

    @field_validator("epoch", mode="before")
    @classmethod
    def _check_epoch(cls, v: Any) -> Any:
        return _require_utc(v)

    @model_validator(mode="after")
    def _derive_direction(self) -> CustomCircularOrbit:
        derived = "PROGRADE" if self.inclination_deg <= 90.0 else "RETROGRADE"
        object.__setattr__(self, "direction", derived)
        return self


class SatelliteCommunications(BaseModel):
    """Communication system parameters for the satellite."""

    model_config = {"frozen": True}

    downlink_rate_mbps: float = Field(gt=0.0, description="Nominal downlink rate in Mbit/s")
    bands: list[str] = Field(min_length=1, description="Supported frequency bands")
    min_elevation_deg: float = Field(
        ge=0.0, le=90.0, description="Minimum elevation angle for contact in degrees"
    )


class CustomSatellite(BaseModel):
    """Top-level satellite definition."""

    model_config = {"frozen": True}

    satellite_id: str = Field(description="Unique satellite ID (prefix: sat_)")
    name: str = Field(min_length=1)
    orbit: CustomCircularOrbit
    comms: SatelliteCommunications
    provenance: Provenance

    @field_validator("satellite_id", mode="before")
    @classmethod
    def _check_id(cls, v: Any) -> Any:
        return _validate_id("sat_", v)
