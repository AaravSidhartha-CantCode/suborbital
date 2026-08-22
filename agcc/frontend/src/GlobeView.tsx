import { Line, OrbitControls, Stars } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { feature } from 'topojson-client'
import countries from 'world-atlas/countries-110m.json'

export type GroundPoint = { latitude_deg: number; longitude_deg: number }
export type StationMarker = GroundPoint & { station_id: string; name: string; classification: string; assumed_fields: string[] }
export type SatelliteMarker = GroundPoint & { altitude_km: number }

type GeoGeometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
type GeoFeatureCollection = { features: { geometry: GeoGeometry | null }[] }

const point = (latitudeDeg: number, longitudeDeg: number, radius: number) => {
  const latitude = latitudeDeg * Math.PI / 180
  const longitude = longitudeDeg * Math.PI / 180
  return new THREE.Vector3(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)).multiplyScalar(radius)
}

const markerColor: Record<string, string> = { anomaly: '#ff4d62', active: '#ff8b4d', approved: '#54d6a0', candidate: '#d2ad66', unused: '#8a9aa5', unselected: '#344b59' }

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

function Earth({ groundTrack, stations, satellite, activeStationId, onStationSelect }: { groundTrack: GroundPoint[]; stations: StationMarker[]; satellite?: SatelliteMarker; activeStationId?: string; onStationSelect?: (station: StationMarker) => void }) {
  const outlines = useMemo(countryLines, [])
  const track = groundTrack.map((item) => point(item.latitude_deg, item.longitude_deg, 2.025))
  const satellitePosition = satellite ? point(satellite.latitude_deg, satellite.longitude_deg, 2 + Math.min(.65, satellite.altitude_km / 1500)) : track[0] ?? new THREE.Vector3(2.4, 0, 0)
  const activeStation = stations.find((station) => station.station_id === activeStationId)
  const activeLink = activeStation ? [point(activeStation.latitude_deg, activeStation.longitude_deg, 2.04), satellitePosition] : null
  return <group rotation={[.08, -.45, -.12]}><mesh><sphereGeometry args={[2, 64, 64]}/><meshStandardMaterial color="#0b3750" roughness={.76}/></mesh>{outlines.map((line, index) => <Line key={index} points={line} color="#6a9bad" lineWidth={.18} transparent opacity={.25}/>)}{track.length > 1 && <><Line points={track} color="#42fff0" lineWidth={4.2} transparent opacity={.16}/><Line points={track} color="#72fff3" lineWidth={2.1} transparent opacity={1}/></>}{activeLink && <Line points={activeLink} color="#ffad63" lineWidth={1.1} dashed dashSize={.08} gapSize={.055} transparent opacity={.95}/>} {stations.map((station) => { const emphasized = station.classification === 'active' || station.classification === 'approved'; return <mesh position={point(station.latitude_deg, station.longitude_deg, 2.035)} key={station.station_id} onClick={(event) => { event.stopPropagation(); onStationSelect?.(station) }}><sphereGeometry args={[station.classification === 'active' ? .075 : emphasized ? .052 : .029, 12, 12]}/><meshBasicMaterial color={markerColor[station.station_id === activeStationId ? 'active' : station.classification] ?? markerColor.unselected}/></mesh> })}<SatelliteAsset position={satellitePosition}/></group>
}

export function GlobeView({ groundTrack = [], stations = [], satellite, activeStationId, onStationSelect }: { running?: boolean; groundTrack?: GroundPoint[]; stations?: StationMarker[]; satellite?: SatelliteMarker; activeStationId?: string; onStationSelect?: (station: StationMarker) => void }) {
  return <div className="globe-canvas" aria-label="Interactive Earth, country outlines, stations, and modeled orbit visualization"><Canvas camera={{ position: [0, 0, 7.2], fov: 44 }}><color attach="background" args={['#050a12']}/><ambientLight intensity={.55}/><directionalLight position={[4, 3, 5]} intensity={2.4} color="#dffcff"/><Stars radius={60} depth={30} count={650} factor={1.3} fade speed={.15}/><Earth groundTrack={groundTrack} stations={stations} satellite={satellite} activeStationId={activeStationId} onStationSelect={onStationSelect}/><OrbitControls enablePan={false} minDistance={5.4} maxDistance={9}/></Canvas></div>
}
