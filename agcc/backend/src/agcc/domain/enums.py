"""AGCC authoritative enumerations."""

from enum import Enum


class OrbitInputMode(str, Enum):
    CUSTOM_CIRCULAR = "custom_circular"


class Band(str, Enum):
    S = "S"
    X = "X"
    KA = "Ka"
    UHF = "UHF"
    VHF = "VHF"


class PassStatus(str, Enum):
    CANDIDATE = "candidate"
    ELIGIBLE = "eligible"
    PLANNED = "planned"
    COMMITTED = "committed"
    EXECUTED = "executed"
    UNUSED = "unused"
    CANCELLED = "cancelled"


class ContactCommitment(str, Enum):
    NONE = "none"
    PLANNED = "planned"
    COMMITTED = "committed"


class MissionStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"
    INFEASIBLE = "infeasible"


class EventType(str, Enum):
    CONTACT_STARTED = "contact_started"
    CONTACT_ENDED = "contact_ended"
    FRAGMENT_DELIVERED = "fragment_delivered"
    ANOMALY_DETECTED = "anomaly_detected"
    PLAN_REVISED = "plan_revised"
    SIMULATION_STARTED = "simulation_started"
    SIMULATION_ENDED = "simulation_ended"


class AnomalyType(str, Enum):
    WEATHER = "weather"
    LINK_DEGRADATION = "link_degradation"
    STATION_UNAVAILABLE = "station_unavailable"
    SATELLITE_ATTITUDE = "satellite_attitude"
    OTHER = "other"


class ProposalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"


class SourceType(str, Enum):
    MANUAL = "manual"
    CATALOG = "catalog"
    FORECAST = "forecast"
    MEASURED = "measured"
    DERIVED = "derived"
    NOT_CONFIGURED = "not_configured"


class RejectionCode(str, Enum):
    BUDGET_EXCEEDED = "budget_exceeded"
    DEADLINE_MISSED = "deadline_missed"
    INCOMPATIBLE_BAND = "incompatible_band"
    STATION_UNAVAILABLE = "station_unavailable"
    BELOW_ELEVATION = "below_elevation"
    INFEASIBLE = "infeasible"
    POLICY = "policy"


class SimulationMode(str, Enum):
    NOMINAL = "nominal"
    REPLAY = "replay"


class CostModel(str, Enum):
    NONE = "none"
    PER_MINUTE = "per_minute"
    PER_CONTACT_PLUS_MINUTE = "per_contact_plus_minute"


class SourceKind(str, Enum):
    FIXTURE = "fixture"
    RECORDED = "recorded"
    LIVE = "live"


class SourceQuality(str, Enum):
    VERIFIED = "verified"
    STALE = "stale"
    ASSUMED = "assumed"
    UNAVAILABLE = "unavailable"
