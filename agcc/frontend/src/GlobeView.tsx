import { Line, OrbitControls, Stars, useTexture } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { feature } from 'topojson-client'
import countries from 'world-atlas/countries-110m.json'

import { propagate, gmstRad, type OrbitParams } from './propagator'

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

const markerColor: Record<string, string> = { anomaly: '#f87171', active: '#e1ff00', approved: '#22d3ee', candidate: '#a855f7', unused: '#475569', unselected: '#2d3748' }

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

function Clouds() {
  const cloudsRef = useRef<THREE.Mesh>(null)
  const texture = useTexture('/textures/earth-clouds.png')
  useFrame((_, delta) => {
    if (cloudsRef.current) {
      cloudsRef.current.rotation.y += delta * 0.015
    }
  })
  return (
    <mesh ref={cloudsRef}>
      <sphereGeometry args={[2.015, 64, 64]} />
      <meshStandardMaterial map={texture} transparent opacity={0.35} depthWrite={false} color="#ffffff" />
    </mesh>
  )
}

function SatelliteAsset({ position }: { position: THREE.Vector3 }) {
  return (
    <group position={position} scale={0.75}>
      {/* Central Bus */}
      <mesh>
        <cylinderGeometry args={[0.06, 0.06, 0.16, 12]} />
        <meshBasicMaterial color="#e1ff00" wireframe />
      </mesh>
      {/* Solar Panel Left */}
      <mesh position={[-0.18, 0, 0]}>
        <boxGeometry args={[0.2, 0.01, 0.12]} />
        <meshBasicMaterial color="#e1ff00" wireframe />
      </mesh>
      {/* Solar Panel Right */}
      <mesh position={[0.18, 0, 0]}>
        <boxGeometry args={[0.2, 0.01, 0.12]} />
        <meshBasicMaterial color="#e1ff00" wireframe />
      </mesh>
      {/* Dish */}
      <mesh position={[0, -0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.05, 16, 16, 0, Math.PI]} />
        <meshBasicMaterial color="#e1ff00" wireframe />
      </mesh>
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

function SatellitePropagator({ satGroupRef, orbitRingGroupRef, orbitConfig, simTimeAnchor, speed, paused, orbitRadius, propagatedPosRef }: { satGroupRef: React.RefObject<THREE.Group | null>; orbitRingGroupRef?: React.RefObject<THREE.Group | null>; orbitConfig: OrbitParams; simTimeAnchor: string; speed: string; paused: boolean; orbitRadius: number; propagatedPosRef?: React.MutableRefObject<{lat: number, lon: number} | null> }) {
  const currentSimMs = useRef(Date.parse(simTimeAnchor))
  const lastFrameWall = useRef(performance.now())

  useEffect(() => {
    const newSimMs = Date.parse(simTimeAnchor)
    const drift = Math.abs(currentSimMs.current - newSimMs)
    const speedNum = (paused ? 0 : parseInt((speed || '1x').replace('x', ''))) || 1
    const maxDriftSimMs = 10000 * speedNum // 10 seconds of real-time drift tolerance
    if (drift > maxDriftSimMs || drift > 60000) {
      currentSimMs.current = newSimMs
    }
  }, [simTimeAnchor, speed, paused])

  const speedNum = useMemo(() => {
    if (paused) return 0
    const m = speed?.match(/^(\d+)x$/i)
    return m ? parseInt(m[1]) : 1
  }, [speed, paused])

  useFrame(() => {
    const now = performance.now()
    const deltaWallMs = now - lastFrameWall.current
    lastFrameWall.current = now

    if (!satGroupRef.current || speedNum === 0) return
    
    currentSimMs.current += deltaWallMs * speedNum
    const pos = propagate(orbitConfig, new Date(currentSimMs.current))
    const v = point(pos.latitude_deg, pos.longitude_deg, orbitRadius)
    satGroupRef.current.position.copy(v)

    if (propagatedPosRef) {
      propagatedPosRef.current = { lat: pos.latitude_deg, lon: pos.longitude_deg }
    }

    if (orbitRingGroupRef?.current) {
      const currentGst = gmstRad(new Date(currentSimMs.current))
      const epochGst = gmstRad(new Date(orbitConfig.epoch))
      orbitRingGroupRef.current.rotation.y = epochGst - currentGst
    }
  })

  return null
}

function Earth({ running, groundTrack, stations, satellite, activeStationId, onStationSelect, orbitConfig, onOrbitChange, setDragging, simTimeAnchor, speed, paused, propagatedPosRef }: { running?: boolean; groundTrack: GroundPoint[]; stations: StationMarker[]; satellite?: SatelliteMarker; activeStationId?: string; onStationSelect?: (station: StationMarker) => void; orbitConfig?: any; onOrbitChange?: (patch: any) => void; setDragging: (v: boolean) => void; simTimeAnchor?: string; speed?: string; paused?: boolean; propagatedPosRef?: React.MutableRefObject<{lat: number, lon: number} | null> }) {
  const outlines = useMemo(countryLines, [])
  const orbitRadius = satellite ? 2 + Math.min(1.15, satellite.altitude_km / 1750) : 2.025
  const orbitRingGroupRef = useRef<THREE.Group>(null)
  const instantaneousOrbit = useMemo(() => {
    if (!running || !orbitConfig) return null
    const points = []
    const epochDate = new Date(orbitConfig.epoch)
    for (let i = 0; i <= 120; i++) {
      const phase = (i / 120) * 360
      const pos = propagate({ ...orbitConfig, phase_deg: phase }, epochDate)
      points.push(point(pos.latitude_deg, pos.longitude_deg, orbitRadius))
    }
    return points
  }, [running, orbitConfig, orbitRadius])

  const smoothTrack = useMemo(() => {
    if (instantaneousOrbit) return instantaneousOrbit
    if (groundTrack.length < 2) return []
    const points = groundTrack.map((item) => point(item.latitude_deg, item.longitude_deg, orbitRadius))
    const curve = new THREE.CatmullRomCurve3(points, false)
    return curve.getPoints(points.length * 4)
  }, [groundTrack, orbitRadius, instantaneousOrbit])
  
  const satellitePosition = satellite ? point(satellite.latitude_deg, satellite.longitude_deg, orbitRadius) : smoothTrack[0] ?? new THREE.Vector3(2.4, 0, 0)
  const satGroupRef = useRef<THREE.Group>(null)
  const isPropagating = !!(running && orbitConfig && simTimeAnchor)
  const activeStation = stations.find((station) => station.station_id === activeStationId)
  const activeLink = activeStation ? [point(activeStation.latitude_deg, activeStation.longitude_deg, 2.04), satellitePosition] : null
  const texture = useTexture('/textures/earth-day.jpg')
  return (
    <group rotation={[.08, -.45, -.12]}>
      {/* Solid ocean/background for the political map */}
      <mesh>
        <sphereGeometry args={[2, 64, 64]}/>
        <meshStandardMaterial map={texture} color="#9ca3af" roughness={0.8} metalness={0.1} />
      </mesh>
      
      {/* Soft blurred atmospheric glow (Fresnel shader) */}
      <mesh>
        <sphereGeometry args={[2.15, 64, 64]}/>
        <shaderMaterial
          vertexShader={`
            varying vec3 vNormal;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying vec3 vNormal;
            void main() {
              float intensity = pow(0.75 - dot(vNormal, vec3(0, 0, 1.0)), 2.5);
              gl_FragColor = vec4(0.22, 0.74, 0.97, 1.0) * intensity * 0.6;
            }
          `}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          transparent={true}
          depthWrite={false}
        />
      </mesh>
      
      {/* Clouds Layer */}
      <Clouds />
      
      {/* Country Outlines - Political Map */}
      {outlines.map((line, index) => <Line key={index} points={line} color="#60a5fa" lineWidth={1.2} transparent opacity={0.8}/>)}
      
      {/* Very thin elegant orbit line and interaction */}
      <group ref={orbitRingGroupRef}>
        {smoothTrack.length > 1 && (
          <Line points={smoothTrack} color="#e1ff00" lineWidth={0.5} transparent opacity={0.35} />
        )}
        <OrbitInteraction track={smoothTrack} orbitConfig={orbitConfig} onOrbitChange={onOrbitChange} satellitePosition={satellitePosition} setDragging={setDragging} />
      </group>
      
      {/* Active Link */}
      {activeLink && <Line points={activeLink} color="#22d3ee" lineWidth={1.8} dashed dashSize={.06} gapSize={.04} transparent opacity={.85}/>}
      
      {/* Station Markers */}
      {stations.map((station) => { 
        const emphasized = station.classification === 'active' || station.classification === 'approved'; 
        const isActive = station.station_id === activeStationId;
        const color = markerColor[isActive ? 'active' : station.classification] ?? markerColor.unselected;
        return (
          <mesh position={point(station.latitude_deg, station.longitude_deg, 2.035)} key={station.station_id} onClick={(event) => { event.stopPropagation(); onStationSelect?.(station) }}>
            <sphereGeometry args={[isActive ? .09 : emphasized ? .06 : .03, 16, 16]}/>
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isActive ? 1.5 : emphasized ? 0.8 : 0.2} toneMapped={false} />
          </mesh>
        )
      })}
      

      {isPropagating ? (
        <group ref={satGroupRef} position={satellitePosition}>
          <SatelliteAsset position={[0, 0, 0] as any} />
        </group>
      ) : (
        <SatelliteAsset position={satellitePosition} />
      )}
      {isPropagating && (
        <SatellitePropagator
          satGroupRef={satGroupRef}
          orbitRingGroupRef={orbitRingGroupRef}
          orbitConfig={orbitConfig as OrbitParams}
          simTimeAnchor={simTimeAnchor!}
          speed={speed ?? '1x'}
          paused={paused ?? false}
          orbitRadius={orbitRadius}
          propagatedPosRef={propagatedPosRef}
        />
      )}
    </group>
  )
}

function CameraTracker({ tracking, satelliteWorldPos, controlsRef }: { tracking: boolean, satelliteWorldPos: THREE.Vector3 | null, controlsRef: any }) {
  useFrame(({ camera, size }) => {
    // ALWAYS apply view offset so the aspect ratio and right-alignment are preserved even during manual dragging/resizing
    if ((camera as THREE.PerspectiveCamera).setViewOffset) {
      ;(camera as THREE.PerspectiveCamera).setViewOffset(size.width, size.height, -80, 0, size.width, size.height)
    }

    if (tracking && satelliteWorldPos) {
      const S = satelliteWorldPos.clone()
      const S_norm = S.clone().normalize()
      
      let up = new THREE.Vector3(0, 1, 0)
      if (Math.abs(S_norm.y) > 0.98) {
        up.set(1, 0, 0)
      }
      
      const targetC = S_norm.multiplyScalar(4.2)
      
      camera.position.lerp(targetC, 0.05)
      camera.lookAt(0, 0, 0)
      
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0)
        controlsRef.current.update()
      }
    }
  })
  return null
}

export function GlobeView({ running, groundTrack = [], stations = [], satellite, activeStationId, onStationSelect, orbitConfig, onOrbitChange, simTimeAnchor, speed, paused, propagatedPosRef }: { running?: boolean; groundTrack?: GroundPoint[]; stations?: StationMarker[]; satellite?: SatelliteMarker; activeStationId?: string; onStationSelect?: (station: StationMarker) => void; onSatelliteSelect?: () => void; orbitConfig?: any; onOrbitChange?: (patch: any) => void; simTimeAnchor?: string; speed?: string; paused?: boolean; propagatedPosRef?: React.MutableRefObject<{lat: number, lon: number} | null> }) {
  const [dragging, setDragging] = useState(false)
  const [tracking, setTracking] = useState(true)
  const controlsRef = useRef<any>(null)

  const orbitRadius = satellite ? 2 + Math.min(1.15, satellite.altitude_km / 1750) : 2.025
  const satellitePosition = satellite ? point(satellite.latitude_deg, satellite.longitude_deg, orbitRadius) : new THREE.Vector3(2.4, 0, 0)
  const earthEuler = new THREE.Euler(0.08, -0.45, -0.12)
  const satelliteWorldPos = satellitePosition.clone().applyEuler(earthEuler)

  return (
    <div className="globe-canvas" aria-label="Interactive Earth, country outlines, stations, and modeled orbit visualization"
         onPointerDown={() => setTracking(false)} onWheel={() => setTracking(false)}>
      <Canvas camera={{ position: [0, 0, 7.2], fov: 44 }}>
        <ambientLight intensity={1.2}/>
        <directionalLight position={[6, 3, 6]} intensity={2.2} color="#c7e8ff"/>
        <directionalLight position={[-4, -2, -4]} intensity={0.6} color="#1e40af"/>
        <pointLight position={[10, 0, 0]} intensity={0.8} color="#60a5fa"/>
        <Stars radius={100} depth={50} count={3500} factor={3} fade speed={.03}/>
        <Suspense fallback={null}>
          <Earth running={running} groundTrack={groundTrack} stations={stations} satellite={satellite} activeStationId={activeStationId} onStationSelect={onStationSelect} orbitConfig={orbitConfig} onOrbitChange={onOrbitChange} setDragging={setDragging} simTimeAnchor={simTimeAnchor} speed={speed} paused={paused} propagatedPosRef={propagatedPosRef} />
          <CameraTracker tracking={tracking} satelliteWorldPos={satelliteWorldPos} controlsRef={controlsRef} />
        </Suspense>
        <OrbitControls ref={controlsRef} enablePan={false} enableRotate={!dragging && !tracking} enableZoom={!dragging && !tracking} minDistance={3.5} maxDistance={10}/>
      </Canvas>
      <button 
        className={`tracking-btn ${tracking ? 'active' : ''}`} 
        onClick={(e) => { e.stopPropagation(); setTracking(true); }}
        style={{ left: '24px', transform: 'none' }}
      >
        DEFAULT VIEW
      </button>
    </div>
  )
}
