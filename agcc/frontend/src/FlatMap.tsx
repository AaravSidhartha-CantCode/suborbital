import { useMemo } from 'react'
import { feature } from 'topojson-client'
import countries from 'world-atlas/countries-110m.json'


type GeoGeometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
type GeoFeatureCollection = { features: { geometry: GeoGeometry | null; id: string }[] }

export type GroundPoint = { latitude_deg: number; longitude_deg: number }
export type StationMarker = GroundPoint & { station_id: string; name: string; classification: string; assumed_fields: string[] }
export type SatelliteMarker = GroundPoint & { altitude_km: number; active_band?: string }

export function FlatMap({ 
  stations, 
  selectedIds,
  groundTrack,
  satellite,
  activeStationId,
  onStationSelect
}: { 
  stations: StationMarker[], 
  selectedIds?: string[],
  groundTrack?: GroundPoint[],
  satellite?: SatelliteMarker,
  activeStationId?: string,
  onStationSelect?: (station: StationMarker) => void
}) {
  const paths = useMemo(() => {
    const object = (countries as any).objects.countries
    const collection = feature(countries as any, object as any) as unknown as GeoFeatureCollection
    
    // Create SVG paths for each country
    return collection.features.map((item, index) => {
      if (!item.geometry) return null
      
      const polygons = item.geometry.type === 'Polygon' ? [item.geometry.coordinates as number[][][]] : item.geometry.coordinates as number[][][][]
      
      let d = ''
      for (const polygon of polygons) {
        for (const ring of polygon) {
          if (ring.length < 2) continue
          d += `M ${ring[0][0]} ${-ring[0][1]} `
          for (let i = 1; i < ring.length; i++) {
            d += `L ${ring[i][0]} ${-ring[i][1]} `
          }
          d += 'Z '
        }
      }
      return <path key={item.id || index} d={d} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
    })
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg 
        viewBox="-180 -90 360 180" 
        style={{ width: '100%', height: '100%', maxHeight: '100%' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <g>
          {paths}
        </g>
        
        {/* Render Ground Track */}
        {groundTrack && groundTrack.length > 0 && (
          <path
            d={`M ${groundTrack[0].longitude_deg} ${-groundTrack[0].latitude_deg} ` + groundTrack.slice(1).map(p => `L ${p.longitude_deg} ${-p.latitude_deg}`).join(' ')}
            fill="none"
            stroke="rgba(225,255,0,0.4)"
            strokeWidth="0.8"
            strokeDasharray="2,2"
          />
        )}
        
        {/* Render Ground Stations */}
        {stations.map(st => {
          const isSelected = selectedIds ? selectedIds.includes(st.station_id) : true
          const isActive = st.station_id === activeStationId
          let color = isSelected ? '#e1ff00' : '#475569'
          if (st.classification === 'anomaly') color = '#f87171'
          else if (st.classification === 'active' || isActive) color = '#22d3ee'
          else if (st.classification === 'approved') color = '#60a5fa'
          else if (st.classification === 'candidate') color = '#a78bfa'
          
          return (
            <g 
              key={st.station_id} 
              transform={`translate(${st.longitude_deg}, ${-st.latitude_deg})`}
              onClick={() => onStationSelect?.(st)}
              style={{ cursor: onStationSelect ? 'pointer' : 'default' }}
            >
              {(isSelected || isActive) && <circle r={isActive ? "4" : "2"} fill={color} opacity="0.4" />}
              <circle r={isActive ? "2" : "1"} fill={color} />
            </g>
          )
        })}

        {/* Render Satellite */}
        {satellite && (
          <g transform={`translate(${satellite.longitude_deg}, ${-satellite.latitude_deg})`}>
            <circle r="3" fill="#ffffff" opacity="0.8" />
            <circle r="1.5" fill="#e1ff00" />
            <rect x="-4" y="-1" width="2" height="2" fill="#e1ff00" />
            <rect x="2" y="-1" width="2" height="2" fill="#e1ff00" />
          </g>
        )}
      </svg>
    </div>
  )
}
