# Forex Price Simulator (XAUUSD)

**Live:** https://vudo805.github.io/forex-price-simulator/

Mô phỏng giao dịch vàng (XAUUSD) kiểu MT5 chạy trong trình duyệt: replay dữ liệu giá thật (Dukascopy), chọn khung giờ bất kỳ (đặc biệt là các mốc tin lớn FOMC/NFP/CPI), và đặt lệnh demo. Dữ liệu nến tự động cập nhật hàng ngày và trang tự deploy lại — không cần thao tác tay.

## Chạy local

```bash
cd app
npm install
npm run dev
```

Mở `http://localhost:5173`.

## Cấu trúc thư mục

```
price simulator/
├── .github/workflows/
│   ├── deploy.yml               build + deploy app lên GitHub Pages mỗi khi push vào main
│   └── update-data.yml          cron hàng ngày: cập nhật nến mới + tick thật, tự commit & push
├── data/XAUUSD/                  parquet nến 15 phút (nguồn: Dukascopy)
├── scripts/
│   ├── dukascopy_downloader.py   lõi tải/giải mã tick Dukascopy (session dùng chung kết nối, có timeout cứng)
│   ├── convert_data.py           parquet -> JSON cho app đọc (app/public/data/)
│   ├── update_candles.py         tự tải nến mới nhất (cửa sổ trượt 5 ngày gần nhất) + gọi convert_data.py
│   └── download_news_ticks.py    tải tick thật quanh các mốc tin FOMC/NFP/CPI trong newsCalendar.ts
└── app/                          ứng dụng React + Vite + TypeScript
    ├── public/data/               JSON nến + news_ticks/ (sinh ra từ các script trên)
    └── src/
        ├── engine/priceEngine.ts  lõi mô phỏng: nội suy giá trong nến, tick thật, phát hiện "nến tin"
        ├── hooks/useTradingAccount.ts   tài khoản demo: balance/equity/margin/vị thế/SL-TP/stop-out
        ├── indicators/            SMA/EMA/RSI/ATR/VWAP + registry để thêm indicator mới
        ├── newsCalendar.ts        lịch FOMC/NFP/CPI 2026 (giờ UTC, đã tính DST)
        ├── components/            UI: TopBar, PriceChart, AccountPanel, OrderTicket, PositionsPanel...
        └── utils/time.ts          format giờ UTC (toàn bộ app chạy theo giờ UTC, không phải giờ máy)
```

## Tự động hoá (GitHub Actions)

- **update-data.yml** chạy mỗi ngày lúc 03:00 UTC: gọi `update_candles.py` (tải lại 5 ngày gần nhất, ghép vào dữ liệu cũ, không tải lại cả tháng) rồi `download_news_ticks.py` (tự lấy tick thật cho sự kiện nào vừa có đủ dữ liệu). Nếu có gì thay đổi thì tự commit + push.
- **deploy.yml** chạy mỗi khi có push vào `main` (kể cả do workflow trên tự commit): build lại app và deploy lên GitHub Pages.

Chạy tay một trong hai workflow qua tab **Actions** trên GitHub (nút "Run workflow"), hoặc `gh workflow run update-data.yml`.

## Cập nhật dữ liệu thủ công (nếu cần)

```bash
pip install -r scripts/requirements.txt

# tải nến mới nhất (an toàn chạy lại nhiều lần)
python3 scripts/update_candles.py

# tải tick thật cho các mốc tin trong app/src/newsCalendar.ts (tự bỏ qua cái đã có)
python3 scripts/download_news_ticks.py
```

Nếu sửa danh sách sự kiện trong `newsCalendar.ts`, nhớ cập nhật `EVENTS` tương ứng trong `download_news_ticks.py`.

## Tính năng chính

- **Chart nến M1-D1** dựng từ nến 15 phút thật, nội suy mượt cho cảm giác giá chạy liên tục; chọn timeframe M1/M5/M15/M30/H1/H4/D1, nút +/- zoom, tự auto-fit khi nhảy tới thời điểm mới.
- **Indicators**: VWAP (đè lên chart giá), RSI/ATR (khung riêng bên dưới, đồng bộ trục thời gian) — bật/tắt và chỉnh chu kỳ qua menu Indicators.
- **Tick thật lúc tin ra**: với các mốc trong `newsCalendar.ts` đã có file JSON tương ứng trong `public/data/news_ticks/`, app phát lại đúng tick lịch sử thật (−1 phút đến +30 phút quanh giờ tin) thay vì mô phỏng — badge "● TICK THẬT" báo khi đang ở trong khung này. Khi tick thật hết, giá chạy tiếp bằng mô phỏng bình thường (không lặp lại pha bung giá tin tức lần nữa).
- **"Nến tin"**: bar nào có biên độ vượt trội so với trung bình cục bộ sẽ được coi là tin mạnh — giá bung nhanh trong ~1-2 phút đầu, spread giãn rộng, badge "⚡ TIN MẠNH" hiện lên (áp dụng cho cả đoạn mô phỏng lẫn tick thật).
- **Nhảy tới lịch tin 2026**: dropdown liệt kê FOMC/NFP/CPI theo đúng giờ UTC thật (đã tính DST), nhảy tới đúng 1 phút trước giờ công bố.
- **Tài khoản demo**: đòn bẩy 1:500/1:1000, lot tuỳ chỉnh, SL/TP, stop-out tự động khi margin level dưới 40%, nhập số dư tuỳ ý.
- **Phím tắt**: Space để Phát/Tạm dừng (không hoạt động khi đang gõ vào ô nhập liệu).

## Lưu ý quan trọng

- **Toàn bộ giờ trong app là UTC**, không phải giờ máy — kể cả ô nhập ngày giờ, đồng hồ mô phỏng, lịch sử lệnh.
- Dữ liệu nến gốc là **dữ liệu thật** từ Dukascopy (không phải giả lập) đã gộp thành khung 15 phút; cột `ticks` là số tick thật nhưng không phải chỉ báo biến động đáng tin cậy (đã kiểm chứng — corr với biên độ giá chỉ ~0.65), nên phần "nến tin" dùng biên độ giá thay vì số tick.
- Lịch FOMC/NFP/CPI trong `newsCalendar.ts` đã điền sẵn hết năm 2026 (Fed/BLS công bố lịch trước cả năm). Sang 2027 cần bổ sung thủ công khi lịch mới được công bố.
