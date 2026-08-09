import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { PriceEngine, Candle } from '../engine/priceEngine'
import type { DraftOrder, OrderKind, PendingOrder, Position, Side } from '../types'
import { DRAFT_ORDER_ID } from '../types'
import { vwap, rsi, atr, type IndicatorPoint } from '../indicators/compute'
import { INDICATOR_DEFS, defaultIndicatorState, type IndicatorState } from '../indicators/types'
import OscillatorPane, { type OscillatorHandle } from './OscillatorPane'
import IndicatorMenu from './IndicatorMenu'
import { SYMBOL_MAP, type SymbolId } from '../symbols'

type Props = {
  engine: PriceEngine
  symbol: SymbolId
  positions: Position[]
  pendingOrders: PendingOrder[]
  draft: DraftOrder
  onOrderLineChange: (id: number, kind: 'sl' | 'tp' | 'trigger', price: number) => void
}

type OrderLineKind = 'sl' | 'tp' | 'trigger'

/** Unifies filled positions, pending stop/limit orders, and the in-progress
 *  draft into one shape so the SL/TP (and, for pending/draft, trigger) drag
 *  handles can be rendered/updated with a single code path. */
type OrderLineTarget = {
  id: number
  side: Side
  anchorPrice: number // position entry, or pending/draft trigger price
  sl: number | null
  tp: number | null
  orderKind?: OrderKind // present only for pending/draft — used to label the trigger handle
}

type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1'

const TF_SECONDS: Record<Timeframe, number> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  M30: 30 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D1: 24 * 60 * 60,
}
const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']

function bucketStart(timeSec: number, tfSec: number) {
  return Math.floor(timeSec / tfSec) * tfSec
}

/** Resample the engine's native M1 candles up into a coarser timeframe. */
function aggregate(m1: Candle[], tfSec: number): Candle[] {
  if (tfSec <= 60) return m1
  const out: Candle[] = []
  let cur: Candle | null = null
  for (const c of m1) {
    const bStart = bucketStart(c.time, tfSec)
    if (!cur || cur.time !== bStart) {
      if (cur) out.push(cur)
      cur = { time: bStart, open: c.open, high: c.high, low: c.low, close: c.close }
    } else {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
    }
  }
  if (cur) out.push(cur)
  return out
}

function toLwc(points: IndicatorPoint[]) {
  return points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
}

function formatCountdown(remainingSec: number) {
  const s = Math.max(0, Math.ceil(remainingSec))
  const pad = (n: number) => String(n).padStart(2, '0')
  if (s >= 3600) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h}:${pad(m)}:${pad(s % 60)}`
  }
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

function formatHMS(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export default function PriceChart({ engine, symbol, positions, pendingOrders, draft, onOrderLineChange }: Props) {
  const pricePrecision = SYMBOL_MAP[symbol].pricePrecision
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiHandleRef = useRef<OscillatorHandle | null>(null)
  const atrHandleRef = useRef<OscillatorHandle | null>(null)
  const priceLinesRef = useRef<Map<number, ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>>(
    new Map(),
  )
  const priceLabelRef = useRef<HTMLDivElement>(null)
  const priceLabelPriceRef = useRef<HTMLDivElement>(null)
  const priceLabelTimeRef = useRef<HTMLDivElement>(null)
  const priceLineRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef<HTMLDivElement>(null)
  const lastBarCloseSecRef = useRef(0)
  const orderLineRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const orderHandleRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const orderLineTargets: OrderLineTarget[] = [
    ...positions.filter((p) => p.symbol === symbol).map((p) => ({
      id: p.id,
      side: p.side,
      anchorPrice: p.openPrice,
      sl: p.sl,
      tp: p.tp,
    })),
    ...pendingOrders.filter((o) => o.symbol === symbol).map((o) => ({
      id: o.id,
      side: o.side,
      anchorPrice: o.triggerPrice,
      sl: o.sl,
      tp: o.tp,
      orderKind: o.kind,
    })),
    ...(draft
      ? [
          {
            id: DRAFT_ORDER_ID,
            side: draft.side,
            anchorPrice: draft.price,
            sl: draft.sl,
            tp: draft.tp,
            orderKind: draft.kind,
          },
        ]
      : []),
  ]
  const orderLineTargetsRef = useRef<OrderLineTarget[]>(orderLineTargets)
  orderLineTargetsRef.current = orderLineTargets

  const draggingRef = useRef<{ id: number; kind: OrderLineKind; price: number } | null>(null)
  const [timeframe, setTimeframe] = useState<Timeframe>('M1')
  const timeframeRef = useRef(timeframe)
  timeframeRef.current = timeframe
  const lastM1HistoryRef = useRef<Candle[]>([])
  const displayedRef = useRef<Candle[]>([])
  const [chartReady, setChartReady] = useState(false)

  const [indicatorState, setIndicatorState] = useState<IndicatorState>(defaultIndicatorState())
  const indicatorStateRef = useRef(indicatorState)
  indicatorStateRef.current = indicatorState

  const recomputeIndicators = (full: boolean) => {
    const candles = displayedRef.current
    const st = indicatorStateRef.current

    if (st.vwap.enabled && vwapSeriesRef.current) {
      const pts = vwap(candles)
      if (full) vwapSeriesRef.current.setData(toLwc(pts))
      else if (pts.length) vwapSeriesRef.current.update(toLwc([pts[pts.length - 1]])[0])
    }
    if (st.rsi.enabled && rsiHandleRef.current) {
      const pts = rsi(candles, st.rsi.period)
      if (full) rsiHandleRef.current.setAll(pts)
      else if (pts.length) rsiHandleRef.current.updateLast(pts[pts.length - 1])
    }
    if (st.atr.enabled && atrHandleRef.current) {
      const pts = atr(candles, st.atr.period)
      if (full) atrHandleRef.current.setAll(pts)
      else if (pts.length) atrHandleRef.current.updateLast(pts[pts.length - 1])
    }
  }

  const zoom = (factor: number) => {
    const chart = chartRef.current
    if (!chart) return
    const current = chart.timeScale().options().barSpacing
    const next = Math.min(60, Math.max(1, current * factor))
    chart.timeScale().applyOptions({ barSpacing: next })
  }

  // Custom current-price line + label (price on top, countdown to this bar's
  // close below) — replaces lightweight-charts' own last-price label, which
  // has no way to show a second line of text.
  const updatePriceIndicator = (barCloseSec: number) => {
    if (clockRef.current) clockRef.current.textContent = formatHMS(engine.getSimTime())

    const chart = chartRef.current
    const series = seriesRef.current
    const bar = displayedRef.current[displayedRef.current.length - 1]
    if (!chart || !series || !bar) return
    if (!priceLabelRef.current || !priceLineRef.current || !priceLabelPriceRef.current || !priceLabelTimeRef.current) return

    const y = series.priceToCoordinate(bar.close)
    if (y == null) return
    const axisWidth = chart.priceScale('right').width()
    const remainingSec = barCloseSec - engine.getSimTime() / 1000
    const bullish = bar.close >= bar.open

    priceLineRef.current.style.display = 'block'
    priceLineRef.current.style.top = `${y}px`
    priceLineRef.current.style.right = `${axisWidth}px`
    priceLineRef.current.style.borderTopColor = bullish ? '#26a69a' : '#ef5350'

    priceLabelRef.current.style.display = 'flex'
    priceLabelRef.current.style.top = `${y}px`
    priceLabelRef.current.style.width = `${Math.max(axisWidth, 1)}px`
    priceLabelRef.current.style.background = bullish ? '#26a69a' : '#ef5350'
    priceLabelPriceRef.current.textContent = bar.close.toFixed(pricePrecision)
    priceLabelTimeRef.current.textContent = formatCountdown(remainingSec)
  }

  // Draggable SL/TP/trigger lines, rendered as DOM overlays (like the price label
  // above) rather than lightweight-charts' native price lines, which have no drag
  // support. Every position/pending-order/draft always gets SL+TP handles, even
  // before set — an unset one shows as a dim "+ SL"/"+ TP" ghost sitting just off
  // the anchor price, ready to be dragged out. Pending orders and the draft also
  // get a "trigger" handle (always solid, since it always has a real price).
  const GHOST_OFFSET_PX = 26

  const updateOrderLines = () => {
    const series = seriesRef.current
    if (!series) return
    const dragging = draggingRef.current
    orderLineTargetsRef.current.forEach((t) => {
      const anchorY = series.priceToCoordinate(t.anchorPrice)
      const dir = t.side === 'buy' ? 1 : -1
      const kinds: OrderLineKind[] = t.orderKind ? ['sl', 'tp', 'trigger'] : ['sl', 'tp']
      kinds.forEach((kind) => {
        const key = `${t.id}-${kind}`
        const el = orderLineRefs.current.get(key)
        const label = orderHandleRefs.current.get(key)
        if (!el || !label) return
        // don't fight the user's own in-progress drag with a stale reposition
        if (dragging && dragging.id === t.id && dragging.kind === kind) return

        let price: number | null
        let isSet: boolean
        if (kind === 'trigger') {
          price = t.anchorPrice
          isSet = true
        } else {
          price = kind === 'sl' ? t.sl : t.tp
          isSet = price != null
        }

        let y: number | null
        if (isSet && price != null) {
          y = series.priceToCoordinate(price)
        } else if (anchorY != null) {
          const offset = kind === 'sl' ? dir * GHOST_OFFSET_PX : -dir * GHOST_OFFSET_PX
          y = anchorY + offset
        } else {
          y = null
        }
        if (y == null) {
          el.style.display = 'none'
          return
        }
        el.style.display = 'block'
        el.style.top = `${y}px`
        el.classList.toggle('sltp-drag-ghost', !isSet)
        if (kind === 'trigger') {
          const sideLabel = t.side === 'buy' ? 'MUA' : 'BÁN'
          label.textContent = `${sideLabel} ${t.orderKind!.toUpperCase()} ${t.anchorPrice.toFixed(pricePrecision)}`
        } else {
          label.textContent = isSet
            ? `${kind.toUpperCase()} ${price!.toFixed(pricePrecision)}`
            : `+ ${kind.toUpperCase()}`
        }
      })
    })
  }

  const startOrderLineDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    id: number,
    kind: OrderLineKind,
    initialPrice: number,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const container = containerRef.current
    const series = seriesRef.current
    if (!container || !series) return
    draggingRef.current = { id, kind, price: initialPrice }

    const onMove = (ev: PointerEvent) => {
      const drag = draggingRef.current
      if (!drag) return
      const rect = container.getBoundingClientRect()
      const y = ev.clientY - rect.top
      const price = series.coordinateToPrice(y)
      if (price == null) return
      drag.price = price
      const key = `${drag.id}-${drag.kind}`
      const el = orderLineRefs.current.get(key)
      const label = orderHandleRefs.current.get(key)
      if (el) {
        el.style.display = 'block'
        el.style.top = `${y}px`
        el.classList.remove('sltp-drag-ghost')
      }
      if (label) {
        const target = orderLineTargetsRef.current.find((t) => t.id === drag.id)
        if (drag.kind === 'trigger' && target?.orderKind) {
          const sideLabel = target.side === 'buy' ? 'MUA' : 'BÁN'
          label.textContent = `${sideLabel} ${target.orderKind.toUpperCase()} ${price.toFixed(pricePrecision)}`
        } else {
          label.textContent = `${drag.kind.toUpperCase()} ${price.toFixed(pricePrecision)}`
        }
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const drag = draggingRef.current
      draggingRef.current = null
      if (!drag) return
      onOrderLineChange(drag.id, drag.kind, drag.price)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f1115' },
        textColor: '#c7ccd6',
      },
      grid: {
        vertLines: { color: '#1b1f27' },
        horzLines: { color: '#1b1f27' },
      },
      rightPriceScale: { borderColor: '#2a2f3a' },
      timeScale: { borderColor: '#2a2f3a', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    })
    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      // replaced by our own price+countdown-to-close label below
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const vwapSeries = chart.addLineSeries({
      color: '#e8c94a',
      lineWidth: 2,
      priceLineVisible: false,
      visible: false,
    })
    chartRef.current = chart
    seriesRef.current = series
    vwapSeriesRef.current = vwapSeries
    setChartReady(true)

    const resize = () => {
      if (!containerRef.current) return
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      })
      updatePriceIndicator(lastBarCloseSecRef.current)
      updateOrderLines()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(containerRef.current)

    const applyReset = (candles: Candle[]) => {
      lastM1HistoryRef.current = candles
      const tfSec = TF_SECONDS[timeframeRef.current]
      const agg = aggregate(candles, tfSec)
      displayedRef.current = agg
      series.setData(agg.map((c) => ({ ...c, time: c.time as UTCTimestamp })))
      // re-enable autoscale in case the user manually dragged the price axis before
      // jumping — otherwise the y-range stays pinned to wherever it was and the new
      // candles can land off-screen until scrolled/zoomed by hand
      series.priceScale().applyOptions({ autoScale: true })
      chart.timeScale().fitContent()
      recomputeIndicators(true)
      const lastBar = agg[agg.length - 1]
      if (lastBar) {
        lastBarCloseSecRef.current = lastBar.time + tfSec
        updatePriceIndicator(lastBarCloseSecRef.current)
        updateOrderLines()
      }
    }

    const offReset = engine.onReset(applyReset)
    const offCandle = engine.onCandle((candle: Candle) => {
      const tfSec = TF_SECONDS[timeframeRef.current]
      const bStart = bucketStart(candle.time, tfSec)
      const arr = displayedRef.current
      const last = arr[arr.length - 1]
      if (!last || last.time !== bStart) {
        arr.push({ time: bStart, open: candle.open, high: candle.high, low: candle.low, close: candle.close })
      } else {
        last.high = Math.max(last.high, candle.high)
        last.low = Math.min(last.low, candle.low)
        last.close = candle.close
      }
      const cur = arr[arr.length - 1]
      series.update({ ...cur, time: cur.time as UTCTimestamp })
      recomputeIndicators(false)
      lastBarCloseSecRef.current = bStart + tfSec
      updatePriceIndicator(lastBarCloseSecRef.current)
      updateOrderLines()
    })

    return () => {
      offReset()
      offCandle()
      ro.disconnect()
      chart.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  // re-render the already-loaded history at the newly selected timeframe
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    const tfSec = TF_SECONDS[timeframe]
    const agg = aggregate(lastM1HistoryRef.current, tfSec)
    displayedRef.current = agg
    series.setData(agg.map((c) => ({ ...c, time: c.time as UTCTimestamp })))
    series.priceScale().applyOptions({ autoScale: true })
    chart.timeScale().fitContent()
    recomputeIndicators(true)
    const lastBar = agg[agg.length - 1]
    if (lastBar) {
      lastBarCloseSecRef.current = lastBar.time + tfSec
      updatePriceIndicator(lastBarCloseSecRef.current)
      updateOrderLines()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe])

  // VWAP: overlay series already exists on the main chart — just show/hide + (re)compute
  useEffect(() => {
    const s = vwapSeriesRef.current
    if (!s) return
    s.applyOptions({ visible: indicatorState.vwap.enabled })
    if (indicatorState.vwap.enabled) s.setData(toLwc(vwap(displayedRef.current)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicatorState.vwap.enabled, chartReady])

  // RSI / ATR panes mount/unmount via JSX below; once mounted, keep them in sync
  // with period changes made from the menu
  useEffect(() => {
    if (indicatorState.rsi.enabled && rsiHandleRef.current) {
      rsiHandleRef.current.setAll(rsi(displayedRef.current, indicatorState.rsi.period))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicatorState.rsi.enabled, indicatorState.rsi.period])

  useEffect(() => {
    if (indicatorState.atr.enabled && atrHandleRef.current) {
      atrHandleRef.current.setAll(atr(displayedRef.current, indicatorState.atr.period))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicatorState.atr.enabled, indicatorState.atr.period])

  // draw open-position entry lines (native price lines — just a marker, not draggable)
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    priceLinesRef.current.forEach((line) => series.removePriceLine(line))
    priceLinesRef.current.clear()

    // positions belonging to a different symbol have prices on a totally different
    // scale (e.g. an EURUSD entry at 1.08 drawn on the XAUUSD chart) — only the
    // current chart's own symbol gets price lines
    positions.filter((p) => p.symbol === symbol).forEach((p) => {
      const entryLine = series.createPriceLine({
        price: p.openPrice,
        color: p.side === 'buy' ? '#26a69a' : '#ef5350',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `${p.side.toUpperCase()} ${p.lot}`,
      })
      priceLinesRef.current.set(p.id, entryLine)
    })
  }, [positions, symbol])

  // reposition the draggable SL/TP/trigger DOM overlays whenever the underlying
  // orders change (dragging itself keeps them in sync during the drag, and the
  // tick-driven update sites above keep them in sync with price/zoom)
  useEffect(() => {
    updateOrderLines()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, pendingOrders, draft, symbol])

  const rsiDef = INDICATOR_DEFS.find((d) => d.id === 'rsi')!
  const atrDef = INDICATOR_DEFS.find((d) => d.id === 'atr')!

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <div ref={priceLineRef} className="current-price-line" style={{ display: 'none' }} />
        <div ref={priceLabelRef} className="current-price-label" style={{ display: 'none' }}>
          <div ref={priceLabelPriceRef} className="current-price-value" />
          <div ref={priceLabelTimeRef} className="current-price-countdown" />
        </div>
        {orderLineTargets.flatMap((t) => {
          const kinds: OrderLineKind[] = t.orderKind ? ['sl', 'tp', 'trigger'] : ['sl', 'tp']
          return kinds.map((kind) => {
            const key = `${t.id}-${kind}`
            const initialPrice = kind === 'trigger' ? t.anchorPrice : (kind === 'sl' ? t.sl : t.tp) ?? t.anchorPrice
            return (
              <div
                key={key}
                ref={(el) => {
                  if (el) orderLineRefs.current.set(key, el)
                  else orderLineRefs.current.delete(key)
                }}
                className={`sltp-drag-line sltp-drag-${kind}`}
                style={{ display: 'none' }}
              >
                <div
                  className="sltp-drag-handle"
                  ref={(el) => {
                    if (el) orderHandleRefs.current.set(key, el)
                    else orderHandleRefs.current.delete(key)
                  }}
                  onPointerDown={(e) => startOrderLineDrag(e, t.id, kind, initialPrice)}
                />
              </div>
            )
          })
        })}
        <div className="chart-tf-controls">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              className={`chart-tf-btn ${tf === timeframe ? 'chart-tf-btn-active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="chart-top-right-controls">
          <div ref={clockRef} className="chart-clock" />
          <IndicatorMenu
            state={indicatorState}
            onToggle={(id) =>
              setIndicatorState((s) => ({ ...s, [id]: { ...s[id], enabled: !s[id].enabled } }))
            }
            onPeriodChange={(id, period) =>
              setIndicatorState((s) => ({ ...s, [id]: { ...s[id], period } }))
            }
          />
          <div className="chart-zoom-controls">
            <button className="chart-zoom-btn" onClick={() => zoom(1.3)} title="Phóng to">
              +
            </button>
            <button className="chart-zoom-btn" onClick={() => zoom(1 / 1.3)} title="Thu nhỏ">
              −
            </button>
          </div>
        </div>
      </div>

      {chartReady && chartRef.current && indicatorState.rsi.enabled && (
        <OscillatorPane
          def={rsiDef}
          mainChart={chartRef.current}
          onReady={(h) => {
            rsiHandleRef.current = h
            h.setAll(rsi(displayedRef.current, indicatorState.rsi.period))
          }}
          onDestroy={() => {
            rsiHandleRef.current = null
          }}
        />
      )}
      {chartReady && chartRef.current && indicatorState.atr.enabled && (
        <OscillatorPane
          def={atrDef}
          mainChart={chartRef.current}
          onReady={(h) => {
            atrHandleRef.current = h
            h.setAll(atr(displayedRef.current, indicatorState.atr.period))
          }}
          onDestroy={() => {
            atrHandleRef.current = null
          }}
        />
      )}
    </div>
  )
}
