import { useState } from 'react'
import type { PriceEngine } from '../engine/priceEngine'
import type { Speed } from '../types'
import { formatUtc, msToUtcInputValue, utcInputValueToMs } from '../utils/time'
import { NEWS_CALENDAR_2026 } from '../newsCalendar'
import { SYMBOLS, formatPrice, type SymbolId } from '../symbols'

type Props = {
  engine: PriceEngine
  symbol: SymbolId
  playing: boolean
  speed: Speed
  bid: number
  ask: number
  range: [number, number] | null
  simTime: number
  newsSpike: boolean
  isRealData: boolean
  onSymbolChange: (s: SymbolId) => void
  onPlayToggle: () => void
  onSpeedChange: (s: Speed) => void
  onJump: (t: number) => void
}

const SPEED_OPTIONS: { value: Speed; label: string }[] = [
  { value: 1, label: '1x (thời gian thực)' },
  { value: 30, label: '30x (chậm)' },
  { value: 60, label: '60x' },
  { value: 300, label: '300x (mặc định)' },
  { value: 900, label: '900x (nhanh)' },
  { value: 3600, label: '3600x (rất nhanh)' },
]

const NEWS_GROUPS = [
  { type: 'FOMC' as const, label: 'FOMC — quyết định lãi suất' },
  { type: 'NFP' as const, label: 'NFP — bảng lương phi NN' },
  { type: 'CPI' as const, label: 'CPI — lạm phát' },
]

export default function TopBar({
  engine,
  symbol,
  playing,
  speed,
  bid,
  ask,
  range,
  simTime,
  newsSpike,
  isRealData,
  onSymbolChange,
  onPlayToggle,
  onSpeedChange,
  onJump,
}: Props) {
  const [dt, setDt] = useState('')
  const [lastNewsMs, setLastNewsMs] = useState<number | null>(null)

  const min = range ? msToUtcInputValue(range[0]) : undefined
  const max = range ? msToUtcInputValue(range[1]) : undefined

  const doJump = () => {
    if (!dt) return
    const t = utcInputValueToMs(dt)
    if (Number.isFinite(t)) {
      engine.setRealTicks(null)
      onJump(t)
    }
  }

  const jumpToNews = async (ms: number) => {
    const ev = NEWS_CALENDAR_2026.find((e) => e.ms === ms)
    if (!ev) return
    setLastNewsMs(ms)
    const target = ev.ms - 60_000 // land 1 minute before the release
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/news_ticks/${symbol}/${ev.key}.json`)
      if (res.ok) {
        const rows: [number, number, number][] = await res.json()
        engine.setRealTicks(
          rows.map(([t, bid, ask]) => ({ t, bid, ask })),
          ev.ms,
        )
      } else {
        engine.setRealTicks(null)
      }
    } catch {
      engine.setRealTicks(null)
    }
    onJump(target)
  }

  return (
    <div className="topbar">
      <div className="topbar-left">
        <select
          className="symbol-badge symbol-select"
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value as SymbolId)}
        >
          {SYMBOLS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
        <div className="price-block">
          <div className="price-bid">{formatPrice(bid, symbol)}</div>
          <div className="price-ask">{formatPrice(ask, symbol)}</div>
        </div>
        <div className="sim-clock">{formatUtc(simTime)}</div>
        {isRealData && <div className="real-badge">● TICK THẬT</div>}
        {newsSpike && <div className="news-badge" title="Tin mạnh" />}
      </div>

      <div className="topbar-right">
        <button
          className="btn btn-secondary btn-tiny"
          onClick={() => lastNewsMs != null && jumpToNews(lastNewsMs)}
          disabled={lastNewsMs == null}
          title="Quay lại tin vừa chọn"
        >
          ↺
        </button>
        <select
          className="speed-select news-select"
          defaultValue=""
          onChange={(e) => {
            const ms = Number(e.target.value)
            if (ms) jumpToNews(ms)
            e.target.value = ''
          }}
        >
          <option value="" disabled>
            ⚡ Lịch tin 2026...
          </option>
          {NEWS_GROUPS.map((g) => (
            <optgroup key={g.type} label={g.label}>
              {NEWS_CALENDAR_2026.filter((e) => e.type === g.type).map((e) => (
                <option key={e.ms} value={e.ms}>
                  {e.label} — {new Date(e.ms).toISOString().slice(11, 16)} UTC
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <input
          type="datetime-local"
          value={dt}
          min={min}
          max={max}
          onChange={(e) => setDt(e.target.value)}
          className="dt-input"
          title="Giờ UTC"
        />
        <button className="btn btn-secondary" onClick={doJump}>
          Nhảy tới (UTC)
        </button>

        <select
          className="speed-select"
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value) as Speed)}
        >
          {SPEED_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <button
          className={`btn ${playing ? 'btn-pause' : 'btn-play'}`}
          onClick={onPlayToggle}
          title="Phím tắt: Space"
        >
          {playing ? '⏸ Tạm dừng' : '▶ Phát'}
        </button>
      </div>
    </div>
  )
}
