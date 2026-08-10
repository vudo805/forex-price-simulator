import type { SymbolId } from './symbols'

export type Bar = {
  time: number // ms epoch, bar open time
  open: number
  high: number
  low: number
  close: number
  ticks: number
}

export type MonthIndexEntry = {
  month: string
  from: number
  to: number
  bars: number
}

export type DataIndex = {
  symbols: Record<string, { months: MonthIndexEntry[] }>
}

export type Side = 'buy' | 'sell'

export type Position = {
  id: number
  symbol: SymbolId
  side: Side
  lot: number
  openPrice: number
  openTime: number
  sl: number | null
  tp: number | null
}

export type ClosedTrade = Position & {
  closePrice: number
  closeTime: number
  pnl: number
  reason: 'manual' | 'sl' | 'tp' | 'stopout'
}

export type OrderKind = 'stop' | 'limit'

export type PendingOrder = {
  id: number
  symbol: SymbolId
  side: Side
  kind: OrderKind
  lot: number
  triggerPrice: number
  sl: number | null
  tp: number | null
  createdTime: number
}

// sentinel id for an order that's being placed but not yet confirmed — lives
// only as local UI state (see App.tsx's `draft`), never in useTradingAccount
export const DRAFT_ORDER_ID = -1

export type DraftOrder = {
  side: Side
  kind: OrderKind
  lot: number
  price: number
  sl: number | null
  tp: number | null
} | null

export type Speed = 1 | 2 | 5 | 30 | 60 | 300 | 900 | 3600

export type EngineSnapshot = {
  simTime: number
  bid: number
  ask: number
  playing: boolean
  speed: Speed
  ready: boolean
}
