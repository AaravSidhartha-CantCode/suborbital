import { useEffect, useMemo, useState } from 'react'
import { AgccClient, ensureSession } from './api'
import { AssumptionMark } from './DataStatus'
import { useMissionStore } from './store'
import { GroundStationWireframe } from './SetupComponents'

type Station = { station_id: string; name: string; provider_id: string; supported_bands: string[] | null; max_downlink_rate_mbps: number | null; cost_per_minute: number; currency: string; field_provenance: { sources: Record<string, string>; assumptions: string[] } }
type Catalog = { catalog_id: string; catalog_version: string; stations: Station[] }
const stationClient = new AgccClient()

export function StationCatalogPicker({ onBack, onContinue }: { onBack?: () => void; onContinue?: () => void }) {
  const { draft, updateDraft } = useMissionStore()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('all')
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    ensureSession(stationClient).then(() => stationClient.request<Catalog>('/catalog/stations')).then((loaded) => {
      setCatalog(loaded)
      const valid = draft.stations.filter((id) => loaded.stations.some((station) => station.station_id === id))
      if (valid.length === 0) {
        const compatible = loaded.stations.filter((station) => station.supported_bands?.includes(draft.band))
        updateDraft({ stations: compatible.slice(0, 3).map((station) => station.station_id) })
      }
    }).catch(() => setError('Station catalogue could not be loaded.'))
  }, [])
  const providers = useMemo(() => [...new Set(catalog?.stations.map((station) => station.provider_id) ?? [])].sort(), [catalog])
  const visible = useMemo(() => catalog?.stations.filter((station) => {
    const compatible = station.supported_bands?.includes(draft.band) ?? false
    const matchesProvider = provider === 'all' || station.provider_id === provider
    const needle = query.trim().toLowerCase()
    const matchesQuery = !needle || `${station.name} ${station.station_id} ${station.provider_id}`.toLowerCase().includes(needle)
    return compatible && matchesProvider && matchesQuery
  }) ?? [], [catalog, draft.band, provider, query])
  const displayed = expanded ? visible : visible.slice(0, 20)
  const filteredCompatibleIds = visible.map((station) => station.station_id)
  const allFilteredSelected = filteredCompatibleIds.length > 0 && filteredCompatibleIds.every((id) => draft.stations.includes(id))
  if (error) return <div className="catalog-error">{error}</div>
  if (!catalog) return <div className="setup-island-row"><div className="glass-island-form"><p>Loading validated station catalogue…</p></div></div>
  return (
    <div className="setup-island-row">
      <div className="setup-form-column" style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="glass-island-form" style={{ padding: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '24px 32px 16px 32px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(0,0,0,0.2)', borderTopLeftRadius: '20px', borderTopRightRadius: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 14px' }}>
              <h3 className="island-title" style={{ margin: 0 }}>Available Stations</h3>
              <div className="disclaimer-group">
                <span className="disclaimer-icon">[i]</span>
                <div className="disclaimer-tooltip">Real provider/place labels are retained, but starred properties are simulation assumptions.</div>
              </div>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                {draft.stations.length} SELECTED &middot; {displayed.length} OF {visible.length} SHOWN
              </span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
              <div className="glass-value-box" style={{ width: '100%', minHeight: 'auto' }}>
                <input style={{ padding: '12px 0', width: '100%', background: 'transparent', border: 'none', color: '#fff', outline: 'none' }} aria-label="Search stations" placeholder="SEARCH STATION, ID, OR PROVIDER" value={query} onChange={(event) => { setQuery(event.target.value); setExpanded(false) }}/>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" className="setup-secondary-btn" style={{ flex: 1, background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.4))', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '16px', padding: '12px', color: '#fff', fontSize: '11px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }} disabled={draft.stations.length === 0} onClick={() => updateDraft({ stations: [] })}>Clear Selection</button>
                <button type="button" className="setup-secondary-btn" style={{ flex: 1, background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.4))', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '16px', padding: '12px', color: '#fff', fontSize: '11px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }} disabled={allFilteredSelected || filteredCompatibleIds.length === 0} onClick={() => updateDraft({ stations: [...new Set([...draft.stations, ...filteredCompatibleIds])] })}>Select All</button>
                <div className="glass-value-box" style={{ flex: 1, minHeight: 'auto', padding: '0 14px' }}>
                  <select style={{ padding: '12px 0', width: '100%', background: 'transparent', border: 'none', color: '#fff', outline: 'none', appearance: 'none', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }} aria-label="Provider filter" value={provider} onChange={(event) => { setProvider(event.target.value); setExpanded(false) }}>
                    <option value="all" style={{color: '#000'}}>FILTER PROVIDERS</option>
                    {providers.map((item) => <option key={item} style={{color: '#000'}}>{item}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
          <div style={{ padding: '16px 32px 24px 32px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {draft.stations.length === 0 && <p className="catalog-error" style={{ color: '#ef4444', marginBottom: '16px' }}>Select at least one compatible station before creating the scenario.</p>}
            <div className="station-card-grid">
              {displayed.map((station) => { 
                const assumed = new Set(station.field_provenance.assumptions)
                const selected = draft.stations.includes(station.station_id)
                const mark = (field: string) => assumed.has(field) ? <AssumptionMark reason={`${field} is unverified in the supplied catalogue.`}/> : null
                return (
                  <label className={`${selected ? 'selected' : ''}`} key={station.station_id}>
                    <input type="checkbox" checked={selected} onChange={(event) => updateDraft({ stations: event.target.checked ? [...draft.stations, station.station_id] : draft.stations.filter((id) => id !== station.station_id) })}/>
                    <b>{station.name}{mark('name')}</b>
                    <span>{station.provider_id}{mark('provider_id')}</span>
                    <small>{station.supported_bands?.join(' / ') || 'Bands unknown'}{mark('supported_bands')}</small>
                    <small>{station.max_downlink_rate_mbps?.toFixed(1) ?? '—'} Mbps{mark('max_downlink_rate_mbps')} · {station.currency} {station.cost_per_minute.toFixed(1)}/min{mark('cost_per_minute')}</small>
                  </label>
                )
              })}
            </div>
            {visible.length > 20 && <button className="catalog-fold" style={{ marginTop: '24px', width: '100%', background: 'rgba(255,255,255,0.05)', padding: '12px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff', cursor: 'pointer' }} type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show less' : `See more (${visible.length - 20} remaining)`}</button>}
          </div>
        </div>
      </div>
      
      <div className="setup-form-column" style={{ flex: 0.4, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="glass-island-globe" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <GroundStationWireframe />
        </div>
        
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {onBack && (
            <button className="home-cta secondary" onClick={onBack} style={{ width: '100%' }}>
              ← BACK TO COMMUNICATIONS
              <div className="home-cta-target"><i/><i/></div>
            </button>
          )}
          {onContinue && (
            <button className="home-cta" disabled={draft.stations.length === 0} onClick={onContinue} style={{ width: '100%' }}>
              CONTINUE TO MISSION
              <div className="home-cta-target"><i/><i/></div>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

