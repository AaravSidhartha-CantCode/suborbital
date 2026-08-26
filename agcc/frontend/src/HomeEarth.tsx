import { Line, Stars, useTexture, Html } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef, Suspense, Component, ReactNode, useEffect } from 'react'
import * as THREE from 'three'


class ErrorBoundary extends Component<{children: ReactNode, fallback: (err: Error) => ReactNode}, {error: Error | null}> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) return this.props.fallback(this.state.error)
    return this.props.children
  }
}

const atmosphereVertexShader = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const atmosphereFragmentShader = `
  varying vec3 vNormal;
  void main() {
    // vNormal points inward for BackSide. At the absolute edge, dot is 0. 
    // This perfectly fades to 0 at the outer boundary, eliminating any hard edge.
    float intensity = pow(max(-dot(vNormal, vec3(0, 0, 1.0)), 0.0), 1.5);
    gl_FragColor = vec4(0.2, 0.7, 1.0, 1.0) * intensity * 2.0;
  }
`

function Satellite() {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const angle = clock.getElapsedTime() * .12
    ref.current.position.set(Math.cos(angle) * 4.8, Math.sin(angle) * 1.5, Math.sin(angle) * 5.5)
    ref.current.rotation.set(angle * .18, -angle, .24)
  })
  
  const c = "#e1ff00";
  return <group ref={ref} scale={.6}>
    <mesh><boxGeometry args={[.32,.24,.26]} /><meshBasicMaterial color={c} wireframe /></mesh>
    <mesh><boxGeometry args={[.16,.4,.16]} /><meshBasicMaterial color={c} wireframe /></mesh>
    <mesh position={[-.6,0,0]}><boxGeometry args={[.8,.025,.28]} /><meshBasicMaterial color={c} wireframe /></mesh>
    <mesh position={[.6,0,0]}><boxGeometry args={[.8,.025,.28]} /><meshBasicMaterial color={c} wireframe /></mesh>
    <mesh position={[-.6,0.02,0]} rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[.8, .28, 4, 1]} /><meshBasicMaterial color={c} wireframe /></mesh>
    <mesh position={[.6,0.02,0]} rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[.8, .28, 4, 1]} /><meshBasicMaterial color={c} wireframe /></mesh>
    <mesh position={[0,-.35,0]} rotation={[Math.PI / 2,0,0]}><cylinderGeometry args={[.1,.02,.2,16]} /><meshBasicMaterial color={c} wireframe /></mesh>
    <mesh position={[0,.25,0]}><cylinderGeometry args={[.01,.01,.3,8]} /><meshBasicMaterial color={c} wireframe /></mesh>
  </group>
}

function EarthSystem() {
  const [day, night, clouds] = useTexture([
    '/textures/earth-day.jpg',
    '/textures/earth-night.jpg',
    '/textures/earth_clouds_1024.png'
  ])

  const { gl } = useThree()
  useEffect(() => {
    [day, night, clouds].forEach((tex) => {
      tex.anisotropy = gl.capabilities.getMaxAnisotropy()
    })
  }, [day, night, clouds, gl])

  const earth = useRef<THREE.Group>(null)
  const cloudsRef = useRef<THREE.Mesh>(null)
  
  const orbit = useMemo(() => Array.from({ length: 161 }, (_, i) => { const a = i / 160 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 4.8, Math.sin(a) * 1.5, Math.sin(a) * 5.5) }), [])
  
  useFrame((_, delta) => { 
    if (earth.current) earth.current.rotation.y += delta * .02 
    if (cloudsRef.current) cloudsRef.current.rotation.y += delta * .025
  })

  // Re-use a single geometry for performance (64 segments is plenty smooth with proper shaders)
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(3.4, 64, 64), []);

  return <group position={[3.3,-.2,0]} rotation={[.15,-1.2,-.08]} scale={0.8}>
    <group ref={earth}>
      {/* Base Earth (Cloudless) */}
      <mesh castShadow receiveShadow geometry={sphereGeo}>
        <meshStandardMaterial 
          map={day} 
          emissiveMap={night}
          emissive="#ffffff"
          emissiveIntensity={4} 
          roughness={0.7}
        />
      </mesh>

      {/* Atmospheric Cloud Layer */}
      <mesh ref={cloudsRef} geometry={sphereGeo} scale={1.008}>
        <meshStandardMaterial 
          map={clouds} 
          transparent 
          opacity={0.85} 
          depthWrite={false} 
          blending={THREE.AdditiveBlending}
          color="#ffffff"
        />
      </mesh>
      
      {/* Hazy Atmosphere Glow (Blur/Glow on surface) */}
      <mesh geometry={sphereGeo} scale={1.015}>
        <meshBasicMaterial 
          color="#7dd3fc"
          transparent
          opacity={0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      
      {/* Sleek Cinematic Atmosphere Halo (Edge Glow) */}
      <mesh geometry={sphereGeo} scale={1.2}>
        <shaderMaterial 
          vertexShader={atmosphereVertexShader}
          fragmentShader={atmosphereFragmentShader}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          transparent={true}
          depthWrite={false}
        />
      </mesh>
    </group>
    
    <Line points={orbit} color="#e1ff00" lineWidth={1.5} transparent opacity={0.6} />
    <Satellite />
  </group>
}

export function HomeEarth() {
  return <Canvas camera={{ position:[0,0,8.5], fov:40 }} dpr={[1,2]} gl={{ antialias:true, alpha:false, powerPreference: "high-performance" }}>
    <color attach="background" args={['#010204']} />
    
    <ambientLight intensity={0.01} />
    
    {/* Cinematic backlit lighting setup - Single strong light for pure black dropoff */}
    <directionalLight position={[-8, 4, -8]} intensity={8} color="#dbeafe" />
    
    {/* Sun Glow/Mesh - positioned behind the earth to match backlit lighting */}
    <mesh position={[-20, 10, -20]}>
      <sphereGeometry args={[1.5, 32, 32]} />
      <meshBasicMaterial color="#ffffff" />
      <pointLight intensity={10} distance={100} decay={2} color="#ffffff" />
    </mesh>
    <mesh position={[-20, 10, -20]}>
      <sphereGeometry args={[3.0, 32, 32]} />
      <meshBasicMaterial color="#dbeafe" transparent opacity={0.3} blending={THREE.AdditiveBlending} />
    </mesh>
    
    <Stars radius={100} depth={50} count={3500} factor={3} saturation={.8} fade speed={.05} />
    
    <ErrorBoundary fallback={(err) => (
      <Html center>
        <div style={{ color: 'red', background: 'white', padding: 20 }}>
          Error: {err.message}
        </div>
      </Html>
    )}>
      <Suspense fallback={null}>
        <EarthSystem />
      </Suspense>
    </ErrorBoundary>
  </Canvas>
}


