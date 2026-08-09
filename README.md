# Forex Price Simulator (XAUUSD)

Mô phỏng giao dịch vàng (XAUUSD) kiểu MT5 chạy trong trình duyệt: replay dữ liệu giá thật (Dukascopy), chọn khung giờ bất kỳ (đặc biệt là các mốc tin lớn FOMC/NFP/CPI), và đặt lệnh demo.

## Chạy nhanh

```bash
cd app
npm install
npm run dev
```

Mở `http://localhost:5173`.

## Cấu trúc thư mục

```
price simulator/
├── data/XAUUSD/                  parquet nến 15 phút (nguồn: Dukascopy, cùng dữ liệu Strat_tester dùng)
├── scripts/
│   ├── convert_data.py           parquet -> JSON cho app đọc (app/public/data/)
│   └── download_news_ticks.py    tải tick thật (Dukascopy) quanh các mốc tin FOMC/NFP/CPI 2026
└── app/                          ứng dụng React + Vite + TypeScript
    ├── public/data/               JSON nến (từ convert_data.py) + news_ticks/ (từ download_news_ticks.py)
    └── src/
        ├── engine/priceEngine.ts  lõi mô phỏng: nội suy giá trong nến, tick thật, phát hiện "nến tin"
        ├── hooks/useTradingAccount.ts   tài khoản demo: balance/equity/margin/vị thế/SL-TP/stop-out
        ├── newsCalendar.ts        lịch FOMC/NFP/CPI 2026 (giờ UTC, đã tính DST)
        ├── components/            UI: TopBar, PriceChart, AccountPanel, OrderTicket, PositionsPanel
        └── utils/time.ts          format giờ UTC (toàn bộ app chạy theo giờ UTC, không phải giờ máy)
```

## Cập nhật dữ liệu

Khi cần thêm tháng dữ liệu mới hoặc tải lại:

```bash
# 1. Tải/convert nến 15 phút thành JSON cho app
python3 scripts/convert_data.py

# 2. (tuỳ chọn) Tải tick thật quanh các mốc tin trong app/src/newsCalendar.ts
#    Script tự bỏ qua sự kiện đã tải rồi, chạy lại an toàn nếu bị ngắt giữa chừng.
python3 scripts/download_news_ticks.py
```

Nếu sửa danh sách sự kiện trong `newsCalendar.ts`, nhớ cập nhật `EVENTS` tương ứng trong `download_news_ticks.py`.

## Tính năng chính

- **Chart nến M1** dựng từ nến 15 phút thật, nội suy mượt cho cảm giác giá chạy liên tục; nút +/- zoom, tự auto-fit khi nhảy tới thời điểm mới.
- **Tick thật lúc tin ra**: với các mốc trong `newsCalendar.ts` đã có file JSON tương ứng trong `public/data/news_ticks/`, app phát lại đúng tick lịch sử thật (−1 phút đến +5 phút quanh giờ tin) thay vì mô phỏng — badge "● TICK THẬT" báo khi đang ở trong khung này.
- **"Nến tin"**: bar nào có biên độ vượt trội so với trung bình cục bộ sẽ được coi là tin mạnh — giá bung nhanh trong ~1-2 phút đầu, spread giãn rộng, badge "⚡ TIN MẠNH" hiện lên (áp dụng cho cả đoạn mô phỏng lẫn tick thật).
- **Nhảy tới lịch tin 2026**: dropdown liệt kê FOMC/NFP/CPI theo đúng giờ UTC thật (đã tính DST), nhảy tới đúng 1 phút trước giờ công bố.
- **Tài khoản demo**: đòn bẩy 1:500/1:1000, lot tuỳ chỉnh, SL/TP, stop-out tự động khi margin level dưới 50%.
- **Phím tắt**: Space để Phát/Tạm dừng (không hoạt động khi đang gõ vào ô nhập liệu).

## Lưu ý quan trọng

- **Toàn bộ giờ trong app là UTC**, không phải giờ máy — kể cả ô nhập ngày giờ, đồng hồ mô phỏng, lịch sử lệnh.
- Dữ liệu nến gốc là **dữ liệu thật** từ Dukascopy (không phải giả lập) đã gộp thành khung 15 phút; cột `ticks` là số tick thật nhưng không phải chỉ báo biến động đáng tin cậy (đã kiểm chứng — corr với biên độ giá chỉ ~0.65), nên phần "nến tin" dùng biên độ giá thay vì số tick.
