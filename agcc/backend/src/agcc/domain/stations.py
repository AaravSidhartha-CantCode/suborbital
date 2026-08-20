"""Ground station domain contracts."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from agcc.domain.common import _validate_id
from agcc.domain.enums import Band, CostModel


class FieldProvenance(BaseModel):
    """Field-level provenance: maps field names to source/assumption notes."""

    model_config = {"frozen": True}

    # Maps field name -> short description of source or assumption
    sources: dict[str, str] = Field(default_factory=dict)
    assumptions: list[str] = Field(default_factory=list)


class GroundStation(BaseModel):
    """A ground station capable of receiving satellite downlink."""

    model_config = {"frozen": True}

    station_id: str = Field(description="Unique station ID (prefix: station_)")
    name: str = Field(min_length=1)
    provider_id: str = Field(min_length=1, description="Identifier of the station provider")

    # Coordinates — must be sourced facts or explicitly marked simulation assumptions
    latitude_deg: float = Field(ge=-90.0, le=90.0, description="Geodetic latitude in degrees")
    longitude_deg: float = Field(
        ge=-180.0, le=180.0, description="Geodetic longitude in degrees"
    )
    altitude_m: float = Field(ge=0.0, description="Altitude above WGS-84 ellipsoid in meters")

    # RF capability — required for planner eligibility
    supported_bands: frozenset[Band] = Field(
        description="Supported frequency bands (must be non-empty for planner eligibility)"
    )
    max_downlink_rate_mbps: float = Field(
        gt=0.0, description="Station maximum downlink rate in Mbit/s"
    )
    minimum_elevation_deg: float = Field(
        ge=0.0, le=90.0, description="Station minimum elevation mask in degrees"
    )

    # Contact timing
    setup_s: int = Field(ge=0, description="Setup time in seconds before contact")
    teardown_s: int = Field(ge=0, description="Teardown time in seconds after contact")

    # Cost model
    cost_model: CostModel = CostModel.NONE
    booking_cost: float = Field(ge=0.0, description="Fixed per-contact booking cost")
    cost_per_minute: float = Field(ge=0.0, description="Variable cost per contact minute")
    currency: str = Field(default="USD", min_length=1)

    # MVP constraint
    simultaneous_contacts: int = Field(
        default=1, ge=1, le=1, description="Fixed at 1 for MVP"
    )

    # Field-level provenance
    field_provenance: FieldProvenance = Field(default_factory=FieldProvenance)

    # Operational flags
    enabled: bool = True

    @field_validator("station_id", mode="before")
    @classmethod
    def _check_id(cls, v: Any) -> Any:
        return _validate_id("station_", v)

    @model_validator(mode="after")
    def _check_coordinates_sourced(self) -> GroundStation:
        """Coordinates must either be sourced facts or explicitly listed as assumptions."""
        coord_fields = {"latitude_deg", "longitude_deg", "altitude_m"}
        sourced = set(self.field_provenance.sources.keys())
        assumed = set(self.field_provenance.assumptions)
        for field in coord_fields:
            if field not in sourced and field not in assumed:
                raise ValueError(
                    f"Coordinate field '{field}' must be listed in field_provenance.sources "
                    f"or field_provenance.assumptions"
                )
        return self

    @property
    def planner_eligible(self) -> bool:
        """True when the station has sufficient data for the planner."""
        return bool(self.supported_bands) and self.max_downlink_rate_mbps > 0.0


class StationCatalog(BaseModel):
    """An ordered collection of ground stations."""

    model_config = {"frozen": True}

    stations: list[GroundStation] = Field(default_factory=list)


class StationSelection(BaseModel):
    """Authorization parameters for ground station selection in a scenario."""

    model_config = {"frozen": True}

    allow_all_eligible: bool = False
    authorized_station_ids: frozenset[str] = Field(default_factory=frozenset)
    authorized_provider_ids: frozenset[str] = Field(default_factory=frozenset)
    excluded_station_ids: frozenset[str] = Field(default_factory=frozenset)
