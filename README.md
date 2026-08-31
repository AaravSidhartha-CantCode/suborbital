# Suborbital

Suborbital is an AI-assisted ground-contact planning and mission-simulation platform for low-Earth-orbit satellites. It combines orbital mechanics, ground-station visibility, weather-aware link estimates, budget constraints, timeline simulation, anomaly handling, and human-approved replanning in one browser application.

The project is an engineering prototype and decision-support demonstration. It does **not** command spacecraft, reserve commercial ground stations, consume telemetry, or claim certified link-budget performance.

## Selected Challenge Theme

**AI for Space Operations and Ground-Station Optimization**

Suborbital addresses the challenge of applying trustworthy AI to operational decision support. The project focuses on scheduling scarce ground-station resources, explaining mission risk, and responding to disruptions without allowing a generative model to override orbital, RF, financial, or authorization constraints.

## Problem Statement

Low-Earth-orbit satellites can communicate with a ground station only during short visibility windows. A useful contact must satisfy several constraints at the same time:

- The satellite must be above the station's minimum elevation angle.
- The spacecraft and station must support a compatible communication band.
- The pass must provide enough weather-adjusted link capacity to transfer useful data.
- The station cost must fit within the mission budget.
- Contacts must occur before the delivery deadline and must not overlap unavailable resources.
- Unexpected weather, station outages, and link degradation can invalidate an otherwise feasible schedule.

Operators therefore need more than a map of future passes. They need an auditable system that can compare alternatives, quantify feasibility, simulate execution, explain failures, and produce a safe recovery proposal when conditions change. Existing manual workflows are difficult to scale, while an unconstrained generative-AI planner can produce schedules that sound plausible but violate physical or operational rules.

## Solution Description

Suborbital turns mission requirements into a validated contact plan and an interactive simulation. A user defines a custom circular orbit, communication configuration, authorized ground stations, required data volume, deadline, budget, and planning preference. The backend then propagates the orbit, computes visibility windows, estimates usable capacity, evaluates feasibility, and schedules contacts.

The resulting mission is represented by three synchronized but isolated timelines:

- **Prediction** preserves the original plan and forecast as a stable baseline.
- **Live** advances at wall-clock speed and reflects refreshed operating conditions.
- **Anomaly** provides an isolated branch where disruptions can be introduced, analyzed, and resolved without altering the baseline.

The application provides:

- Custom circular-orbit configuration using altitude, inclination, RAAN, phase, and epoch.
- Communication-system configuration by RF band, carrier frequency, polarization, maximum downlink rate, and protocol efficiency.
- Ground-station filtering by authorization and communication compatibility.
- Propagated ground tracks and predicted station visibility windows.
- Weather-aware downlink capacity using Open-Meteo forecasts and ITU-R rain-attenuation models.
- Deterministic mission feasibility checks and contact-plan generation.
- Separate Prediction, Live, and Anomaly timelines initialized from one shared baseline.
- Simulated downlink execution with delivered volume, cost, event history, and contact progression.
- Natural-language anomaly interpretation using IBM watsonx.ai and Granite.
- Forward replanning with explicit user approval before a proposed plan can modify a timeline.
- Reproducible fixtures, golden outputs, schema exports, and cross-stack verification.

## AI Approach and Architecture

Suborbital uses a **hybrid deterministic and generative architecture**. IBM watsonx.ai with `ibm/granite-4-h-small` handles language understanding and grounded explanations. Deterministic services remain authoritative for every numerical or state-changing decision.

### Granite Responsibilities

Granite is used to:

- Convert a natural-language anomaly report into a structured anomaly proposal.
- Ask for clarification when the report does not contain enough operational detail.
- Explain shortfalls, risks, and proposed recovery actions in operator-friendly language.
- Summarize validated planning context supplied by the backend.

Granite cannot directly mutate a mission, approve a replan, invent station availability, or bypass validation. Its output is parsed into typed contracts and checked against the current simulation state. Numerical effects are calculated by deterministic domain engines, and a recovery plan becomes active only after explicit user approval.

### Request Flow

1. The React client submits mission constraints or an anomaly description to FastAPI.
2. Pydantic validates the request against typed domain contracts.
3. Orbital, pass, capacity, feasibility, cost, and scheduling engines calculate the authoritative result.
4. For natural-language workflows, a constrained prompt sends only relevant mission context to Granite through watsonx.ai.
5. Granite returns a structured interpretation or grounded explanation.
6. The backend validates the interpretation and computes any proposed replan deterministically.
7. The UI presents the proposal to the operator for approval or rejection.

### Technical Architecture

```text
React + TypeScript frontend
        |
        | HTTP / Server-Sent Events
        v
FastAPI application layer
        |
        +-- Circular orbit propagation and pass geometry
        +-- Station catalog and compatibility filtering
        +-- Open-Meteo and NOAA environment adapters
        +-- ITU-R rain attenuation and capacity engine
        +-- Feasibility checker and deterministic contact planner
        +-- Simulation, anomaly, dispatch, and replanning engines
        +-- IBM watsonx.ai / Granite adapter
```

The frontend presents backend-owned state and does not recompute planning decisions. Browser sessions are isolated in memory and identified through the `X-AGCC-Session` header. The legacy header name is retained as an internal API contract; the product branding is Suborbital.

## How IBM Bob Was Used

IBM Bob was used as an AI development assistant throughout the implementation of Suborbital. The team supplied Bob with bounded engineering tasks, domain requirements, data contracts, expected behavior, and verification criteria. Bob helped accelerate:

- Repository scaffolding and organization of the Python and TypeScript codebases.
- Implementation of domain models for orbit configuration, stations, missions, passes, capacities, plans, anomalies, and simulation state.
- Development of FastAPI routes, React interfaces, and integration points between the frontend and backend.
- Creation of unit, API, integration, and golden-verification tests.
- Iterative debugging, refactoring, UI refinement, and technical documentation.

Bob was not treated as an autonomous source of orbital or RF truth. Its changes were constrained by explicit requirements and reviewed through tests, static analysis, generated schemas, reproducible fixtures, and human inspection. Scientific calculations remained implemented in conventional code using established libraries and declared assumptions.

IBM Bob and IBM watsonx.ai serve different roles in this project: **Bob assisted the team while building the software**, whereas **watsonx.ai and Granite are runtime components used by the finished application** for anomaly interpretation and explanation.

## Why This Approach Matters

The architecture applies AI where it is useful: language understanding and explanation. It preserves deterministic control over physics, scheduling, cost, and mission state. This reduces hallucination risk, keeps decisions auditable, and gives operators a clear approval boundary before any recovery plan is applied.

## Technology Stack

### Frontend

- React 18 and TypeScript
- Vite
- Zustand state management
- Three.js with React Three Fiber and Drei
- Vitest and Testing Library

### Backend

- Python 3.12
- FastAPI and Pydantic
- Skyfield-based orbital calculations
- `itur` for ITU-R propagation models
- HTTPX for external adapters
- Pytest, Ruff, and mypy

### External Services

- IBM watsonx.ai with `ibm/granite-4-h-small`
- Open-Meteo hourly ground weather
- NOAA SWPC planetary K-index context (optional)

## Repository Layout

```text
.
|-- agcc/
|   |-- backend/
|   |   |-- src/agcc/       # Domain engines, adapters, and FastAPI routes
|   |   |-- tests/          # Unit, API, integration, and golden tests
|   |   `-- scripts/        # Verification and schema utilities
|   |-- frontend/
|   |   |-- src/            # React application and UI tests
|   |   `-- public/         # Local maps and Earth textures
|   |-- data/
|   |   |-- catalogs/       # Demo and hybrid station catalogs
|   |   |-- fixtures/       # Controlled scenarios and environment data
|   |   `-- golden/         # Reproducible verification outputs
|   |-- schemas/            # Exported JSON schemas
|   `-- docs/               # Verification report template
`-- README.md
```

## Prerequisites

- Git
- Python `3.12.x` (the backend requires `>=3.12,<3.13`)
- Node.js 18 or newer and npm
- An IBM Cloud API key with access to the configured watsonx.ai project, if AI anomaly parsing is required

## Quick Start

Clone the repository and enter the implementation directory:

```bash
git clone https://github.com/AdityaV1288/Suborbital.git
cd Suborbital/agcc
```

### 1. Install and Start the Backend

Windows PowerShell:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
uvicorn agcc.api.app:app --reload --port 8000
```

macOS or Linux:

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e ".[dev]"
uvicorn agcc.api.app:app --reload --port 8000
```

The backend is available at `http://127.0.0.1:8000`.

- Health check: `http://127.0.0.1:8000/health`
- Interactive API documentation: `http://127.0.0.1:8000/docs`
- OpenAPI schema: `http://127.0.0.1:8000/openapi.json`

### 2. Configure External Services

Set environment variables in the same terminal **before** starting the backend.

Windows PowerShell:

```powershell
$env:AGCC_GRANITE_API_KEY="your-ibm-cloud-api-key"
$env:AGCC_GRANITE_BASE_URL="https://eu-de.ml.cloud.ibm.com"
$env:AGCC_GRANITE_PROJECT_ID="68204ffc-8923-48ff-b244-9e81162676cc"
$env:AGCC_GRANITE_MODEL_ID="ibm/granite-4-h-small"
$env:AGCC_WEATHER_API_URL="https://api.open-meteo.com/v1/forecast"
$env:AGCC_SPACE_WEATHER_API_URL="https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
```

macOS or Linux:

```bash
export AGCC_GRANITE_API_KEY="your-ibm-cloud-api-key"
export AGCC_GRANITE_BASE_URL="https://eu-de.ml.cloud.ibm.com"
export AGCC_GRANITE_PROJECT_ID="68204ffc-8923-48ff-b244-9e81162676cc"
export AGCC_GRANITE_MODEL_ID="ibm/granite-4-h-small"
export AGCC_WEATHER_API_URL="https://api.open-meteo.com/v1/forecast"
export AGCC_SPACE_WEATHER_API_URL="https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
```

Only `AGCC_GRANITE_API_KEY` is secret. Never add it to source code, screenshots, commits, or issue reports. Watsonx and live environment data are optional for deterministic development paths; the backend exposes explicit configuration and availability errors when an external adapter is unavailable.

To use the larger hybrid station catalog instead of the controlled demo catalog, set an absolute path:

```powershell
$env:AGCC_STATION_CATALOG_PATH="C:\path\to\Suborbital\agcc\data\catalogs\stations.hybrid.json"
```

```bash
export AGCC_STATION_CATALOG_PATH="/path/to/Suborbital/agcc/data/catalogs/stations.hybrid.json"
```

Catalog fields marked as assumptions are intentionally identified in the interface and must not be presented as provider-verified operational data.

### 3. Install and Start the Frontend

Open a second terminal from the repository root:

```bash
cd agcc/frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` requests to the backend on port `8000`.

## Using the Application

1. Open **Setup** and define the circular orbit.
2. Configure the satellite communication system.
3. Select compatible ground stations from the catalog.
4. Enter required data volume, deadline, budget, and planning preference.
5. Finish setup to create synchronized Prediction, Live, and Anomaly timelines.
6. Review the generated contact route, expected completion, capacity, and cost.
7. Start or pause the simulation and select a speed in modeled timelines.
8. Use **Live** to observe dynamically refreshed weather and routing effects.
9. Create an anomaly branch, describe an operational issue to Watsonx, and confirm the structured proposal.
10. Calculate a forward replan and explicitly approve or reject it.

### Timeline Semantics

- **Prediction** uses the initial shared forecast and models the planned mission outcome.
- **Live** advances at wall-clock speed and refreshes executable conditions such as weather.
- **Anomaly** is an isolated branch for disruption injection and recovery testing; it does not modify Prediction.

## API Overview

The browser-oriented API is rooted at `/api/v1`. A client first creates a session with `POST /api/v1/sessions`, stores the returned identifier, and sends it as `X-AGCC-Session` on subsequent requests.

Important endpoint groups include:

- `/api/v1/timelines/initialize` - atomically initialize all three timelines
- `/api/v1/catalog/stations` - list available ground stations
- `/api/v1/scenario/*` - configure orbit, communications, stations, and mission constraints
- `/api/v1/passes/compute` and `/api/v1/plan` - calculate opportunities and contact plans
- `/api/v1/weather` and `/api/v1/space-weather` - retrieve environment context
- `/api/v1/simulation/*` - start, pause, resume, fork, and inspect simulation state
- `/api/v1/anomalies/*` - parse, discuss, and confirm anomaly proposals
- `/api/v1/replans/*` - create and decide forward-plan proposals
- `/api/v1/events/stream` - stream session events using Server-Sent Events
- `/api/v1/watsonx/status` - inspect non-secret Watsonx configuration and connectivity

FastAPI's `/docs` page contains the complete generated request and response reference.

## Verification and Tests

### Backend

From `agcc/backend` with the Python environment activated:

```bash
pytest
ruff check .
mypy src/agcc
python scripts/run_golden_verification.py --benchmark
```

### Frontend

From `agcc/frontend`:

```bash
npm test -- --run
npm run build
```

### Full Cross-Stack Verification

From `agcc/backend`:

```bash
python scripts/verify_all.py --benchmark
```

This runs backend tests, golden verification, linting, static typing, frontend tests, and the production frontend build in sequence.

## Engineering Notes

- Domain timestamps are UTC and timezone-aware.
- Mission quantities use explicit units in models and UI labels.
- The backend simulation clock is authoritative for position, contacts, data transfer, costs, and events.
- Scenario and timeline state is held in memory; restarting the backend clears active sessions.
- Live weather responses are normalized, cached, and hashed for provenance.
- Rain attenuation is a planning estimate based on ITU-R P.618/P.838/P.839, not measured RF telemetry.
- NOAA K-index data is displayed as context and does not directly alter link capacity.
- Golden fixtures support reproducibility without requiring external service availability.

## Limitations

- Circular LEO orbits only; this is not a general high-fidelity flight-dynamics platform.
- Station catalogs contain demo or assumption-marked data and do not represent guaranteed commercial access.
- No persistent database or multi-user authentication is included in the prototype.
- External weather and AI behavior depends on service availability, account permissions, quotas, and regional model availability.
- All generated plans require operational review before being used outside a demonstration.

## Future Scope

With access to operational data, provider partnerships, and additional funding, Suborbital can evolve from a controlled planning prototype into a production-grade satellite and ground-network coordination platform.

- **Real orbital data:** Replace manually configured circular-orbit assumptions with validated, continuously refreshed Two-Line Element (TLE) sets from authoritative providers. Production propagation would include TLE provenance, age and quality checks, conjunction-aware updates, and higher-fidelity orbit models where mission requirements justify them.
- **Multi-satellite operations:** Extend the planner from one spacecraft to fleets and constellations. The scheduling engine would resolve competing passes, shared ground-station capacity, mission priorities, deadlines, link compatibility, data backlogs, and cross-mission budget constraints across many satellites simultaneously.
- **Ground-station network software:** Provide deployable software for participating ground stations so each site can securely exchange availability, supported bands, antenna capabilities, maintenance windows, pricing, and reservation state with satellites and other stations through a common protocol.
- **Automated assignment and reservation:** Introduce transactional station booking with conflict detection, reservation holds, approval policies, cancellation rules, and auditable provider confirmations. Stations would be assigned and reserved automatically according to mission priority, pass geometry, predicted link quality, weather, cost, data urgency, reliability, regulatory constraints, and current network load.
- **Closed-loop network coordination:** Connect planning to authenticated telemetry and station status feeds so schedules can be revised when an orbit changes, a pass underperforms, weather degrades a link, or a station becomes unavailable. Human-defined policy and approval boundaries would remain authoritative for high-impact decisions.
- **Interoperability and governance:** Define secure APIs and shared data contracts for satellite operators and station providers, including identity, authorization, encryption, provenance, service-level reporting, billing records, and complete audit trails for every automated decision.

## License

No open-source license has been declared for this repository. All rights are reserved unless the repository owner adds a license file.
