import { propagate, gmstRad } from "./propagator.ts";
import * as THREE from "three";

// 1. Setup mock orbit
const epoch = new Date("2026-09-01T12:00:00Z");
const orbitConfig = {
  altitude_km: 500,
  inclination_deg: 45,
  raan_deg: 0,
  phase_deg: 0,
  epoch: epoch.toISOString()
};

// 2. Generate point at current time using propagate (this is what satellite does)
const currentTime = new Date(epoch.getTime() + 1000 * 3600); // 1 hour later
const pos = propagate(orbitConfig, currentTime);
const orbitRadius = 2.025;
const lat = pos.latitude_deg * Math.PI / 180;
const lon = pos.longitude_deg * Math.PI / 180;
const satPos = new THREE.Vector3(
  Math.cos(lat) * Math.cos(lon),
  Math.sin(lat),
  -Math.cos(lat) * Math.sin(lon)
).multiplyScalar(orbitRadius);

console.log("Satellite Pos in ECEF (ThreeJS):", satPos);

// 3. Generate the ring point at the corresponding phase using epoch
// propagate phase_deg advances by n * delta_s
const MU_KM3_S2 = 398600.4418;
const EARTH_RADIUS_KM = 6378.137;
const a = EARTH_RADIUS_KM + orbitConfig.altitude_km;
const n = Math.sqrt(MU_KM3_S2 / (a * a * a));
const deltaS = 3600;
const currentPhase = orbitConfig.phase_deg + n * deltaS * 180 / Math.PI;

const ringPos = propagate({ ...orbitConfig, phase_deg: currentPhase }, epoch);
const rLat = ringPos.latitude_deg * Math.PI / 180;
const rLon = ringPos.longitude_deg * Math.PI / 180;
const ringPoint = new THREE.Vector3(
  Math.cos(rLat) * Math.cos(rLon),
  Math.sin(rLat),
  -Math.cos(rLat) * Math.sin(rLon)
).multiplyScalar(orbitRadius);

console.log("Ring point at epoch (ThreeJS):", ringPoint);

// 4. Rotate ring point by epochGst - currentGst
const epochGst = gmstRad(epoch);
const currentGst = gmstRad(currentTime);
console.log("epochGst", epochGst, "currentGst", currentGst);
const rotationY = epochGst - currentGst;

ringPoint.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
console.log("Rotated Ring point (ThreeJS):", ringPoint);
console.log("Distance between satellite and ring:", satPos.distanceTo(ringPoint));
