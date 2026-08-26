import type { ReactNode } from 'react'
import { HomeEarth } from './HomeEarth'
import './home.css'

type HomeProps = {
  missionUnlocked: boolean
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

const LockIcon = () => (
  <svg className="home-lock" viewBox="0 0 12 12" aria-hidden="true">
    <rect x="2.2" y="5.2" width="7.6" height="5.4" rx="1" />
    <path d="M3.8 5.2V3.8a2.2 2.2 0 0 1 4.4 0v1.4" />
  </svg>
)

const features: Feature[] = [
  { index: '01', title: 'Live Data Streams', copy: 'Ingest and visualize real-time satellite telemetry with zero-latency orbital tracking.', icon: <RadarIcon /> },
  { index: '02', title: 'Threat & Anomaly Detection', copy: 'Identify structural integrity risks and orbital debris threats before they escalate.', icon: <ThreatIcon /> },
  { index: '03', title: 'AI-Driven Prediction', copy: 'Forecast orbital decay, power consumption trends, and optimal trajectory windows.', icon: <PredictionIcon /> },
]

export function Home({ missionUnlocked, onNavigate }: HomeProps) {
  return (
    <section className="home" aria-label="Autonomous Ground Contact Control home">
      <div id="earth-canvas-layer" className="home-canvas" aria-hidden="true">
        <HomeEarth />
      </div>
      <div className="home-noise" aria-hidden="true" />

      <header className="home-header">
        <button className="home-brand" onClick={() => onNavigate('/')} aria-label="AGCC home">
          <span className="home-brand-mark"><i /><i /><i /><i /></span>
          <span><b>AGCC</b><small>ORBITAL SYSTEMS</small></span>
        </button>
        <nav className="home-nav" aria-label="Primary navigation">
          <button className="active" aria-current="page" onClick={() => onNavigate('/')}>HOME</button>
          <button onClick={() => onNavigate('/setup/orbit')}>SETUP</button>
          <button className="locked" disabled={!missionUnlocked} onClick={() => missionUnlocked && onNavigate('/mission')} title={missionUnlocked ? 'Open mission control' : 'Complete setup to unlock mission control'}>
            MISSION {!missionUnlocked && <LockIcon />}
          </button>
        </nav>
        <div className="home-coordinate" aria-hidden="true"><span>OPS / 001</span><span>UTC +05:30</span></div>
      </header>

      <main className="home-hero">
        <div className="home-hero-copy">
          <div className="home-kicker"><i />SYSTEM STATUS: NOMINAL // PUBLIC RELEASE</div>
          <h1>UNIFIED<br />GROUND CONTROL.</h1>
          <p>The next-generation orbital coordinator. Seamlessly configure your satellite, monitor live telemetry, and leverage AI-driven anomaly prediction from a single, cinematic interface.</p>
          <button className="home-cta" onClick={() => onNavigate('/setup/orbit')}>
            <span>INITIALIZE SETUP</span><span className="home-cta-target" aria-hidden="true"><i /><i /></span>
          </button>
        </div>
        <div className="home-object-label" aria-hidden="true">
          <span>SAT / AGCC—01</span><i /><b>ORBITAL ASSET</b><small>ALT 550 KM · INC 53.0°</small>
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
