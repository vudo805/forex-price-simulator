import { useEffect, useMemo, useState } from 'react'
import { PriceEngine } from './engine/priceEngine'
import { loadSymbolBars } from './data'
import type { DraftOrder, OrderKind, Side, Speed } from './types'
import { DRAFT_ORDER_ID } from './types'
import { useTradingAccount } from './hooks/useTradingAccount'
import { SYMBOL_MAP, type SymbolId } from './symbols'
import TopBar from './components/TopBar'
import PriceChart from './components/PriceChart'
import AccountPanel from './components/AccountPanel'
import OrderTicket from './components/OrderTicket'
import PositionsPanel from './components/PositionsPanel'

export default function App() {
  const engine = useMemo(() => new PriceEngine(), [])
  const [symbol, setSymbol] = useState<SymbolId>('XAUUSD')
  const [ready, setReady] = useState(false)
  const [noData, setNoData] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(300)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [draft, setDraft] = useState<DraftOrder>(null)

  const account = useTradingAccount(engine, symbol)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setNoData(false)
    setDraft(null)
    engine.pause()
    engine.setRealTicks(null)
    engine.setSpread(SYMBOL_MAP[symbol].defaultSpread)
    loadSymbolBars(symbol).then((bars) => {
      if (cancelled) return
      engine.setBars(bars)
      setRange(engine.getRange())
      setReady(true)
      if (bars.length) {
        // start a little into the data so there is history context on the chart
        const startIdx = Math.min(200, bars.length - 1)
        engine.jumpTo(bars[startIdx].time)
      } else {
        setNoData(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [engine, symbol])

  useEffect(() => {
    return engine.onStateChange(() => {
      setPlaying(engine.isPlaying())
    })
  }, [engine])

  const handlePlayToggle = () => {
    if (engine.isPlaying()) engine.pause()
    else engine.play()
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      // don't hijack space while typing into an input/select or focused on a button
      // (space would otherwise both toggle playback AND activate the focused control)
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
      e.preventDefault()
      handlePlayToggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  const handleSpeedChange = (s: Speed) => {
    engine.setSpeed(s)
    setSpeed(s)
  }

  const handleJump = (t: number) => {
    engine.pause()
    engine.jumpTo(t)
  }

  // Starts a pending-order draft: a default trigger price offset from the
  // current market (away from it for a stop / toward it for a limit), shown
  // on the chart as a draggable line the user fine-tunes before confirming.
  const handleStartDraft = (side: Side, kind: OrderKind, lot: number) => {
    const { bid, ask } = account.price
    if (!bid || !ask) return
    const ref = side === 'buy' ? ask : bid
    const offset = ref * 0.001
    const goesUp = (side === 'buy') === (kind === 'stop')
    const price = goesUp ? ref + offset : ref - offset
    setDraft({ side, kind, lot, price, sl: null, tp: null })
  }

  const handleConfirmDraft = () => {
    if (!draft) return
    account.placePendingOrder(draft.side, draft.kind, draft.lot, draft.price, draft.sl, draft.tp)
    setDraft(null)
  }

  const handleCancelDraft = () => setDraft(null)

  // Single entry point for every draggable line on the chart (SL/TP on a
  // filled position, SL/TP on a pending order, or the draft's trigger/SL/TP).
  const handleOrderLineChange = (id: number, kind: 'sl' | 'tp' | 'trigger', price: number) => {
    if (id === DRAFT_ORDER_ID) {
      setDraft((d) => {
        if (!d) return d
        if (kind === 'trigger') return { ...d, price }
        if (kind === 'sl') return { ...d, sl: price }
        return { ...d, tp: price }
      })
      return
    }
    if (kind === 'trigger') {
      account.updatePendingTrigger(id, price)
      return
    }
    const existing =
      account.positions.find((p) => p.id === id) ?? account.pendingOrders.find((o) => o.id === id)
    const newSl = kind === 'sl' ? price : (existing?.sl ?? null)
    const newTp = kind === 'tp' ? price : (existing?.tp ?? null)
    account.updateSlTp(id, newSl, newTp)
  }

  return (
    <div className="app">
      <TopBar
        engine={engine}
        symbol={symbol}
        playing={playing}
        speed={speed}
        bid={account.price.bid}
        ask={account.price.ask}
        range={range}
        simTime={engine.getSimTime()}
        newsSpike={account.price.newsSpike}
        isRealData={account.price.isRealData}
        onSymbolChange={setSymbol}
        onPlayToggle={handlePlayToggle}
        onSpeedChange={handleSpeedChange}
        onJump={handleJump}
      />

      {account.stopOutAlert && (
        <div className="alert-banner">
          {account.stopOutAlert}
          <button className="btn btn-tiny btn-secondary" onClick={account.dismissStopOutAlert}>
            Đóng
          </button>
        </div>
      )}

      <div className="main-grid">
        <div className="chart-area">
          {!ready && <div className="loading">Đang tải dữ liệu {symbol}...</div>}
          {ready && noData && (
            <div className="loading">Chưa có dữ liệu cho {symbol} — đang trong quá trình tải về, quay lại sau.</div>
          )}
          <PriceChart
            engine={engine}
            symbol={symbol}
            positions={account.positions}
            pendingOrders={account.pendingOrders}
            draft={draft}
            onOrderLineChange={handleOrderLineChange}
          />
        </div>

        <div className="side-panel">
          <AccountPanel
            balance={account.balance}
            equity={account.equity}
            usedMargin={account.usedMargin}
            freeMargin={account.freeMargin}
            marginLevel={account.marginLevel}
            floatingPnl={account.floatingPnl}
            leverage={account.leverage}
            onLeverageChange={account.setLeverage}
            onReset={account.resetAccount}
          />
          <OrderTicket
            symbol={symbol}
            bid={account.price.bid}
            ask={account.price.ask}
            leverage={account.leverage}
            freeMargin={account.freeMargin}
            draft={draft}
            onOrder={account.openPosition}
            onStartDraft={handleStartDraft}
            onConfirmDraft={handleConfirmDraft}
            onCancelDraft={handleCancelDraft}
          />
        </div>
      </div>

      <div className="bottom-panel">
        <PositionsPanel
          positions={account.positions}
          pendingOrders={account.pendingOrders}
          history={account.history}
          priceBySymbol={account.priceBySymbol}
          onClose={(id) => account.closePosition(id, 'manual')}
          onCancelPending={account.cancelPendingOrder}
        />
      </div>
    </div>
  )
}
