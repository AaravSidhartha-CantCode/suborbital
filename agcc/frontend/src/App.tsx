import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgccClient, ensureSession, resetSession } from './api'
import { AssumptionMark } from './DataStatus'
import { GlobeView, type GroundPoint, type SatelliteMarker, type StationMarker } from './GlobeView'
import { LiveWeather } from './LiveWeather'
import { StationCatalogPicker } from './StationCatalogPicker'
import { orbitToRing } from './orbit'
import { useMissionStore, type Draft, type MissionMode } from './store'
import './weather.css'
import './assumptions.css'
import './styles.css'
import './task15.css'
import './v2.css'
import './runtime.css'
import './runtime-v3.css'

const setupRoutes = ['/setup/orbit', '/setup/communications', '/setup/stations', '/setup/mission']
const routeLabel: Record<string, string> = { '/setup/orbit': 'Orbit', '/setup/communications': 'Communications', '/setup/stations': 'Stations', '/setup/mission': 'Mission' }
const sessionKeys: Record<MissionMode, string> = { prediction: 'agcc.session.prediction.v2', live: 'agcc.session.live.v2', branch: 'agcc.session.anomaly.v2' }
const clients: Record<MissionMode, AgccClient> = { prediction: new AgccClient('', sessionKeys.prediction), live: new AgccClient('', sessionKeys.live), branch: new AgccClient('', sessionKeys.branch) }
const navigate = (path: string, setPath: (path: string) => void) => { history.pushState({}, '', path); setPath(path) }
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>

type Opportunity = { pass_id: string; contact_id: string | null; station_id: string; station_name: string; start_at: string; end_at: string; volume_mb: number; classification: string; reason: string }
type Contact = { contact_id: string; station_id: string; station_name: string; start_at: string; end_at: string; rate_mbps: number; band: string; anomaly_multiplier: number; target_volume_mb: number; actual_volume_mb: number }
type SimulationState = { started: boolean; finished: boolean; sim_time: string; deadline_at: string; delivered_mb: number; remaining_mb: number; paused: boolean; speed: string; satellite: SatelliteMarker; current_contact: Contact | null; predicted_final_mb: number; predicted_shortfall_mb: number; required_mb: number; resolution_required: boolean; plan: { plan_id: string; version: number; planned_completion_at: string | null; estimated_total_cost: string }; stations: StationMarker[]; opportunities: Opportunity[]; event_count: number }
type SimEvent = { event_id: string; sequence_number: number; event_type: string; sim_time: string; contact_id?: string; fragment_id?: string; delivered_volume_mb?: number; description: string }
type Runtime = { state: SimulationState; events: SimEvent[]; track: GroundPoint[] }
type AnomalyProposal = { proposal_id: string; status: string; rate_multiplier: number | null; clarification_questions: string[]; source_text: string; intent: { anomaly_type?: string; station_id?: string; qualitative_severity?: string } }
type ReplanProposal = { proposal_id: string; diff: { added_contact_ids: string[]; removed_contact_ids: string[]; cost_delta: string } }
type Resolution = { reason: { summary: string; impact: string; action: string; tradeoff: string }; approval_prompt: string }
type WatsonStatus = { configured: boolean; status: string; reachable: boolean | null; endpoint?: string; model_id?: string; message?: string }

const bandRanges: Record<string, [number, number, number]> = { S: [2, 4, 2.2], X: [8, 12, 9.6], Ka: [26.5, 40, 27.5] }
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
  return errors
}

function OrbitManipulator({ draft, updateOrbit }: { draft: Draft; updateOrbit: (patch: Partial<Draft['orbit']>) => void }) {
  const ring = useMemo(() => orbitToRing(draft.orbit), [draft.orbit])
  const origin = useRef<{ x: number; y: number; raan: number; inclination: number } | null>(null)
  return <div className="ring-preview interactive-orbit" role="application" aria-label="Drag to change RAAN and inclination; use the wheel for altitude" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); origin.current = { x: event.clientX, y: event.clientY, raan: draft.orbit.raan_deg, inclination: draft.orbit.inclination_deg } }} onPointerMove={(event) => { if (!origin.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return; updateOrbit({ raan_deg: (origin.current.raan + event.clientX - origin.current.x + 360) % 360, inclination_deg: Math.max(0, Math.min(180, origin.current.inclination + event.clientY - origin.current.y)) }) }} onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); origin.current = null }} onWheel={(event) => { event.preventDefault(); updateOrbit({ altitude_km: Math.max(200, Math.min(2000, draft.orbit.altitude_km - Math.sign(event.deltaY) * 25)) }) }}><div className="ring-shape" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); const angle = (Math.atan2(event.clientY - box.top - box.height / 2, event.clientX - box.left - box.width / 2) * 180 / Math.PI + 360) % 360; updateOrbit({ phase_deg: angle }) }} style={{ transform: `rotateX(${draft.orbit.inclination_deg}deg) rotateZ(${draft.orbit.raan_deg}deg)` }}><i style={{ transform: `rotate(${draft.orbit.phase_deg}deg) translateX(112px)` }}/></div><strong>{ring.radius.toFixed(4)} R⊕</strong><small>Drag disc: RAAN/inclination · click orbit: phase · wheel: altitude<AssumptionMark reason="This is modeled circular-orbit geometry."/></small></div>
}

function Setup({ path, setPath }: { path: string; setPath: (path: string) => void }) {
  const { draft, updateDraft, updateOrbit, applyDraft } = useMissionStore()
  const index = Math.max(0, setupRoutes.indexOf(path))
  const errors = validateDraft(draft)
  const finish = () => { applyDraft(); navigate('/mission', setPath) }
  const chooseBand = (band: string) => updateDraft({ band, frequency: bandRanges[band][2], stations: [] })
  return <section className="setup-shell"><aside className="setup-progress"><span className="eyebrow">SCENARIO SETUP</span>{setupRoutes.map((route, i) => <button className={route === path ? 'active' : i < index ? 'done' : ''} onClick={() => navigate(route, setPath)} key={route}><b>{i + 1}</b>{routeLabel[route]}</button>)}</aside><section className="setup-stage"><div className="setup-copy"><span className="eyebrow">STEP {index + 1} OF 4</span><h2>{routeLabel[path] ?? 'Orbit'}</h2><p>Editing this working copy does not pause the active mission. Recalculation occurs only when you apply the final form.</p></div>
    {path === '/setup/orbit' && <div className="orbit-editor"><OrbitManipulator draft={draft} updateOrbit={updateOrbit}/><div className="field-grid"><Field label="Preset"><select value={draft.orbit.inclination_deg} onChange={(event) => updateOrbit({ inclination_deg: Number(event.target.value) })}><option value="53">Mid-inclination 550</option><option value="0">Equatorial 550</option><option value="90">Polar 550</option><option value="97.6">Retrograde demo 550</option></select></Field><Field label="Altitude (km)"><input type="number" min="200" max="2000" value={draft.orbit.altitude_km} onChange={(event) => updateOrbit({ altitude_km: +event.target.value })}/></Field><Field label="Inclination (degrees)"><input type="number" min="0" max="180" value={draft.orbit.inclination_deg} onChange={(event) => updateOrbit({ inclination_deg: +event.target.value })}/></Field><Field label="RAAN (degrees)"><input type="number" min="0" max="359.999" value={draft.orbit.raan_deg} onChange={(event) => updateOrbit({ raan_deg: +event.target.value })}/></Field><Field label="Phase (degrees)"><input type="number" min="0" max="359.999" value={draft.orbit.phase_deg} onChange={(event) => updateOrbit({ phase_deg: +event.target.value })}/></Field><Field label="Epoch UTC (initialized from this device)"><input value={draft.orbit.epoch} onChange={(event) => updateOrbit({ epoch: event.target.value })}/></Field></div></div>}
    {path === '/setup/communications' && <div className="field-grid"><Field label="Band"><select value={draft.band} onChange={(event) => chooseBand(event.target.value)}><option>X</option><option>S</option><option>Ka</option></select></Field><Field label="Exact carrier frequency (GHz)"><input className={errors.some((item) => item.includes('-band')) ? 'invalid' : ''} type="number" step=".1" value={draft.frequency} onChange={(event) => updateDraft({ frequency: +event.target.value })}/><small>{draft.band}: {bandRanges[draft.band][0]}–{bandRanges[draft.band][1]} GHz</small></Field><Field label="Maximum downlink rate (Mbps)"><input type="number" min=".01" value={draft.rate} onChange={(event) => updateDraft({ rate: +event.target.value })}/></Field><Field label="Polarization (required)"><select value={draft.polarization} required onChange={(event) => updateDraft({ polarization: event.target.value as Draft['polarization'] })}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="circular">Circular</option></select></Field><Field label="Protocol efficiency"><input type="number" step=".01" min=".01" max="1" value={draft.protocolEfficiency} onChange={(event) => updateDraft({ protocolEfficiency: +event.target.value })}/></Field></div>}
    {path === '/setup/stations' && <StationCatalogPicker/>}
    {path === '/setup/mission' && <div className="field-grid"><Field label="Required data (MB)"><input type="number" min=".01" value={draft.required} onChange={(event) => updateDraft({ required: +event.target.value })}/></Field><Field label="Hard deadline UTC"><input value={draft.deadline} onChange={(event) => updateDraft({ deadline: event.target.value })}/></Field><Field label="Maximum budget (USD)"><input type="number" min="0" value={draft.budget} onChange={(event) => updateDraft({ budget: +event.target.value })}/></Field><Field label="Planning preference"><select value={draft.preference} onChange={(event) => updateDraft({ preference: event.target.value })}><option value="fastest">Fastest</option><option value="lowest_cost">Lowest cost</option><option value="balanced">Balanced</option></select></Field></div>}
    {errors.length > 0 && <div className="validation-errors">{errors.map((error) => <p key={error}>{error}</p>)}</div>}<div className="setup-actions"><button disabled={index === 0} onClick={() => navigate(setupRoutes[index - 1], setPath)}>Back</button><button className="primary" disabled={index === setupRoutes.length - 1 && errors.length > 0} onClick={() => index === setupRoutes.length - 1 ? finish() : navigate(setupRoutes[index + 1], setPath)}>{index === setupRoutes.length - 1 ? 'Apply & create isolated timelines' : 'Continue'}</button></div></section></section>
}

function buildPayload(draft: Draft, mode: MissionMode, revision: number) {
  const suffix = `${mode}_${revision}`
  return { scenario: { scenario_id: `scenario_${suffix}`, name: `${mode} browser mission`, satellite_id: `sat_${suffix}`, station_ids: draft.stations, mission_id: `mission_${suffix}`, constraints: { maximum_budget: String(draft.budget), currency: 'USD', station_selection: { allow_all_eligible: false, authorized_station_ids: draft.stations }, planning_preference: draft.preference, allow_additional_contact_proposals: true } }, satellite: { satellite_id: `sat_${suffix}`, name: 'Custom satellite', orbit: draft.orbit, comms: { band: draft.band, carrier_frequency_ghz: draft.frequency, max_downlink_rate_mbps: draft.rate, protocol_efficiency: draft.protocolEfficiency, min_elevation_deg: 5, polarization: draft.polarization }, provenance: { source_type: 'manual', source_name: 'browser-session', fetched_at: new Date().toISOString(), assumption_fields: ['orbit', 'comms'] } }, mission: { mission_id: `mission_${suffix}`, name: 'Custom downlink', required_volume_mb: draft.required, release_at: draft.orbit.epoch, deadline_at: draft.deadline } }
}

function ModeTabs() { const { mode, setMode } = useMissionStore(); return <div className="mode-tabs" role="tablist">{([['prediction','Prediction'],['live','Live sources'],['branch','Anomalies']] as [MissionMode,string][]).map(([id,label]) => <button role="tab" aria-selected={mode === id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)} key={id}>{label}</button>)}</div> }

function AnomalyChat({ runtime, refresh }: { runtime: Runtime; refresh: () => void }) {
  const client = clients.branch
  const [text, setText] = useState('')
  const [proposal, setProposal] = useState<AnomalyProposal | null>(null)
  const [replan, setReplan] = useState<ReplanProposal | null>(null)
  const [turns, setTurns] = useState<string[]>([])
  const [watson, setWatson] = useState<WatsonStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Describe an anomaly in natural language. WatsonX will normalize it and ask for missing details.')
  const probe = () => { setBusy(true); client.request<WatsonStatus>('/watsonx/status?probe=true').then(setWatson).catch((error) => setWatson({ configured: false, status: 'probe_failed', reachable: false, message: error.message })).finally(() => setBusy(false)) }
  useEffect(probe, [])
  const send = () => {
    const userTurn = `User: ${text.trim()}`
    const transcript = [...turns, userTurn]
    setTurns(transcript); setText(''); setBusy(true)
    client.request<AnomalyProposal>('/anomalies/chat', { method: 'POST', body: JSON.stringify({ text: transcript.join('\n') }) }).then((item) => {
      const reply = item.clarification_questions.join(' ') || `Proposed ${item.intent.anomaly_type ?? 'anomaly'} at multiplier ${item.rate_multiplier ?? 'unresolved'}×. Confirm to inject it.`
      setTurns((current) => [...current, `WatsonX: ${reply}`]); setProposal(item); setMessage(reply)
    }).catch((error) => { const reply = error.message ?? 'WatsonX anomaly parsing failed.'; setTurns((current) => [...current, `System: ${reply}`]); setMessage(reply) }).finally(() => setBusy(false))
  }
  const confirm = () => proposal && client.request(`/anomalies/confirm?proposal_id=${encodeURIComponent(proposal.proposal_id)}`, { method: 'POST' }).then(() => { setProposal((current) => current ? { ...current, status: 'confirmed' } : current); setMessage('Anomaly recorded at the branch simulation time. Calculating a forward replan is now available.'); refresh() }).catch((error) => setMessage(error.message ?? 'Confirmation failed.'))
  const requestReplan = () => client.request<ReplanProposal>('/replans', { method: 'POST', body: JSON.stringify({ reason: `WatsonX anomaly: ${proposal?.source_text ?? text}` }) }).then(setReplan).catch((error) => setMessage(error.message ?? 'Replan failed.'))
  const decide = (decision: 'approve'|'reject') => replan && client.request(`/replans/${replan.proposal_id}/${decision}`, { method: 'POST', body: JSON.stringify({ reason: `User ${decision}d proposal` }) }).then(() => { setMessage(`Replan ${decision}d on the anomaly branch.`); setReplan(null); refresh() }).catch((error) => setMessage(error.message ?? 'Decision failed.'))
  return <section className="anomaly-workbench panel"><div className="watson-heading"><div><span className="eyebrow">SEPARATE ANOMALY TIMELINE · WATSONX CHAT</span><h2>Describe what changed</h2></div><button className={`watson-status ${watson?.reachable ? 'ready' : 'error'}`} onClick={probe} disabled={busy}>{watson?.reachable ? `WATSONX READY · ${watson.model_id}` : `${watson?.status?.replaceAll('_',' ') ?? 'TESTING WATSONX'} · RETEST`}</button></div>{watson?.message && <p className="watson-error">{watson.message}</p>}<div className="chat-history">{turns.map((turn, index) => <p className={turn.startsWith('User:') ? 'user-turn' : turn.startsWith('WatsonX:') ? 'watson-turn' : 'system-turn'} key={`${index}-${turn}`}>{turn}</p>)}</div><div className="anomaly-chat"><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={`Example: ${runtime.state.stations.find((item) => item.classification === 'approved')?.name ?? 'the next station'} has severe link degradation`}/><button disabled={!text.trim() || busy || watson?.reachable === false} onClick={send}>{busy ? 'Contacting…' : 'Ask WatsonX'}</button></div><p className="workflow-message">{message}</p>{proposal && <div className="proposal-card"><b>{proposal.status.replaceAll('_',' ')}</b><span>{proposal.intent.anomaly_type ?? 'unresolved'} · {proposal.intent.station_id ?? 'station needed'} · multiplier {proposal.rate_multiplier ?? 'needs clarification'}×<AssumptionMark reason="WatsonX classifies intent/severity; a bounded policy table produces the numerical multiplier."/></span><button disabled={proposal.status !== 'pending'} onClick={confirm}>Confirm branch injection</button><button disabled={proposal.status !== 'confirmed' && !runtime.events.some((event) => event.event_type === 'anomaly_detected')} onClick={requestReplan}>Calculate replan</button></div>}{replan && <div className="proposal-card"><b>Approval required</b><span>Added {replan.diff.added_contact_ids.length}; removed {replan.diff.removed_contact_ids.length}; cost Δ {replan.diff.cost_delta}</span><button onClick={() => decide('approve')}>Approve</button><button onClick={() => decide('reject')}>Reject</button></div>}</section>
}

function Mission() {
  const { appliedDraft, revision, mode } = useMissionStore()
  const [runtimes, setRuntimes] = useState<Partial<Record<MissionMode, Runtime>>>({})
  const [statuses, setStatuses] = useState<Partial<Record<MissionMode, string>>>({})
  const [selectedStation, setSelectedStation] = useState<StationMarker | null>(null)
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const initializing = useRef(new Set<MissionMode>())

  const refresh = useCallback(async (target: MissionMode) => {
    const client = clients[target]
    const [state, events] = await Promise.all([client.request<SimulationState>('/simulation/state'), client.request<SimEvent[]>('/simulation/events')])
    setRuntimes((current) => ({ ...current, [target]: { state, events, track: current[target]?.track ?? [] } }))
    if (state.resolution_required) client.request<Resolution>('/mission/resolution').then(setResolution).catch(() => undefined)
  }, [])

  const initialize = useCallback(async (target: MissionMode, draft: Draft, currentRevision: number) => {
    if (initializing.current.has(target)) return
    initializing.current.add(target)
    setStatuses((current) => ({ ...current, [target]: `Creating isolated ${target} timeline…` }))
    const client = clients[target]
    try {
      await ensureSession(client)
      const payload = buildPayload(draft, target, currentRevision)
      const catalog = await client.request<{ stations: { station_id: string; supported_bands: string[] | null }[] }>('/catalog/stations')
      const known = new Set(catalog.stations.map((item) => item.station_id))
      const ids = draft.stations.filter((id) => known.has(id))
      if (!ids.length) throw new Error('None of the selected station IDs exist in the active catalogue.')
      payload.scenario.station_ids = ids
      payload.scenario.constraints.station_selection.authorized_station_ids = ids
      await client.request('/scenario', { method: 'POST', body: JSON.stringify(payload) })
      await client.request('/passes/compute', { method: 'POST' })
      await client.request('/plan', { method: 'POST', body: JSON.stringify({ plan_id: `plan_${target}_${currentRevision}` }) })
      const [track, state] = await Promise.all([client.request<GroundPoint[]>('/orbit/ground-track'), client.request<SimulationState>('/simulation/start', { method: 'POST', body: JSON.stringify({ speed: target === 'live' ? '1x' : 'paused' }) })])
      setRuntimes((current) => ({ ...current, [target]: { state, events: [], track } }))
      setStatuses((current) => ({ ...current, [target]: `${target} timeline ready` }))
    } catch (error) {
      setStatuses((current) => ({ ...current, [target]: error instanceof Error ? error.message : String((error as { message?: string }).message ?? 'Timeline setup failed') }))
    } finally { initializing.current.delete(target) }
  }, [])

  useEffect(() => {
    if (!appliedDraft) return
    for (const target of ['prediction','live','branch'] as MissionMode[]) resetSession(clients[target])
    initializing.current.clear(); setRuntimes({}); setResolution(null)
    void initialize('prediction', appliedDraft, revision)
  }, [appliedDraft, revision, initialize])
  useEffect(() => { if (appliedDraft && !runtimes[mode]) void initialize(mode, appliedDraft, revision) }, [mode, appliedDraft, revision, runtimes, initialize])
  useEffect(() => { const timer = setInterval(() => { for (const target of ['prediction','live','branch'] as MissionMode[]) if (runtimes[target] && !runtimes[target]!.state.paused) void refresh(target) }, 1000); return () => clearInterval(timer) }, [runtimes, refresh])

  if (!appliedDraft) return <div className="live-unavailable"><h2>Create your custom satellite first</h2><p>The mission controller will remain mounted after creation, including while you return to Setup.</p></div>
  const runtime = runtimes[mode]
  if (!runtime) return <><div className="mission-toolbar"><ModeTabs/></div><div className="live-unavailable"><h2>{statuses[mode] ?? 'Preparing timeline…'}</h2><p>Prediction, live execution, and anomaly experiments are isolated from one another.</p></div></>
  const state = runtime.state
  const client = clients[mode]
  const setSpeed = (speed: string) => client.request<SimulationState>('/simulation/speed', { method: 'POST', body: JSON.stringify({ speed }) }).then((next) => setRuntimes((current) => ({ ...current, [mode]: { ...runtime, state: next } }))).catch((error) => setStatuses((current) => ({ ...current, [mode]: error.message ?? 'Speed change failed' })))
  const toggle = () => setSpeed(state.paused ? (state.speed === 'paused' ? '1x' : state.speed) : 'paused')
  const approved = state.opportunities.filter((item) => item.contact_id).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
  const stationPasses = selectedStation ? approved.filter((item) => item.station_id === selectedStation.station_id) : []

  return <><div className="mission-toolbar"><ModeTabs/><div className="clock-controls"><b>INTERNAL SIMULATION TIME</b><span>{new Date(state.sim_time).toISOString()}<AssumptionMark reason="Authoritative modeled time, not spacecraft telemetry."/></span><button onClick={toggle}>{state.paused ? 'Start' : 'Pause'}</button>{['1x','10x','100x','1000x'].map((speed) => <button className={state.speed === speed ? 'active' : ''} onClick={() => setSpeed(speed)} key={speed}>{speed}</button>)}</div></div>
    {mode === 'branch' && <AnomalyChat runtime={runtime} refresh={() => void refresh('branch')}/>} {mode === 'live' && <section className="live-banner panel"><b>LIVE EXECUTION TIMELINE</b><span>Open-Meteo observations feed the capacity model; contact-close redistribution moves undelivered fragments to upcoming approved contacts. New stations remain approval-gated.</span></section>}
    {state.resolution_required && <section className="approval-alert"><b>{state.finished ? `Mission stopped exactly at its deadline with ${state.remaining_mb.toFixed(2)} MB unresolved.` : `Live forecast detects a ${state.predicted_shortfall_mb.toFixed(2)} MB shortfall; intervention is required before the deadline.`}</b><span>{resolution?.reason.summary ?? 'WatsonX is preparing a grounded explanation.'} {resolution?.reason.impact}</span><span>{resolution?.approval_prompt ?? 'A constraint change or previously unused station requires your approval before replanning.'}</span><button onClick={() => client.request('/replans', { method: 'POST', body: JSON.stringify({ reason: 'Predicted deadline shortfall requires a feasible resolution path' }) }).then(() => setStatuses((current) => ({ ...current, [mode]: 'Resolution proposal prepared; review it in Planner decisions.' })))}>Prepare approval-gated resolution</button></section>}
    <section className="v2-dashboard"><section className="earth-panel panel"><GlobeView groundTrack={runtime.track} stations={state.stations} satellite={state.satellite} activeStationId={state.current_contact?.station_id} onStationSelect={setSelectedStation}/><div className="earth-caption"><span className="eyebrow">MODELED CUSTOM SATELLITE · {mode.toUpperCase()} TIMELINE</span><h2>{state.satellite.latitude_deg.toFixed(2)}°, {state.satellite.longitude_deg.toFixed(2)}°</h2><small><span className="legend active">active</span><span className="legend approved">planned</span><span className="legend candidate">candidate</span><span className="legend unused">unused</span></small></div>{selectedStation && <div className="station-popover"><button onClick={() => setSelectedStation(null)}>×</button><b>{selectedStation.name}</b><span>{selectedStation.classification} · {selectedStation.latitude_deg.toFixed(3)}°, {selectedStation.longitude_deg.toFixed(3)}°</span>{stationPasses.length ? stationPasses.map((item) => <small key={item.pass_id}>{new Date(item.start_at).toLocaleString()} → {new Date(item.end_at).toLocaleTimeString()} · target {item.volume_mb.toFixed(2)} MB</small>) : <small>No planned pass in this timeline.</small>}</div>}</section>
      <aside className="target-panel panel"><span className="eyebrow">MISSION TARGET · HARD DEADLINE {new Date(state.deadline_at).toLocaleString()}</span><h2>Downlink completion</h2><dl>{[['Required',state.required_mb],['Delivered',state.delivered_mb],['Remaining',state.remaining_mb],['Predicted final',state.predicted_final_mb],['Predicted shortfall',state.predicted_shortfall_mb]].map(([key,value]) => <div key={String(key)}><dt>{key}<AssumptionMark reason="Backend-calculated simulation value."/></dt><dd>{Number(value).toFixed(2)} MB</dd></div>)}</dl><div className="current-link"><span>Live modeled rate</span><strong>{(state.current_contact?.rate_mbps ?? 0).toFixed(2)} Mbps</strong><small>{state.current_contact ? `${state.current_contact.station_name} · target ${state.current_contact.target_volume_mb.toFixed(2)} MB · actual ${state.current_contact.actual_volume_mb.toFixed(2)} MB` : 'No active ground-station contact'}</small></div>{mode === 'live' && <LiveWeather client={client} simulationTime={state.sim_time}/>}</aside>
      <section className="passes-panel panel"><div className="panel-heading"><div><span className="eyebrow">SEQUENTIAL APPROVED ROUTE</span><h2>Planner decisions · next contact first</h2></div><span>{approved.length} planned contacts</span></div><div className="pass-list route-list">{approved.map((item, index) => { const completed = Date.parse(item.end_at) <= Date.parse(state.sim_time); const active = state.current_contact?.contact_id === item.contact_id; return <button className={`pass-row approved ${active ? 'active' : completed ? 'complete' : 'upcoming'}`} onClick={() => setSelectedStation(state.stations.find((station) => station.station_id === item.station_id) ?? null)} key={item.pass_id}><time>{index + 1} · {new Date(item.start_at).toLocaleString()}</time><b>{item.station_name}</b><span>{item.volume_mb.toFixed(1)} MB</span><i>{active ? 'NOW' : completed ? 'COMPLETED' : 'UPCOMING'}</i></button> })}</div><div className="decision-detail"><span className="eyebrow">TRANSFER LOG SUMMARY</span><h3>{approved.filter((item) => Date.parse(item.end_at) <= Date.parse(state.sim_time)).length} completed · {approved.filter((item) => Date.parse(item.start_at) > Date.parse(state.sim_time)).length} upcoming</h3><p>Planned {approved.reduce((sum, item) => sum + item.volume_mb, 0).toFixed(2)} MB across all revolutions before the deadline.</p></div></section>
      <aside className="event-panel panel"><div className="panel-heading"><div><span className="eyebrow">AUTHORITATIVE EVENT LOG</span><h2>Every event at internal simulation time</h2></div></div><div className="event-list">{runtime.events.slice().reverse().map((event) => <div className="event-row" key={event.event_id}><time>{new Date(event.sim_time).toLocaleTimeString()}</time><i/><p><strong>{event.event_type.replaceAll('_',' ')}</strong><span>{event.description || event.fragment_id || event.contact_id}{event.delivered_volume_mb != null ? ` · ${event.delivered_volume_mb.toFixed(3)} MB` : ''}</span></p></div>)}</div></aside>
    </section></>
}

export default function App() {
  const initialPath = location.pathname === '/' || location.pathname === '/mission' ? '/setup/orbit' : location.pathname
  const [path, setPath] = useState(initialPath)
  const [connection, setConnection] = useState('CONNECTING')
  const { appliedDraft } = useMissionStore()
  useEffect(() => { if (location.pathname !== initialPath) history.replaceState({}, '', initialPath); const pop = () => setPath(location.pathname); addEventListener('popstate', pop); clients.prediction.createSession().then((session) => { sessionStorage.setItem(sessionKeys.prediction, session); setConnection('BACKEND READY') }).catch(() => setConnection('BACKEND OFFLINE')); return () => removeEventListener('popstate', pop) }, [])
  const setupVisible = path.startsWith('/setup/')
  return <main className="app-shell"><header className="topbar"><div className="brand-lockup"><div className="brand-mark">A</div><div><span className="eyebrow">AUTONOMOUS GROUND CONTACT CONTROL</span><h1>Custom Satellite Downlink</h1></div></div><nav className="main-nav"><button disabled={!appliedDraft} className={path === '/mission' ? 'active' : ''} onClick={() => navigate('/mission', setPath)}>Mission</button><button className={setupVisible ? 'active' : ''} onClick={() => navigate('/setup/orbit', setPath)}>Setup</button></nav><div className="mission-status"><span className={`status-chip ${connection === 'BACKEND READY' ? 'live' : ''}`}><i/>{connection}</span></div></header><div hidden={!setupVisible}><Setup path={path} setPath={setPath}/></div><div hidden={setupVisible}><Mission/></div></main>
}
