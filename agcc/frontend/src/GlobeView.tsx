import { Line, OrbitControls, Stars, Html } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { feature } from 'topojson-client'
import countries from 'world-atlas/countries-110m.json'
import type { WeatherVisual } from './LiveWeather'
import { useMissionStore } from './store'

export type GroundPoint = { latitude_deg: number; longitude_deg: number }
export type StationMarker = GroundPoint & { station_id: string; name: string; classification: string; assumed_fields: string[] }
export type SatelliteMarker = GroundPoint & { altitude_km: number; active_band?: string }

type GeoGeometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
type GeoFeatureCollection = { features: { geometry: GeoGeometry | null }[] }

const point = (latitudeDeg: number, longitudeDeg: number, radius: number) => {
  const latitude = latitudeDeg * Math.PI / 180
  const longitude = longitudeDeg * Math.PI / 180
  return new THREE.Vector3(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), -Math.cos(latitude) * Math.sin(longitude)).multiplyScalar(radius)
}

const markerColor: Record<string, string> = { anomaly: '#ff4d62', active: '#00f0ff', approved: '#31d17c', candidate: '#a66cff', unused: '#4ea8de', unselected: '#2f3e46' }

function countryLines(): THREE.Vector3[][] {
  const object = (countries as { objects: { countries: unknown } }).objects.countries
  const collection = feature(countries as never, object as never) as unknown as GeoFeatureCollection
  const lines: THREE.Vector3[][] = []
  for (const item of collection.features) {
    if (!item.geometry) continue
    const polygons = item.geometry.type === 'Polygon' ? [item.geometry.coordinates as number[][][]] : item.geometry.coordinates as number[][][][]
    for (const polygon of polygons) for (const ring of polygon) {
      if (ring.length > 1) lines.push(ring.map(([longitude, latitude]) => point(latitude, longitude, 2.008)))
    }
  }
  return lines
}

function SatelliteAsset({ position, band }: { position: THREE.Vector3, band?: string }) {
  return (
    <group position={position} scale={1.5}>
      {/* Central Bus */}
      <mesh>
        <cylinderGeometry args={[0.06, 0.06, 0.16, 12]} />
        <meshPhysicalMaterial color="#e0e0e0" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Solar Panel Left */}
      <mesh position={[-0.18, 0, 0]}>
        <boxGeometry args={[0.2, 0.01, 0.12]} />
        <meshPhysicalMaterial color="#1b3b5a" metalness={0.9} roughness={0.1} emissive="#002244" />
      </mesh>
      {/* Solar Panel Right */}
      <mesh position={[0.18, 0, 0]}>
        <boxGeometry args={[0.2, 0.01, 0.12]} />
        <meshPhysicalMaterial color="#1b3b5a" metalness={0.9} roughness={0.1} emissive="#002244" />
      </mesh>
      {/* Dish */}
      <mesh position={[0, -0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.05, 16, 16, 0, Math.PI]} />
        <meshPhysicalMaterial color="#ffffff" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* HTML Overlay for Specs */}
      <Html position={[0.2, 0.2, 0]} center>
        <div style={{ background: 'rgba(5, 10, 15, 0.8)', padding: '6px 12px', borderRadius: '12px', border: '1px solid rgba(0, 240, 255, 0.2)', backdropFilter: 'blur(8px)', color: '#00f0ff', font: '500 11px "JetBrains Mono", monospace', whiteSpace: 'nowrap', pointerEvents: 'none', textTransform: 'uppercase', boxShadow: '0 0 15px rgba(0, 240, 255, 0.1)' }}>
          {band ? `BAND: ${band}` : 'NOMINAL'}
        </div>
      </Html>
    </group>
  )
}

function WeatherEffect({ position, weather }: { position: THREE.Vector3; weather: WeatherVisual }) {
  if (weather.kind === 'clear') return <pointLight position={position} color="#ffe6a3" intensity={1.2}/>
  const cloudPosition = position.clone().multiplyScalar(1.08)
  return (
    <group position={cloudPosition}>
      {[-.1, 0, .1].map((offset) => <mesh key={offset} position={[offset, 0, 0]}><sphereGeometry args={[.09 + weather.intensity * .04, 12, 12]}/><meshStandardMaterial color={weather.kind === 'rain' ? '#5a6e82' : '#b0c4cf'} transparent opacity={.85}/></mesh>)}
      {weather.kind === 'rain' && [-.08, 0, .08].map((offset) => <Line key={`rain-${offset}`} points={[[offset, -.04, 0], [offset, -.24 - weather.intensity * .12, 0]]} color="#66c9ff" lineWidth={1.5} transparent opacity={0.6}/>)}
      <Html position={[0.2, 0.1, 0]} center>
        <div style={{ background: 'rgba(5, 10, 15, 0.8)', padding: '4px 8px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(8px)', color: '#fff', font: '400 10px "JetBrains Mono", monospace', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {weather.kind === 'rain' ? 'HEAVY CLOUDS & RAIN' : 'PARTLY CLOUDY'}
        </div>
      </Html>
    </group>
  )
}

function OrbitInteraction({ track, orbitConfig, onOrbitChange, satellitePosition, setDragging }: { track: THREE.Vector3[]; orbitConfig: any; onOrbitChange: any; satellitePosition: THREE.Vector3; setDragging: (v: boolean) => void }) {
  const origin = useRef<{ x: number, y: number, dist: number, raan: number, inclination: number, altitude: number } | null>(null)
  const originPhase = useRef<{ initialPhase: number, initialAngle: number } | null>(null)
  if (!orbitConfig || !onOrbitChange || track.length < 2) return null
  const curve = useMemo(() => new THREE.CatmullRomCurve3(track, true), [track])

  return (
    <group>
      <mesh
        onPointerDown={(e) => {
          e.stopPropagation()
          ;(e.target as any).setPointerCapture?.(e.pointerId)
          const canvas = e.nativeEvent.target as HTMLCanvasElement
          const rect = canvas.getBoundingClientRect()
          const x = e.clientX - rect.left - rect.width / 2
          const y = e.clientY - rect.top - rect.height / 2
          origin.current = { x: e.clientX, y: e.clientY, dist: Math.sqrt(x*x + y*y), raan: orbitConfig.raan_deg, inclination: orbitConfig.inclination_deg, altitude: orbitConfig.altitude_km }
          setDragging(true)
        }}
        onPointerMove={(e) => {
          if (!origin.current) return
          e.stopPropagation()
          const canvas = e.nativeEvent.target as HTMLCanvasElement
          const rect = canvas.getBoundingClientRect()
          const x = e.clientX - rect.left - rect.width / 2
          const y = e.clientY - rect.top - rect.height / 2
          const currentDist = Math.sqrt(x*x + y*y)
          
          const dx = e.clientX - origin.current.x
          const dy = e.clientY - origin.current.y
          const distDelta = currentDist - origin.current.dist
          
          onOrbitChange({
            raan_deg: (origin.current.raan + dx * 0.5 + 360) % 360,
            inclination_deg: Math.max(0, Math.min(180, origin.current.inclination + dy * 0.5)),
            altitude_km: Math.max(200, Math.min(2000, origin.current.altitude + distDelta * 10))
          })
        }}
        onPointerUp={(e) => {
          e.stopPropagation()
          ;(e.target as any).releasePointerCapture?.(e.pointerId)
          origin.current = null
          setDragging(false)
        }}
        onWheel={(e) => {
          e.stopPropagation()
          onOrbitChange({ altitude_km: Math.max(200, Math.min(2000, orbitConfig.altitude_km - Math.sign(e.deltaY) * 25)) })
        }}
      >
        <tubeGeometry args={[curve, 120, 0.15, 8, true]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <mesh
        position={satellitePosition}
        onPointerDown={(e) => {
          e.stopPropagation()
          ;(e.target as any).setPointerCapture?.(e.pointerId)
          const canvas = e.nativeEvent.target as HTMLCanvasElement
          const rect = canvas.getBoundingClientRect()
          const x = e.clientX - rect.left - rect.width / 2
          const y = e.clientY - rect.top - rect.height / 2
          originPhase.current = { initialPhase: orbitConfig.phase_deg, initialAngle: Math.atan2(y, x) * 180 / Math.PI }
          setDragging(true)
        }}
        onPointerMove={(e) => {
          if (!originPhase.current) return
          e.stopPropagation()
          const canvas = e.nativeEvent.target as HTMLCanvasElement
          const rect = canvas.getBoundingClientRect()
          const x = e.clientX - rect.left - rect.width / 2
          const y = e.clientY - rect.top - rect.height / 2
          const angle = Math.atan2(y, x) * 180 / Math.PI
          const angleDiff = angle - originPhase.current.initialAngle
          onOrbitChange({ phase_deg: (originPhase.current.initialPhase + angleDiff + 360) % 360 })
        }}
        onPointerUp={(e) => {
          e.stopPropagation()
          ;(e.target as any).releasePointerCapture?.(e.pointerId)
          originPhase.current = null
          setDragging(false)
        }}
      >
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  )
}

function Earth({ groundTrack, stations, satellite, activeStationId, weather, onStationSelect, orbitConfig, onOrbitChange, setDragging }: { groundTrack: GroundPoint[]; stations: StationMarker[]; satellite?: SatelliteMarker; activeStationId?: string; weather?: WeatherVisual | null; onStationSelect?: (station: StationMarker) => void; orbitConfig?: any; onOrbitChange?: (patch: any) => void; setDragging: (v: boolean) => void }) {
  const outlines = useMemo(countryLines, [])
  const orbitRadius = satellite ? 2 + Math.min(1.15, satellite.altitude_km / 1750) : 2.025
  const track = groundTrack.map((item) => point(item.latitude_deg, item.longitude_deg, orbitRadius))
  const satellitePosition = satellite ? point(satellite.latitude_deg, satellite.longitude_deg, orbitRadius) : track[0] ?? new THREE.Vector3(2.4, 0, 0)
  const activeStation = stations.find((station) => station.station_id === activeStationId)
  const activeLink = activeStation ? [point(activeStation.latitude_deg, activeStation.longitude_deg, 2.04), satellitePosition] : null
  const draft = useMissionStore((s) => s.draft)
  
  return (
    <group rotation={[.08, -.45, -.12]}>
      {/* Main Earth Sphere - Realistic Dark Ocean */}
      <mesh>
        <sphereGeometry args={[2, 64, 64]}/>
        <meshPhysicalMaterial color="#020813" emissive="#000000" roughness={0.7} metalness={0.1} clearcoat={0.1} />
      </mesh>
      {/* Atmospheric Halo */}
      <mesh>
        <sphereGeometry args={[2.02, 64, 64]}/>
        <meshPhysicalMaterial color="#4ea8de" transparent opacity={0.1} transmission={0.5} roughness={0} />
      </mesh>
      {/* Thin Grid Wireframe */}
      <mesh>
        <sphereGeometry args={[2.001, 32, 32]}/>
        <meshBasicMaterial color="#4ea8de" wireframe transparent opacity={0.05} />
      </mesh>
      
      {/* Country Outlines */}
      {outlines.map((line, index) => <Line key={index} points={line} color="#153b5c" lineWidth={0.6} transparent opacity={0.7}/>)}
      
      {/* Very thin elegant orbit line */}
      {track.length > 1 && (
        <Line points={track} color="#00f0ff" lineWidth={0.8} transparent opacity={0.8} />
      )}
      
      {/* Active Link */}
      {activeLink && <Line points={activeLink} color="#00f0ff" lineWidth={1.5} dashed dashSize={.06} gapSize={.04} transparent opacity={.9}/>}
      
      {/* Station Markers */}
      {stations.map((station) => { 
        const emphasized = station.classification === 'active' || station.classification === 'approved'; 
        const isActive = station.station_id === activeStationId;
        return (
          <mesh position={point(station.latitude_deg, station.longitude_deg, 2.035)} key={station.station_id} onClick={(event) => { event.stopPropagation(); onStationSelect?.(station) }}>
            <sphereGeometry args={[isActive ? .06 : emphasized ? .04 : .02, 16, 16]}/>
            <meshBasicMaterial color={markerColor[isActive ? 'active' : station.classification] ?? markerColor.unselected}/>
          </mesh>
        )
      })}
      
      {activeStation && weather && <WeatherEffect position={point(activeStation.latitude_deg, activeStation.longitude_deg, 2.06)} weather={weather}/>}
      <SatelliteAsset position={satellitePosition} band={draft?.band} />
      <OrbitInteraction track={track} orbitConfig={orbitConfig} onOrbitChange={onOrbitChange} satellitePosition={satellitePosition} setDragging={setDragging} />
    </group>
  )
}

export function GlobeView({ groundTrack = [], stations = [], satellite, activeStationId, weather, onStationSelect, orbitConfig, onOrbitChange }: { running?: boolean; groundTrack?: GroundPoint[]; stations?: StationMarker[]; satellite?: SatelliteMarker; activeStationId?: string; weather?: WeatherVisual | null; onStationSelect?: (station: StationMarker) => void; orbitConfig?: any; onOrbitChange?: (patch: any) => void }) {
  const [dragging, setDragging] = useState(false)
  return (
    <div className="globe-canvas" aria-label="Interactive Earth, country outlines, stations, and modeled orbit visualization">
      <Canvas camera={{ position: [0, 0, 7.2], fov: 44 }}>
        <color attach="background" args={['#000000']}/>
        <ambientLight intensity={1.5}/>
        <directionalLight position={[5, 3, 5]} intensity={2.5} color="#90e0ef"/>
        <directionalLight position={[-5, -3, -5]} intensity={1.0} color="#00f0ff"/>
        <Stars radius={80} depth={40} count={2000} factor={2} fade speed={.05}/>
        <Earth groundTrack={groundTrack} stations={stations} satellite={satellite} activeStationId={activeStationId} weather={weather} onStationSelect={onStationSelect} orbitConfig={orbitConfig} onOrbitChange={onOrbitChange} setDragging={setDragging} />
        <OrbitControls enablePan={false} enableRotate={!dragging} enableZoom={!dragging} minDistance={5.4} maxDistance={10}/>
      </Canvas>
    </div>
  )
}
