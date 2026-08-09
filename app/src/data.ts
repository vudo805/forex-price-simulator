import type { Bar, DataIndex } from './types'

type RawRow = [number, number, number, number, number, number]

// import.meta.env.BASE_URL is '/' in dev and the configured `base` (e.g.
// '/forex-price-simulator/') in production — plain '/data/...' paths would
// 404 once this is deployed under a GitHub Pages project subpath.
const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`

export async function loadAllBars(): Promise<{ bars: Bar[]; index: DataIndex }> {
  const index: DataIndex = await fetch(dataUrl('index.json')).then((r) => r.json())
  const perMonth = await Promise.all(
    index.months.map((m) =>
      fetch(dataUrl(`XAUUSD_${m.month}.json`)).then((r) => r.json() as Promise<RawRow[]>),
    ),
  )
  const bars: Bar[] = []
  for (const rows of perMonth) {
    for (const [time, open, high, low, close, ticks] of rows) {
      bars.push({ time, open, high, low, close, ticks })
    }
  }
  bars.sort((a, b) => a.time - b.time)
  return { bars, index }
}
