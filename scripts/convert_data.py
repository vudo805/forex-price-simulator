"""Convert monthly XAUUSD OHLC parquet files into compact JSON the web app can fetch statically."""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "data" / "XAUUSD"
OUT_DIR = ROOT / "app" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

months = []

for path in sorted(SRC_DIR.glob("XAUUSD_*.parquet")):
    month_key = path.stem.replace("XAUUSD_", "")
    df = pd.read_parquet(path)
    df = df.sort_index()

    rows = []
    for ts, r in df.iterrows():
        rows.append([
            int(ts.timestamp() * 1000),
            round(float(r["open"]), 3),
            round(float(r["high"]), 3),
            round(float(r["low"]), 3),
            round(float(r["close"]), 3),
            int(r["ticks"]),
        ])

    out_path = OUT_DIR / f"XAUUSD_{month_key}.json"
    out_path.write_text(json.dumps(rows, separators=(",", ":")))

    if rows:
        months.append({
            "month": month_key,
            "from": rows[0][0],
            "to": rows[-1][0],
            "bars": len(rows),
        })
    print(f"{path.name}: {len(rows)} bars -> {out_path.name}")

index_path = OUT_DIR / "index.json"
index_path.write_text(json.dumps({"symbol": "XAUUSD", "months": months}, indent=2))
print(f"Wrote index with {len(months)} months -> {index_path}")
