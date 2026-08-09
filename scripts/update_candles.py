"""Refresh local XAUUSD candle data from Dukascopy up to the latest available
day, then regenerate the JSON the web app reads. Meant to run on a schedule
(see .github/workflows/update-data.yml) — safe to run repeatedly.

Re-downloads and overwrites the most recent local month's parquet each run
(since that file is almost always partial), and fills in any months that
don't have a file yet at all. Does NOT touch app/public/data/news_ticks/ —
those are fixed historical events downloaded once by download_news_ticks.py.
"""
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dukascopy_downloader import download_symbol_range, month_ranges, ticks_to_ohlc  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "XAUUSD"
SYMBOL = "XAUUSD"
TIMEFRAME = "15min"
# Dukascopy publishes daily files with a lag (observed 1-2 days) — stop short
# of "today" so we're not repeatedly re-fetching a day that isn't actually
# published yet.
LAG_DAYS = 2


def latest_local_month() -> date | None:
    files = sorted(DATA_DIR.glob(f"{SYMBOL}_*.parquet"))
    if not files:
        return None
    last = files[-1].stem.split("_")[-1]
    y, m = map(int, last.split("-"))
    return date(y, m, 1)


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    end = date.today() - timedelta(days=LAG_DAYS)
    start_month = latest_local_month()

    if start_month is None:
        print("No existing parquet data found under data/XAUUSD/ — nothing to anchor an update to. Skipping.")
        return
    if start_month > end:
        print(f"Local data (month {start_month:%Y-%m}) is already at/after the update cutoff ({end}). Nothing to do.")
        return

    changed = False
    for month_start, month_end in month_ranges(start_month, end):
        out_path = DATA_DIR / f"{SYMBOL}_{month_start.strftime('%Y-%m')}.parquet"
        print(f"refreshing {SYMBOL} {month_start} .. {month_end}")
        ticks = download_symbol_range(SYMBOL, month_start, month_end)
        bars = ticks_to_ohlc(ticks, TIMEFRAME)
        if bars.empty:
            print(f"  no data returned for this range, leaving {out_path.name} untouched")
            continue
        bars.to_parquet(out_path)
        changed = True
        print(f"  saved {out_path.name}: {len(bars)} bars")

    if not changed:
        print("No new data was available from Dukascopy this run.")
        return

    print("Regenerating app JSON from updated parquet files...")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "convert_data.py")], check=True)


if __name__ == "__main__":
    main()
