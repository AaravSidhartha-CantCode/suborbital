"""Application service orchestrating domain engines for the HTTP API."""

from __future__ import annotations

import asyncio
import hashlib
import importlib.metadata
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from agcc.api.contracts import (
    AnomalyImpactData,
    AnomalyRequest,
    ApiErrorBody,
    DiagnosticsData,
    EventSubscriptionMessage,
    HorizonRequest,
    OrbitSummaryData,
    ProposalData,
    ScenarioCreateRequest,
    ScenarioValidationData,
)
from agcc.api.events import EventSubscriptionHub
from agcc.api.repository import InMemoryScenarioRepository, ScenarioRuntime
from agcc.capacity.attenuation import ItuRainAttenuationModel, NoWeatherAttenuationModel
from agcc.capacity.engine import CapacityEngine
from agcc.dispatch import DispatchBuilder
from agcc.domain.enums import EventType, ProposalStatus, SourceQuality
from agcc.domain.planning import CapacityEstimate
from agcc.environment.alignment import align_to_pass
from agcc.environment.provider import (
    NotConfiguredLiveWeatherProvider,
    WeatherProvider,
    WeatherUnavailable,
    weather_provider_from_environment,
)
from agcc.environment.space_weather import (
    NotConfiguredLiveSpaceWeatherProvider,
    SpaceWeatherProvider,
    SpaceWeatherUnavailable,
    space_weather_provider_from_environment,
)
from agcc.feasibility import FeasibilityChecker, FeasibilityReport
from agcc.feasibility.builder import EligiblePassBuilder
from agcc.orbit.derived import (
    mean_motion_rad_s,
    period_s,
    revolutions_per_day,
    semi_major_axis_km,
)
from agcc.orbit.propagator import CircularKeplerPropagator
from agcc.passes.engine import PassEngine
from agcc.planner import ALGORITHM_VERSION, ContactPlan, ContactPlanner, PlanStatus
from agcc.simulation import SessionEventStore, SimulationEngine
from agcc.stations.catalog import load_catalog_from_file
from agcc.stations.filtering import filter_stations

ENGINE_VERSION = "agcc-api-1"


class ApiServiceError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        entity_refs: dict[str, str] | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.entity_refs = entity_refs or {}
        self.details = details or {}


class AgccApplicationService:
    """Owns orchestration and runtime state; HTTP routes only delegate here."""

    def __init__(
        self,
        *,
        repository: InMemoryScenarioRepository | None = None,
        fixture_mode: bool = False,
        catalog_path: Path | None = None,
        subscriptions: EventSubscriptionHub | None = None,
        weather_provider: WeatherProvider | None = None,
        space_weather_provider: SpaceWeatherProvider | None = None,
    ) -> None:
        self.repository = repository or InMemoryScenarioRepository()
        self.fixture_mode = fixture_mode
        self.subscriptions = subscriptions or EventSubscriptionHub()
        self.weather_provider = weather_provider or weather_provider_from_environment()
        self.space_weather_provider = (
            space_weather_provider or space_weather_provider_from_environment()
        )
        data_root = Path(__file__).resolve().parents[4] / "data"
        configured_catalog = os.getenv("AGCC_STATION_CATALOG_PATH")
        self.catalog_path = catalog_path or (
            Path(configured_catalog)
            if configured_catalog
            else data_root / "catalogs" / "stations.demo.json"
        )
        self.catalog = load_catalog_from_file(self.catalog_path)
        self.propagator = CircularKeplerPropagator()
        self.pass_engine = PassEngine(propagator=self.propagator)
        attenuation = (
            NoWeatherAttenuationModel()
            if isinstance(self.weather_provider, NotConfiguredLiveWeatherProvider)
            else ItuRainAttenuationModel()
        )
        self.capacity_engine = CapacityEngine(attenuation)
        self.feasibility_checker = FeasibilityChecker()
        self.planner = ContactPlanner()

    def diagnostics(self) -> DiagnosticsData:
        dependencies = {}
        for package in ("fastapi", "pydantic", "skyfield", "httpx"):
            dependencies[package] = importlib.metadata.version(package)
        return DiagnosticsData(
            engine_version=ENGINE_VERSION,
            model_versions={
                "orbit": "circular_kepler_v1",
                "capacity": "capacity_v1",
                "planner": ALGORITHM_VERSION,
            },
            adapter_mode="fixture" if self.fixture_mode else "not_configured",
            dependency_versions=dependencies,
            active_scenario_count=self.repository.count(),
        )

    def create_scenario(self, request: ScenarioCreateRequest) -> ScenarioRuntime:
        catalog_ids = {station.station_id for station in self.catalog.stations}
        unknown = sorted(set(request.scenario.station_ids) - catalog_ids)
        if unknown:
            raise ApiServiceError(
                422,
                "UNKNOWN_STATION",
                "Scenario references stations absent from the configured catalog",
                entity_refs={"scenario_id": request.scenario.scenario_id},
                details={"station_ids": unknown},
            )
        runtime = ScenarioRuntime(definition=request)
        try:
            self.repository.add(runtime)
        except ValueError as exc:
            raise ApiServiceError(409, "SCENARIO_EXISTS", str(exc)) from exc
        return runtime

    def get_runtime(self, scenario_id: str) -> ScenarioRuntime:
        try:
            return self.repository.get(scenario_id)
        except KeyError as exc:
            raise ApiServiceError(
                404,
                "SCENARIO_NOT_FOUND",
                str(exc),
                entity_refs={"scenario_id": scenario_id},
            ) from exc

    def validate_scenario(self, scenario_id: str) -> ScenarioValidationData:
        runtime = self.get_runtime(scenario_id)
        errors: list[ApiErrorBody] = []
        authorized = self._stations(runtime)
        if not authorized:
            errors.append(
                ApiErrorBody(
                    code="NO_AUTHORIZED_STATIONS",
                    message="No planner-eligible stations are authorized",
                    entity_refs={"scenario_id": scenario_id},
                )
            )
        return ScenarioValidationData(valid=not errors, errors=errors)

    def orbit_summary(self, scenario_id: str) -> OrbitSummaryData:
        orbit = self.get_runtime(scenario_id).definition.satellite.orbit
        return OrbitSummaryData(
            semi_major_axis_km=semi_major_axis_km(orbit),
            mean_motion_rad_s=mean_motion_rad_s(orbit),
            period_s=period_s(orbit),
            revolutions_per_day=revolutions_per_day(orbit),
            direction=orbit.direction,
        )

    def ground_track(self, scenario_id: str, horizon: HorizonRequest) -> list[Any]:
        orbit = self.get_runtime(scenario_id).definition.satellite.orbit
        return self.propagator.sample_ground_track(
            orbit, horizon.start_at, horizon.end_at, horizon.step_s
        )

    def generate_passes(self, scenario_id: str, horizon: HorizonRequest | None = None) -> list[Any]:
        runtime = self.get_runtime(scenario_id)
        mission = runtime.definition.mission
        selected = self._stations(runtime)
        effective_horizon = horizon or HorizonRequest(
            start_at=mission.release_at,
            end_at=mission.deadline_at,
        )
        runtime.passes = self.pass_engine.compute_passes_from_catalog(
            orbit=runtime.definition.satellite.orbit,
            satellite_id=runtime.definition.satellite.satellite_id,
            catalog=self.catalog,
            selected_stations=selected,
            horizon_start=effective_horizon.start_at,
            horizon_end=effective_horizon.end_at,
            scenario_id=scenario_id,
        )
        return runtime.passes

    def compute_capacities(
        self, scenario_id: str, pass_ids: list[str] | None = None
    ) -> list[CapacityEstimate]:
        if not self.fixture_mode:
            raise ApiServiceError(
                503,
                "WEATHER_ATTENUATION_TABLE_MISSING",
                "Approved production weather attenuation coefficients are not configured",
            )
        runtime = self.get_runtime(scenario_id)
        if not runtime.passes:
            self.generate_passes(scenario_id)
        requested = set(pass_ids) if pass_ids else None
        stations = {station.station_id: station for station in self._stations(runtime)}
        weather_by_station: dict[str, list[Any]] = {}
        using_live_weather = not isinstance(
            self.weather_provider, NotConfiguredLiveWeatherProvider
        )
        candidates = [
            item
            for item in runtime.passes
            if requested is None or item.pass_id in requested
        ]
        if using_live_weather and candidates:
            pass_station_ids = {item.station_id for item in candidates}
            weather_stations = {
                ident: station
                for ident, station in stations.items()
                if ident in pass_station_ids
            }
            weather_by_station = self._fetch_weather(
                weather_stations,
                min(item.start_at for item in candidates),
                max(item.end_at for item in candidates),
            )
            runtime.weather_snapshots = [
                snapshot for snapshots in weather_by_station.values() for snapshot in snapshots
            ]
        estimates = []
        for candidate in runtime.passes:
            if requested is not None and candidate.pass_id not in requested:
                continue
            station = stations[candidate.station_id]
            precipitation = 0.0
            quality = SourceQuality.ASSUMED
            if using_live_weather:
                aligned = align_to_pass(candidate, weather_by_station.get(station.station_id, []))
                if not aligned.available or aligned.snapshot is None:
                    continue
                precipitation = aligned.snapshot.precipitation_mm_per_hr
                quality = aligned.quality
            estimates.append(
                self.capacity_engine.estimate(
                    candidate,
                    runtime.definition.satellite.comms,
                    station,
                    precipitation_mm_per_hr=precipitation,
                    weather_data_quality=quality,
                )
            )
        if using_live_weather and candidates and not estimates:
            raise ApiServiceError(
                503,
                "WEATHER_DATA_UNAVAILABLE",
                "Open-Meteo returned no usable weather for any computed pass",
                details={
                    "pass_count": len(candidates),
                    "station_count": len({item.station_id for item in candidates}),
                },
            )
        runtime.capacities = estimates
        return estimates

    def weather_snapshots(
        self, scenario_id: str, start: datetime, end: datetime
    ) -> list[Any]:
        """Fetch normalized weather only for unique stations in the active plan."""
        if isinstance(self.weather_provider, NotConfiguredLiveWeatherProvider):
            raise ApiServiceError(
                503, "WEATHER_LIVE_NOT_CONFIGURED", "Open-Meteo is not configured"
            )
        runtime = self.get_runtime(scenario_id)
        plan = self._current_plan(runtime)
        planned_station_ids = {contact.station_id for contact in plan.contacts}
        stations = {
            station.station_id: station
            for station in self._stations(runtime)
            if station.station_id in planned_station_ids
        }
        if not stations:
            return []
        fetched = self._fetch_weather(stations, start, end)
        runtime.weather_snapshots = [item for values in fetched.values() for item in values]
        return runtime.weather_snapshots

    def _fetch_weather(
        self, stations: dict[str, Any], start: datetime, end: datetime
    ) -> dict[str, list[Any]]:
        async def fetch_all() -> dict[str, list[Any]]:
            semaphore = asyncio.Semaphore(8)

            async def fetch_one(
                station_id: str, station: Any
            ) -> tuple[str, list[Any] | None, WeatherUnavailable | None]:
                async with semaphore:
                    try:
                        snapshots = await self.weather_provider.snapshots_for(
                            station, start, end
                        )
                        return station_id, snapshots, None
                    except WeatherUnavailable as exc:
                        return station_id, None, exc

            outcomes = await asyncio.gather(
                *(fetch_one(ident, station) for ident, station in stations.items())
            )
            successful = {
                ident: snapshots
                for ident, snapshots, error in outcomes
                if error is None and snapshots is not None
            }
            if not successful and outcomes:
                failures = {
                    ident: error.error.details
                    for ident, _, error in outcomes
                    if error is not None
                }
                raise ApiServiceError(
                    503,
                    "WEATHER_DATA_UNAVAILABLE",
                    "Open-Meteo failed for every required pass station",
                    details={"station_failures": failures},
                )
            return successful

        return asyncio.run(fetch_all())

    def space_weather(self, scenario_id: str) -> dict[str, Any]:
        """Return global NOAA context; never apply it as a capacity multiplier."""
        if isinstance(self.space_weather_provider, NotConfiguredLiveSpaceWeatherProvider):
            raise ApiServiceError(
                503, "SPACE_WEATHER_LIVE_NOT_CONFIGURED", "NOAA SWPC is not configured"
            )
        runtime = self.get_runtime(scenario_id)
        now = datetime.now(timezone.utc)
        try:
            snapshots = asyncio.run(
                self.space_weather_provider.snapshots_for(
                    now - timedelta(hours=8), now + timedelta(minutes=2)
                )
            )
        except SpaceWeatherUnavailable as exc:
            raise ApiServiceError(
                503,
                "SPACE_WEATHER_DATA_UNAVAILABLE",
                "NOAA SWPC data could not be obtained",
                details={"provider_error": exc.error.details},
            ) from exc
        runtime.space_weather_snapshots = snapshots
        return {
            "latest": snapshots[-1] if snapshots else None,
            "history": snapshots,
            "capacity_effect_applied": False,
        }

    def feasibility(self, scenario_id: str, *, refresh_capacity: bool = True) -> FeasibilityReport:
        runtime = self.get_runtime(scenario_id)
        if refresh_capacity or not runtime.capacities:
            self.compute_capacities(scenario_id)
        records = self._eligible_records(runtime)
        mission = runtime.definition.mission
        constraints = runtime.definition.scenario.constraints
        runtime.feasibility = self.feasibility_checker.check(
            scenario_id=scenario_id,
            mission_id=mission.mission_id,
            required_volume_mb=mission.required_volume_mb,
            deadline=mission.deadline_at,
            maximum_budget=constraints.maximum_budget,
            records=records,
            catalog_station_ids=[station.station_id for station in self.catalog.stations],
            authorized_station_ids=[station.station_id for station in self._stations(runtime)],
        )
        return runtime.feasibility

    def create_plan(
        self,
        scenario_id: str,
        requested_plan_id: str | None = None,
        *,
        excluded_pass_ids: set[str] | None = None,
        activate: bool = True,
    ) -> ContactPlan:
        runtime = self.get_runtime(scenario_id)
        records = self._eligible_records(runtime)
        if excluded_pass_ids:
            records = [item for item in records if item.pass_.pass_id not in excluded_pass_ids]
        mission = runtime.definition.mission
        constraints = runtime.definition.scenario.constraints
        sequence = len(runtime.plans) + 1
        plan_id = requested_plan_id or self._stable_id(
            "plan", scenario_id, str(sequence), str(mission.required_volume_mb)
        )
        stations = {station.station_id: station for station in self._stations(runtime)}
        plan = self.planner.plan(
            plan_id=plan_id,
            scenario_id=scenario_id,
            mission_id=mission.mission_id,
            required_volume_mb=mission.required_volume_mb,
            deadline=mission.deadline_at,
            mission_window_start=mission.release_at,
            maximum_budget=constraints.maximum_budget,
            preference=constraints.planning_preference,
            eligible_records=records,
            station_map=stations,
        )
        runtime.plans[plan.plan_id] = plan
        if activate and plan.status == PlanStatus.FEASIBLE:
            runtime.current_plan_id = plan.plan_id
        return plan

    def get_plan(self, scenario_id: str, plan_id: str) -> ContactPlan:
        runtime = self.get_runtime(scenario_id)
        try:
            return runtime.plans[plan_id]
        except KeyError as exc:
            raise ApiServiceError(404, "PLAN_NOT_FOUND", f"Plan not found: {plan_id}") from exc

    def start_simulation(
        self,
        scenario_id: str,
        *,
        plan_id: str | None,
        sim_start_at: datetime | None,
        speed: str = "1x",
        initial_delivered_mb: float = 0.0,
        preserve_events: bool = False,
    ) -> SimulationEngine:
        runtime = self.get_runtime(scenario_id)
        selected_plan_id = plan_id or runtime.current_plan_id
        if selected_plan_id is None:
            raise ApiServiceError(409, "PLAN_REQUIRED", "Create a feasible plan first")
        plan = self.get_plan(scenario_id, selected_plan_id)
        if plan.status != PlanStatus.FEASIBLE:
            raise ApiServiceError(409, "PLAN_NOT_FEASIBLE", "Simulation requires a feasible plan")
        plan = plan.model_copy(
            update={
                "contacts": [
                    contact.model_copy(update={"commitment": "committed"})
                    for contact in plan.contacts
                ]
            }
        )
        runtime.plans[selected_plan_id] = plan
        runtime.dispatch = DispatchBuilder().build(plan)
        if not preserve_events:
            runtime.event_store = SessionEventStore()
        passes = {item.pass_id: item for item in runtime.passes}
        stations = {item.station_id: item for item in self._stations(runtime)}
        comms = runtime.definition.satellite.comms

        def rate_provider(contact: Any, at: datetime) -> float:
            candidate = passes.get(contact.pass_id)
            station = stations.get(contact.station_id)
            if candidate is None or station is None:
                return 0.0
            precipitation = next(
                (
                    snapshot.precipitation_mm_per_hr
                    for snapshot in runtime.weather_snapshots
                    if snapshot.station_id == station.station_id
                    and snapshot.valid_from <= at < snapshot.valid_until
                ),
                0.0,
            )
            modeled_rate = self.capacity_engine.effective_rate_at(
                candidate,
                comms,
                station,
                at,
                precipitation_mm_per_hr=precipitation,
            )
            return modeled_rate * self._contact_anomaly_multiplier(runtime, contact.contact_id)

        effective_start = sim_start_at or runtime.definition.mission.release_at
        execution_plan = plan.model_copy(
            update={
                "contacts": [item for item in plan.contacts if item.end_at > effective_start]
            }
        )
        runtime.dispatch = DispatchBuilder().build(execution_plan)
        runtime.simulation = SimulationEngine(
            plan=execution_plan,
            dispatch=runtime.dispatch,
            required_volume_mb=runtime.definition.mission.required_volume_mb,
            deadline=runtime.definition.mission.deadline_at,
            base_rate_mbps=0.0,
            protocol_efficiency=1.0,
            store=runtime.event_store,
            anomaly_multiplier=1.0,
            rate_provider=rate_provider,
            initial_delivered_mb=initial_delivered_mb,
        )
        runtime.simulation.start(effective_start)
        runtime.simulation_paused = speed == "paused"
        runtime.simulation_speed = speed
        runtime.simulation_wall_anchor = datetime.now(timezone.utc)
        runtime.simulation_wall_remainder_s = 0.0
        self._publish(runtime)
        return runtime.simulation

    def activate_replan(self, scenario_id: str, plan_id: str) -> SimulationEngine | None:
        """Switch future execution to an approved plan without losing delivered volume."""
        runtime = self.get_runtime(scenario_id)
        runtime.current_plan_id = plan_id
        if runtime.simulation is None:
            return None
        delivered = runtime.simulation.delivered_mb
        sim_time = runtime.simulation.sim_time or runtime.definition.mission.release_at
        speed = runtime.simulation_speed
        paused = runtime.simulation_paused
        simulation = self.start_simulation(
            scenario_id,
            plan_id=plan_id,
            sim_start_at=sim_time,
            speed=speed,
            initial_delivered_mb=delivered,
            preserve_events=True,
        )
        if paused:
            runtime.simulation_paused = True
        return simulation

    def pause_simulation(self, scenario_id: str) -> SimulationEngine:
        runtime = self._simulation_runtime(scenario_id)
        simulation = runtime.simulation
        assert simulation is not None
        simulation.pause(simulation.sim_time or runtime.definition.mission.release_at)
        runtime.simulation_paused = True
        runtime.simulation_wall_anchor = datetime.now(timezone.utc)
        self._publish(runtime)
        return simulation

    def step_simulation(self, scenario_id: str, seconds: int) -> SimulationEngine:
        runtime = self._simulation_runtime(scenario_id)
        simulation = runtime.simulation
        assert simulation is not None
        current = simulation.sim_time or runtime.definition.mission.release_at
        for offset in range(1, seconds + 1):
            simulation.tick(current + timedelta(seconds=offset))
            if simulation.is_finished:
                break
        self._publish(runtime)
        return simulation

    def resume_simulation(self, scenario_id: str) -> SimulationEngine:
        runtime = self._simulation_runtime(scenario_id)
        runtime.simulation_paused = False
        runtime.simulation_wall_anchor = datetime.now(timezone.utc)
        self._publish(runtime)
        assert runtime.simulation is not None
        return runtime.simulation

    def set_simulation_speed(self, scenario_id: str, speed: str) -> SimulationEngine:
        """Apply a clock multiplier immediately without restarting execution."""
        runtime = self._simulation_runtime(scenario_id)
        self.advance_realtime(scenario_id)
        runtime.simulation_speed = speed
        runtime.simulation_paused = speed == "paused"
        runtime.simulation_wall_anchor = datetime.now(timezone.utc)
        runtime.simulation_wall_remainder_s = 0.0
        self._publish(runtime)
        assert runtime.simulation is not None
        return runtime.simulation

    def advance_realtime(self, scenario_id: str, wall_now: datetime | None = None) -> None:
        """Advance backend simulation from elapsed wall time at the selected speed."""
        runtime = self._simulation_runtime(scenario_id)
        now = wall_now or datetime.now(timezone.utc)
        anchor = runtime.simulation_wall_anchor or now
        runtime.simulation_wall_anchor = now
        if (
            runtime.simulation_paused
            or runtime.simulation is None
            or runtime.simulation.is_finished
        ):
            return
        if runtime.simulation_speed == "paused":
            runtime.simulation_paused = True
            return
        speed = float(runtime.simulation_speed.removesuffix("x"))
        elapsed = (
            max(0.0, (now - anchor).total_seconds()) * speed
            + runtime.simulation_wall_remainder_s
        )
        whole_seconds = int(elapsed)
        runtime.simulation_wall_remainder_s = elapsed - whole_seconds
        if whole_seconds > 0:
            self.step_simulation(scenario_id, whole_seconds)

    def inject_anomaly(self, scenario_id: str, request: AnomalyRequest) -> AnomalyImpactData:
        runtime = self.get_runtime(scenario_id)
        current_plan = self._current_plan(runtime)
        contacts = (
            [c for c in current_plan.contacts if c.contact_id in request.affected_contact_ids]
            if request.affected_contact_ids
            else list(current_plan.contacts)
        )
        affected_capacity = sum(contact.allocated_volume_mb for contact in contacts)
        anomaly = AnomalyImpactData(
            anomaly_id=self._stable_id(
                "anomaly", scenario_id, str(len(runtime.anomalies) + 1), request.description
            ),
            anomaly_type=request.anomaly_type,
            affected_contact_ids=[contact.contact_id for contact in contacts],
            rate_multiplier=request.rate_multiplier,
            estimated_capacity_reduction_mb=affected_capacity * (1.0 - request.rate_multiplier),
            description=request.description,
        )
        runtime.anomalies.append(anomaly)
        if runtime.simulation is not None:
            runtime.simulation.record_external_event(
                EventType.ANOMALY_DETECTED,
                f"{request.anomaly_type.value}: {request.description}; "
                f"multiplier={request.rate_multiplier:.3f}",
            )
        self._publish(runtime)
        return anomaly

    def request_replan(self, scenario_id: str, reason: str) -> ProposalData:
        runtime = self.get_runtime(scenario_id)
        current = self._current_plan(runtime)
        proposed_id = self._stable_id(
            "plan", scenario_id, "proposal", str(len(runtime.proposals) + 1)
        )
        proposed = self.create_plan(scenario_id, proposed_id)
        runtime.current_plan_id = current.plan_id
        proposal_id = self._stable_id(
            "proposal", scenario_id, str(len(runtime.proposals) + 1), proposed.plan_id
        )
        proposal = ProposalData(
            proposal_id=proposal_id,
            scenario_id=scenario_id,
            current_plan_id=current.plan_id,
            proposed_plan_id=proposed.plan_id,
            status="pending",
            reason=reason,
            created_at=datetime.now(timezone.utc),
        )
        runtime.proposals[proposal_id] = proposal
        self._publish(runtime)
        return proposal

    def decide_proposal(
        self, scenario_id: str, proposal_id: str, *, approve: bool, reason: str
    ) -> ProposalData:
        runtime = self.get_runtime(scenario_id)
        try:
            proposal = runtime.proposals[proposal_id]
        except KeyError as exc:
            raise ApiServiceError(
                404, "PROPOSAL_NOT_FOUND", f"Proposal not found: {proposal_id}"
            ) from exc
        if proposal.status != "pending":
            raise ApiServiceError(409, "PROPOSAL_ALREADY_DECIDED", "Proposal is not pending")
        status = ProposalStatus.APPROVED.value if approve else ProposalStatus.REJECTED.value
        decided = proposal.model_copy(update={"status": status, "reason": reason})
        runtime.proposals[proposal_id] = decided
        if approve:
            runtime.current_plan_id = proposal.proposed_plan_id
        self._publish(runtime)
        return decided

    def events(self, scenario_id: str) -> list[Any]:
        return [
            {
                "event_id": event.event_id,
                "sequence_number": event.sequence_number,
                "event_type": event.event_type,
                "sim_time": event.sim_time,
                "contact_id": event.contact_id,
                "fragment_id": event.fragment_id,
                "delivered_volume_mb": event.delivered_volume_mb,
                "rate_mbps": event.rate_mbps,
                "predicted_shortfall_mb": event.predicted_shortfall_mb,
                "description": event.description,
            }
            for event in self.get_runtime(scenario_id).event_store.all_events()
        ]

    def export_plan(self, scenario_id: str) -> dict[str, Any]:
        runtime = self.get_runtime(scenario_id)
        return self._current_plan(runtime).model_dump(mode="json")

    def simulation_state(self, scenario_id: str) -> dict[str, Any]:
        runtime = self._simulation_runtime(scenario_id)
        self.advance_realtime(scenario_id)
        simulation = runtime.simulation
        assert simulation is not None
        sim_time = simulation.sim_time or runtime.definition.mission.release_at
        orbit_state = self.propagator.state_at(runtime.definition.satellite.orbit, sim_time)
        plan = self._current_plan(runtime)
        contacts_by_pass = {item.pass_id: item for item in plan.contacts}
        capacity_by_pass = {item.pass_id: item for item in runtime.capacities}
        station_by_id = {item.station_id: item for item in self.catalog.stations}
        active = simulation.active_contact
        approved_station_ids = {item.station_id for item in plan.contacts}
        contact_station = {item.contact_id: item.station_id for item in plan.contacts}
        anomalous_station_ids = {
            contact_station[contact_id]
            for anomaly in runtime.anomalies
            for contact_id in anomaly.affected_contact_ids
            if contact_id in contact_station
        }
        candidate_station_ids = {item.station_id for item in runtime.passes}
        selected_station_ids = set(runtime.definition.scenario.station_ids)
        opportunities = []
        for candidate in runtime.passes:
            contact = contacts_by_pass.get(candidate.pass_id)
            capacity = capacity_by_pass.get(candidate.pass_id)
            opportunities.append({
                "pass_id": candidate.pass_id,
                "contact_id": contact.contact_id if contact else None,
                "station_id": candidate.station_id,
                "station_name": station_by_id[candidate.station_id].name,
                "start_at": candidate.start_at,
                "end_at": candidate.end_at,
                "volume_mb": (
                    contact.allocated_volume_mb if contact else
                    (capacity.usable_capacity_mb if capacity else 0.0)
                ),
                "classification": "approved" if contact else "candidate",
                "reason": (
                    "; ".join(contact.selection_reasons) if contact else
                    "Geometrically visible and capacity-eligible, but not selected by the planner."
                ),
            })
        stations = []
        for station in self.catalog.stations:
            if station.station_id in anomalous_station_ids:
                classification = "anomaly"
            elif active and station.station_id == active.station_id:
                classification = "active"
            elif station.station_id in approved_station_ids:
                classification = "approved"
            elif station.station_id in candidate_station_ids:
                classification = "candidate"
            elif station.station_id in selected_station_ids:
                classification = "unused"
            else:
                classification = "unselected"
            stations.append({
                "station_id": station.station_id,
                "name": station.name,
                "latitude_deg": station.latitude_deg,
                "longitude_deg": station.longitude_deg,
                "classification": classification,
                "assumed_fields": station.field_provenance.assumptions,
            })
        return {
            "started": True,
            "finished": simulation.is_finished,
            "sim_time": sim_time,
            "delivered_mb": simulation.delivered_mb,
            "remaining_mb": max(
                0.0, runtime.definition.mission.required_volume_mb - simulation.delivered_mb
            ),
            "paused": runtime.simulation_paused,
            "speed": runtime.simulation_speed,
            "satellite": {
                "satellite_id": runtime.definition.satellite.satellite_id,
                "latitude_deg": orbit_state.latitude_deg,
                "longitude_deg": orbit_state.longitude_deg,
                "altitude_km": orbit_state.altitude_km,
                "modeled": True,
            },
            "current_contact": None if active is None else {
                "contact_id": active.contact_id,
                "station_id": active.station_id,
                "station_name": station_by_id[active.station_id].name,
                "start_at": active.start_at,
                "end_at": active.end_at,
                "rate_mbps": simulation.current_rate_mbps(),
                "target_volume_mb": active.allocated_volume_mb,
                "actual_volume_mb": simulation.active_contact_delivered_mb,
                "band": runtime.definition.satellite.comms.band,
                "anomaly_multiplier": self._contact_anomaly_multiplier(
                    runtime, active.contact_id
                ),
            },
            "predicted_final_mb": max(
                simulation.delivered_mb,
                runtime.definition.mission.required_volume_mb
                - simulation.predicted_shortfall_mb,
            ),
            "predicted_shortfall_mb": simulation.predicted_shortfall_mb,
            "required_mb": runtime.definition.mission.required_volume_mb,
            "deadline_at": runtime.definition.mission.deadline_at,
            "resolution_required": (
                simulation.predicted_shortfall_mb > 1e-9
                or (
                    simulation.is_finished
                    and simulation.delivered_mb
                    < runtime.definition.mission.required_volume_mb - 1e-9
                )
            ),
            "plan": {
                "plan_id": plan.plan_id,
                "version": plan.version,
                "planned_completion_at": plan.planned_completion_at,
                "estimated_total_cost": plan.estimated_total_cost,
            },
            "stations": stations,
            "opportunities": opportunities,
            "event_count": len(runtime.event_store.all_events()),
        }

    def _stations(self, runtime: ScenarioRuntime) -> list[Any]:
        selected = filter_stations(
            self.catalog, runtime.definition.scenario.constraints.station_selection
        )
        scenario_ids = set(runtime.definition.scenario.station_ids)
        return [station for station in selected if station.station_id in scenario_ids]

    def _eligible_records(self, runtime: ScenarioRuntime) -> list[Any]:
        if not runtime.capacities:
            self.compute_capacities(runtime.definition.scenario.scenario_id)
        capacities = {item.pass_id: item for item in runtime.capacities}
        stations = {station.station_id: station for station in self._stations(runtime)}
        mission = runtime.definition.mission
        builder = EligiblePassBuilder(
            satellite_band=runtime.definition.satellite.comms.band,
            deadline=mission.deadline_at,
            release_at=mission.release_at,
            max_budget_usd=runtime.definition.scenario.constraints.maximum_budget,
        )
        return [
            builder.build(candidate, capacities[candidate.pass_id], stations[candidate.station_id])
            for candidate in runtime.passes
            if candidate.pass_id in capacities and candidate.station_id in stations
        ]

    def _current_plan(self, runtime: ScenarioRuntime) -> ContactPlan:
        if runtime.current_plan_id is None:
            raise ApiServiceError(409, "PLAN_REQUIRED", "Create a feasible plan first")
        return runtime.plans[runtime.current_plan_id]

    def _simulation_runtime(self, scenario_id: str) -> ScenarioRuntime:
        runtime = self.get_runtime(scenario_id)
        if runtime.simulation is None:
            raise ApiServiceError(409, "SIMULATION_NOT_STARTED", "Start simulation first")
        return runtime

    @staticmethod
    def _stable_id(prefix: str, *parts: str) -> str:
        digest = hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]
        return f"{prefix}_{digest}"

    @staticmethod
    def _active_anomaly_multiplier(runtime: ScenarioRuntime) -> float:
        multiplier = 1.0
        for anomaly in runtime.anomalies:
            multiplier *= anomaly.rate_multiplier
        return multiplier

    @staticmethod
    def _contact_anomaly_multiplier(runtime: ScenarioRuntime, contact_id: str) -> float:
        multiplier = 1.0
        for anomaly in runtime.anomalies:
            if not anomaly.affected_contact_ids or contact_id in anomaly.affected_contact_ids:
                multiplier *= anomaly.rate_multiplier
        return multiplier

    def _publish(self, runtime: ScenarioRuntime) -> None:
        simulation = runtime.simulation
        plan = runtime.plans.get(runtime.current_plan_id or "")
        current_contact = None
        if simulation is not None and simulation.sim_time is not None and plan is not None:
            current_contact = next(
                (
                    contact
                    for contact in plan.contacts
                    if contact.start_at <= simulation.sim_time < contact.end_at
                ),
                None,
            )
        delivered = simulation.delivered_mb if simulation else 0.0
        self.subscriptions.publish(
            EventSubscriptionMessage(
                scenario_id=runtime.definition.scenario.scenario_id,
                simulated_time=simulation.sim_time if simulation else None,
                current_contact_id=current_contact.contact_id if current_contact else None,
                current_station_id=current_contact.station_id if current_contact else None,
                throughput_mbps=None,
                delivered_volume_mb=delivered,
                remaining_volume_mb=max(
                    0.0, runtime.definition.mission.required_volume_mb - delivered
                ),
                anomalies=runtime.anomalies,
                notifications=[],
                proposals=list(runtime.proposals.values()),
            )
        )
