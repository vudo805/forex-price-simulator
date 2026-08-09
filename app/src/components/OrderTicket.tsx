import { useState } from 'react'
import type { Side } from '../types'
import { CONTRACT_SIZE, marginForLot, type Leverage } from '../hooks/useTradingAccount'

type Props = {
  bid: number
  ask: number
  leverage: Leverage
  freeMargin: number
  onOrder: (side: Side, lot: number, sl: number | null, tp: number | null) => void
}

const LOT_STEP = 0.01
const LOT_PRESETS = [0.01, 0.1, 1]

export default function OrderTicket({ bid, ask, leverage, freeMargin, onOrder }: Props) {
  const [lot, setLot] = useState(0.1)
  const [useSlTp, setUseSlTp] = useState(false)
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')

  const clampLot = (v: number) => Math.max(0.01, Math.min(50, Math.round(v * 100) / 100))

  const parsedSl = useSlTp && sl ? Number(sl) : null
  const parsedTp = useSlTp && tp ? Number(tp) : null

  const estMargin = marginForLot(lot, ask || bid || 0, leverage)
  const canTrade = bid > 0 && ask > 0

  const submit = (side: Side) => {
    if (!canTrade) return
    onOrder(side, lot, parsedSl, parsedTp)
  }

  return (
    <div className="panel order-panel">
      <div className="panel-title">Đặt lệnh</div>

      <div className="lot-row">
        <span>Khối lượng (lot)</span>
        <div className="lot-stepper">
          <button className="btn btn-secondary btn-tiny" onClick={() => setLot((l) => clampLot(l - LOT_STEP))}>
            −
          </button>
          <input
            className="lot-input"
            type="number"
            min={0.01}
            max={50}
            step={0.01}
            value={lot}
            onChange={(e) => setLot(clampLot(Number(e.target.value) || 0.01))}
          />
          <button className="btn btn-secondary btn-tiny" onClick={() => setLot((l) => clampLot(l + LOT_STEP))}>
            +
          </button>
        </div>
      </div>
      <div className="lot-presets">
        {LOT_PRESETS.map((p) => (
          <button key={p} className="chip" onClick={() => setLot(p)}>
            {p}
          </button>
        ))}
        <span className="hint">1 lot = {CONTRACT_SIZE} oz</span>
      </div>

      <label className="sltp-toggle">
        <input type="checkbox" checked={useSlTp} onChange={(e) => setUseSlTp(e.target.checked)} />
        Đặt Stop Loss / Take Profit
      </label>
      {useSlTp && (
        <div className="sltp-row">
          <input
            className="sltp-input"
            type="number"
            placeholder="SL"
            value={sl}
            onChange={(e) => setSl(e.target.value)}
          />
          <input
            className="sltp-input"
            type="number"
            placeholder="TP"
            value={tp}
            onChange={(e) => setTp(e.target.value)}
          />
        </div>
      )}

      <div className="margin-est">
        Ký quỹ cần: ${estMargin.toFixed(2)}{' '}
        {estMargin > freeMargin && <span className="pnl-neg"> — vượt ký quỹ khả dụng</span>}
      </div>

      <div className="order-buttons">
        <button className="btn btn-sell" disabled={!canTrade} onClick={() => submit('sell')}>
          BÁN
          <span className="order-price">{bid ? bid.toFixed(2) : '—'}</span>
        </button>
        <button className="btn btn-buy" disabled={!canTrade} onClick={() => submit('buy')}>
          MUA
          <span className="order-price">{ask ? ask.toFixed(2) : '—'}</span>
        </button>
      </div>
    </div>
  )
}
