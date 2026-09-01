/**
 * Client-side circular Kepler propagator.
 *
 * This is an exact TypeScript port of the backend's CircularKeplerPropagator
 * (agcc/backend/src/agcc/orbit/propagator.py). It uses identical constants,
 * formulas, and conventions so that frontend-propagated positions match
 * backend positions to floating-point precision.
 *
 * Algorithm (Vallado, "Fundamentals of Astrodynamics and Applications", 4th ed.):
 *   Step 1 — Mean motion:  n = sqrt(mu / a^3)
 *   Step 2 — Phase advance: theta = phase_deg_rad + n * delta_t
 *   Step 3 — Perifocal position (circular, e=0, omega=0)
 *   Step 4 — Rotate to ECI via inclination + RAAN
 *   Step 5 — ECI → ECEF via GMST (IAU 1982)
 *   Step 6 — ECEF → geodetic (spherical Earth)
 */

// ---------------------------------------------------------------------------
// Constants (identical to backend orbit.py)
// ---------------------------------------------------------------------------

const MU_KM3_S2 = 398600.4418
const EARTH_RADIUS_KM = 6378.137
const J2000_JD = 2451545.0
const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrbitParams = {
  altitude_km: number
  inclination_deg: number
  raan_deg: number
  phase_deg: number
  epoch: string // ISO 8601
}

export type PropagatedPosition = {
  latitude_deg: number
  longitude_deg: number
  altitude_km: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function julianDate(d: Date): number {
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const frac =
    (d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 + d.getUTCMilliseconds() / 3600000) / 24
  if (m <= 2) { y -= 1; m += 12 }
  const a = Math.floor(y / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + frac + b - 1524.5
}

function gmstRad(d: Date): number {
  const jd = julianDate(d)
  const tUt1 = (jd - J2000_JD) / 36525
  let deg =
    280.46061837 +
    360.98564736629 * (jd - J2000_JD) +
    0.000387933 * tUt1 * tUt1 -
    (tUt1 * tUt1 * tUt1) / 38710000
  deg = ((deg % 360) + 360) % 360
  return deg * DEG2RAD
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

export function propagate(orbit: OrbitParams, at: Date): PropagatedPosition {
  // Step 1 — semi-major axis and mean motion
  const a = EARTH_RADIUS_KM + orbit.altitude_km
  const n = Math.sqrt(MU_KM3_S2 / (a * a * a))

  // Step 2 — phase advance
  const epochMs = Date.parse(orbit.epoch)
  const deltaS = (at.getTime() - epochMs) / 1000
  const theta = orbit.phase_deg * DEG2RAD + n * deltaS

  // Step 3 — perifocal frame (circular orbit, e=0, omega=0)
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)
  const px = a * cosT
  const py = a * sinT

  // Step 4 — rotate to ECI
  const inc = orbit.inclination_deg * DEG2RAD
  const raan = orbit.raan_deg * DEG2RAD
  const cosI = Math.cos(inc)
  const sinI = Math.sin(inc)
  const cosO = Math.cos(raan)
  const sinO = Math.sin(raan)

  const xEci = cosO * px - sinO * py * cosI
  const yEci = sinO * px + cosO * py * cosI
  const zEci = py * sinI

  // Step 5 — ECI → ECEF via Greenwich sidereal angle
  const gst = gmstRad(at)
  const cosG = Math.cos(gst)
  const sinG = Math.sin(gst)

  const xEcef = xEci * cosG + yEci * sinG
  const yEcef = -xEci * sinG + yEci * cosG
  const zEcef = zEci

  // Step 6 — ECEF → geodetic (spherical approximation)
  const rXy = Math.sqrt(xEcef * xEcef + yEcef * yEcef)
  const latRad = Math.atan2(zEcef, rXy)
  const lonRad = Math.atan2(yEcef, xEcef)
  const altKm = Math.sqrt(xEcef * xEcef + yEcef * yEcef + zEcef * zEcef) - EARTH_RADIUS_KM

  let lonDeg = lonRad * RAD2DEG
  lonDeg = ((lonDeg + 180) % 360) - 180

  return {
    latitude_deg: latRad * RAD2DEG,
    longitude_deg: lonDeg,
    altitude_km: altKm,
  }
}
