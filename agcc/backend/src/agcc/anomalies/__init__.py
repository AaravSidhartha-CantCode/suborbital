"""Deterministic anomaly proposal and confirmation boundary (Task 13)."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, Field, field_validator

from agcc.domain.common import _require_utc
from agcc.domain.enums import AnomalyType, ProposalStatus


class AnomalyContext(BaseModel):
    scenario_id: str
    station_ids: list[str]
    station_names: dict[str, str] = Field(default_factory=dict)
    contact_ids: list[str]
    simulation_time: datetime

    @field_validator("simulation_time", mode="before")
    @classmethod
    def utc_time(cls, value: object) -> object:
        return _require_utc(value)  # type: ignore[arg-type]


class ParsedAnomalyIntent(BaseModel):
    anomaly_type: AnomalyType | None = None
    station_id: str | None = None
    contact_id: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    qualitative_severity: str | None = None
    explicit_reduction_pct: float | None = Field(default=None, gt=0.0, le=100.0)
    explicit_delay_s: int | None = Field(default=None, gt=0)
    missing_fields: list[str] = Field(default_factory=list)

    @field_validator("starts_at", "ends_at", mode="before")
    @classmethod
    def utc_times(cls, value: object) -> object:
        return value if value is None else _require_utc(value)  # type: ignore[arg-type]


class AnomalyIntentParser(Protocol):
    async def parse(self, text: str, context: AnomalyContext) -> ParsedAnomalyIntent: ...


class GraniteAnomalyNotConfigured(RuntimeError):
    code = "GRANITE_ANOMALY_NOT_CONFIGURED"


class NotConfiguredGraniteAnomalyParser:
    async def parse(self, text: str, context: AnomalyContext) -> ParsedAnomalyIntent:
        del text, context
        raise GraniteAnomalyNotConfigured("Granite anomaly parsing is not configured")


class StructuredAnomalyInput(BaseModel):
    anomaly_type: AnomalyType
    station_id: str | None = None
    contact_id: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    explicit_reduction_pct: float | None = Field(default=None, gt=0.0, le=100.0)
    explicit_delay_s: int | None = Field(default=None, gt=0)
    source_text: str = Field(min_length=1)


class AnomalyProposalRecord(BaseModel):
    proposal_id: str
    scenario_id: str
    intent: ParsedAnomalyIntent
    status: ProposalStatus
    clarification_questions: list[str]
    rate_multiplier: float | None = Field(default=None, ge=0.0, le=1.0)
    delay_s: int | None = Field(default=None, gt=0)
    source_text: str
    created_at: datetime


class ActiveAnomaly(BaseModel):
    anomaly_id: str
    proposal_id: str
    scenario_id: str
    anomaly_type: AnomalyType
    station_id: str | None
    contact_id: str | None
    rate_multiplier: float
    delay_s: int | None
    confirmed_at: datetime


class AnomalyPolicyTable:
    def __init__(self, path: Path) -> None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        self.schema_version = str(payload["schema_version"])
        self.policies: dict[str, dict[str, object]] = payload["policies"]

    @classmethod
    def default(cls) -> AnomalyPolicyTable:
        path = (
            Path(__file__).resolve().parents[4]
            / "data"
            / "fixtures"
            / "anomalies"
            / "policies.json"
        )
        return cls(path)

    def resolve(self, intent: ParsedAnomalyIntent) -> tuple[float | None, int | None]:
        if intent.anomaly_type is None:
            return None, None
        policy = self.policies[intent.anomaly_type.value]
        if not bool(policy["enabled"]):
            return None, None
        if intent.anomaly_type == AnomalyType.STATION_OUTAGE:
            return 0.0, None
        if intent.anomaly_type == AnomalyType.RATE_DEGRADATION:
            reduction = intent.explicit_reduction_pct
            if reduction is None and intent.qualitative_severity:
                severity = policy.get("severity_reduction_pct", {})
                assert isinstance(severity, dict)
                reduction = float(severity.get(intent.qualitative_severity.lower(), 0.0))
            if not reduction:
                return None, None
            return 1.0 - reduction / 100.0, None
        if intent.anomaly_type == AnomalyType.CONTACT_DELAY:
            return 1.0, intent.explicit_delay_s
        return None, None


class AnomalyService:
    def __init__(self, policies: AnomalyPolicyTable | None = None) -> None:
        self.policies = policies or AnomalyPolicyTable.default()
        self.proposals: dict[str, AnomalyProposalRecord] = {}
        self.active: dict[str, ActiveAnomaly] = {}

    def propose_structured(
        self,
        scenario_id: str,
        data: StructuredAnomalyInput,
        context: AnomalyContext,
        created_at: datetime,
    ) -> AnomalyProposalRecord:
        intent = ParsedAnomalyIntent(
            anomaly_type=data.anomaly_type,
            station_id=data.station_id,
            contact_id=data.contact_id,
            starts_at=data.starts_at,
            ends_at=data.ends_at,
            explicit_reduction_pct=data.explicit_reduction_pct,
            explicit_delay_s=data.explicit_delay_s,
        )
        return self._propose(scenario_id, data.source_text, intent, context, created_at)

    async def propose_text(
        self,
        scenario_id: str,
        text: str,
        context: AnomalyContext,
        parser: AnomalyIntentParser,
        created_at: datetime,
    ) -> AnomalyProposalRecord:
        intent = await parser.parse(text, context)
        return self._propose(scenario_id, text, intent, context, created_at)

    def _propose(
        self,
        scenario_id: str,
        source_text: str,
        intent: ParsedAnomalyIntent,
        context: AnomalyContext,
        created_at: datetime,
    ) -> AnomalyProposalRecord:
        questions = _clarification_questions(intent, context, self.policies)
        multiplier, delay_s = self.policies.resolve(intent)
        status = ProposalStatus.NEEDS_CLARIFICATION if questions else ProposalStatus.PENDING
        digest = hashlib.sha256(
            f"{scenario_id}|{source_text}|{created_at.isoformat()}".encode()
        ).hexdigest()[:16]
        proposal = AnomalyProposalRecord(
            proposal_id=f"proposal_{digest}",
            scenario_id=scenario_id,
            intent=intent,
            status=status,
            clarification_questions=questions,
            rate_multiplier=multiplier,
            delay_s=delay_s,
            source_text=source_text,
            created_at=created_at,
        )
        self.proposals[proposal.proposal_id] = proposal
        return proposal

    def confirm(self, proposal_id: str, confirmed_at: datetime) -> ActiveAnomaly:
        proposal = self.proposals[proposal_id]
        if proposal.status != ProposalStatus.PENDING:
            raise ValueError("Only a complete pending proposal may be confirmed")
        if proposal.intent.anomaly_type is None or proposal.rate_multiplier is None:
            raise ValueError("Proposal has no deterministic numerical effect")
        anomaly_id = proposal.proposal_id.replace("proposal_", "anomaly_", 1)
        active = ActiveAnomaly(
            anomaly_id=anomaly_id,
            proposal_id=proposal.proposal_id,
            scenario_id=proposal.scenario_id,
            anomaly_type=proposal.intent.anomaly_type,
            station_id=proposal.intent.station_id,
            contact_id=proposal.intent.contact_id,
            rate_multiplier=proposal.rate_multiplier,
            delay_s=proposal.delay_s,
            confirmed_at=confirmed_at,
        )
        self.proposals[proposal_id] = proposal.model_copy(
            update={"status": ProposalStatus.CONFIRMED}
        )
        self.active[active.anomaly_id] = active
        return active


def _clarification_questions(
    intent: ParsedAnomalyIntent,
    context: AnomalyContext,
    policies: AnomalyPolicyTable,
) -> list[str]:
    questions: list[str] = []
    if intent.anomaly_type is None:
        questions.append("Which supported anomaly type should be simulated?")
        return questions
    policy = policies.policies[intent.anomaly_type.value]
    if not bool(policy["enabled"]):
        questions.append(
            f"The {intent.anomaly_type.value} policy is disabled pending approved data."
        )
    if intent.anomaly_type == AnomalyType.STATION_OUTAGE and not intent.station_id:
        questions.append("Which station is unavailable?")
    if intent.station_id and intent.station_id not in context.station_ids:
        questions.append("Select a station from the current scenario.")
    if (
        intent.anomaly_type == AnomalyType.RATE_DEGRADATION
        and intent.explicit_reduction_pct is None
        and not intent.qualitative_severity
    ):
        questions.append("How severe is the degradation (low, medium, high, or severe)?")
    if intent.anomaly_type == AnomalyType.CONTACT_DELAY and intent.explicit_delay_s is None:
        questions.append("What explicit contact delay in seconds should be applied?")
    return questions


__all__ = [
    "ActiveAnomaly",
    "AnomalyContext",
    "AnomalyIntentParser",
    "AnomalyPolicyTable",
    "AnomalyProposalRecord",
    "AnomalyService",
    "GraniteAnomalyNotConfigured",
    "NotConfiguredGraniteAnomalyParser",
    "ParsedAnomalyIntent",
    "StructuredAnomalyInput",
]
