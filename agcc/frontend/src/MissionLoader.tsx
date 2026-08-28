import { useState, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const phrases = [
  "> Establishing live telemetry link...",
  "> Resolving orbital vectors...",
  "> Calculating payload distribution...",
  "> Optimizing contact windows...",
  "> Synchronizing ground station arrays...",
  "> Calibrating atmospheric attenuation models...",
  "> Integrating sub-system telemetry...",
  "> Finalizing authoritative baseline..."
];

function GyroGlobe() {
  const group = useRef<THREE.Group>(null);
  const r1 = useRef<THREE.Mesh>(null);
  const r2 = useRef<THREE.Mesh>(null);
  const r3 = useRef<THREE.Mesh>(null);
  
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) {
      const pulse = 1.2 + Math.sin(t * 3) * 0.05;
      group.current.scale.set(pulse, pulse, pulse);
      group.current.rotation.x = t * 0.2;
      group.current.rotation.y = t * 0.15;
    }
    // TorusGeometry hole is along the Z axis. Spinning around Z rotates it smoothly.
    if (r1.current) r1.current.rotation.z = t * 1.5;
    if (r2.current) r2.current.rotation.z = -t * 1.2;
    if (r3.current) r3.current.rotation.z = t * 0.9;
  });

  const c = "#e1ff00";

  return (
    <group ref={group} scale={1.2}>
      {/* Background solid sphere to block the back side of the rings if desired, though wireframe is requested */}
      <mesh>
        <sphereGeometry args={[0.98, 32, 32]} />
        <meshBasicMaterial color="#010205" />
      </mesh>
      {/* Wireframe globe */}
      <mesh>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color={c} wireframe transparent opacity={0.25} />
      </mesh>
      
      {/* Ring 1 - Equator */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        <mesh ref={r1}>
          <torusGeometry args={[1.2, 0.012, 4, 64]} />
          <meshBasicMaterial color={c} />
        </mesh>
      </group>

      {/* Ring 2 - Tilted */}
      <group rotation={[Math.PI / 3, Math.PI / 4, 0]}>
        <mesh ref={r2}>
          <torusGeometry args={[1.4, 0.012, 4, 64]} />
          <meshBasicMaterial color={c} />
        </mesh>
      </group>

      {/* Ring 3 - Tilted opposite */}
      <group rotation={[-Math.PI / 3, -Math.PI / 4, 0]}>
        <mesh ref={r3}>
          <torusGeometry args={[1.6, 0.012, 4, 64]} />
          <meshBasicMaterial color={c} />
        </mesh>
      </group>
    </group>
  );
}

export function MissionLoader({ status: _status }: { status?: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex(c => (c + 1) % phrases.length);
    }, 15000); // 15 seconds
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="loading-data-art" style={{ background: 'transparent' }}>
      <div className="loading-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px' }}>
        <div style={{ width: '240px', height: '240px' }}>
          <Canvas camera={{ position: [0, 0, 4] }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
            <GyroGlobe />
          </Canvas>
        </div>
        
        <div style={{ 
          height: '72px', 
          overflow: 'hidden', 
          position: 'relative', 
          width: '100%', 
          maxWidth: '500px',
          maskImage: 'linear-gradient(to bottom, transparent, black 40%, black 60%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 40%, black 60%, transparent)',
          display: 'flex',
          justifyContent: 'center'
        }}>
          <div style={{
            position: 'absolute',
            top: '24px', // middle
            display: 'flex',
            flexDirection: 'column',
            gap: '0',
            transition: 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
            transform: `translateY(-${currentIndex * 24}px)`,
            width: '100%'
          }}>
            {phrases.map((phrase, i) => {
              const distance = Math.abs(currentIndex - i);
              const opacity = i === currentIndex ? 1 : i < currentIndex ? Math.max(0, 0.6 - distance * 0.3) : 0;
              const color = i === currentIndex ? '#ffffff' : '#e1ff00';
              const textShadow = i === currentIndex ? '0 0 10px rgba(255,255,255,0.5)' : 'none';
              
              return (
                 <div key={i} style={{ 
                   height: '24px', 
                   lineHeight: '24px',
                   whiteSpace: 'nowrap',
                   opacity, 
                   color, 
                   textShadow,
                   fontFamily: 'var(--font-mono)', 
                   fontSize: '11px', 
                   textAlign: 'center',
                   textTransform: 'uppercase',
                   transition: 'opacity 0.6s, color 0.6s'
                 }}>
                   {phrase}
                 </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
