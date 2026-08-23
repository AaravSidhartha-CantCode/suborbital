import { Line, OrbitControls, Stars } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { feature } from 'topojson-client'
import countries from 'world-atlas/countries-110m.json'
import type { WeatherVisual } from './LiveWeather'

export type GroundPoint = { latitude_deg: number; longitude_deg: number }
export type StationMarker = GroundPoint & { station_id: string; name: string; classification: string; assumed_fields: string[] }
export type SatelliteMarker = GroundPoint & { altitude_km: number }

type GeoGeometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
type GeoFeatureCollection = { features: { geometry: GeoGeometry | null }[] }

const point = (latitudeDeg: number, longitudeDeg: number, radius: number) => {
  const latitude = latitudeDeg * Math.PI / 180
  const longitude = longitudeDeg * Math.PI / 180
  return new THREE.Vector3(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), -Math.cos(latitude) * Math.sin(longitude)).multiplyScalar(radius)
}

const markerColor: Record<string, string> = { anomaly: '#ff4d62', active: '#ff8b4d', approved: '#31d17c', candidate: '#a66cff', unused: '#7f8a93', unselected: '#7f8a93' }

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

function SatelliteAsset({ position }: { position: THREE.Vector3 }) {
  return <group position={position} scale={1.35}><mesh><boxGeometry args={[.12, .08, .08]}/><meshStandardMaterial color="#ffb15c" emissive="#ff7a3d" emissiveIntensity={1.7}/></mesh><mesh position={[-.13, 0, 0]}><boxGeometry args={[.12, .02, .16]}/><meshStandardMaterial color="#52d7e5" emissive="#1b7180" emissiveIntensity={1}/></mesh><mesh position={[.13, 0, 0]}><boxGeometry args={[.12, .02, .16]}/><meshStandardMaterial color="#52d7e5" emissive="#1b7180" emissiveIntensity={1}/></mesh></group>
}

function WeatherEffect({ position, weather }: { position: THREE.Vector3; weather: WeatherVisual }) {
  if (weather.kind === 'clear') return <pointLight position={position} color="#ffe6a3" intensity={1.2}/>
  const cloudPosition = position.clone().multiplyScalar(1.08)
  return <group position={cloudPosition}>{[-.1, 0, .1].map((offset) => <mesh key={offset} position={[offset, 0, 0]}><sphereGeometry args={[.09 + weather.intensity * .04, 12, 12]}/><meshStandardMaterial color={weather.kind === 'rain' ? '#8395a5' : '#dbe9ee'} transparent opacity={.65}/></mesh>)}{weather.kind === 'rain' && [-.08, 0, .08].map((offset) => <Line key={`rain-${offset}`} points={[[offset, -.04, 0], [offset, -.24 - weather.intensity * .12, 0]]} color="#66c9ff" lineWidth={1}/>)}</group>
}

function Earth({ groundTrack, stations, satellite, activeStationId, weather, onStationSelect }: { groundTrack: GroundPoint[]; stations: StationMarker[]; satellite?: SatelliteMarker; activeStationId?: string; weather?: WeatherVisual | null; onStationSelect?: (station: StationMarker) => void }) {
  const outlines = useMemo(countryLines, [])
  const orbitRadius = satellite ? 2 + Math.min(1.15, satellite.altitude_km / 1750) : 2.025
  const track = groundTrack.map((item) => point(item.latitude_deg, item.longitude_deg, orbitRadius))
  const satellitePosition = satellite ? point(satellite.latitude_deg, satellite.longitude_deg, orbitRadius) : track[0] ?? new THREE.Vector3(2.4, 0, 0)
  const activeStation = stations.find((station) => station.station_id === activeStationId)
  const activeLink = activeStation ? [point(activeStation.latitude_deg, activeStation.longitude_deg, 2.04), satellitePosition] : null
  return <group rotation={[.08, -.45, -.12]}><mesh><sphereGeometry args={[2, 64, 64]}/><meshStandardMaterial color="#0b3750" roughness={.76}/></mesh>{outlines.map((line, index) => <Line key={index} points={line} color="#8bc3d5" lineWidth={.25} transparent opacity={.42}/>)}{track.length > 1 && <><Line points={track} color="#42fff0" lineWidth={4.2} transparent opacity={.16}/><Line points={track} color="#72fff3" lineWidth={2.1} transparent opacity={1}/></>}{activeLink && <Line points={activeLink} color="#ffad63" lineWidth={1.1} dashed dashSize={.08} gapSize={.055} transparent opacity={.95}/>} {stations.map((station) => { const emphasized = station.classification === 'active' || station.classification === 'approved'; return <mesh position={point(station.latitude_deg, station.longitude_deg, 2.035)} key={station.station_id} onClick={(event) => { event.stopPropagation(); onStationSelect?.(station) }}><sphereGeometry args={[station.classification === 'active' ? .075 : emphasized ? .052 : .029, 12, 12]}/><meshBasicMaterial color={markerColor[station.station_id === activeStationId ? 'active' : station.classification] ?? markerColor.unselected}/></mesh> })}{activeStation && weather && <WeatherEffect position={point(activeStation.latitude_deg, activeStation.longitude_deg, 2.06)} weather={weather}/>}<SatelliteAsset position={satellitePosition}/></group>
}

export function GlobeView({ groundTrack = [], stations = [], satellite, activeStationId, weather, onStationSelect }: { running?: boolean; groundTrack?: GroundPoint[]; stations?: StationMarker[]; satellite?: SatelliteMarker; activeStationId?: string; weather?: WeatherVisual | null; onStationSelect?: (station: StationMarker) => void }) {
  return <div className="globe-canvas" aria-label="Interactive Earth, country outlines, stations, and modeled orbit visualization"><Canvas camera={{ position: [0, 0, 7.2], fov: 44 }}><color attach="background" args={['#050a12']}/><ambientLight intensity={.55}/><directionalLight position={[4, 3, 5]} intensity={2.4} color="#dffcff"/><Stars radius={60} depth={30} count={650} factor={1.3} fade speed={.15}/><Earth groundTrack={groundTrack} stations={stations} satellite={satellite} activeStationId={activeStationId} weather={weather} onStationSelect={onStationSelect}/><OrbitControls enablePan={false} minDistance={5.4} maxDistance={9}/></Canvas></div>
}
