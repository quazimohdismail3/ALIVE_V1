import React, { useEffect, useRef, useState } from 'react'
import { ToneEngine } from '../engines/toneEngine.js'
import { PolarH10BLE } from '../engines/polarH10BLE.js'
import { WhoopBLE } from '../engines/whoopBLE.js'
import { store } from '../store/sessionStore.js'

const STATE_MESSAGES = {
  ventral_vagal: "You're here.",
  healthy_sympathetic: 'Moving well.',
  anxious_sympathetic: 'Something activated.',
  dorsal_vagal: 'Deep stillness.',
  burnout_rigidity: 'Holding the anchor.',
}

const TIER_GROUPS = [
  { label: 'TEMPORAL', params: ['bpm', 'rhythmic_complexity', 'beat_regularity', 'silence_ratio'] },
  { label: 'HARMONIC', params: ['key_mode', 'harmonic_tension', 'chord_complexity', 'voice_range_presence'] },
  { label: 'TIMBRAL',  params: ['brightness', 'roughness', 'warmth', 'spatial_width'] },
  { label: 'BIOLOGICAL', params: ['soma_carrier_hz', 'binaural_beat_hz', 'breath_sync_ratio', 'micro_variation'] },
]

function normParam(name, value) {
  if (value == null) return 0
  if (name === 'bpm') return Math.max(0, Math.min(1, (value - 50) / 80))
  if (name === 'binaural_beat_hz') return Math.max(0, Math.min(1, value / 30))
  if (name === 'soma_carrier_hz') return Math.max(0, Math.min(1, (value - 30) / 100))
  if (name === 'key_mode') return value / 2
  return Math.max(0, Math.min(1, value))
}

export default function MainSession({ selection, setAnsState, onExit }) {
  const [frame, setFrame] = useState(null)
  const [startFrame, setStartFrame] = useState(null)
  const [timeLeft, setTimeLeft] = useState(selection.duration_s)
  const [hrvSeries, setHrvSeries] = useState([])
  const toneRef = useRef(null)
  const bleRef = useRef(null)
  const wsRef = useRef(null)
  const startFrameRef = useRef(null)
  const frameRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function setup() {
      // Audio
      toneRef.current = new ToneEngine()
      await toneRef.current.start()
      toneRef.current.setSession(selection.session)

      // WebSocket
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const host = location.host
      const userId = store.get().user_id
      const url = `${proto}://${host}/ws/session?session=${selection.session}&mode=${selection.sensor_mode}&duration_s=${selection.duration_s}&user_id=${encodeURIComponent(userId)}`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        if (cancelled) return
        const msg = JSON.parse(ev.data)
        if (msg.status === 'buffering' || msg.error) return
        if (!startFrameRef.current) { startFrameRef.current = msg; setStartFrame(msg) }
        frameRef.current = msg
        setFrame(msg)
        if (msg.state) {
          setHrvSeries(prev => {
            const next = [...prev, msg.metrics.rmssd]
            return next.slice(-60)
          })
        }
        if (msg.ans?.actionable) {
          setAnsState(msg.ans.state)
          toneRef.current.setAnsState(msg.ans.state)
        }
        if (msg.music_params) {
          toneRef.current.apply(msg.music_params)
        }
      }

      ws.onclose = () => { if (!cancelled) onExit(startFrameRef.current, frameRef.current) }

      // Real sensor connection
      if (selection.sensor_mode === 'polar') {
        bleRef.current = new PolarH10BLE()
        try { await bleRef.current.connect((rr) => ws.readyState === 1 && ws.send(JSON.stringify({ rr }))) }
        catch (e) { console.error('Polar connect failed', e) }
      } else if (selection.sensor_mode === 'whoop') {
        bleRef.current = new WhoopBLE()
        try { await bleRef.current.connect(
          (rr) => ws.readyState === 1 && ws.send(JSON.stringify({ rr })),
          () => console.warn('WHOOP motion warning'),
        ) }
        catch (e) { console.error('WHOOP connect failed', e) }
      }
    }

    setup()
    const iv = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 1000)
    return () => {
      cancelled = true
      clearInterval(iv)
      if (wsRef.current) wsRef.current.close()
      if (bleRef.current) bleRef.current.disconnect()
      if (toneRef.current) toneRef.current.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const state = frame?.ans?.state || 'ventral_vagal'
  const msg = STATE_MESSAGES[state] || 'Listening...'
  const mins = Math.floor(timeLeft / 60)
  const secs = Math.floor(timeLeft % 60).toString().padStart(2, '0')

  return (
    <div className="screen" style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 20px', fontSize: 12 }}>
        <span className="secondary" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>{selection.session}</span>
        <span className="mono">{mins}:{secs}</span>
        <button className="secondary" style={{ background: 'none', color: 'var(--text-secondary)' }} onClick={() => { wsRef.current?.close(); onExit(startFrameRef.current, frameRef.current) }}>✕</button>
      </div>

      {/* Central circle */}
      <div style={{ height: '45vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <svg width="240" height="240" className="state-color">
          <circle cx="120" cy="120" r="108" fill="rgba(0,0,0,0)" stroke="var(--state)" strokeWidth="1" strokeDasharray="4 6" opacity="0.4" />
          <circle cx="120" cy="120" r="92" fill="rgba(0,201,167,0.06)" stroke="var(--state)" strokeWidth="1.5" className="breathe" style={{ transformOrigin: '120px 120px' }} />
        </svg>
        <div style={{ position: 'absolute', top: 24, left: 0, right: 0, textAlign: 'center' }}>
          <div className="secondary" style={{ fontSize: 12 }}>{msg}</div>
        </div>
        <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, textAlign: 'center' }}>
          <div className="pill" style={{ fontSize: 10, display: 'inline-block' }}>
            {selection.sensor_mode === 'simulator' ? 'SIM' : selection.sensor_mode.toUpperCase()}
          </div>
        </div>
      </div>

      {/* HRV trend */}
      <div style={{ padding: '0 20px', height: 60 }}>
        <HrvTrend series={hrvSeries} />
      </div>

      {/* Music params */}
      <div style={{ padding: '16px 20px' }}>
        {TIER_GROUPS.map(tier => (
          <div key={tier.label} style={{ marginBottom: 10 }}>
            <div className="secondary" style={{ fontSize: 9, letterSpacing: '0.15em', marginBottom: 4 }}>{tier.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {tier.params.map(p => (
                <div key={p} className="param-bar">
                  <span style={{ width: `${normParam(p, frame?.music_params?.[p]) * 100}%` }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HrvTrend({ series }) {
  if (!series.length) return null
  const w = 350, h = 60
  const min = Math.min(...series), max = Math.max(...series)
  const range = Math.max(max - min, 1)
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1 || 1)) * w
    const y = h - ((v - min) / range) * h * 0.9 - h * 0.05
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline fill="none" stroke="var(--state)" strokeWidth="1.5" points={pts} className="state-color" />
    </svg>
  )
}
