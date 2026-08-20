"""Planning domain contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from agcc.domain.common import _require_utc, _validate_id
from agcc.domain.enums import ContactCommitment, PassStatus, RejectionCode


class CandidatePass(BaseModel):
    """A geometrically visible satellite-station interval."""

    model_config = {"frozen": True}

    pass_id: str = Field(description="Unique pass ID (prefix: pass_); deterministic hash-derived")
    scenario_id: str = ""
    satellite_id: str
    station_id: str

    # Timing
    start_at: datetime = Field(description="Rise time: elevation first crosses threshold (UTC)")
    peak_at: datetime = Field(description="Time of maximum elevation (UTC)")
    end_at: datetime = Field(description="Set time: elevation falls back below threshold (UTC)")
    duration_s: float = Field(ge=0.0, description="Total pass duration in seconds")
    usable_duration_s: float = Field(
        ge=0.0, description="Usable duration after setup/teardown subtracted in seconds"
    )

    # Geometry
    max_elevation_deg: float = Field(ge=0.0, le=90.0)
    azimuth_start_deg: float = Field(ge=0.0, lt=360.0)
    azimuth_peak_deg: float = Field(ge=0.0, lt=360.0)
    azimuth_end_deg: float = Field(ge=0.0, lt=360.0)
    slant_range_peak_km: float = Field(gt=0.0)
    minimum_elevation_deg: float = Field(ge=0.0, le=90.0)

    # Versioning
    orbit_model_version: str = ""
    station_catalog_version: str = ""

    status: PassStatus = PassStatus.CANDIDATE

    @field_validator("pass_id", mode="before")
    @classmethod
    def _check_id(cls, v: Any) -> Any:
        return _validate_id("pass_", v)

    @field_validator("start_at", "peak_at", "end_at", mode="before")
    @classmethod
    def _check_times(cls, v: Any) -> Any:
        return _require_utc(v)


class CapacityEstimate(BaseModel):
    """Estimated physical transfer capacity for a pass."""

    model_config = {"frozen": True}

    capacity_id: str = Field(description="Unique capacity ID (prefix: capacity_)")
    pass_id: str
    estimated_rate_mbps: float = Field(ge=0.0, description="Estimated transfer rate in Mbit/s")
    estimated_capacity_mb: float = Field(
        ge=0.0, description="Estimated transferable volume in decimal MB"
    )
    duration_seconds: float = Field(ge=0.0)

    @field_validator("capacity_id", mode="before")
    @classmethod
    def _check_id(cls, v: Any) -> Any:
        return _validate_id("capacity_", v)


class FeasibilityResult(BaseModel):
    """Outcome of a feasibility check against hard constraints."""

    model_config = {"frozen": True}

    is_feasible: bool
    planned_volume_mb: float = Field(ge=0.0)
    planned_cost_usd: float = Field(ge=0.0)
    rejection_codes: list[RejectionCode] = Field(default_factory=list)
    message: str = ""


class PlannedAllocation(BaseModel):
    """Assignment of a data fragment to a planned or committed contact."""

    model_config = {"frozen": True}

    contact_id: str = Field(description="Unique contact ID (prefix: contact_)")
    pass_id: str
    allocated_volume_mb: float = Field(ge=0.0)
    commitment: ContactCommitment = ContactCommitment.PLANNED
    cost_usd: float = Field(ge=0.0)

    @field_validator("contact_id", mode="before")
    @classmethod
    def _check_id(cls, v: Any) -> Any:
        return _validate_id("contact_", v)


class ContactPlan(BaseModel):
    """A versioned ordered list of planned allocations for a scenario."""

    model_config = {"frozen": True}

    plan_id: str = Field(description="Unique plan ID (prefix: plan_)")
    scenario_id: str
    version: int = Field(ge=0)
    allocations: list[PlannedAllocation] = Field(default_factory=list)
    feasibility: FeasibilityResult

    @field_validator("plan_id", mode="before")
    @classmethod
    def _check_id(cls, v: Any) -> Any:
        return _validate_id("plan_", v)


class PlanDiff(BaseModel):
    """Describes changes between two plan versions."""

    model_config = {"frozen": True}

    from_version: int = Field(ge=0)
    to_version: int = Field(ge=0)
    added_contact_ids: list[str] = Field(default_factory=list)
    removed_contact_ids: list[str] = Field(default_factory=list)
    modified_contact_ids: list[str] = Field(default_factory=list)
