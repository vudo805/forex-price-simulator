import { useCallback, useEffect, useRef, useState } from 'react'
import type { PriceEngine } from '../engine/priceEngine'
import type { ClosedTrade, Position, Side } from '../types'

export const CONTRACT_SIZE = 100 // oz per lot, standard XAUUSD CFD convention
export const STARTING_BALANCE = 10000
const STOP_OUT_LEVEL = 50 // % margin level -> forced liquidation

export type Leverage = 500 | 1000

export function positionPnl(p: Position, bid: number, ask: number) {
  const closePrice = p.side === 'buy' ? bid : ask
  const dir = p.side === 'buy' ? 1 : -1
  return (closePrice - p.openPrice) * dir * p.lot * CONTRACT_SIZE
}

export function marginForLot(lot: number, price: number, leverage: Leverage) {
  return (lot * CONTRACT_SIZE * price) / leverage
}

export function useTradingAccount(engine: PriceEngine) {
  const [balance, setBalance] = useState(STARTING_BALANCE)
  const [leverage, setLeverage] = useState<Leverage>(500)
  const [positions, setPositions] = useState<Position[]>([])
  const [history, setHistory] = useState<ClosedTrade[]>([])
  const [price, setPrice] = useState({ bid: 0, ask: 0, mid: 0, newsSpike: false, isRealData: false })
  const [stopOutAlert, setStopOutAlert] = useState<string | null>(null)

  const positionsRef = useRef<Position[]>([])
  const priceRef = useRef({ bid: 0, ask: 0, mid: 0 })
  const balanceRef = useRef(STARTING_BALANCE)
  const nextId = useRef(1)
  const lastUiUpdate = useRef(0)

  useEffect(() => {
    positionsRef.current = positions
  }, [positions])
  useEffect(() => {
    balanceRef.current = balance
  }, [balance])

  const closePosition = useCallback(
    (id: number, reason: ClosedTrade['reason']) => {
      const pos = positionsRef.current.find((p) => p.id === id)
      if (!pos) return
      const { bid, ask } = priceRef.current
      const closePrice = pos.side === 'buy' ? bid : ask
      const pnl = positionPnl(pos, bid, ask)
      const trade: ClosedTrade = {
        ...pos,
        closePrice,
        closeTime: engine.getSimTime(),
        pnl,
        reason,
      }
      positionsRef.current = positionsRef.current.filter((p) => p.id !== id)
      setPositions(positionsRef.current)
      setHistory((h) => [trade, ...h])
      balanceRef.current += pnl
      setBalance(balanceRef.current)
    },
    [engine],
  )

  const openPosition = useCallback(
    (side: Side, lot: number, sl: number | null, tp: number | null) => {
      const { bid, ask } = priceRef.current
      if (!bid || !ask) return
      const openPrice = side === 'buy' ? ask : bid
      const pos: Position = {
        id: nextId.current++,
        side,
        lot,
        openPrice,
        openTime: engine.getSimTime(),
        sl,
        tp,
      }
      positionsRef.current = [...positionsRef.current, pos]
      setPositions(positionsRef.current)
    },
    [engine],
  )

  useEffect(() => {
    const off = engine.onTick(({ bid, ask, mid, newsSpike, isRealData }) => {
      priceRef.current = { bid, ask, mid }

      // SL/TP checks every tick (cheap, few positions)
      for (const p of positionsRef.current) {
        const curClose = p.side === 'buy' ? bid : ask
        if (p.side === 'buy') {
          if (p.sl != null && curClose <= p.sl) {
            closePosition(p.id, 'sl')
            continue
          }
          if (p.tp != null && curClose >= p.tp) {
            closePosition(p.id, 'tp')
            continue
          }
        } else {
          if (p.sl != null && curClose >= p.sl) {
            closePosition(p.id, 'sl')
            continue
          }
          if (p.tp != null && curClose <= p.tp) {
            closePosition(p.id, 'tp')
            continue
          }
        }
      }

      // margin / stop-out check
      if (positionsRef.current.length) {
        let usedMargin = 0
        let floatingPnl = 0
        for (const p of positionsRef.current) {
          usedMargin += marginForLot(p.lot, p.openPrice, leverage)
          floatingPnl += positionPnl(p, bid, ask)
        }
        const equity = balanceRef.current + floatingPnl
        const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : Infinity
        if (marginLevel < STOP_OUT_LEVEL) {
          const ids = positionsRef.current.map((p) => p.id)
          ids.forEach((id) => closePosition(id, 'stopout'))
          setStopOutAlert(
            `Stop out: mức ký quỹ dưới ${STOP_OUT_LEVEL}% — toàn bộ lệnh đã bị đóng tự động.`,
          )
        }
      }

      const now = performance.now()
      if (now - lastUiUpdate.current > 100) {
        lastUiUpdate.current = now
        setPrice({ bid, ask, mid, newsSpike, isRealData })
      }
    })
    return off
  }, [engine, leverage, closePosition])

  const usedMargin = positions.reduce((s, p) => s + marginForLot(p.lot, p.openPrice, leverage), 0)
  const floatingPnl = positions.reduce((s, p) => s + positionPnl(p, price.bid, price.ask), 0)
  const equity = balance + floatingPnl
  const freeMargin = equity - usedMargin
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : null

  const resetAccount = useCallback((newBalance = STARTING_BALANCE) => {
    balanceRef.current = newBalance
    setBalance(newBalance)
    positionsRef.current = []
    setPositions([])
    setHistory([])
    setStopOutAlert(null)
  }, [])

  return {
    balance,
    equity,
    usedMargin,
    freeMargin,
    marginLevel,
    floatingPnl,
    leverage,
    setLeverage,
    positions,
    history,
    price,
    openPosition,
    closePosition,
    resetAccount,
    stopOutAlert,
    dismissStopOutAlert: () => setStopOutAlert(null),
  }
}
