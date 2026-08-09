import type { ClosedTrade, Position } from '../types'
import { positionPnl } from '../hooks/useTradingAccount'
import { formatUtcShort } from '../utils/time'

type Props = {
  positions: Position[]
  history: ClosedTrade[]
  bid: number
  ask: number
  onClose: (id: number) => void
}

const fmtTime = formatUtcShort

const REASON_LABEL: Record<ClosedTrade['reason'], string> = {
  manual: 'Đóng tay',
  sl: 'SL',
  tp: 'TP',
  stopout: 'Stop out',
}

export default function PositionsPanel({ positions, history, bid, ask, onClose }: Props) {
  return (
    <div className="panel positions-panel">
      <div className="panel-title">Lệnh đang mở ({positions.length})</div>
      <div className="table-wrap">
        <table className="pos-table">
          <thead>
            <tr>
              <th>Loại</th>
              <th>Lot</th>
              <th>Giá mở</th>
              <th>SL/TP</th>
              <th>Thời gian</th>
              <th>P/L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const pnl = positionPnl(p, bid, ask)
              return (
                <tr key={p.id}>
                  <td className={p.side === 'buy' ? 'side-buy' : 'side-sell'}>
                    {p.side === 'buy' ? 'MUA' : 'BÁN'}
                  </td>
                  <td>{p.lot.toFixed(2)}</td>
                  <td>{p.openPrice.toFixed(2)}</td>
                  <td className="small">
                    {p.sl ? p.sl.toFixed(2) : '—'} / {p.tp ? p.tp.toFixed(2) : '—'}
                  </td>
                  <td className="small">{fmtTime(p.openTime)}</td>
                  <td className={pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                    {pnl >= 0 ? '+' : ''}
                    {pnl.toFixed(2)}
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-tiny" onClick={() => onClose(p.id)}>
                      Đóng
                    </button>
                  </td>
                </tr>
              )
            })}
            {!positions.length && (
              <tr>
                <td colSpan={7} className="empty">
                  Chưa có lệnh nào
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel-title">Lịch sử</div>
      <div className="table-wrap history-wrap">
        <table className="pos-table">
          <thead>
            <tr>
              <th>Loại</th>
              <th>Lot</th>
              <th>Mở</th>
              <th>Đóng</th>
              <th>Lý do</th>
              <th>P/L</th>
            </tr>
          </thead>
          <tbody>
            {history.map((t) => (
              <tr key={t.id}>
                <td className={t.side === 'buy' ? 'side-buy' : 'side-sell'}>
                  {t.side === 'buy' ? 'MUA' : 'BÁN'}
                </td>
                <td>{t.lot.toFixed(2)}</td>
                <td>{t.openPrice.toFixed(2)}</td>
                <td>{t.closePrice.toFixed(2)}</td>
                <td className="small">{REASON_LABEL[t.reason]}</td>
                <td className={t.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                  {t.pnl >= 0 ? '+' : ''}
                  {t.pnl.toFixed(2)}
                </td>
              </tr>
            ))}
            {!history.length && (
              <tr>
                <td colSpan={6} className="empty">
                  Chưa có giao dịch nào
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
