"""Mission domain contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from agcc.domain.common import _require_utc, _validate_id
from agcc.domain.enums import MissionStatus


class DownlinkMission(BaseModel):
    """A fixed-volume downlink mission with a hard deadline and budget cap."""

    model_config = {"frozen": True}

    mission_id: str = Field(description="Unique mission ID (prefix: mission_)")
    name: str = Field(min_length=1)
    required_volume_mb: float = Field(
        gt=0.0, description="Required data volume in decimal megabytes"
    )
    deadline: datetime = Field(description="Hard deadline (UTC)")
    max_budget_usd: float = Field(ge=0.0, description="Maximum allowable cost in USD")
    status: MissionStatus = MissionStatus.PENDING

    @field_validator("mission_id", mode="before")
    @classmethod
    def _check_id(cls, v: Any) -> Any:
        return _validate_id("mission_", v)

    @field_validator("deadline", mode="before")
    @classmethod
    def _check_deadline(cls, v: Any) -> Any:
        return _require_utc(v)


class ScenarioConstraints(BaseModel):
    """Hard constraints that govern planning for a scenario."""

    model_config = {"frozen": True}

    max_budget_usd: float = Field(ge=0.0)
    deadline: datetime

    @field_validator("deadline", mode="before")
    @classmethod
    def _check_deadline(cls, v: Any) -> Any:
        return _require_utc(v)


class Scenario(BaseModel):
    """Root aggregate binding satellite, stations, mission, and constraints."""

    model_config = {"frozen": True}

    scenario_id: str = Field(description="Unique scenario ID (prefix: scenario_)")
    name: str = Field(min_length=1)
    satellite_id: str
    station_ids: list[str] = Field(min_length=1)
    mission_id: str
    constraints: ScenarioConstraints

    @field_validator("scenario_id", mode="before")
    @classmethod
    def _check_id(cls, v: Any) -> Any:
        return _validate_id("scenario_", v)
