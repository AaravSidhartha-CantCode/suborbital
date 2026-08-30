import type { ReactNode } from 'react'
import { HomeEarth } from './HomeEarth'
import './home.css'

type HomeProps = {
  onNavigate: (path: string) => void
}

type Feature = {
  index: string
  title: string
  copy: string
  icon: ReactNode
}

const RadarIcon = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="3" />
    <path d="M16.2 31.8a11 11 0 0 1 0-15.6M10.5 37.5a19 19 0 0 1 0-27M31.8 16.2a11 11 0 0 1 0 15.6M37.5 10.5a19 19 0 0 1 0 27" />
  </svg>
)

const ThreatIcon = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path d="m24 5 16.5 9.5v19L24 43 7.5 33.5v-19L24 5Z" />
    <circle cx="24" cy="24" r="7" />
    <path d="M24 11v6m0 14v6M11 24h6m14 0h6" />
  </svg>
)

const PredictionIcon = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path d="M7 37h34M10 33l9-10 7 5 12-16" />
    <circle cx="10" cy="33" r="2.5" /><circle cx="19" cy="23" r="2.5" />
    <circle cx="26" cy="28" r="2.5" /><circle cx="38" cy="12" r="2.5" />
  </svg>
)

const features: Feature[] = [
  { index: '01', title: 'PREDICTIVE CONTACT WINDOWS', copy: 'Map precise communication windows. Forecast exact station availability, line-of-sight acquisition, and pass durations before deployment.', icon: <RadarIcon /> },
  { index: '02', title: 'PAYLOAD OPTIMIZATION', copy: 'Distribute telemetry downlinks across global ground stations to hit data targets under strict time and budget constraints.', icon: <ThreatIcon /> },
  { index: '03', title: 'DYNAMIC ANOMALY RESOLUTION', copy: 'Instantly reroute orbital paths, bypass degraded links, and authorize timeline recalculations when real-world conditions threaten the mission.', icon: <PredictionIcon /> },
]

export function Home({ onNavigate }: HomeProps) {
  return (
    <section className="home" aria-label="Autonomous Ground Contact Control home">
      <div id="earth-canvas-layer" className="home-canvas" aria-hidden="true">
        <HomeEarth />
      </div>
      <div className="home-noise" aria-hidden="true" />



      <main className="home-hero">
        <div className="home-hero-copy" style={{ marginTop: '-15px' }}>
          <h1 style={{ fontSize: 'clamp(42px, 5.5vw, 84px)' }}>VIEW THE MISSION LIVE,<br /><b>BEFORE IT REACHES ORBIT.</b></h1>
          <p>Precompute precise orbital contact windows. Distribute payloads efficiently across global ground stations, and dynamically reroute telemetry when real-world conditions shift.</p>
          <button className="home-cta" style={{ width: '280px', transform: 'scale(1.15)', transformOrigin: 'left center' }} onClick={() => onNavigate('/setup/orbit')}>
            <span>INITIALIZE SETUP</span><span className="home-cta-target" aria-hidden="true"><i /><i /></span>
          </button>
        </div>
        <div className="home-object-label" aria-hidden="true">
          <span>SAT / SUBORBITAL—01</span><i /><b>ORBITAL ASSET</b><small>ALT 550 KM · INC 53.0°</small>
        </div>
      </main>

      <section className="home-features" aria-label="Platform capabilities">
        {features.map((feature) => (
          <article className="home-feature" key={feature.index}>
            <span className="home-feature-index">{feature.index}</span>
            <div className="home-feature-icon">{feature.icon}</div>
            <div><h2>{feature.title}</h2><p>{feature.copy}</p></div>
            <span className="home-card-cross" aria-hidden="true" />
          </article>
        ))}
      </section>
      <div className="home-footer-line" aria-hidden="true"><span>GROUND NETWORK / ONLINE</span><i /><span>SCROLL TO EXPLORE</span></div>
    </section>
  )
}
