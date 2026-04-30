import { useState } from 'react'
import { putProfile } from '../lib/api'
import styles from './ProfileSetup.module.css'

const STEPS = ['hero', 'age', 'sex', 'height', 'weight', 'resting_hr', 'done']

export default function ProfileSetup({ onComplete }) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState({
    age: '', sex: '', height_cm: '',
    weight_kg: '', resting_hr: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))
  const set = (k) => (v) => setData((d) => ({ ...d, [k]: v }))

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        age: parseInt(data.age, 10),
        sex: data.sex,
        height_cm: parseInt(data.height_cm, 10),
        weight_kg: data.weight_kg ? parseFloat(data.weight_kg) : null,
        resting_hr: data.resting_hr ? parseInt(data.resting_hr, 10) : null,
      }
      await putProfile(payload)
      next()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const current = STEPS[step]

  return (
    <div className={styles.root}>
      <Dots count={STEPS.length} active={step} />
      {current === 'hero' && (
        <Card>
          <h1>Tell us about you</h1>
          <p>So the science can fit your body.</p>
          <PrimaryButton onClick={next}>Begin</PrimaryButton>
        </Card>
      )}
      {current === 'age' && (
        <Card>
          <h2>How old are you?</h2>
          <NumberInput value={data.age} onChange={set('age')} min={13} max={100} placeholder="32" />
          <Nav onBack={back} onNext={next} canNext={isValidAge(data.age)} />
        </Card>
      )}
      {current === 'sex' && (
        <Card>
          <h2>Biological sex</h2>
          <p className={styles.subtle}>
            Shapes your healthy heart-rhythm range — peer-reviewed norms (Umetani 1998, Nunan 2010).
          </p>
          <SegmentedChoice
            options={[
              ['male', 'Male'],
              ['female', 'Female'],
              ['prefer_not_to_say', 'Prefer not to say'],
            ]}
            value={data.sex}
            onChange={set('sex')}
          />
          <Nav onBack={back} onNext={next} canNext={!!data.sex} />
        </Card>
      )}
      {current === 'height' && (
        <Card>
          <h2>Your height</h2>
          <NumberInput value={data.height_cm} onChange={set('height_cm')} min={100} max={230} placeholder="170" suffix="cm" />
          <Nav onBack={back} onNext={next} canNext={isValidHeight(data.height_cm)} />
        </Card>
      )}
      {current === 'weight' && (
        <Card>
          <h2>Your weight</h2>
          <p className={styles.subtle}>Optional — helps fine-tune your baseline.</p>
          <NumberInput value={data.weight_kg} onChange={set('weight_kg')} min={20} max={300} placeholder="65" suffix="kg" allowEmpty />
          <Nav onBack={back} onNext={next} canNext={true} />
        </Card>
      )}
      {current === 'resting_hr' && (
        <Card>
          <h2>Resting heart rate</h2>
          <p className={styles.subtle}>
            Optional — your heart rate when fully rested. Lower resting HR is associated with higher HRV (Aubert 2003).
          </p>
          <NumberInput value={data.resting_hr} onChange={set('resting_hr')} min={30} max={120} placeholder="60" suffix="bpm" allowEmpty />
          <Nav onBack={back} onNext={submit} canNext={true} nextLabel={submitting ? 'Saving…' : 'Finish'} disabled={submitting} />
          {error && <p className={styles.softError}>Something didn't save. Let's try again.</p>}
        </Card>
      )}
      {current === 'done' && (
        <Card>
          <h1>Your starting baseline is ready</h1>
          <p>We'll refine it from your real H10 sessions over the next few days.</p>
          <PrimaryButton onClick={onComplete}>Continue</PrimaryButton>
        </Card>
      )}
    </div>
  )
}

function isValidAge(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 13 && n <= 100 }
function isValidHeight(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 100 && n <= 230 }

function Dots({ count, active }) {
  return (
    <div className={styles.dots}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={i === active ? styles.dotActive : styles.dot} />
      ))}
    </div>
  )
}

function Card({ children }) {
  return <div className={styles.card}>{children}</div>
}

function PrimaryButton({ children, onClick, disabled }) {
  return <button className={styles.primary} onClick={onClick} disabled={disabled}>{children}</button>
}

function NumberInput({ value, onChange, min, max, placeholder, suffix, allowEmpty }) {
  return (
    <div className={styles.inputRow}>
      <input
        className={styles.numberInput}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        placeholder={placeholder}
        inputMode="numeric"
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </div>
  )
}

function SegmentedChoice({ options, value, onChange }) {
  return (
    <div className={styles.segmented}>
      {options.map(([val, label]) => (
        <button
          key={val}
          className={value === val ? styles.segmentActive : styles.segment}
          onClick={() => onChange(val)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Nav({ onBack, onNext, canNext, nextLabel = 'Next', disabled }) {
  return (
    <div className={styles.nav}>
      <button className={styles.secondary} onClick={onBack}>Back</button>
      <button className={styles.primary} onClick={onNext} disabled={!canNext || disabled}>{nextLabel}</button>
    </div>
  )
}
