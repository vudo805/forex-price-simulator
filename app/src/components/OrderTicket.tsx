import { useState } from 'react'
import type { DraftOrder, OrderKind, Side } from '../types'
import { marginForLot, type Leverage } from '../hooks/useTradingAccount'
import { SYMBOL_MAP, formatPrice, type SymbolId } from '../symbols'

type Props = {
  symbol: SymbolId
  bid: number
  ask: number
  leverage: Leverage
  freeMargin: number
  draft: DraftOrder
  onOrder: (side: Side, lot: number, sl: number | null, tp: number | null) => void
  onStartDraft: (side: Side, kind: OrderKind, lot: number) => void
  onConfirmDraft: () => void
  onCancelDraft: () => void
}

const LOT_STEP = 0.01
const LOT_PRESETS = [0.01, 0.1, 1]

const ORDER_TYPES: { value: 'market' | OrderKind; label: string }[] = [
  { value: 'market', label: 'Market' },
  { value: 'stop', label: 'Stop' },
  { value: 'limit', label: 'Limit' },
]

export default function OrderTicket({
  symbol,
  bid,
  ask,
  leverage,
  freeMargin,
  draft,
  onOrder,
  onStartDraft,
  onConfirmDraft,
  onCancelDraft,
}: Props) {
  const [lot, setLot] = useState(0.1)
  const [orderType, setOrderType] = useState<'market' | OrderKind>('market')
  const [useSlTp, setUseSlTp] = useState(false)
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')

  const clampLot = (v: number) => Math.max(0.01, Math.min(50, Math.round(v * 100) / 100))

  const parsedSl = useSlTp && sl ? Number(sl) : null
  const parsedTp = useSlTp && tp ? Number(tp) : null

  const estMargin = marginForLot(symbol, lot, ask || bid || 0, leverage)
  const canTrade = bid > 0 && ask > 0

  const submit = (side: Side) => {
    if (!canTrade) return
    if (orderType === 'market') {
      onOrder(side, lot, parsedSl, parsedTp)
    } else {
      onStartDraft(side, orderType, lot)
    }
  }

  return (
    <div className="panel order-panel">
      <div className="panel-title">Đặt lệnh</div>

      <div className="order-type-row">
        {ORDER_TYPES.map((t) => (
          <button
            key={t.value}
            className={`chip ${orderType === t.value ? 'chip-active' : ''}`}
            disabled={!!draft}
            onClick={() => setOrderType(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

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
        <span className="hint">{SYMBOL_MAP[symbol].lotHint}</span>
      </div>

      {orderType === 'market' && (
        <>
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
        </>
      )}

      <div className="margin-est">
        Ký quỹ cần: ${estMargin.toFixed(2)}{' '}
        {estMargin > freeMargin && <span className="pnl-neg"> — vượt ký quỹ khả dụng</span>}
      </div>

      {draft ? (
        <>
          <div className="draft-info">
            <div className="draft-info-row">
              <span>Lệnh</span>
              <b>
                {draft.side === 'buy' ? 'MUA' : 'BÁN'} {draft.kind.toUpperCase()}
              </b>
            </div>
            <div className="draft-info-row">
              <span>Giá vào</span>
              <b>{formatPrice(draft.price, symbol)}</b>
            </div>
            <div className="draft-info-row">
              <span>SL / TP</span>
              <b>
                {draft.sl != null ? formatPrice(draft.sl, symbol) : '—'} /{' '}
                {draft.tp != null ? formatPrice(draft.tp, symbol) : '—'}
              </b>
            </div>
            <div className="hint">Kéo đường trên chart để chỉnh giá vào lệnh và SL/TP</div>
          </div>
          <div className="order-buttons">
            <button className="btn btn-secondary" onClick={onCancelDraft}>
              Huỷ
            </button>
            <button className="btn btn-buy" onClick={onConfirmDraft}>
              Xác nhận đặt lệnh
            </button>
          </div>
        </>
      ) : (
        <div className="order-buttons">
          <button className="btn btn-sell" disabled={!canTrade} onClick={() => submit('sell')}>
            {orderType === 'market' ? 'BÁN' : `${orderType.toUpperCase()} BÁN`}
            {orderType === 'market' && <span className="order-price">{formatPrice(bid, symbol)}</span>}
          </button>
          <button className="btn btn-buy" disabled={!canTrade} onClick={() => submit('buy')}>
            {orderType === 'market' ? 'MUA' : `${orderType.toUpperCase()} MUA`}
            {orderType === 'market' && <span className="order-price">{formatPrice(ask, symbol)}</span>}
          </button>
        </div>
      )}
    </div>
  )
}
