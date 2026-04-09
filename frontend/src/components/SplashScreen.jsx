import React, { useEffect } from 'react'
import { store } from '../store/sessionStore.js'

// First screen. No chrome. Just the mark + headline + Begin.
export default function SplashScreen({ onBegin, setAnsState }) {
  useEffect(() => { setAnsState && setAnsState('ventral_vagal') }, [setAnsState])
  const lastInsight = store.get().last_insight

  return (
    <div className="screen cosmic-bg" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 60px) 24px calc(env(safe-area-inset-bottom, 0px) + 48px)', position: 'relative' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="display" style={{ fontSize: 14, letterSpacing: '0.42em', color: 'var(--text-secondary)' }}>VAGUS</div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40 }}>
        <VagusNerveAnimated />
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <div className="display" style={{ fontSize: 34, lineHeight: 1.15, fontWeight: 500, letterSpacing: '-0.01em' }}>
            Listen to<br/>your body.
          </div>
          <div className="secondary" style={{ fontSize: 13, marginTop: 18, fontStyle: lastInsight ? 'italic' : 'normal', minHeight: 20 }}>
            {lastInsight || 'Music that follows your nervous system.'}
          </div>
        </div>
      </div>

      <button className="btn state-color" style={{ maxWidth: 280 }} onClick={onBegin}>Begin</button>
    </div>
  )
}

function VagusNerveAnimated() {
  return (
    <svg
      width="220" height="280" viewBox="0 0 220 280"
      className="nerve-mark"
      role="img" aria-label="Vagus nerve anatomy diagram"
      style={{ filter: 'drop-shadow(0 0 24px rgba(0,201,167,0.35))' }}
    >
      <defs>
        <radialGradient id="vna-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(0,201,167,0.22)" />
          <stop offset="70%"  stopColor="rgba(0,201,167,0.04)" />
          <stop offset="100%" stopColor="rgba(0,201,167,0)" />
        </radialGradient>
        <linearGradient id="vna-nerve" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#6EE7D2" />
          <stop offset="50%"  stopColor="#00C9A7" />
          <stop offset="100%" stopColor="#4A7FA5" />
        </linearGradient>
        <path id="vna-trunk"     d="M110,15 C130,55 90,85 110,120 C130,155 90,185 110,215" fill="transparent" />
        <path id="vna-cranial-l" d="M110,30 Q80,42 72,60" fill="transparent" />
        <path id="vna-cranial-r" d="M110,30 Q140,42 148,60" fill="transparent" />
        <path id="vna-heart-l"   d="M110,88 Q78,98 62,112" fill="transparent" />
        <path id="vna-lung-r"    d="M110,105 Q145,112 162,130" fill="transparent" />
        <path id="vna-gut-l"     d="M110,215 Q70,242 56,258" fill="transparent" />
      </defs>

      <circle cx="110" cy="140" r="108" fill="url(#vna-halo)" />
      <circle cx="110" cy="140" r="96"  fill="none" stroke="rgba(0,201,167,0.18)" strokeWidth="0.6" strokeDasharray="2 6" />

      <path d="M110,30 Q80,42 72,60"   stroke="url(#vna-nerve)" strokeWidth="1.2" fill="none" opacity="0.75" strokeLinecap="round" />
      <path d="M110,30 Q140,42 148,60" stroke="url(#vna-nerve)" strokeWidth="1.2" fill="none" opacity="0.75" strokeLinecap="round" />
      <path d="M110,30 Q96,48 92,68"   stroke="url(#vna-nerve)" strokeWidth="1"   fill="none" opacity="0.55" strokeLinecap="round" />
      <path d="M110,30 Q124,48 128,68" stroke="url(#vna-nerve)" strokeWidth="1"   fill="none" opacity="0.55" strokeLinecap="round" />

      <path d="M110,15 C130,55 90,85 110,120 C130,155 90,185 110,215"
            stroke="url(#vna-nerve)" strokeWidth="2.2" fill="none" strokeLinecap="round" />

      <path d="M110,88 Q78,98 62,112"   stroke="url(#vna-nerve)" strokeWidth="1.1" fill="none" opacity="0.70" strokeLinecap="round" />
      <path d="M110,88 Q142,96 158,112" stroke="url(#vna-nerve)" strokeWidth="1.1" fill="none" opacity="0.70" strokeLinecap="round" />

      <path d="M110,105 Q75,115 58,132"   stroke="url(#vna-nerve)" strokeWidth="1" fill="none" opacity="0.60" strokeLinecap="round" />
      <path d="M110,105 Q145,112 162,130" stroke="url(#vna-nerve)" strokeWidth="1" fill="none" opacity="0.60" strokeLinecap="round" />

      <path d="M110,148 Q90,152 80,155"   stroke="url(#vna-nerve)" strokeWidth="1" fill="none" opacity="0.50" strokeLinecap="round" />
      <path d="M110,148 Q130,152 140,155" stroke="url(#vna-nerve)" strokeWidth="1" fill="none" opacity="0.50" strokeLinecap="round" />

      <path d="M110,215 Q70,242 56,258"   stroke="url(#vna-nerve)" strokeWidth="1.1" fill="none" opacity="0.70" strokeLinecap="round" />
      <path d="M110,215 Q88,250 78,265"   stroke="url(#vna-nerve)" strokeWidth="1"   fill="none" opacity="0.55" strokeLinecap="round" />
      <path d="M110,215 Q110,252 110,268" stroke="url(#vna-nerve)" strokeWidth="1.1" fill="none" opacity="0.65" strokeLinecap="round" />
      <path d="M110,215 Q132,250 142,265" stroke="url(#vna-nerve)" strokeWidth="1"   fill="none" opacity="0.55" strokeLinecap="round" />
      <path d="M110,215 Q150,242 164,258" stroke="url(#vna-nerve)" strokeWidth="1.1" fill="none" opacity="0.70" strokeLinecap="round" />

      <circle r="2" fill="#6EE7D2" opacity="0.9">
        <animateMotion dur="7s" repeatCount="indefinite" begin="0s" calcMode="linear">
          <mpath href="#vna-trunk" />
        </animateMotion>
      </circle>

      <circle r="1.5" fill="#00C9A7" opacity="0.85">
        <animateMotion dur="2.5s" repeatCount="indefinite" begin="1.5s" calcMode="linear">
          <mpath href="#vna-heart-l" />
        </animateMotion>
      </circle>

      <circle r="1.5" fill="#4A7FA5" opacity="0.80">
        <animateMotion dur="2.5s" repeatCount="indefinite" begin="2.8s" calcMode="linear">
          <mpath href="#vna-lung-r" />
        </animateMotion>
      </circle>

      <circle r="1.5" fill="#00C9A7" opacity="0.75">
        <animateMotion dur="3s" repeatCount="indefinite" begin="1s" calcMode="linear">
          <mpath href="#vna-gut-l" />
        </animateMotion>
      </circle>

      <circle r="1.2" fill="#6EE7D2" opacity="0.70">
        <animateMotion dur="1.2s" repeatCount="indefinite" begin="0s" calcMode="linear">
          <mpath href="#vna-cranial-l" />
        </animateMotion>
      </circle>

      <circle r="1.2" fill="#6EE7D2" opacity="0.70">
        <animateMotion dur="1.2s" repeatCount="indefinite" begin="0.6s" calcMode="linear">
          <mpath href="#vna-cranial-r" />
        </animateMotion>
      </circle>

      <circle cx="52"  cy="70"  r="1"   fill="#E8EDF2" opacity="0.6" />
      <circle cx="172" cy="58"  r="0.8" fill="#E8EDF2" opacity="0.5" />
      <circle cx="38"  cy="165" r="0.7" fill="#E8EDF2" opacity="0.4" />
      <circle cx="186" cy="182" r="1"   fill="#E8EDF2" opacity="0.55" />
      <circle cx="64"  cy="228" r="0.8" fill="#E8EDF2" opacity="0.45" />
      <circle cx="158" cy="238" r="0.9" fill="#E8EDF2" opacity="0.5" />
    </svg>
  )
}
