import { Line, Stars } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { feature } from 'topojson-client'
import countries from 'world-atlas/countries-110m.json'

type GeoGeometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
type GeoFeatureCollection = { features: { geometry: GeoGeometry | null }[] }

const globePoint = (latitude: number, longitude: number, radius: number) => {
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).multiplyScalar(radius)
}

function countryOutlines() {
  const object = (countries as { objects: { countries: unknown } }).objects.countries
  const collection = feature(countries as never, object as never) as unknown as GeoFeatureCollection
  const lines: THREE.Vector3[][] = []
  for (const item of collection.features) {
    if (!item.geometry) continue
    const polygons = item.geometry.type === 'Polygon' ? [item.geometry.coordinates as number[][][]] : item.geometry.coordinates as number[][][][]
    for (const polygon of polygons) for (const ring of polygon) if (ring.length > 1) lines.push(ring.map(([lon, lat]) => globePoint(lat, lon, 2.014)))
  }
  return lines
}

function Satellite() {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const angle = clock.getElapsedTime() * .22
    ref.current.position.set(Math.cos(angle) * 2.85, Math.sin(angle) * 1.32, Math.sin(angle) * 2.48)
    ref.current.rotation.set(angle * .18, -angle, .24)
  })
  return <group ref={ref} scale={.56}>
    <mesh><boxGeometry args={[.32,.24,.26]} /><meshStandardMaterial color="#c9d0d3" metalness={.9} roughness={.24} /></mesh>
    <mesh position={[-.5,0,0]}><boxGeometry args={[.66,.025,.28]} /><meshStandardMaterial color="#123d68" emissive="#062241" emissiveIntensity={.5} metalness={.65} roughness={.24} /></mesh>
    <mesh position={[.5,0,0]}><boxGeometry args={[.66,.025,.28]} /><meshStandardMaterial color="#123d68" emissive="#062241" emissiveIntensity={.5} metalness={.65} roughness={.24} /></mesh>
    <mesh position={[0,-.22,0]} rotation={[Math.PI / 2,0,0]}><cylinderGeometry args={[.15,.035,.09,24]} /><meshStandardMaterial color="#d9e3e5" metalness={.72} roughness={.3} /></mesh>
    <pointLight color="#72ecff" intensity={2.2} distance={1.3} />
  </group>
}

function EarthSystem() {
  const earth = useRef<THREE.Group>(null)
  const outlines = useMemo(countryOutlines, [])
  const orbit = useMemo(() => Array.from({ length: 161 }, (_, i) => { const a = i / 160 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 2.85, Math.sin(a) * 1.32, Math.sin(a) * 2.48) }), [])
  useFrame((_, delta) => { if (earth.current) earth.current.rotation.y += delta * .035 })
  return <group position={[.7,-.12,0]} rotation={[.1,-.55,-.08]}>
    <group ref={earth}>
      <mesh castShadow receiveShadow><sphereGeometry args={[2,96,96]} /><meshPhysicalMaterial color="#071a25" emissive="#01070b" emissiveIntensity={.25} roughness={.82} metalness={.02} clearcoat={.12} /></mesh>
      <mesh rotation={[.01,.02,.01]}><sphereGeometry args={[2.022,96,96]} /><meshStandardMaterial color="#b8d7d8" transparent opacity={.055} roughness={1} depthWrite={false} /></mesh>
      {outlines.map((line,index) => <Line key={index} points={line} color="#78bdd0" lineWidth={.48} transparent opacity={.31} />)}
      <mesh><sphereGeometry args={[2.065,72,72]} /><meshBasicMaterial color="#3ca6ca" side={THREE.BackSide} transparent opacity={.11} /></mesh>
      <mesh><sphereGeometry args={[2.095,72,72]} /><meshBasicMaterial color="#73dbf6" side={THREE.BackSide} transparent opacity={.035} /></mesh>
    </group>
    <Line points={orbit} color="#70dff7" lineWidth={.55} transparent opacity={.22} />
    <Satellite />
  </group>
}

export function HomeEarth() {
  return <Canvas camera={{ position:[0,0,7], fov:42 }} dpr={[1,1.65]} gl={{ antialias:true, alpha:true }}>
    <ambientLight intensity={.12} /><directionalLight position={[-5,4,6]} intensity={4.2} color="#c9f2ff" /><directionalLight position={[5,-2,-4]} intensity={.7} color="#0d4f78" /><pointLight position={[2,4,5]} intensity={1.4} color="#75dfff" distance={12} />
    <Stars radius={70} depth={28} count={1200} factor={1.4} saturation={.25} fade speed={.08} /><EarthSystem />
  </Canvas>
}
