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
  symbol: string
  months: MonthIndexEntry[]
}

export type Side = 'buy' | 'sell'

export type Position = {
  id: number
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

export type Speed = 1 | 30 | 60 | 300 | 900 | 3600

export type EngineSnapshot = {
  simTime: number
  bid: number
  ask: number
  playing: boolean
  speed: Speed
  ready: boolean
}
