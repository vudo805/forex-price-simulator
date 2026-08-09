import type { Bar, Speed } from '../types'

const BAR_MS = 15 * 60 * 1000
const MINUTE_MS = 60 * 1000

export type Candle = {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
}

export type EngineTick = {
  simTime: number
  mid: number
  bid: number
  ask: number
  newsSpike: boolean
  isRealData: boolean
}

export type RealTick = { t: number; bid: number; ask: number }

// deterministic PRNG seeded per-bar so scrubbing/replaying is stable
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic intra-bar price path: open -> (low/high in a plausible order) -> close, plus noise.
 * News bars front-load the move into the first ~1-2 minutes (like a real release reaction)
 * instead of drifting evenly across the full 15 minutes.
 */
function priceAtFraction(bar: Bar, frac: number, isNews: boolean): number {
  const f = Math.max(0, Math.min(1, frac))
  const bullish = bar.close >= bar.open
  const mid1 = bullish ? bar.low : bar.high
  const mid2 = bullish ? bar.high : bar.low
  const [t1, t2] = isNews ? [0.1, 0.25] : [0.35, 0.7]
  const keypoints: [number, number][] = [
    [0, bar.open],
    [t1, mid1],
    [t2, mid2],
    [1, bar.close],
  ]

  let base = bar.close
  for (let i = 0; i < keypoints.length - 1; i++) {
    const [t0, p0] = keypoints[i]
    const [t1, p1] = keypoints[i + 1]
    if (f >= t0 && f <= t1) {
      const localT = t1 === t0 ? 0 : (f - t0) / (t1 - t0)
      base = p0 + (p1 - p0) * localT
      break
    }
  }

  const rng = mulberry32(Math.floor(bar.time / 1000))
  const seed1 = rng() * 1000
  const seed2 = rng() * 1000
  const range = Math.max(bar.high - bar.low, 0.01)
  const noise =
    Math.sin(f * 23 + seed1) * range * 0.035 + Math.sin(f * 71 + seed2) * range * 0.018

  const value = base + noise
  return Math.min(bar.high, Math.max(bar.low, value))
}

type Listener = (tick: EngineTick) => void
type CandleListener = (candle: Candle, isNew: boolean) => void
type StateListener = () => void

export class PriceEngine {
  private bars: Bar[] = []
  private simTime = 0
  private playing = false
  private speed: Speed = 300
  private spread = 0.22
  private rafId: number | null = null
  private lastFrameAt = 0
  private lastMinuteBucket = -1
  private tickListeners = new Set<Listener>()
  private candleListeners = new Set<CandleListener>()
  private stateListeners = new Set<StateListener>()
  private ready = false
  private globalAvgRange = Infinity
  private realTicks: RealTick[] | null = null
  private realEventMs = 0

  /** Splice in real historical ticks (e.g. -1min..+5min around a real news release). */
  setRealTicks(ticks: RealTick[] | null, eventMs = 0) {
    this.realTicks = ticks && ticks.length ? ticks : null
    this.realEventMs = eventMs
  }

  private realTickAt(simTime: number): { bid: number; ask: number } | null {
    const ticks = this.realTicks
    if (!ticks) return null
    const first = ticks[0]
    const last = ticks[ticks.length - 1]
    // outside the real-data window entirely — fall back to the synthetic path instead
    // of freezing on the boundary tick forever (that produced a flat line once real
    // data ran out)
    if (simTime < first.t || simTime > last.t) return null
    if (simTime === first.t) return { bid: first.bid, ask: first.ask }
    if (simTime === last.t) return { bid: last.bid, ask: last.ask }
    let lo = 0
    let hi = ticks.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ticks[mid].t <= simTime) lo = mid
      else hi = mid - 1
    }
    const a = ticks[lo]
    const b = ticks[Math.min(lo + 1, ticks.length - 1)]
    const span = b.t - a.t
    const localT = span > 0 ? (simTime - a.t) / span : 0
    return {
      bid: a.bid + (b.bid - a.bid) * localT,
      ask: a.ask + (b.ask - a.ask) * localT,
    }
  }

  setBars(bars: Bar[]) {
    this.bars = bars
    this.ready = bars.length > 0
    if (bars.length) {
      this.globalAvgRange = bars.reduce((s, b) => s + (b.high - b.low), 0) / bars.length
    }
    this.emitState()
  }

  isReady() {
    return this.ready
  }

  getBars() {
    return this.bars
  }

  getRange(): [number, number] | null {
    if (!this.bars.length) return null
    return [this.bars[0].time, this.bars[this.bars.length - 1].time + BAR_MS]
  }

  private findBarIndex(t: number): number {
    const bars = this.bars
    if (!bars.length) return -1
    let lo = 0
    let hi = bars.length - 1
    if (t < bars[0].time) return 0
    if (t >= bars[hi].time + BAR_MS) return hi
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (bars[mid].time <= t) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  getBarAt(t: number): Bar | null {
    const idx = this.findBarIndex(t)
    return idx >= 0 ? this.bars[idx] : null
  }

  /**
   * A bar reads as "news" when its high-low range blows out well past its own
   * recent neighborhood (not a flat global average — quiet Asian-session hours
   * and busy London/NY overlaps have wildly different baselines, so a global
   * threshold either misses real spikes or false-flags normal busy hours).
   * Range turns out to separate real releases far more cleanly than tick count.
   */
  private isNewsBar(idx: number): boolean {
    const bar = this.bars[idx]
    if (this.realTicks) {
      const first = this.realTicks[0]
      const last = this.realTicks[this.realTicks.length - 1]
      // this bar's reaction already played out via real tick data — once those ticks
      // run out, let the synthetic tail drift normally instead of re-playing the same
      // front-loaded spike a second time for the rest of the bar
      if (bar.time < last.t && bar.time + BAR_MS > first.t) return false
    }
    const windowSize = 20
    const start = Math.max(0, idx - windowSize)
    if (start === idx) return false
    const neighborhood = this.bars.slice(start, idx)
    if (!neighborhood.length) return false
    const localAvgRange = neighborhood.reduce((s, b) => s + (b.high - b.low), 0) / neighborhood.length
    const barRange = bar.high - bar.low
    return barRange > Math.max(localAvgRange * 2.5, this.globalAvgRange * 2.5)
  }

  /** Same intra-bar path used for live ticks, densely sampled into 15 real M1 candles. */
  private buildMinuteCandles(barIdx: number): Candle[] {
    const bar = this.bars[barIdx]
    const isNews = this.isNewsBar(barIdx)
    const samplesPerMinute = 6
    const totalMinutes = BAR_MS / MINUTE_MS
    const candles: Candle[] = []
    for (let m = 0; m < totalMinutes; m++) {
      const minuteStart = bar.time + m * MINUTE_MS
      let open = 0
      let high = -Infinity
      let low = Infinity
      let close = 0
      for (let s = 0; s < samplesPerMinute; s++) {
        const t = minuteStart + (s / samplesPerMinute) * MINUTE_MS
        const price = priceAtFraction(bar, (t - bar.time) / BAR_MS, isNews)
        if (s === 0) open = price
        close = price
        high = Math.max(high, price)
        low = Math.min(low, price)
      }
      candles.push({ time: minuteStart / 1000, open, high, low, close })
    }
    return candles
  }

  jumpTo(t: number, contextBars = 150) {
    const idx = this.findBarIndex(t)
    if (idx < 0) return
    // keep the exact requested time (not snapped to the 15-min bar boundary) so we can
    // land precisely e.g. 1 minute before a news release
    this.simTime = t
    this.lastMinuteBucket = -1
    this.emitCandleReset(idx, contextBars, t)
    this.tick()
    this.emitState()
  }

  private emitCandleReset(idx: number, contextBars: number, uptoMs: number) {
    const start = Math.max(0, idx - contextBars)
    const candles: Candle[] = []
    for (let i = start; i < idx; i++) {
      candles.push(...this.buildMinuteCandles(i))
    }
    // the bar we're jumping into is only partially in the past — include just that slice
    if (idx < this.bars.length) {
      candles.push(...this.buildMinuteCandles(idx).filter((c) => c.time * 1000 < uptoMs))
    }
    this.resetListeners.forEach((l) => l(candles))
  }

  private resetListeners = new Set<(candles: Candle[]) => void>()
  onReset(cb: (candles: Candle[]) => void) {
    this.resetListeners.add(cb)
    return () => { this.resetListeners.delete(cb) }
  }

  play() {
    if (this.playing || !this.ready) return
    this.playing = true
    this.lastFrameAt = performance.now()
    this.loop()
    this.emitState()
  }

  pause() {
    this.playing = false
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.emitState()
  }

  isPlaying() {
    return this.playing
  }

  setSpeed(s: Speed) {
    this.speed = s
    this.emitState()
  }

  getSpeed() {
    return this.speed
  }

  getSpread() {
    return this.spread
  }

  /** Synthetic bid/ask spread — differs a lot by instrument (gold vs a JPY pair vs BTC). */
  setSpread(spread: number) {
    this.spread = spread
  }

  getSimTime() {
    return this.simTime
  }

  private loop = () => {
    if (!this.playing) return
    const now = performance.now()
    const dtRealMs = now - this.lastFrameAt
    this.lastFrameAt = now
    const dtSimMs = dtRealMs * this.speed
    this.advance(dtSimMs)
    this.rafId = requestAnimationFrame(this.loop)
  }

  private advance(dtSimMs: number) {
    const range = this.getRange()
    if (!range) return
    const [, end] = range
    this.simTime = Math.min(this.simTime + dtSimMs, end - 1)

    // market-closed gaps (weekends, holidays) have no bars at all — crawling
    // through them minute by minute just holds the last close frozen for the
    // whole gap (looks like a flat-line bug). Skip straight to the next bar
    // instead, same as a real terminal simply having no candles for that span.
    if (!this.realTickAt(this.simTime)) {
      const idx = this.findBarIndex(this.simTime)
      const bar = this.bars[idx]
      if (bar && this.simTime >= bar.time + BAR_MS && idx + 1 < this.bars.length) {
        this.simTime = Math.min(this.bars[idx + 1].time, end - 1)
        this.lastMinuteBucket = -1
      }
    }

    if (this.simTime >= end - 1) {
      this.pause()
    }
    this.tick()
  }

  private tick() {
    const real = this.realTickAt(this.simTime)
    let mid: number
    let bid: number
    let ask: number
    let newsSpike: boolean

    if (real) {
      bid = real.bid
      ask = real.ask
      mid = (bid + ask) / 2
      // real ticks carry their own genuine spread — just flag the ~90s right after the
      // release as "hot" for the UI badge, no synthetic widening needed
      newsSpike = this.simTime >= this.realEventMs && this.simTime < this.realEventMs + 90_000
    } else {
      const idx = this.findBarIndex(this.simTime)
      if (idx < 0) return
      const bar = this.bars[idx]
      const frac = (this.simTime - bar.time) / BAR_MS
      const isNews = this.isNewsBar(idx)
      mid = priceAtFraction(bar, frac, isNews)
      // spreads blow out for the first ~20% of a news bar, same as a real broker during a release
      const effSpread = isNews && frac < 0.2 ? this.spread * 4 : this.spread
      bid = mid - effSpread / 2
      ask = mid + effSpread / 2
      newsSpike = isNews && frac < 0.2
    }

    const minuteBucket = Math.floor(this.simTime / MINUTE_MS)
    const candleTime = Math.floor(minuteBucket * MINUTE_MS) / 1000
    const isNew = minuteBucket !== this.lastMinuteBucket
    this.lastMinuteBucket = minuteBucket

    if (isNew) {
      this.currentCandle = { time: candleTime, open: mid, high: mid, low: mid, close: mid }
    } else if (this.currentCandle) {
      this.currentCandle.high = Math.max(this.currentCandle.high, mid)
      this.currentCandle.low = Math.min(this.currentCandle.low, mid)
      this.currentCandle.close = mid
    }
    if (this.currentCandle) {
      this.candleListeners.forEach((l) => l(this.currentCandle!, isNew))
    }

    const t: EngineTick = { simTime: this.simTime, mid, bid, ask, newsSpike, isRealData: !!real }
    this.tickListeners.forEach((l) => l(t))
  }

  private currentCandle: Candle | null = null

  onTick(cb: Listener) {
    this.tickListeners.add(cb)
    return () => { this.tickListeners.delete(cb) }
  }

  onCandle(cb: CandleListener) {
    this.candleListeners.add(cb)
    return () => { this.candleListeners.delete(cb) }
  }

  onStateChange(cb: StateListener) {
    this.stateListeners.add(cb)
    return () => { this.stateListeners.delete(cb) }
  }

  private emitState() {
    this.stateListeners.forEach((l) => l())
  }
}
