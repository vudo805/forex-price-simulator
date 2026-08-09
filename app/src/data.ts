import type { Bar, DataIndex } from './types'
import type { SymbolId } from './symbols'

type RawRow = [number, number, number, number, number, number]

// import.meta.env.BASE_URL is '/' in dev and the configured `base` (e.g.
// '/forex-price-simulator/') in production — plain '/data/...' paths would
// 404 once this is deployed under a GitHub Pages project subpath.
const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`

let indexCache: Promise<DataIndex> | null = null
function loadIndex(): Promise<DataIndex> {
  if (!indexCache) indexCache = fetch(dataUrl('index.json')).then((r) => r.json())
  return indexCache
}

export async function loadSymbolBars(symbol: SymbolId): Promise<Bar[]> {
  const index = await loadIndex()
  const months = index.symbols[symbol]?.months ?? []
  const perMonth = await Promise.all(
    months.map((m) =>
      fetch(dataUrl(`${symbol}_${m.month}.json`)).then((r) => r.json() as Promise<RawRow[]>),
    ),
  )
  const bars: Bar[] = []
  for (const rows of perMonth) {
    for (const [time, open, high, low, close, ticks] of rows) {
      bars.push({ time, open, high, low, close, ticks })
    }
  }
  bars.sort((a, b) => a.time - b.time)
  return bars
}
