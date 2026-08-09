import { useCallback, useEffect, useRef, useState } from 'react'
import type { PriceEngine } from '../engine/priceEngine'
import type { ClosedTrade, Position, Side } from '../types'
import { SYMBOL_MAP, type SymbolId } from '../symbols'

export const STARTING_BALANCE = 10000
const STOP_OUT_LEVEL = 40 // % margin level -> forced liquidation

export type Leverage = 500 | 1000
export type PriceQuote = { bid: number; ask: number }

export function positionPnl(p: Position, quote: PriceQuote) {
  const spec = SYMBOL_MAP[p.symbol]
  const closePrice = p.side === 'buy' ? quote.bid : quote.ask
  const dir = p.side === 'buy' ? 1 : -1
  const raw = (closePrice - p.openPrice) * dir * p.lot * spec.contractSize
  // USD-base pairs (USDJPY, USDCAD) settle P/L in the quote currency — convert
  // to the account's USD terms by dividing by the current rate.
  return spec.quoteIsUsd ? raw : raw / closePrice
}

export function marginForLot(symbol: SymbolId, lot: number, price: number, leverage: Leverage) {
  const spec = SYMBOL_MAP[symbol]
  const notionalUsd = spec.quoteIsUsd ? spec.contractSize * lot * price : spec.contractSize * lot
  return notionalUsd / leverage
}

export function useTradingAccount(engine: PriceEngine, activeSymbol: SymbolId) {
  const [balance, setBalance] = useState(STARTING_BALANCE)
  const [leverage, setLeverage] = useState<Leverage>(500)
  const [positions, setPositions] = useState<Position[]>([])
  const [history, setHistory] = useState<ClosedTrade[]>([])
  const [price, setPrice] = useState({ bid: 0, ask: 0, mid: 0, newsSpike: false, isRealData: false })
  const [stopOutAlert, setStopOutAlert] = useState<string | null>(null)

  const positionsRef = useRef<Position[]>([])
  // last known bid/ask per symbol — only the currently active symbol gets fresh
  // ticks, so positions opened under a different symbol keep marking-to-market
  // at whatever price that symbol last showed until it's active again
  const priceBySymbolRef = useRef<Partial<Record<SymbolId, PriceQuote>>>({})
  const activeSymbolRef = useRef(activeSymbol)
  const balanceRef = useRef(STARTING_BALANCE)
  const nextId = useRef(1)
  const lastUiUpdate = useRef(0)

  useEffect(() => {
    activeSymbolRef.current = activeSymbol
    // the previous symbol's last tick would otherwise linger on screen
    // mislabeled as this symbol's price until the new one starts ticking
    setPrice({ bid: 0, ask: 0, mid: 0, newsSpike: false, isRealData: false })
  }, [activeSymbol])
  useEffect(() => {
    positionsRef.current = positions
  }, [positions])
  useEffect(() => {
    balanceRef.current = balance
  }, [balance])

  const quoteFor = (symbol: SymbolId): PriceQuote => priceBySymbolRef.current[symbol] ?? { bid: 0, ask: 0 }

  const closePosition = useCallback(
    (id: number, reason: ClosedTrade['reason']) => {
      const pos = positionsRef.current.find((p) => p.id === id)
      if (!pos) return
      const quote = quoteFor(pos.symbol)
      const closePrice = pos.side === 'buy' ? quote.bid : quote.ask
      const pnl = positionPnl(pos, quote)
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
      const symbol = activeSymbolRef.current
      const quote = quoteFor(symbol)
      if (!quote.bid || !quote.ask) return
      const openPrice = side === 'buy' ? quote.ask : quote.bid
      const pos: Position = {
        id: nextId.current++,
        symbol,
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

  const updateSlTp = useCallback((id: number, sl: number | null, tp: number | null) => {
    positionsRef.current = positionsRef.current.map((p) => (p.id === id ? { ...p, sl, tp } : p))
    setPositions(positionsRef.current)
  }, [])

  useEffect(() => {
    const off = engine.onTick(({ bid, ask, mid, newsSpike, isRealData }) => {
      const symbol = activeSymbolRef.current
      priceBySymbolRef.current[symbol] = { bid, ask }

      // SL/TP checks every tick — only meaningful for positions in the symbol
      // that's actually receiving live ticks right now
      for (const p of positionsRef.current) {
        if (p.symbol !== symbol) continue
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

      // margin / stop-out check across all open positions, using each one's
      // own last-known price (only `symbol`'s is fresh this tick)
      if (positionsRef.current.length) {
        let usedMargin = 0
        let floatingPnl = 0
        for (const p of positionsRef.current) {
          usedMargin += marginForLot(p.symbol, p.lot, p.openPrice, leverage)
          floatingPnl += positionPnl(p, quoteFor(p.symbol))
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

  const usedMargin = positions.reduce((s, p) => s + marginForLot(p.symbol, p.lot, p.openPrice, leverage), 0)
  const floatingPnl = positions.reduce((s, p) => s + positionPnl(p, quoteFor(p.symbol)), 0)
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
    priceBySymbol: priceBySymbolRef.current,
    openPosition,
    closePosition,
    updateSlTp,
    resetAccount,
    stopOutAlert,
    dismissStopOutAlert: () => setStopOutAlert(null),
  }
}
