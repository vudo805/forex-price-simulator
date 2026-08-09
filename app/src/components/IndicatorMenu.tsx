import { useState } from 'react'
import { INDICATOR_DEFS, type IndicatorState } from '../indicators/types'

type Props = {
  state: IndicatorState
  onToggle: (id: (typeof INDICATOR_DEFS)[number]['id']) => void
  onPeriodChange: (id: (typeof INDICATOR_DEFS)[number]['id'], period: number) => void
}

export default function IndicatorMenu({ state, onToggle, onPeriodChange }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="indicator-menu">
      <button className="chart-tf-btn indicator-menu-btn" onClick={() => setOpen((o) => !o)}>
        📊 Indicators
      </button>
      {open && (
        <div className="indicator-dropdown">
          {INDICATOR_DEFS.map((def) => {
            const s = state[def.id]
            return (
              <div key={def.id} className="indicator-row">
                <label className="indicator-row-label">
                  <input type="checkbox" checked={s.enabled} onChange={() => onToggle(def.id)} />
                  <span style={{ color: def.color }}>{def.label}</span>
                </label>
                {def.hasPeriod && (
                  <input
                    className="indicator-period-input"
                    type="number"
                    min={1}
                    value={s.period}
                    onChange={(e) => onPeriodChange(def.id, Math.max(1, Number(e.target.value) || 1))}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
