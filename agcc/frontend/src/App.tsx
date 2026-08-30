import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgccClient, resetSession } from './api'
import { AssumptionMark } from './DataStatus'
import { GlobeView, type GroundPoint, type SatelliteMarker, type StationMarker } from './GlobeView'
import { SetupGlobe } from './SetupGlobe'
import { LiveWeather, weatherCondition, type WeatherVisual } from './LiveWeather'
import { StationCatalogPicker } from './StationCatalogPicker'

import { AsteroidBackground, DeepSpaceBackground, ScrubberInput, PresetSelector, SatelliteWireframe, GlassSelect } from './SetupComponents'
import { Home } from './Home'
import { MissionLoader } from './MissionLoader'
import { useMissionStore, type Draft, type MissionMode } from './store'
import './weather.css'
import './setup-glassmorphism.css'
import './mission-glass.css'
import './assumptions.css'
import './styles.css'
import './task15.css'
import './v2.css'
import './runtime.css'
import './runtime-v3.css'
import './mission-controls.css'
import './home.css'

const LockIcon = () => (
  <svg className="home-lock" viewBox="0 0 12 12" aria-hidden="true">
    <rect x="2.2" y="5.2" width="7.6" height="5.4" rx="1" />
    <path d="M3.8 5.2V3.8a2.2 2.2 0 0 1 4.4 0v1.4" />
  </svg>
)

function GlobalHeader({ path, appliedDraft, onNavigate }: { path: string; appliedDraft: any; onNavigate: (path: string) => void }) {
  return (
    <header className="home-header" style={{ position: path === '/' ? 'absolute' : 'relative', width: '100%', boxSizing: 'border-box' }}>
      <button className="home-brand" onClick={() => onNavigate('/')} aria-label="Suborbital home">
        <span className="home-brand-mark"><i /><i /><i /><i /></span>
        <span><b>Suborbital</b><small>ORBITAL SYSTEMS</small></span>
      </button>
      <nav className="home-nav" aria-label="Primary navigation">
        <button className={path === '/' ? 'active' : ''} aria-current={path === '/' ? 'page' : undefined} onClick={() => onNavigate('/')}>HOME</button>
        <button className={path.startsWith('/setup') ? 'active' : ''} aria-current={path.startsWith('/setup') ? 'page' : undefined} onClick={() => onNavigate('/setup/orbit')}>SETUP</button>
        <button className={`locked ${path === '/mission' ? 'active' : ''}`} disabled={!appliedDraft} onClick={() => appliedDraft && onNavigate('/mission')} title={appliedDraft ? 'Open mission control' : 'Complete setup to unlock mission control'}>
          MISSION {!appliedDraft && <LockIcon />}
        </button>
      </nav>
      <div className="home-coordinate" aria-hidden="true"><span>OPS / 001</span><span>UTC +05:30</span></div>
    </header>
  )
}

const setupRoutes = ['/setup/orbit', '/setup/communications', '/setup/stations', '/setup/mission']
const routeLabel: Record<string, string> = { '/setup/orbit': 'Orbit', '/setup/communications': 'Communications', '/setup/stations': 'Stations', '/setup/mission': 'Mission' }
const sessionKeys: Record<MissionMode, string> = { prediction: 'agcc.session.prediction.v2', live: 'agcc.session.live.v2', branch: 'agcc.session.anomaly.v2' }
const clients: Record<MissionMode, AgccClient> = { prediction: new AgccClient('', sessionKeys.prediction), live: new AgccClient('', sessionKeys.live), branch: new AgccClient('', sessionKeys.branch) }
const navigate = (path: string, setPath: (path: string) => void) => { history.pushState({}, '', path); setPath(path) }
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="glass-value-box">
    {children}
    <span className="right-label">{label}</span>
  </div>
)

type Opportunity = { pass_id: string; contact_id: string | null; station_id: string; station_name: string; start_at: string; end_at: string; volume_mb: number; classification: string; reason: string; planned_cost?: string | null; actual_volume_mb?: number; completed_at?: string | null; usable_capacity_mb?: number; average_effective_rate_mbps?: number; weather_precipitation_mm_per_hr?: number | null; weather_valid_from?: string | null; weather_quality?: string | null }
type Contact = { contact_id: string; station_id: string; station_name: string; start_at: string; end_at: string; rate_mbps: number; band: string; anomaly_multiplier: number; target_volume_mb: number; actual_volume_mb: number }
type BaselineIdentity = { snapshot_id: string | null; plan_id: string | null; created_at: string | null; weather_hash: string | null }
type SimulationState = { started: boolean; finished: boolean; sim_time: string; deadline_at: string; mission_start_at: string; mission_end_at: string | null; cost_used: string; committed_cost: string; remaining_budget: string; maximum_budget: string; cost_assumed: boolean; delivered_mb: number; remaining_mb: number; paused: boolean; speed: string; satellite: SatelliteMarker; current_contact: Contact | null; predicted_final_mb: number; predicted_shortfall_mb: number; confirmed_shortfall_mb: number; shortfall_status: 'clear' | 'provisional_monitoring' | 'confirmed_action_required'; required_mb: number; resolution_required: boolean; preflight: { capacity_policy: 'frozen' | 'live'; weather_frozen: boolean; ledger_allocated_mb: number; ledger_capacity_mb: number; feasible: boolean }; baseline: BaselineIdentity; plan: { plan_id: string; version: number; planned_completion_at: string | null; estimated_total_cost: string }; stations: StationMarker[]; opportunities: Opportunity[]; event_count: number }
type SimEvent = { event_id: string; sequence_number: number; event_type: string; sim_time: string; contact_id?: string; fragment_id?: string; delivered_volume_mb?: number; rate_mbps?: number; predicted_shortfall_mb?: number; planned_volume_mb?: number | null; planned_cost?: string | null; description: string; station_name?: string | null; source_station_name?: string | null; destination_station_name?: string | null; reroute_reason?: string | null }
type Runtime = { state: SimulationState; events: SimEvent[]; track: GroundPoint[] }
type AnomalyProposal = { proposal_id: string; status: string; rate_multiplier: number | null; clarification_questions: string[]; source_text: string; intent: { anomaly_type?: string; station_id?: string; qualitative_severity?: string; suggested_multiplier?: number; confidence?: number; cause?: string; starts_at?: string; ends_at?: string; assumptions?: string[] } }
type ReplanProposal = { proposal_id: string; predicted_shortfall_before_mb: number; predicted_shortfall_after_mb: number; approval_reasons: string[]; alternatives: { kind: string; calculated_value: string | number | string[] }[]; proposed_plan?: { contacts: { contact_id: string; station_id: string }[] } | null; diff: { added_contact_ids: string[]; removed_contact_ids: string[]; cost_delta: string } | null }
type Resolution = { reason: { summary: string; impact: string; action: string; tradeoff: string }; approval_prompt: string }
type WatsonStatus = { configured: boolean; status: string; reachable: boolean | null; endpoint?: string; model_id?: string; message?: string }
type PlanResult = { status: 'feasible' | 'no_feasible_plan_found'; validation_violations?: string[]; planned_volume_mb: number; required_volume_mb: number; estimated_total_cost: string; planned_completion_at?: string | null }
type InitializationFailure = { kind: 'constraint' | 'error'; message: string; plan?: PlanResult }
type TimelineInitializeResponse = { status: 'ready' | 'no_feasible_plan_found'; sessions?: Record<MissionMode, string>; states?: Record<MissionMode, SimulationState>; track?: GroundPoint[]; plan: PlanResult; baseline_at: string; baseline?: { snapshot_id: string; plan_id: string; created_at: string; baseline_at: string; weather_hash: string } }

const bandRanges: Record<string, [number, number, number]> = { S: [2, 4, 2.2], X: [8, 12, 9.6], Ka: [26.5, 40, 27.5] }
const localTime = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })
const localClock = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
function validateDraft(draft: Draft): string[] {
  const errors: string[] = []
  const range = bandRanges[draft.band]
  if (!range || draft.frequency < range[0] || draft.frequency > range[1]) errors.push(`${draft.band}-band requires ${range?.[0] ?? '?'}–${range?.[1] ?? '?'} GHz; ${draft.frequency} GHz is contradictory.`)
  if (draft.orbit.altitude_km < 200 || draft.orbit.altitude_km > 2000) errors.push('Circular LEO altitude must be between 200 and 2,000 km.')
  if (draft.orbit.inclination_deg < 0 || draft.orbit.inclination_deg > 180) errors.push('Inclination must be between 0° and 180°.')
  if (!(draft.rate > 0) || !(draft.protocolEfficiency > 0 && draft.protocolEfficiency <= 1)) errors.push('Rate must be positive and protocol efficiency must be in (0, 1].')
  if (!draft.stations.length) errors.push('Select at least one compatible ground station.')
  if (!(draft.required > 0) || !(draft.budget >= 0)) errors.push('Required data must be positive and budget cannot be negative.')
  if (new Date(draft.deadline) <= new Date(draft.orbit.epoch)) errors.push('Deadline must be after the orbit epoch/release time.')
  if (new Date(draft.deadline).getTime() <= Date.now()) errors.push('Deadline has already passed. Please select a future deadline.')
  return errors
}

function OrbitManipulator({ draft, updateOrbit }: { draft: Draft; updateOrbit: (patch: Partial<Draft['orbit']>) => void }) {
  const preview = useMemo(() => Array.from({ length: 121 }, (_, index) => {
    const argument = index / 120 * Math.PI * 2
    const inclination = draft.orbit.inclination_deg * Math.PI / 180
    const latitude = Math.asin(Math.sin(inclination) * Math.sin(argument))
    const longitude = draft.orbit.raan_deg * Math.PI / 180 + Math.atan2(Math.cos(inclination) * Math.sin(argument), Math.cos(argument))
    return { latitude_deg: latitude * 180 / Math.PI, longitude_deg: ((longitude * 180 / Math.PI + 540) % 360) - 180 }
  }), [draft.orbit.inclination_deg, draft.orbit.raan_deg])
  const satellite = preview[Math.round((draft.orbit.phase_deg % 360) / 360 * 120)]
  return <div className="orbit-preview-stack"><SetupGlobe groundTrack={preview} satellite={{ ...satellite, altitude_km: draft.orbit.altitude_km }} orbitConfig={draft.orbit} onOrbitChange={updateOrbit}/></div>
}

function Setup({ path, setPath }: { path: string; setPath: (path: string) => void }) {
  const { draft, updateDraft, updateOrbit, applyDraft } = useMissionStore()
  const index = Math.max(0, setupRoutes.indexOf(path))
  const errors = validateDraft(draft)
  const visibleErrors = errors.filter((error) => {
    if (path === '/setup/orbit') return error.includes('altitude') || error.includes('Inclination') || error.includes('Deadline')
    if (path === '/setup/communications') return error.includes('-band') || error.includes('Rate')
    if (path === '/setup/stations') return error.includes('ground station')
    return true
  })
  const finish = () => { applyDraft(); navigate('/mission', setPath) }
  const chooseBand = (band: string) => updateDraft({ band, frequency: bandRanges[band][2], stations: [] })
  return (
    <>
      <AsteroidBackground />
      <section className="setup-shell glass-island-layout">
        <aside className="setup-progress glass-island-navigator">
          <span className="eyebrow">SCENARIO SETUP</span>
          {setupRoutes.map((route, i) => {
            const descriptions: Record<string, string> = {
              '/setup/orbit': 'Configure trajectory',
              '/setup/communications': 'Design telemetry link',
              '/setup/stations': 'Select ground network',
              '/setup/mission': 'Finalize constraints',
            };
            return (
              <button className={route === path ? 'active' : i < index ? 'done' : ''} onClick={() => navigate(route, setPath)} key={route}>
                <b>{i + 1}</b>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                  <span>{routeLabel[route]}</span>
                  {route === path && <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.02em', lineHeight: '1.2', textAlign: 'left' }}>{descriptions[route]}</span>}
                </div>
              </button>
            )
          })}
        </aside>
        
        <section className="setup-stage">
          <div className="setup-copy">
            <span className="eyebrow">STEP {index + 1} OF 4</span>
            <h2>{routeLabel[path] ?? 'Orbit'}</h2>
          </div>
          
          {path === '/setup/orbit' && (
            <div className="orbit-editor">
              <div className="glass-island-globe" style={{ flex: '0 0 55%' }}>
                <OrbitManipulator draft={draft} updateOrbit={updateOrbit}/>
              </div>
              <div className="setup-form-column" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="glass-island-form" style={{ display: 'flex', flexDirection: 'column' }}>
                  <h3 className="island-title">Orbital Parameters</h3>
                  <PresetSelector value={draft.orbit.inclination_deg} onChange={(val) => updateOrbit({ inclination_deg: val })} />
                  <div className="field-grid">
                    <ScrubberInput label="Altitude (km)" min={200} max={2000} value={draft.orbit.altitude_km} onChange={(val) => updateOrbit({ altitude_km: val })} />
                    <ScrubberInput label="Inclination (degrees)" min={0} max={180} value={draft.orbit.inclination_deg} onChange={(val) => updateOrbit({ inclination_deg: val })} />
                    <ScrubberInput label="RAAN (degrees)" min={0} max={359.999} value={draft.orbit.raan_deg} onChange={(val) => updateOrbit({ raan_deg: val })} />
                    <ScrubberInput label="Phase (degrees)" min={0} max={359.999} value={draft.orbit.phase_deg} onChange={(val) => updateOrbit({ phase_deg: val })} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: 'auto' }}>
                  <button className="home-cta secondary" onClick={() => navigate('/', setPath)} style={{ width: '100%' }}>
                    ← BACK TO HOME
                    <div className="home-cta-target"><i/><i/></div>
                  </button>
                  <button className="home-cta" onClick={() => navigate('/setup/communications', setPath)} style={{ width: '100%' }}>
                    CONTINUE TO COMMUNICATIONS
                    <div className="home-cta-target"><i/><i/></div>
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {path === '/setup/communications' && (
            <div className="setup-island-row">
              <div className="setup-form-column" style={{ flex: 1.2, gap: '12px' }}>
                <div className="glass-island-form" style={{ flex: 1, justifyContent: 'center' }}>
                  <h3 className="island-title">Radio Parameters</h3>
                  <div className="field-grid">
                    <Field label="Band">
                      <GlassSelect 
                        value={draft.band} 
                        onChange={(val) => chooseBand(val)}
                        options={[
                          { value: "X", label: "X [8–12 GHz]" },
                          { value: "S", label: "S [2–4 GHz]" },
                          { value: "Ka", label: "Ka [26.5–40 GHz]" }
                        ]}
                      />
                    </Field>
                    <Field label="Exact carrier frequency (GHz)">
                      <input className={errors.some((item) => item.includes('-band')) ? 'invalid' : ''} type="number" step=".1" value={draft.frequency} onChange={(event) => updateDraft({ frequency: +event.target.value })}/>
                    </Field>
                    <Field label="Maximum downlink rate (Mbps)">
                      <input type="number" min=".01" value={draft.rate} onChange={(event) => updateDraft({ rate: +event.target.value })}/>
                    </Field>
                  </div>
                </div>
                  
                <div className="glass-island-form" style={{ flex: 1, justifyContent: 'center' }}>
                  <h3 className="island-title">Signal & Protocol</h3>
                  <div className="field-grid">
                    <Field label="Polarization">
                      <GlassSelect 
                        value={draft.polarization} 
                        onChange={(val) => updateDraft({ polarization: val as Draft['polarization'] })}
                        options={[
                          { value: "horizontal", label: "Horizontal" },
                          { value: "vertical", label: "Vertical" },
                          { value: "circular", label: "Circular" }
                        ]}
                      />
                    </Field>
                    <Field label="Protocol efficiency">
                      <input type="number" step=".01" min=".01" max="1" value={draft.protocolEfficiency} onChange={(event) => updateDraft({ protocolEfficiency: +event.target.value })}/>
                    </Field>
                    <div className="glass-value-box">
                      <div className="glass-value-text">
                        {(draft.rate * draft.protocolEfficiency).toFixed(1)}
                      </div>
                      <span className="right-label">TELEMETRY OUTPUT (MBPS)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="setup-form-column" style={{ flex: 1, gap: '12px' }}>
                <div className="glass-island-globe" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <SatelliteWireframe />
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: 'auto' }}>
                  <button className="home-cta secondary" onClick={() => navigate('/setup/orbit', setPath)} style={{ width: '100%' }}>
                    ← BACK TO ORBIT
                    <div className="home-cta-target"><i/><i/></div>
                  </button>
                  <button className="home-cta" disabled={errors.some(e => e.includes('-band') || e.includes('Rate'))} onClick={() => navigate('/setup/stations', setPath)} style={{ width: '100%' }}>
                    CONTINUE TO STATIONS
                    <div className="home-cta-target"><i/><i/></div>
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {path === '/setup/stations' && <StationCatalogPicker onBack={() => navigate('/setup/communications', setPath)} onContinue={() => navigate('/setup/mission', setPath)}/>}
          
          {path === '/setup/mission' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, minHeight: 0 }}>
              <div className="setup-island-row" style={{ flex: '0 0 auto' }}>
                <div className="setup-form-column" style={{ flex: 1 }}>
                  <div className="glass-island-form">
                    <h3 className="island-title">Mission Targets</h3>
                    <div className="field-grid">
                      <Field label="Required data (MB)">
                        <input type="number" min=".01" value={draft.required} onChange={(event) => updateDraft({ required: +event.target.value })}/>
                      </Field>
                      <Field label="Hard deadline UTC">
                        <input value={draft.deadline} onChange={(event) => updateDraft({ deadline: event.target.value })}/>
                      </Field>
                    </div>
                  </div>
                </div>
                <div className="setup-form-column" style={{ flex: 1 }}>
                  <div className="glass-island-form">
                    <h3 className="island-title">Resource Constraints</h3>
                    <div className="field-grid">
                      <Field label="Maximum budget (USD)">
                        <input type="number" min="0" value={draft.budget} onChange={(event) => updateDraft({ budget: +event.target.value })}/>
                      </Field>
                      <Field label="Planning preference">
                        <GlassSelect 
                          value={draft.preference} 
                          onChange={(val) => updateDraft({ preference: val as Draft['preference'] })}
                          options={[
                            { value: "fastest", label: "Fastest" },
                            { value: "lowest_cost", label: "Lowest cost" },
                            { value: "balanced", label: "Balanced" }
                          ]}
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              </div>
              <div className="glass-island-form manifest-panel" style={{ flex: '0 0 auto', minHeight: 0 }}>
                <h3 className="island-title" style={{ color: '#94a3b8' }}>PRE-COMPUTATION MANIFEST</h3>
                <div className="manifest-grid">
                  <div className="manifest-col">
                    <span className="manifest-label">Orbit</span>
                    <span className="manifest-value">{draft.orbit.altitude_km.toFixed(0)}km @ {draft.orbit.inclination_deg.toFixed(1)}°</span>
                  </div>
                  <div className="manifest-col">
                    <span className="manifest-label">Comms</span>
                    <span className="manifest-value">{draft.band} Band ({draft.rate} Mbps)</span>
                  </div>
                  <div className="manifest-col">
                    <span className="manifest-label">Ground</span>
                    <span className="manifest-value">{draft.stations.length} Stations Linked</span>
                  </div>
                  <div className="manifest-status">
                    <div className="status-ring"></div>
                    <span>SYSTEM NOMINAL</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '24px', marginTop: 'auto' }}>
                <div style={{ flex: 1 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button className="home-cta secondary" onClick={() => navigate('/setup/stations', setPath)} style={{ width: '100%' }}>
                    ← BACK TO STATIONS
                    <div className="home-cta-target"><i/><i/></div>
                  </button>
                  <button className="home-cta" disabled={errors.length > 0} onClick={() => finish()} style={{ width: '100%' }}>
                    FINISH SETUP & CONTINUE
                    <div className="home-cta-target"><i/><i/></div>
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {visibleErrors.length > 0 && (
            <div className="validation-errors">
              {visibleErrors.map((error) => <p key={error}>{error}</p>)}
            </div>
          )}
        </section>
      </section>
    </>
  )
}

function buildPayload(draft: Draft, mode: MissionMode, revision: number) {
  const suffix = `${mode}_${revision}`
  return { scenario: { scenario_id: `scenario_${suffix}`, name: `${mode} browser mission`, satellite_id: `sat_${suffix}`, station_ids: draft.stations, mission_id: `mission_${suffix}`, constraints: { maximum_budget: String(draft.budget), currency: 'USD', station_selection: { allow_all_eligible: false, authorized_station_ids: draft.stations }, planning_preference: draft.preference, allow_additional_contact_proposals: true } }, satellite: { satellite_id: `sat_${suffix}`, name: 'Custom satellite', orbit: draft.orbit, comms: { band: draft.band, carrier_frequency_ghz: draft.frequency, max_downlink_rate_mbps: draft.rate, protocol_efficiency: draft.protocolEfficiency, min_elevation_deg: 5, polarization: draft.polarization }, provenance: { source_type: 'manual', source_name: 'browser-session', fetched_at: new Date().toISOString(), assumption_fields: ['orbit', 'comms'] } }, mission: { mission_id: `mission_${suffix}`, name: 'Custom downlink', required_volume_mb: draft.required, release_at: draft.orbit.epoch, deadline_at: draft.deadline } }
}

function ModeTabs() { 
  const { mode, setMode } = useMissionStore(); 
  const descriptions: Record<MissionMode, string> = {
    prediction: 'Simulate the full mission route using the initial weather forecast.',
    live: 'Execute the mission against live, dynamically updated weather data.',
    branch: 'Branch the timeline to inject and resolve what-if disruptions.'
  };
  const ICONS = {
    prediction: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>,
    live: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>,
    branch: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
  };
  return (
    <div className="setup-progress glass-island-navigator horizontal" role="tablist">
      {([['prediction','Prediction'],['live','Real Time'],['branch','Anomalies']] as [MissionMode,string][]).map(([id,label]) => (
        <button role="tab" aria-selected={mode === id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)} key={id}>
          <b>{ICONS[id]}</b>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.01em', lineHeight: '1.4', textAlign: 'left', textTransform: 'none' }}>{descriptions[id]}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function AnomalyChat({ runtime, refresh, resetToStart }: { runtime: Runtime; refresh: () => void; resetToStart: () => void }) {
  const client = clients.branch
  const [text, setText] = useState('')
  const [proposal, setProposal] = useState<AnomalyProposal | null>(null)
  const [replan, setReplan] = useState<ReplanProposal | null>(null)
  const [turns, setTurns] = useState<string[]>([])
  const [watson, setWatson] = useState<WatsonStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState<'confirm'|'replan'|'approve'|'reject'|null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [message, setMessage] = useState('Describe an anomaly in natural language. The configured LLM will normalize it and ask for missing details.')
  const stationName = (stationId?: string) => runtime.state.stations.find((item) => item.station_id === stationId)?.name ?? stationId ?? 'station needed'
  const probe = () => { setBusy(true); client.request<WatsonStatus>('/watsonx/status?probe=true').then(setWatson).catch((error) => setWatson({ configured: false, status: 'probe_failed', reachable: false, message: error.message })).finally(() => setBusy(false)) }
  useEffect(probe, [])
  const send = () => {
    const userTurn = `User: ${text.trim()}`
    const transcript = [...turns, userTurn]
    setTurns(transcript); setText(''); setBusy(true)
    client.request<AnomalyProposal>('/anomalies/chat', { method: 'POST', body: JSON.stringify({ text: transcript.join('\n') }) }).then((item) => {
      const interval = item.intent.ends_at
        ? ` from ${localTime(item.intent.starts_at ?? runtime.state.sim_time)} until ${localTime(item.intent.ends_at)}`
        : ` from ${localTime(item.intent.starts_at ?? runtime.state.sim_time)} onward`
      const confidence = item.intent.confidence == null
        ? ''
        : ` · confidence ${(item.intent.confidence * 100).toFixed(0)}%`
      const reply = item.clarification_questions.join(' ') || `Proposed ${item.intent.anomaly_type ?? 'anomaly'} at multiplier ${item.rate_multiplier ?? 'unresolved'}×${interval}${confidence}. Confirm to inject it.`
      setTurns((current) => [...current, `LLM: ${reply}`]); setProposal(item); setMessage(reply)
    }).catch((error) => { const reply = error.message ?? 'LLM anomaly parsing failed.'; setTurns((current) => [...current, `System: ${reply}`]); setMessage(reply) }).finally(() => setBusy(false))
  }
  const confirm = async () => {
    if (!proposal || actionBusy) return
    setActionBusy('confirm'); setMessage('Recording anomaly on the branch timeline…')
    try {
      await client.request(`/anomalies/confirm?proposal_id=${encodeURIComponent(proposal.proposal_id)}`, { method: 'POST' })
      setProposal((current) => current ? { ...current, status: 'confirmed' } : current)
      setMessage('Anomaly recorded at the branch simulation time. A forward replan is now available.')
      refresh()
    } catch (error) { setMessage((error as Error).message ?? 'Confirmation failed.') }
    finally { setActionBusy(null) }
  }
  const requestReplan = async () => {
    if (actionBusy) return
    setActionBusy('replan'); setMessage('Calculating an anomaly-adjusted forward plan. Please wait; this can take time for long missions…')
    try {
      const next = await client.request<ReplanProposal>('/replans', { method: 'POST', body: JSON.stringify({ reason: `LLM-normalized anomaly: ${proposal?.source_text ?? text}` }) })
      setReplan(next); setMessage('Forward replan calculated and validated. Review it before approval.')
    } catch (error) { setMessage((error as Error).message ?? 'Replan failed.') }
    finally { setActionBusy(null) }
  }
  const decide = async (decision: 'approve'|'reject') => {
    if (!replan || actionBusy) return
    setActionBusy(decision); setMessage(`${decision === 'approve' ? 'Approving and activating' : 'Rejecting'} the proposed branch plan…`)
    try {
      await client.request(`/replans/${replan.proposal_id}/${decision}`, { method: 'POST', body: JSON.stringify({ reason: `User ${decision}d proposal` }) })
      setMessage(`Replan ${decision}d on the anomaly branch.`)
      setReplan(null); refresh()
      if (decision === 'reject') setRejectOpen(true)
    } catch (error) { setMessage((error as Error).message ?? 'Decision failed.') }
    finally { setActionBusy(null) }
  }
  const openMissionSetup = () => {
    history.pushState({}, '', '/setup/mission')
    dispatchEvent(new PopStateEvent('popstate'))
    setRejectOpen(false)
  }
  const addedStations = replan?.proposed_plan?.contacts
    .filter((item) => replan.diff?.added_contact_ids.includes(item.contact_id))
    .map((item) => stationName(item.station_id)) ?? []
  return <>
    <section className="anomaly-workbench panel">
      <div className="watson-heading"><div><span className="eyebrow">SEPARATE ANOMALY TIMELINE · GROQ CHAT</span><h2>Describe your anomaly</h2><small>Branch time: {localTime(runtime.state.sim_time)}</small></div><div className="anomaly-heading-actions"><button type="button" onClick={resetToStart} disabled={Boolean(actionBusy)}>Reset branch to T=0</button><button className={`watson-status ${watson?.reachable ? 'ready' : 'error'}`} onClick={probe} disabled={busy || Boolean(actionBusy)}>{watson?.reachable ? `WATSONX READY · ${watson.model_id}` : `${watson?.status?.replaceAll('_',' ') ?? 'TESTING WATSONX'} · RETEST`}</button></div></div>
      {watson?.message && <p className="watson-error">{watson.message}</p>}
      <div className="chat-history">{turns.map((turn, index) => <p className={turn.startsWith('User:') ? 'user-turn' : turn.startsWith('LLM:') ? 'watson-turn' : 'system-turn'} key={`${index}-${turn}`}>{turn}</p>)}</div>
      <div className="anomaly-chat"><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={`Example: ${runtime.state.stations.find((item) => item.classification === 'approved')?.name ?? 'the next station'} has severe link degradation`}/><button disabled={!text.trim() || busy || Boolean(actionBusy) || watson?.reachable === false} onClick={send}>{busy ? 'Contacting…' : 'Ask WatsonX'}</button></div>
      <p className="workflow-message">{message}</p>
      {actionBusy && <div className="action-progress" role="progressbar" aria-label={`${actionBusy} in progress`}><span/><b>{actionBusy === 'replan' ? 'Computing pass capacity and validating route…' : `${actionBusy} in progress…`}</b></div>}
      {proposal && <div className="proposal-card"><b>{proposal.status.replaceAll('_',' ')}</b><span>{proposal.intent.anomaly_type ?? 'unresolved'} · {stationName(proposal.intent.station_id)} · multiplier {proposal.rate_multiplier ?? 'needs clarification'}×<AssumptionMark reason="Groq proposed the effect; deterministic bounds validate the multiplier."/></span><button disabled={proposal.status !== 'pending' || Boolean(actionBusy)} onClick={confirm}>{actionBusy === 'confirm' ? 'Confirming…' : 'Confirm branch injection'}</button><button disabled={Boolean(actionBusy) || (proposal.status !== 'confirmed' && !runtime.events.some((event) => event.event_type === 'anomaly_detected'))} onClick={requestReplan}>{actionBusy === 'replan' ? 'Calculating…' : 'Calculate replan'}</button></div>}
      {replan && <div className="proposal-card"><b>Approval required</b><span>Added future contacts: {addedStations.join(', ') || 'No replacement contact'} · cost Δ {replan.diff?.cost_delta ?? 'not applicable'} · remaining shortfall {replan.predicted_shortfall_after_mb.toFixed(2)} MB</span><small>Approve explicitly authorizes the calculated plan cost. If needed, the branch budget ceiling will increase only to that total; the deadline remains hard.</small><button disabled={Boolean(actionBusy) || !replan.diff || replan.predicted_shortfall_after_mb > 1e-9} onClick={() => void decide('approve')}>{actionBusy === 'approve' ? 'Approving…' : 'Approve'}</button><button disabled={Boolean(actionBusy)} onClick={() => void decide('reject')}>{actionBusy === 'reject' ? 'Rejecting…' : 'Reject'}</button></div>}
    </section>
    {rejectOpen && <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal"><span className="eyebrow">REPLAN REJECTED</span><h2>Configure your own recovery path</h2><p>The anomaly branch remains unchanged. Open Mission Constraints to change the deadline, budget, planning preference, required volume, or selected stations, then apply the revised setup to calculate all three timelines again.</p><div className="modal-actions"><button onClick={() => setRejectOpen(false)}>Keep current branch</button><button onClick={openMissionSetup}>Edit mission constraints</button></div></div></div>}
  </>
}

function SemiGauge({ value, predicted = 0, total, shortfall = 0, color = '#e1ff00', label }: { value: number, predicted?: number, total: number, shortfall?: number, color?: string, label: string }) {
  const radius = 70;
  const strokeWidth = 10;
  const r = radius - strokeWidth / 2;
  const circumference = Math.PI * r;
  
  const pctValue = Math.min(1, Math.max(0, value / (total || 1)));
  const pctPredicted = Math.min(1, Math.max(0, predicted / (total || 1)));
  const pctShortfall = Math.min(1, Math.max(0, shortfall / (total || 1)));
  
  const offsetValue = circumference - (pctValue * circumference);
  const offsetPredicted = circumference - ((pctValue + pctPredicted) * circumference);
  const offsetShortfall = circumference - (pctShortfall * circumference);

  return (
    <div className="semi-gauge-container" style={{ position: 'relative', width: radius * 2, height: radius + 10, margin: '0 auto 16px auto' }}>
      <svg height={radius + 15} width={radius * 2} style={{ overflow: 'visible' }}>
        <defs>
          <filter id={`glow-${label.replace(/\s+/g, '')}`}>
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <path d={`M ${strokeWidth/2} ${radius} A ${r} ${r} 0 0 1 ${radius * 2 - strokeWidth/2} ${radius}`} fill="none" stroke="rgba(255, 255, 255, 0.05)" strokeWidth={strokeWidth} strokeLinecap="round"/>
        {predicted > 0 && (
          <path d={`M ${strokeWidth/2} ${radius} A ${r} ${r} 0 0 1 ${radius * 2 - strokeWidth/2} ${radius}`} fill="none" stroke={color} opacity={0.3} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} style={{ strokeDashoffset: offsetPredicted, transition: 'stroke-dashoffset 1s ease-in-out' }} filter={`url(#glow-${label.replace(/\s+/g, '')})`}/>
        )}
        <path d={`M ${strokeWidth/2} ${radius} A ${r} ${r} 0 0 1 ${radius * 2 - strokeWidth/2} ${radius}`} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} style={{ strokeDashoffset: offsetValue, transition: 'stroke-dashoffset 1s ease-in-out' }} filter={`url(#glow-${label.replace(/\s+/g, '')})`}/>
        {shortfall > 0 && (
          <path d={`M ${radius * 2 - strokeWidth/2} ${radius} A ${r} ${r} 0 0 0 ${strokeWidth/2} ${radius}`} fill="none" stroke="#f87171" strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} style={{ strokeDashoffset: offsetShortfall, transition: 'stroke-dashoffset 1s ease-in-out' }} filter={`url(#glow-${label.replace(/\s+/g, '')})`}/>
        )}
      </svg>
      <div style={{ position: 'absolute', bottom: '0px', left: 0, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff', lineHeight: 1 }}>{Math.round((pctValue + pctPredicted) * 100)}%</div>
        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '4px' }}>{label}</div>
      </div>
    </div>
  )
}

function WeatherGlyph({ weather }: { weather: WeatherVisual }) {
  const label = weatherCondition(weather)
  return <span className={`station-weather-icon ${weather.kind}`} role="img" aria-label={`${label} weather`} title={`${label} weather`}>
    {weather.kind === 'clear' && <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></svg>}
    {weather.kind === 'partly' && <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 2.5v1.2M3.3 8H2.1M4.7 4.7l-.9-.9M11.3 4.7l.9-.9M7.2 19h10.2a3.8 3.8 0 0 0 .4-7.6 5.6 5.6 0 0 0-10.5-1.2A4.4 4.4 0 0 0 7.2 19Z"/></svg>}
    {weather.kind === 'cloud' && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 18.2h10.2a4.1 4.1 0 0 0 .5-8.2A6.1 6.1 0 0 0 6.4 8.7a4.8 4.8 0 0 0 .8 9.5Z"/></svg>}
    {weather.kind === 'rain' && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 15.5h10.2a4.1 4.1 0 0 0 .5-8.2A6.1 6.1 0 0 0 6.4 6a4.8 4.8 0 0 0 .8 9.5Z"/><path d="m8.5 18-1 2M13 18l-1 2M17.5 18l-1 2"/></svg>}
  </span>
}

function StationWeatherLabel({ stationName, weather, next = false }: { stationName: string; weather: WeatherVisual | null; next?: boolean }) {
  return <span className={`station-name-with-weather${next ? ' next' : ''}`}>
    {weather && <WeatherGlyph weather={weather}/>}
    <span className="station-weather-copy">
      <span>{stationName}</span>
      {weather && <small>{weatherCondition(weather)}</small>}
    </span>
  </span>
}

function Mission({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { appliedDraft, revision, mode, setMode } = useMissionStore()
  const [runtimes, setRuntimes] = useState<Partial<Record<MissionMode, Runtime>>>({})
  const [statuses, setStatuses] = useState<Partial<Record<MissionMode, string>>>({})
  const [failures, setFailures] = useState<Partial<Record<MissionMode, InitializationFailure>>>({})
  const [selectedStation, setSelectedStation] = useState<StationMarker | null>(null)
  const [selectedSatellite, setSelectedSatellite] = useState(false)
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const [resolutionProposal, setResolutionProposal] = useState<ReplanProposal | null>(null)
  const [resolutionError, setResolutionError] = useState('')
  const [liveWeatherVisual, setLiveWeatherVisual] = useState<WeatherVisual | null>(null)
  const initializing = useRef(new Set<MissionMode>())
  const fetchingResolution = useRef<Record<string, boolean>>({})

  const refresh = useCallback(async (target: MissionMode) => {
    const client = clients[target]
    const [state, events] = await Promise.all([client.request<SimulationState>('/simulation/state'), client.request<SimEvent[]>('/simulation/events')])
    setRuntimes((current) => ({ ...current, [target]: { state, events, track: current[target]?.track ?? [] } }))
    if (state.resolution_required) {
      if (!fetchingResolution.current[target]) {
        fetchingResolution.current[target] = true
        client.request<Resolution>('/mission/resolution').then(setResolution).catch((error) => {
          setResolutionError(error instanceof Error ? error.message : 'Explanation request failed.')
          // Keep this target latched until the shortfall clears or the user retries.
          // This prevents a one-second polling loop from repeatedly charging the LLM.
        })
      }
    } else {
      fetchingResolution.current[target] = false
      setResolutionError('')
    }
  }, [])

  const initializeAll = useCallback(async (draft: Draft, currentRevision: number) => {
    if (initializing.current.has('prediction')) return
    initializing.current = new Set(['prediction', 'live', 'branch'])
    setStatuses({ prediction: 'Building shared authoritative baseline…', live: 'Waiting for shared baseline…', branch: 'Waiting for shared baseline…' })
    setFailures({})
    for (const target of ['prediction', 'live', 'branch'] as MissionMode[]) resetSession(clients[target])
    try {
      const payload = buildPayload(draft, 'prediction', currentRevision)
      const baselineAt = new Date(Math.max(Date.now(), Date.parse(draft.orbit.epoch))).toISOString()
      const result = await clients.prediction.request<TimelineInitializeResponse>('/timelines/initialize', {
        method: 'POST',
        body: JSON.stringify({ scenario: payload, baseline_at: baselineAt }),
      })
      if (result.status !== 'ready' || !result.sessions || !result.states || !result.track) {
        const detail = result.plan.validation_violations?.length
          ? result.plan.validation_violations.join(' · ')
          : `Only ${result.plan.planned_volume_mb.toFixed(2)} of ${result.plan.required_volume_mb.toFixed(2)} MB can be scheduled under the shared constraints.`
        const failure: InitializationFailure = { kind: 'constraint', message: detail, plan: result.plan }
        setFailures({ prediction: failure, live: failure, branch: failure })
        setStatuses({ prediction: 'Constraint analysis complete', live: 'Constraint analysis complete', branch: 'Constraint analysis complete' })
        return
      }
      for (const target of ['prediction', 'live', 'branch'] as MissionMode[]) {
        sessionStorage.setItem(sessionKeys[target], result.sessions[target])
      }
      const sharedTrack = result.track
      setRuntimes({
        prediction: { state: result.states.prediction, events: [], track: sharedTrack },
        live: { state: result.states.live, events: [], track: sharedTrack },
        branch: { state: result.states.branch, events: [], track: sharedTrack },
      })
      setStatuses({ prediction: 'Shared baseline ready', live: 'Shared baseline ready', branch: 'Shared baseline ready' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String((error as { message?: string }).message ?? 'Atomic timeline setup failed')
      const failure: InitializationFailure = { kind: 'error', message }
      setFailures({ prediction: failure, live: failure, branch: failure })
      setStatuses({ prediction: message, live: message, branch: message })
    } finally {
      initializing.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!appliedDraft) return
    initializing.current.clear(); setRuntimes({}); setFailures({}); setResolution(null); fetchingResolution.current = {}
    void initializeAll(appliedDraft, revision)
  }, [appliedDraft, revision, initializeAll])
  useEffect(() => { const timer = setInterval(() => { for (const target of ['prediction','live','branch'] as MissionMode[]) if (runtimes[target] && !runtimes[target]!.state.paused) void refresh(target) }, 1000); return () => clearInterval(timer) }, [runtimes, refresh])

  if (!appliedDraft) return <div className="live-unavailable"><h2>Create your custom satellite first</h2><p>The mission controller will remain mounted after creation, including while you return to Setup.</p></div>
  const sharedFailure = failures[mode] ?? failures.prediction ?? failures.live ?? failures.branch
  const runtime = sharedFailure ? undefined : runtimes[mode]
  if (!runtime) {
    const failure = sharedFailure
    if (failure) {
      const plan = failure.plan
      const transferable = plan?.planned_volume_mb ?? 0
      const required = plan?.required_volume_mb ?? appliedDraft.required
      const shortfall = Math.max(0, required - transferable)
      const ratio = transferable > 0 ? required / transferable : 2
      const suggestedBudget = Math.ceil(Math.max(appliedDraft.budget + 1, appliedDraft.budget * ratio * 1.05))
      const release = Date.parse(appliedDraft.orbit.epoch)
      const currentDeadline = Date.parse(appliedDraft.deadline)
      const suggestedDeadline = new Date(release + Math.max(24 * 3600_000, (currentDeadline - release) * ratio * 1.1)).toISOString()
      const applyConstraint = (patch: Partial<Draft>) => {
        useMissionStore.getState().updateDraft(patch)
        useMissionStore.getState().applyDraft()
      }
      return <><div className="constraint-backdrop" style={{ minHeight: 'calc(100vh - 96px)' }}><section className="constraint-dialog" role="dialog" aria-modal="true"><h2>{failure.kind === 'constraint' ? 'The requested mission is not feasible as configured' : 'Timeline initialization stopped'}</h2>{failure.kind === 'constraint' ? <><div className="constraint-numbers"><div><small>BEST-CASE TRANSFER</small><strong>{transferable.toFixed(2)} MB</strong></div><div><small>REQUESTED</small><strong>{required.toFixed(2)} MB</strong></div><div><small>UNRESOLVED</small><strong>{shortfall.toFixed(2)} MB</strong></div></div><div className="constraint-options" style={{ gridTemplateColumns: '1fr' }}><div className="glass-island-form constraint-action-card"><div className="constraint-option-desc"><h3>Auto-Resolve Constraints</h3><p>Raise budget ceiling to USD {suggestedBudget.toFixed(2)} and extend deadline to {localTime(suggestedDeadline)} to unblock mission planning.</p></div><div style={{ marginTop: '24px', display: 'flex', gap: '16px' }}><button className="home-cta" onClick={() => applyConstraint({ budget: suggestedBudget, deadline: suggestedDeadline })} style={{ flex: 1 }}>APPROVE AUTO-RESOLUTION<div className="home-cta-target"><i/><i/></div></button><button className="home-cta secondary" onClick={() => onNavigate('/setup/mission')} style={{ flex: 1 }}>REJECT & RECONFIGURE<div className="home-cta-target"><i/><i/></div></button></div></div></div></> : <><p>{failure.message}</p><p>This is a terminal error, not a background loading operation.</p><button className="home-cta" onClick={() => void initializeAll(appliedDraft, revision)}>RETRY ATOMICALLY<div className="home-cta-target"><i/><i/></div></button></>}</section></div></>
    }
    return <><div className="mission-toolbar"><ModeTabs/></div><MissionLoader status={statuses[mode]} /></>
  }
  const state = runtime.state
  const client = clients[mode]
  const setSpeed = (speed: string) => client.request<SimulationState>('/simulation/speed', { method: 'POST', body: JSON.stringify({ speed }) }).then((next) => setRuntimes((current) => ({ ...current, [mode]: { ...runtime, state: next } }))).catch((error) => setStatuses((current) => ({ ...current, [mode]: error.message ?? 'Speed change failed' })))
  const toggle = () => setSpeed(state.paused ? (state.speed === 'paused' ? '10x' : state.speed) : 'paused')
  const approved = state.opportunities.filter((item) => item.contact_id).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
  const nextContact = approved.find((item) => Date.parse(item.start_at) > Date.parse(state.sim_time))
  const displayedContact = state.current_contact ?? nextContact
  const route = [
    ...approved.filter((item) => state.current_contact?.contact_id === item.contact_id),
    ...approved.filter((item) => Date.parse(item.start_at) > Date.parse(state.sim_time)),
    ...approved.filter((item) => Date.parse(item.end_at) <= Date.parse(state.sim_time)).reverse(),
  ]
  const stationPasses = selectedStation ? approved.filter((item) => item.station_id === selectedStation.station_id) : []
  const stationContactIds = new Set(stationPasses.map((item) => item.contact_id).filter(Boolean))
  const stationEvents = selectedStation ? runtime.events.filter((event) => event.contact_id && stationContactIds.has(event.contact_id)) : []
  const reroutes = runtime.events.filter((event) => event.event_type === 'data_rerouted')
  const predictionRuntime = runtimes.prediction
  const predictionStationIds = new Set(
    predictionRuntime?.state.opportunities
      .filter((item) => item.contact_id)
      .map((item) => item.station_id) ?? [],
  )
  const liveAddedStations = mode === 'live'
    ? Array.from(new Map(
      approved
        .filter((item) => !predictionStationIds.has(item.station_id))
        .map((item) => [item.station_id, item.station_name]),
    ).values())
    : []
  const liveRemovedStations = mode === 'live' && predictionRuntime
    ? Array.from(new Map(
      predictionRuntime.state.opportunities
        .filter((item) => item.contact_id && !approved.some((live) => live.station_id === item.station_id))
        .map((item) => [item.station_id, item.station_name]),
    ).entries())
    : []
  const liveRouteReasons = mode === 'live'
    ? liveAddedStations.map((stationName) => {
      const stationOpportunities = state.opportunities.filter((item) => item.station_name === stationName)
      const selectedCapacity = stationOpportunities
        .filter((item) => item.contact_id)
        .reduce((sum, item) => sum + item.volume_mb, 0)
      const representative = stationOpportunities.find((item) => item.contact_id) ?? stationOpportunities[0]
      const rain = representative?.weather_precipitation_mm_per_hr
      const weatherText = rain == null
        ? 'weather value unavailable'
        : rain > 0.05
          ? `${rain.toFixed(2)} mm/h forecast rain was included in its attenuated capacity`
          : `${rain.toFixed(2)} mm/h forecast rain (effectively dry)`
      return `${stationName} was selected for ${selectedCapacity.toFixed(2)} MB of remaining executable capacity at ${representative?.average_effective_rate_mbps?.toFixed(2) ?? 'unknown'} Mbps; ${weatherText}.`
    })
    : []
  const liveRemovedReasons = liveRemovedStations.map(([stationId, stationName]) => {
    const candidates = state.opportunities.filter((item) => item.station_id === stationId)
    const usable = candidates.reduce((sum, item) => sum + (item.usable_capacity_mb ?? 0), 0)
    const rainiest = candidates.reduce<Opportunity | null>((current, item) =>
      current == null || (item.weather_precipitation_mm_per_hr ?? -1) > (current.weather_precipitation_mm_per_hr ?? -1) ? item : current, null)
    const rain = rainiest?.weather_precipitation_mm_per_hr
    const weatherReason = rain != null && rain > 0.05
      ? `Its refreshed forecast includes up to ${rain.toFixed(2)} mm/h rain.`
      : 'Rain was not the limiting factor in the refreshed forecast.'
    return `${stationName} was in Prediction but not selected by Live. Its remaining candidate opportunities offered ${usable.toFixed(2)} MB before overlap, budget, and deadline selection. ${weatherReason}`
  })
  const liveCostDelta = predictionRuntime
    ? Number(state.committed_cost) - Number(predictionRuntime.state.committed_cost)
    : 0
  const resetBranch = (simTime: string, deliveredMb: number) => clients.branch.request<SimulationState>('/simulation/fork', { method: 'POST', body: JSON.stringify({ sim_time: simTime, delivered_mb: deliveredMb }) }).then((next) => {
    setRuntimes((current) => ({ ...current, branch: { ...(current.branch ?? runtime), state: next, events: [] } }))
  })
  const branchFromPrediction = () => resetBranch(state.sim_time, state.delivered_mb).then(() => setMode('branch')).catch((error) => setStatuses((current) => ({ ...current, branch: error.message ?? 'Could not create anomaly branch.' })))
  const prepareResolution = () => { setResolutionError(''); client.request<ReplanProposal>('/replans', { method: 'POST', body: JSON.stringify({ reason: 'Predicted deadline shortfall requires a validated feasible resolution path' }) }).then((proposal) => { if (!proposal) throw new Error('No forward proposal could be produced from the current instant.'); setResolutionProposal(proposal) }).catch((error) => setResolutionError(error.message ?? 'Resolution calculation failed.')) }
  const approveResolution = () => resolutionProposal && client.request(`/replans/${resolutionProposal.proposal_id}/approve`, { method: 'POST', body: JSON.stringify({ reason: 'User approved the validated shortfall resolution' }) }).then(() => { setResolutionProposal(null); setResolution(null); fetchingResolution.current[mode] = false; void refresh(mode) }).catch((error) => setResolutionError(error.message ?? 'Approval failed due to a server error.'))

  const predictionBlocked = mode === 'prediction' && state.predicted_shortfall_mb > 1e-9
  return <><div className="mission-toolbar" style={{ marginBottom: '16px' }}><ModeTabs/></div>
    {mode === 'branch' && <AnomalyChat runtime={runtime} refresh={() => void refresh('branch')} resetToStart={() => { if (appliedDraft) void resetBranch(appliedDraft.orbit.epoch, 0) }}/>}

    <div className="notification-shelf">
      {mode === 'live' && (liveAddedStations.length > 0 || liveRemovedStations.length > 0) && (
        <div className="notif-island notif-blue">
          <span className="notif-title">⊹ LIVE ROUTE DIFFERS FROM PREDICTION</span>
          <span className="notif-body">Live starts at wall-clock time with a fresh Open-Meteo capacity ledger. Prediction retains its frozen ledger. The Anomaly timeline cannot affect either one.</span>
          {liveRouteReasons.map((reason) => <small key={reason}>{reason}</small>)}
          {liveRemovedReasons.map((reason) => <small key={reason}>{reason}</small>)}
          <small>Committed resource change vs Prediction: {liveCostDelta >= 0 ? '+' : ''}USD {liveCostDelta.toFixed(2)}{state.cost_assumed ? '*' : ''}.</small>
        </div>
      )}
      {mode === 'live' && state.shortfall_status === 'provisional_monitoring' && (
        <div className="notif-island notif-cyan">
          <span className="notif-title">◉ MONITORING PROVISIONAL RISK · {state.predicted_shortfall_mb.toFixed(2)} MB</span>
          <span className="notif-body">The current contact is still executing. No approval needed yet — the system will measure the final transfer and redistribute any confirmed loss when the contact closes.</span>
        </div>
      )}
      {state.resolution_required && (
        <div className="notif-island notif-amber">
          <span className="notif-title">⚠ {state.finished ? `Mission reached deadline · ${state.remaining_mb.toFixed(2)} MB unresolved` : `${mode === 'prediction' ? 'Preflight' : 'Live forecast'} · ${state.predicted_shortfall_mb.toFixed(2)} MB shortfall detected`}</span>
          <span className="notif-body">{resolution?.reason.summary ?? 'Preparing grounded explanation…'} {resolution?.reason.impact}</span>
          <span className="notif-body" style={{ color: 'rgba(253,230,138,0.55)' }}>{resolution?.approval_prompt ?? 'A constraint change or forward plan requires your approval.'}</span>
          {resolutionError && <span className="resolution-error">Resolution calculation failed: {resolutionError}</span>}
          {!resolutionProposal && <button onClick={prepareResolution}>Calculate specific resolution</button>}
          {resolutionProposal && (
            <div className="validated-resolution">
              <b>Validated recommendation · {localTime(state.sim_time)}</b>
              <span>Shortfall: {resolutionProposal.predicted_shortfall_before_mb.toFixed(2)} → {resolutionProposal.predicted_shortfall_after_mb.toFixed(2)} MB · cost Δ {resolutionProposal.diff?.cost_delta ?? 'n/a'}</span>
              {resolutionProposal.approval_reasons.map((reason) => <small key={reason}>{reason}</small>)}
              {resolutionProposal.alternatives.map((alt) => <small key={alt.kind}>{alt.kind.replaceAll('_',' ')}: {String(alt.calculated_value)}</small>)}
              <button disabled={resolutionProposal.predicted_shortfall_after_mb > 1e-9 || !resolutionProposal.diff} onClick={approveResolution}>Approve recommended plan</button>
              {resolutionProposal.predicted_shortfall_after_mb > 1e-9 && <small>No plan presented as successful — calculated shortfall remains non-zero.</small>}
            </div>
          )}
        </div>
      )}
    </div>

    <div className="mission-glass-dashboard">
      <div className="mission-top-row">
        <div style={{ flex: '1.5', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="glass-island-globe" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <GlobeView groundTrack={runtime.track} stations={state.stations} satellite={state.satellite} activeStationId={state.current_contact?.station_id} weather={mode === 'live' ? liveWeatherVisual : null} onStationSelect={setSelectedStation} onSatelliteSelect={() => setSelectedSatellite(true)} />
            
            <div className="globe-left-panel" style={{ position: 'absolute', top: '24px', left: '24px', bottom: '24px', overflowY: 'auto', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none', width: '280px', paddingRight: '12px' }}>
              <div className="earth-caption" style={{ position: 'relative', top: 'auto', left: 'auto', pointerEvents: 'auto', width: '100%', boxSizing: 'border-box', padding: '12px 16px' }}>
                <span className="eyebrow" style={{ fontSize: '9px' }}>MODELED CUSTOM SATELLITE · {mode.toUpperCase()} TIMELINE</span>
                <h2 style={{ fontSize: '18px', margin: '4px 0' }}>{state.satellite.latitude_deg.toFixed(2)}°, {state.satellite.longitude_deg.toFixed(2)}°</h2>
                <small style={{ fontSize: '9px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <span className="legend-item active">active</span>
                  <span className="legend-item planned">planned</span>
                  <span className="legend-item candidate">candidate</span>
                  <span className="legend-item unused">unused</span>
                </small>
              </div>

              {mode !== 'live' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'auto', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.05)', padding: '10px 16px', borderRadius: '12px', width: '100%', boxSizing: 'border-box' }}>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.1em', fontWeight: 600 }}>SPEED MULTIPLIER:</span>
                    <select 
                      value={state.speed === 'paused' ? '10x' : state.speed} 
                      onChange={(e) => setSpeed(e.target.value)}
                      style={{
                        background: 'rgba(0,0,0,0.4)',
                        color: '#e1ff00',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="1x">1x</option>
                      <option value="10x">10x</option>
                      <option value="100x">100x</option>
                      <option value="1000x">1000x</option>
                    </select>
                  </div>

                  <button className="home-cta" disabled={predictionBlocked && state.paused} onClick={toggle} style={{ margin: 0, width: '100%', padding: '12px 16px', boxSizing: 'border-box', fontSize: '11px' }}>
                    {state.paused ? 'START SIMULATION' : 'PAUSE SIMULATION'}
                    <div className="home-cta-target"><i/><i/></div>
                  </button>
                </div>
              )}

              {mode === 'live' && <span className="live-lock" style={{ pointerEvents: 'auto', fontSize: '11px', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.05em' }}>REAL TIME · 1× · CONTINUES DURING APPROVAL</span>}
            </div>

            <div className="globe-right-panel" style={{ position: 'absolute', top: '24px', right: '24px', zIndex: 10, display: 'flex', flexDirection: 'column', pointerEvents: 'auto', textAlign: 'right' }}>
               <span className="eyebrow" style={{ color: 'rgba(225,255,0,0.7)', letterSpacing: '0.1em', fontSize: '10px' }}>{mode === 'live' ? `LIVE SYSTEM TIME · ${localZone}` : 'INTERNAL SIMULATION TIME'}</span>
               <h3 style={{ margin: 0, fontSize: '14px', color: '#fff', letterSpacing: '0.05em', textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
                 {mode === 'live' ? localTime(state.sim_time) : new Date(state.sim_time).toISOString()}
                 <AssumptionMark reason={mode === 'live' ? 'Live mode advances at 1× wall-clock time; displayed in this device’s time zone.' : 'Authoritative modeled time, not spacecraft telemetry.'}/>
               </h3>
            </div>
            {selectedSatellite && (
              <div className="station-popover satellite-popover">
                <button onClick={() => setSelectedSatellite(false)}>×</button>
                <b style={{ color: '#e1ff00' }}>MODELED CUSTOM SATELLITE</b>
                <span>{state.satellite.altitude_km?.toFixed(0) ?? '—'} km ALTITUDE</span>
                {state.current_contact ? (
                  <small>Active Link: {state.current_contact.rate_mbps.toFixed(1)} Mbps via {state.current_contact.band} Band</small>
                ) : (
                  <small>No active downlink in progress.</small>
                )}
              </div>
            )}
            {selectedStation && (
              <div className="station-popover">
                <button onClick={() => setSelectedStation(null)}>×</button>
                <b>{selectedStation.name}</b>
                <span>{selectedStation.classification} · {selectedStation.latitude_deg.toFixed(3)}°, {selectedStation.longitude_deg.toFixed(3)}°</span>
                {stationPasses.length ? stationPasses.map((item) => { 
                  const completed = Date.parse(item.end_at) <= Date.parse(state.sim_time); 
                  const actual = stationEvents.filter((event) => event.contact_id === item.contact_id).reduce((sum, event) => sum + (event.delivered_volume_mb ?? 0), 0); 
                  return <small key={item.pass_id}>{completed ? 'PAST' : 'PLANNED'} · {new Date(item.start_at).toLocaleString()} → {new Date(item.end_at).toLocaleTimeString()} · target {item.volume_mb.toFixed(2)} MB · transferred {actual.toFixed(2)} MB</small> 
                }) : <small>No planned or past contact in this timeline.</small>}
              </div>
            )}
          </div>
          {mode === 'prediction' && (
            <div className="glass-island-form branch-cta-box" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '24px 32px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, paddingRight: '24px' }}>
                <span className="eyebrow" style={{ margin: 0 }}>BRANCH & INJECT ANOMALY</span>
                <h3 style={{ margin: 0, fontSize: '16px', letterSpacing: '0.05em', color: '#fff' }}>TEST AN ANOMALY AT THIS MOMENT</h3>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                  The Prediction timeline remains untouched. The Anomaly timeline receives this timestamp and delivered-volume snapshot.
                </span>
              </div>
              <button className="home-cta" onClick={branchFromPrediction} style={{ margin: 0, flexShrink: 0 }}>
                CREATE ANOMALY BRANCH
                <div className="home-cta-target"><i/><i/></div>
              </button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div className="glass-island-form" style={{ padding: '24px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 className="island-title" style={{ margin: 0 }}>LIVE MODELED RATE</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <strong style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '56px', lineHeight: 0.9, margin: 0, color: '#e1ff00' }}>{(state.current_contact?.rate_mbps ?? 0).toFixed(2)}</strong>
                <span className="right-label" style={{ margin: 0, color: '#e1ff00', fontSize: '14px' }}>MBPS</span>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>GROUND STATION</span>
                  {state.current_contact ? (
                    <StationWeatherLabel stationName={state.current_contact.station_name} weather={mode === 'live' ? liveWeatherVisual : null}/>
                  ) : (() => {
                    if (nextContact) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '11px', color: 'rgba(225,255,0,0.6)', letterSpacing: '0.08em' }}>NEXT UP</span>
                        <StationWeatherLabel stationName={nextContact.station_name} weather={mode === 'live' ? liveWeatherVisual : null} next/>
                      </div>
                    )
                    return <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>NO CONTACTS</span>
                  })()}
                </div>
              </div>
            </div>
          </div>

        <div style={{ flex: '1', display: 'flex', gap: '24px' }}>
          <div className="glass-island-form mission-metrics data-metrics" style={{ flex: '1', display: 'flex', flexDirection: 'column', padding: '24px' }}>
            <h3 className="island-title">DOWNLINK DATA TRANSFER</h3>
            
            <SemiGauge 
              value={state.delivered_mb} 
              total={state.required_mb}
              label="DATA DELIVERED" 
              color="#e1ff00"
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="glass-value-box">
                <div className="glass-value-text">{state.required_mb.toFixed(2)} MB</div>
                <span className="right-label">REQUIRED</span>
              </div>
              <div className="glass-value-box">
                <div className="glass-value-text">{(state.required_mb - state.delivered_mb).toFixed(2)} MB</div>
                <span className="right-label">REMAINING</span>
              </div>
              <div className="glass-value-box">
                <div className="glass-value-text">{state.delivered_mb.toFixed(2)} MB</div>
                <span className="right-label">DELIVERED</span>
              </div>
            </div>
            
            {state.predicted_shortfall_mb > 0 && (
              <div className="glass-value-box" style={{ borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)', marginTop: '16px' }}>
                <div className="glass-value-text danger" style={{ color: '#f87171' }}>{state.predicted_shortfall_mb.toFixed(2)} MB</div>
                <span className="right-label" style={{ color: '#f87171' }}>SHORTFALL</span>
              </div>
            )}


            {mode === 'live' && <div style={{ display: 'none' }}><LiveWeather client={client} simulationTime={state.sim_time} activeStationId={displayedContact?.station_id} onActiveWeather={setLiveWeatherVisual}/></div>}
          </div>

          <div className="glass-island-form mission-metrics budget-metrics" style={{ flex: '1', display: 'flex', flexDirection: 'column', padding: '24px' }}>
            <h3 className="island-title">MISSION COST & BUDGET</h3>

            <SemiGauge 
              value={Number(state.cost_used)} 
              total={Number(state.maximum_budget)}
              label="BUDGET USED" 
              color="#0ea5e9"
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="glass-value-box">
                <div className="glass-value-text">USD {Number(state.maximum_budget).toFixed(2)}</div>
                <span className="right-label">BUDGET</span>
              </div>
              <div className="glass-value-box">
                <div className="glass-value-text">USD {Number(state.committed_cost).toFixed(2)}</div>
                <span className="right-label">ESTIMATED</span>
              </div>
              <div className="glass-value-box">
                <div className="glass-value-text">USD {Number(state.cost_used).toFixed(2)}</div>
                <span className="right-label">USED</span>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>
      
      <div className="mission-bottom-row" style={{ display: 'flex', gap: '24px', flex: '1', minHeight: 0, maxHeight: '350px' }}>
        <div className="glass-island-form mission-passes" style={{ flex: '1', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="mission-panel-header">
            <span className="eyebrow">SEQUENTIAL APPROVED ROUTE · {localZone}</span>
            <h3>Planner decisions · active/next contact first</h3>
          </div>
          <div className="mission-list-content" style={{ overflowY: 'auto', flex: 1, paddingRight: '8px', minHeight: 0 }}>
            {route.map((item, index) => { 
              const completed = Boolean(item.completed_at) || Date.parse(item.end_at) <= Date.parse(state.sim_time); 
              const active = state.current_contact?.contact_id === item.contact_id; 
              const actual = (active ? state.current_contact?.actual_volume_mb ?? 0 : item.actual_volume_mb ?? 0); 
              const delta = completed ? actual - item.volume_mb : 0; 
              const deltaStr = completed ? (delta > 0.01 ? ` (+${delta.toFixed(1)} MB)` : delta < -0.01 ? ` (${delta.toFixed(1)} MB)` : '') : ''; 
              return (
                <div className={`mission-pass-card ${active ? 'active' : ''}`} onClick={() => setSelectedStation(state.stations.find((s) => s.station_id === item.station_id) ?? null)} key={item.pass_id}>
                  <div className="mission-pass-header">
                    <b>{item.station_name}</b>
                    <time>{index + 1} · {localTime(item.start_at)} → {localClock(item.end_at)}</time>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>planned {item.volume_mb.toFixed(1)} MB · actual {actual.toFixed(1)} MB{deltaStr}</span>
                    <i style={{ fontSize: '10px', fontStyle: 'normal', color: active ? '#e1ff00' : 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>{active ? 'IN PROGRESS' : completed ? 'COMPLETED' : 'UPCOMING'}</i>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="glass-island-form mission-events" style={{ flex: '1', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="mission-panel-header">
            <span className="eyebrow">AUTHORITATIVE EVENT LOG · {mode === 'live' ? localZone : 'SIMULATION UTC'}</span>
            <h3>Transfer lifecycle & algorithm decisions</h3>
          </div>
          <div className="mission-list-content" style={{ overflowY: 'auto', flex: 1, paddingRight: '8px', minHeight: 0 }}>
            {reroutes.slice().reverse().map((event) => (
              <div className="mission-event-card reroute" key={`reroute-${event.event_id}`}>
                <div className="mission-event-header">
                  <b>{mode === 'live' ? 'Real-time' : 'Deterministic'} redistribution</b>
                  <time>{localClock(event.sim_time)}</time>
                </div>
                <span>{event.source_station_name ?? 'Previous station'} under-delivered; {(event.delivered_volume_mb ?? 0).toFixed(3)} MB reassigned to {event.destination_station_name ?? 'the next approved station'} because it had spare capacity. {event.reroute_reason}</span>
              </div>
            ))}
            {runtime.events.slice().reverse().map((event) => { 
              const station = event.station_name ?? 'ground station'; 
              const planned = event.planned_volume_mb == null ? '' : `; planned ${event.planned_volume_mb.toFixed(3)} MB`; 
              const delta = event.planned_volume_mb != null ? (event.delivered_volume_mb ?? 0) - event.planned_volume_mb : 0; 
              const deltaEl = event.planned_volume_mb != null ? (delta > 0.01 ? ` (+${delta.toFixed(2)} MB)` : delta < -0.01 ? ` (${delta.toFixed(2)} MB)` : '') : ''; 
              const transferLabel = event.event_type === 'contact_started' ? `Transfer started · ${station}${planned}` : event.event_type === 'contact_ended' ? `Transfer ended · ${station}${planned}; actual ${(event.delivered_volume_mb ?? 0).toFixed(3)} MB` : event.event_type === 'fragment_started' ? `Segment started · ${station}` : event.event_type === 'fragment_partial' ? `${(event.delivered_volume_mb ?? 0).toFixed(3)} MB via ${station}` : event.event_type === 'fragment_delivered' ? `Segment complete · ${(event.delivered_volume_mb ?? 0).toFixed(3)} MB via ${station}` : event.event_type === 'rate_updated' ? `Link rate → ${(event.rate_mbps ?? 0).toFixed(2)} Mbps · ${station}` : event.event_type === 'shortfall_predicted' ? `Shortfall: ${(event.predicted_shortfall_mb ?? 0).toFixed(3)} MB ungainful` : event.event_type === 'data_rerouted' ? `Rerouted ${(event.delivered_volume_mb ?? 0).toFixed(3)} MB from ${event.source_station_name ?? 'source'} → ${event.destination_station_name ?? 'destination'}. ${event.reroute_reason ?? ''}` : `${event.station_name ? `${event.station_name}: ` : ''}${event.description || event.event_type.replaceAll('_',' ')}`; 
              return (
                <div className="mission-event-card" key={event.event_id}>
                  <div className="mission-event-header">
                    <b>{event.event_type.replaceAll('_',' ')}</b>
                    <time>{mode === 'live' ? localClock(event.sim_time) : new Date(event.sim_time).toISOString().slice(11,19)}</time>
                  </div>
                  <span>{transferLabel}{deltaEl}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  </>
}

export default function App() {
  const initialPath = location.pathname === '/mission' && !useMissionStore.getState().appliedDraft ? '/' : location.pathname
  const [path, setPath] = useState(initialPath)
  const { appliedDraft } = useMissionStore()
  useEffect(() => { if (location.pathname !== initialPath) history.replaceState({}, '', initialPath); const pop = () => setPath(location.pathname); addEventListener('popstate', pop); fetch('/api/v1/health').catch(console.error); return () => removeEventListener('popstate', pop) }, [])
  const setupVisible = path.startsWith('/setup/')
  
  return (
    <>
      <GlobalHeader path={path} appliedDraft={appliedDraft} onNavigate={(next) => navigate(next, setPath)} />
      <div hidden={path !== '/'}>
        <Home onNavigate={(next) => navigate(next, setPath)} />
      </div>
      <main hidden={path === '/'} className={setupVisible ? 'home setup-mode' : 'home mission-mode'}>
        {setupVisible && <div className="home-noise" />}
        {!setupVisible && <DeepSpaceBackground />}
        <div hidden={!setupVisible}><Setup path={path} setPath={setPath}/></div>
        <div hidden={setupVisible}><Mission onNavigate={(next) => navigate(next, setPath)}/></div>
      </main>
    </>
  )
}
