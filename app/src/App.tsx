import { useEffect, useMemo, useRef, useState } from 'react'
import { PriceEngine } from './engine/priceEngine'
import { loadAllBars } from './data'
import type { Speed } from './types'
import { useTradingAccount } from './hooks/useTradingAccount'
import TopBar from './components/TopBar'
import PriceChart from './components/PriceChart'
import AccountPanel from './components/AccountPanel'
import OrderTicket from './components/OrderTicket'
import PositionsPanel from './components/PositionsPanel'

export default function App() {
  const engine = useMemo(() => new PriceEngine(), [])
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(300)
  const [range, setRange] = useState<[number, number] | null>(null)
  const initialJumpDone = useRef(false)

  const account = useTradingAccount(engine)

  useEffect(() => {
    let cancelled = false
    loadAllBars().then(({ bars }) => {
      if (cancelled) return
      engine.setBars(bars)
      setRange(engine.getRange())
      setReady(true)
      if (!initialJumpDone.current && bars.length) {
        initialJumpDone.current = true
        // start a little into the data so there is history context on the chart
        const startIdx = Math.min(200, bars.length - 1)
        engine.jumpTo(bars[startIdx].time)
      }
    })
    return () => {
      cancelled = true
    }
  }, [engine])

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

  return (
    <div className="app">
      <TopBar
        engine={engine}
        playing={playing}
        speed={speed}
        bid={account.price.bid}
        ask={account.price.ask}
        range={range}
        simTime={engine.getSimTime()}
        newsSpike={account.price.newsSpike}
        isRealData={account.price.isRealData}
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
          {!ready && <div className="loading">Đang tải dữ liệu XAUUSD...</div>}
          <PriceChart engine={engine} positions={account.positions} />
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
            bid={account.price.bid}
            ask={account.price.ask}
            leverage={account.leverage}
            freeMargin={account.freeMargin}
            onOrder={account.openPosition}
          />
        </div>
      </div>

      <div className="bottom-panel">
        <PositionsPanel
          positions={account.positions}
          history={account.history}
          bid={account.price.bid}
          ask={account.price.ask}
          onClose={(id) => account.closePosition(id, 'manual')}
        />
      </div>
    </div>
  )
}
