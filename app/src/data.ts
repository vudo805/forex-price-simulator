import type { Bar, DataIndex } from './types'

type RawRow = [number, number, number, number, number, number]

export async function loadAllBars(): Promise<{ bars: Bar[]; index: DataIndex }> {
  const index: DataIndex = await fetch('/data/index.json').then((r) => r.json())
  const perMonth = await Promise.all(
    index.months.map((m) =>
      fetch(`/data/XAUUSD_${m.month}.json`).then((r) => r.json() as Promise<RawRow[]>),
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
