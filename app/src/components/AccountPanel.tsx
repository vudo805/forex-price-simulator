import { useState } from 'react'
import type { Leverage } from '../hooks/useTradingAccount'

type Props = {
  balance: number
  equity: number
  usedMargin: number
  freeMargin: number
  marginLevel: number | null
  floatingPnl: number
  leverage: Leverage
  onLeverageChange: (l: Leverage) => void
  onReset: (balance: number) => void
}

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function AccountPanel({
  balance,
  equity,
  usedMargin,
  freeMargin,
  marginLevel,
  floatingPnl,
  leverage,
  onLeverageChange,
  onReset,
}: Props) {
  const [customBalance, setCustomBalance] = useState('')

  const applyCustomBalance = () => {
    const n = Number(customBalance)
    if (Number.isFinite(n) && n > 0) {
      onReset(n)
      setCustomBalance('')
    }
  }

  return (
    <div className="panel account-panel">
      <div className="panel-title">Tài khoản Demo</div>

      <div className="account-row">
        <span>Số dư</span>
        <b>${money(balance)}</b>
      </div>
      <div className="account-row">
        <span>Vốn chủ sở hữu</span>
        <b>${money(equity)}</b>
      </div>
      <div className="account-row">
        <span>Lãi/lỗ nổi</span>
        <b className={floatingPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
          {floatingPnl >= 0 ? '+' : ''}
          {money(floatingPnl)}
        </b>
      </div>
      <div className="account-row">
        <span>Ký quỹ đã dùng</span>
        <b>${money(usedMargin)}</b>
      </div>
      <div className="account-row">
        <span>Ký quỹ khả dụng</span>
        <b>${money(freeMargin)}</b>
      </div>
      <div className="account-row">
        <span>Mức ký quỹ</span>
        <b>{marginLevel != null ? `${marginLevel.toFixed(0)}%` : '—'}</b>
      </div>

      <div className="account-row leverage-row">
        <span>Đòn bẩy</span>
        <div className="leverage-buttons">
          <button
            className={`chip ${leverage === 500 ? 'chip-active' : ''}`}
            onClick={() => onLeverageChange(500)}
          >
            1:500
          </button>
          <button
            className={`chip ${leverage === 1000 ? 'chip-active' : ''}`}
            onClick={() => onLeverageChange(1000)}
          >
            1:1000
          </button>
        </div>
      </div>

      <div className="reset-row">
        <button className="btn btn-secondary btn-small" onClick={() => onReset(10000)}>
          Reset $10,000
        </button>
        <button className="btn btn-secondary btn-small" onClick={() => onReset(100000)}>
          Reset $100,000
        </button>
      </div>

      <div className="custom-balance-row">
        <input
          className="custom-balance-input"
          type="number"
          min={1}
          placeholder="Nhập số dư..."
          value={customBalance}
          onChange={(e) => setCustomBalance(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyCustomBalance()}
        />
        <button className="btn btn-secondary btn-small" onClick={applyCustomBalance}>
          Đặt
        </button>
      </div>
    </div>
  )
}
