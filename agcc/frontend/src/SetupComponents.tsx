import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';

import { EarthSystem } from './HomeEarth';

export function DeepSpaceBackground() {
  return (
    <div className="deep-space-bg">
      <div className="space-blob space-blob-1"></div>
      <div className="space-blob space-blob-2"></div>
      <div className="space-blob space-blob-3"></div>
      <div className="home-noise" style={{ display: 'block' }}></div>
    </div>
  )
}

function DriftingEarth() {
  const group = useRef<THREE.Group>(null);
  
  useFrame((_state, delta) => {
    if (group.current) {
      // Move right to left slowly
      group.current.position.x -= delta * 0.4;
      // Wrap around
      if (group.current.position.x < -14) {
        group.current.position.x = 14;
      }
    }
  });

  return (
    <group ref={group} position={[14, -1, 0]} scale={1.4}>
      <group position={[-3.3, 0, 0]}>
        <React.Suspense fallback={null}>
          <EarthSystem />
        </React.Suspense>
      </group>
    </group>
  );
}

export function AsteroidBackground() {
  return (
    <div className="asteroid-background">
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', filter: 'blur(6px)' }}>
        <Canvas camera={{ position: [0, 0, 8.5], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, alpha: false }}>
          <color attach="background" args={['#010204']} />
          <ambientLight intensity={0.01} />
          
          <directionalLight position={[-8, 4, -8]} intensity={8} color="#dbeafe" />
          
          {/* Tiny distant sun */}
          <mesh position={[-40, 10, -40]}>
            <sphereGeometry args={[0.2, 32, 32]} />
            <meshBasicMaterial color="#ffffff" />
            <pointLight intensity={10} distance={150} decay={2} color="#ffffff" />
          </mesh>
          <mesh position={[-40, 10, -40]}>
            <sphereGeometry args={[0.6, 32, 32]} />
            <meshBasicMaterial color="#dbeafe" transparent opacity={0.3} blending={THREE.AdditiveBlending} />
          </mesh>

          <Stars radius={100} depth={50} count={3500} factor={3} saturation={0.8} fade speed={0.05} />
          <DriftingEarth />
        </Canvas>
      </div>
    </div>
  );
}

export function ScrubberInput({ value, onChange, min, max, label }: { value: number, onChange: (val: number) => void, min: number, max: number, label: string }) {
  const origin = useRef<{ x: number, value: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, value };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!origin.current) return;
    const dx = e.clientX - origin.current.x;
    const range = max - min;
    const sensitivity = range > 1000 ? 5 : (range > 100 ? 1 : 0.1);
    let next = origin.current.value + dx * sensitivity;
    next = Math.max(min, Math.min(max, next));
    next = parseFloat(next.toFixed(1));
    onChange(next);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    origin.current = null;
  };

  return (
    <div className="glass-value-box">
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        min={min}
        max={max}
      />
      <span className="right-label">{label}</span>
    </div>
  );
}

export function PresetSelector({ value, onChange }: { value: number, onChange: (val: number) => void }) {
  const options = [
    { label: 'Mid-inclination', value: 53 },
    { label: 'Equatorial', value: 0 },
    { label: 'Polar', value: 90 },
    { label: 'Custom', value: -1 }
  ];

  const currentValOpt = options.find(o => o.value === value);
  const displayValue = currentValOpt ? value : -1;

  return (
    <div className="glass-value-box">
      <GlassSelect 
        value={displayValue}
        options={options}
        onChange={(val) => {
          if (Number(val) !== -1) {
            onChange(Number(val));
          }
        }}
      />
      <span className="right-label">Presets</span>
    </div>
  );
}

export function EpochSync(_props?: { value?: string, onChange?: (val: string) => void }) {
  return (
    <div className="glass-value-box">
      <div className="live-sync-badge" style={{ fontSize: '11px', padding: 0, background: 'transparent', border: 'none', color: '#e1ff00' }}>
        <span className="live-dot" style={{ background: '#e1ff00', boxShadow: '0 0 8px #e1ff00' }} /> SYNCED WITH LOCAL TIME
      </div>
      <span className="right-label">Epoch</span>
    </div>
  );
}

function SatelliteModel() {
  const ref = React.useRef<THREE.Group>(null);
  
  useFrame(({ clock, camera }) => {
    const t = clock.getElapsedTime() * 0.15;
    const R = 5;
    
    const satX = Math.cos(t) * R;
    const satZ = Math.sin(t) * R;
    const satY = Math.sin(t * 2) * 0.5; // slight bobbing/inclination
    
    if (ref.current) {
      ref.current.position.set(satX, satY, satZ);
      const angle = clock.getElapsedTime() * 0.4;
      ref.current.rotation.set(angle * 0.5, angle, angle * 0.3);
    }
    
    // Lock camera onto satellite with a fixed offset
    camera.position.set(satX + 2, satY + 1.5, satZ + 3);
    camera.lookAt(satX, satY, satZ);
  });
  
  const c = "#e1ff00";
  return (
    <>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[2, 24, 24]} />
        <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.15} />
      </mesh>
      <group ref={ref} scale={1.5}>
        <mesh><boxGeometry args={[.32,.24,.26]} /><meshBasicMaterial color={c} wireframe /></mesh>
        <mesh><boxGeometry args={[.16,.4,.16]} /><meshBasicMaterial color={c} wireframe /></mesh>
        <mesh position={[-.6,0,0]}><boxGeometry args={[.8,.025,.28]} /><meshBasicMaterial color={c} wireframe /></mesh>
        <mesh position={[.6,0,0]}><boxGeometry args={[.8,.025,.28]} /><meshBasicMaterial color={c} wireframe /></mesh>
        <mesh position={[-.6,0.02,0]} rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[.8, .28, 4, 1]} /><meshBasicMaterial color={c} wireframe /></mesh>
        <mesh position={[.6,0.02,0]} rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[.8, .28, 4, 1]} /><meshBasicMaterial color={c} wireframe /></mesh>
        <mesh position={[0,-.35,0]} rotation={[Math.PI / 2,0,0]}><cylinderGeometry args={[.1,.02,.2,16]} /><meshBasicMaterial color={c} wireframe /></mesh>
        <mesh position={[0,.25,0]}><cylinderGeometry args={[.01,.01,.3,8]} /><meshBasicMaterial color={c} wireframe /></mesh>
      </group>
    </>
  );
}

export function SatelliteWireframe() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '320px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <SatelliteModel />
      </Canvas>
    </div>
  );
}

function GroundStationModel() {
  const dishRef = React.useRef<THREE.Group>(null);
  
  useFrame(({ clock }) => {
    if (dishRef.current) {
      const t = clock.getElapsedTime();
      // Continuous rotation (Azimuth) and slight tilt oscillation (Elevation)
      dishRef.current.rotation.y = t * 0.4;
      dishRef.current.rotation.x = - (Math.PI / 4 + Math.sin(t * 0.5) * 0.05); 
    }
  });

  const c = "#e1ff00";
  return (
    <group scale={1.2} position={[0, -0.5, 0]}>
      {/* Base Structure (Truss) */}
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.3, 0.9, 1.2, 8, 3, true]} />
        <meshBasicMaterial color={c} wireframe transparent opacity={0.6} />
      </mesh>
      {/* Central Pillar */}
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 1.2, 8]} />
        <meshBasicMaterial color={c} wireframe />
      </mesh>
      
      {/* Mount / Pivot */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.25, 0.25, 0.25]} />
        <meshBasicMaterial color={c} wireframe />
      </mesh>

      {/* Rotating Dish Assembly */}
      <group ref={dishRef} position={[0, 0, 0]}>
        {/* Backing support structure */}
        <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.2, 0.4, 0.2, 12, 1, true]} />
          <meshBasicMaterial color={c} wireframe />
        </mesh>
        
        {/* Parabolic Dish (using shallow sphere cap) */}
        {/* Center of sphere is translated so vertex is exactly at the pivot [0,0,0] */}
        <mesh position={[0, 0, 1.2]} rotation={[-Math.PI / 2, 0, 0]}>
          <sphereGeometry args={[1.2, 24, 6, 0, Math.PI * 2, 0, Math.PI / 4]} />
          <meshBasicMaterial color={c} wireframe />
        </mesh>
        
        {/* Feed Horn Struts (Simulated with a 4-segment open cone rolled by 45 deg) */}
        {/* Base of cone at Z=0.35, apex at Z=0.8. Center is 0.575 */}
        <mesh position={[0, 0, 0.575]} rotation={[Math.PI / 2, Math.PI / 4, 0]}>
          <coneGeometry args={[0.848, 0.45, 4, 1, true]} />
          <meshBasicMaterial color={c} wireframe />
        </mesh>

        {/* Feed Horn / Receiver */}
        <mesh position={[0, 0, 0.8]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.02, 0.15, 8]} />
          <meshBasicMaterial color={c} wireframe />
        </mesh>
      </group>
    </group>
  );
}

function SmallHoveringSatellite() {
  const ref = React.useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.getElapsedTime();
      ref.current.position.y = 1.2 + Math.sin(t * 0.5) * 0.05;
      ref.current.rotation.y = t * 0.2;
      ref.current.rotation.x = Math.sin(t * 0.3) * 0.1;
    }
  });

  const c = "#e1ff00";
  return (
    <group ref={ref} position={[-1.2, 1.2, 0]} scale={0.15}>
      <mesh><boxGeometry args={[.32,.24,.26]} /><meshBasicMaterial color={c} wireframe /></mesh>
      <mesh><boxGeometry args={[.16,.4,.16]} /><meshBasicMaterial color={c} wireframe /></mesh>
      <mesh position={[-.6,0,0]}><boxGeometry args={[.8,.025,.28]} /><meshBasicMaterial color={c} wireframe /></mesh>
      <mesh position={[.6,0,0]}><boxGeometry args={[.8,.025,.28]} /><meshBasicMaterial color={c} wireframe /></mesh>
      <mesh position={[-.6,0.02,0]} rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[.8, .28, 4, 1]} /><meshBasicMaterial color={c} wireframe /></mesh>
      <mesh position={[.6,0.02,0]} rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[.8, .28, 4, 1]} /><meshBasicMaterial color={c} wireframe /></mesh>
      <mesh position={[0,-.35,0]} rotation={[Math.PI / 2,0,0]}><cylinderGeometry args={[.1,.02,.2,16]} /><meshBasicMaterial color={c} wireframe /></mesh>
      <mesh position={[0,.25,0]}><cylinderGeometry args={[.01,.01,.3,8]} /><meshBasicMaterial color={c} wireframe /></mesh>
    </group>
  );
}

export function GroundStationWireframe() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '320px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <Canvas camera={{ position: [3, 2, 4], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <GroundStationModel />
        <SmallHoveringSatellite />
      </Canvas>
    </div>
  );
}

export function GlassSelect({ value, onChange, options, style }: { value: string | number, onChange: (val: string) => void, options: {value: string | number, label: string}[], style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (ref.current) {
      const parent = ref.current.closest('.glass-value-box');
      if (parent) {
        (parent as HTMLElement).style.zIndex = open ? '100' : '';
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = Math.min(250, options.length * 40 + 2);
      const spaceBelow = window.innerHeight - rect.bottom;
      const openAbove = spaceBelow < menuHeight + 12 && rect.top > spaceBelow;
      setMenuStyle({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        top: openAbove ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4,
      });
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, options.length]);

  const selectedOption = options.find(o => String(o.value) === String(value));

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', ...style }}>
      <div 
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
          padding: '12px 0', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
          color: '#fff', width: '100%'
        }}
      >
        <span>{selectedOption ? selectedOption.label : 'Select...'}</span>
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>?</span>
      </div>
      
      {open && createPortal(
        <div ref={menuRef} style={{
          ...menuStyle,
          background: 'rgba(10, 15, 25, 0.95)',
          border: '1px solid rgba(225, 255, 0, 0.2)',
          backdropFilter: 'blur(12px)',
          borderRadius: '8px',
          boxShadow: '0 8px 16px rgba(0,0,0,0.5)',
          zIndex: 10000,
          maxHeight: '250px',
          overflowY: 'auto'
        }}>
          {options.map(opt => (
            <div 
              key={String(opt.value)}
              onClick={() => { onChange(String(opt.value)); setOpen(false); }}
              style={{
                padding: '10px 14px', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: '12px',
                color: String(value) === String(opt.value) ? '#e1ff00' : 'rgba(255,255,255,0.7)',
                textTransform: 'uppercase',
                transition: 'background 0.2s, color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(225, 255, 0, 0.1)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = String(value) === String(opt.value) ? '#e1ff00' : 'rgba(255,255,255,0.7)';
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
