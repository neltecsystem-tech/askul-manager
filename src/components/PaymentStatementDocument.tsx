import { forwardRef, type CSSProperties } from 'react';
import { colors, table } from '../lib/ui';
import type { ClosedPaymentStatement } from '../types/db';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  statement: ClosedPaymentStatement;
}

const PaymentStatementDocument = forwardRef<HTMLDivElement, Props>(
  ({ statement }, ref) => {
    const reiwaYear = statement.year - 2018;
    const officeName = statement.driver_snapshot?.office_name ?? '';
    const driverName = statement.driver_snapshot?.full_name ?? '';
    const daily = statement.daily_rows ?? [];

    const totalKodate = daily.reduce((s, r) => s + (r.kodate || 0), 0);
    const totalVehicle = daily.reduce((s, r) => s + (r.vehicle || 0), 0);
    const totalQty = daily.reduce((s, r) => s + (r.count || 0), 0);
    const grossRevenue = totalKodate + totalVehicle;
    const deductionRate = statement.deduction_rate;
    const deduction = statement.deduction_amount;
    const payment = statement.payment_amount;

    return (
      <div ref={ref} style={styles.doc}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>
              令和{reiwaYear}年 {statement.month}月度 支払い明細
            </div>
            {statement.modified_at && (
              <div style={styles.modifiedNote}>
                ※ 修正反映: {new Date(statement.modified_at).toLocaleString('ja-JP')}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13 }}>{officeName}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
              {driverName} 様
            </div>
          </div>
        </div>

        <table style={{ ...table, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={tableHeader}>日付</th>
              <th style={tableHeader}>曜日</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>個建金額</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>車建金額</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>個数</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>売上(税抜)</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((r, i) => {
              const isHoliday = r.day_of_week === 0 || r.day_of_week === 6;
              const hasData = (r.kodate || 0) > 0 || (r.vehicle || 0) > 0;
              const d = new Date(r.date);
              return (
                <tr key={i} style={isHoliday ? { background: '#fde8e8' } : undefined}>
                  <td style={tableCell}>
                    {d.getMonth() + 1}月{d.getDate()}日
                  </td>
                  <td style={tableCell}>{DOW_LABELS[r.day_of_week]}</td>
                  <td style={{ ...tableCell, textAlign: 'right' }}>
                    {(r.kodate || 0).toLocaleString()}
                  </td>
                  <td style={{ ...tableCell, textAlign: 'right' }}>
                    {(r.vehicle || 0).toLocaleString()}
                  </td>
                  <td style={{ ...tableCell, textAlign: 'right' }}>
                    {(r.count || 0).toLocaleString()}
                  </td>
                  <td
                    style={{
                      ...tableCell,
                      textAlign: 'right',
                      fontWeight: hasData ? 600 : 400,
                    }}
                  >
                    {(r.subtotal || 0).toLocaleString()}
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
              <td style={tableCell} colSpan={2}>
                合計
              </td>
              <td style={{ ...tableCell, textAlign: 'right' }}>
                {totalKodate.toLocaleString()}
              </td>
              <td style={{ ...tableCell, textAlign: 'right' }}>
                {totalVehicle.toLocaleString()}
              </td>
              <td style={{ ...tableCell, textAlign: 'right' }}>
                {totalQty.toLocaleString()}
              </td>
              <td style={{ ...tableCell, textAlign: 'right' }}>
                {grossRevenue.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={styles.calcBox}>
          <div style={styles.calcTitle}>お支払い額計算</div>
          <div style={styles.calcGrid}>
            <span>個建 合計</span>
            <span style={{ textAlign: 'right' }}>¥{totalKodate.toLocaleString()}</span>
            <span>車建 合計 (控除対象外)</span>
            <span style={{ textAlign: 'right' }}>¥{totalVehicle.toLocaleString()}</span>
            <span>総売上(税抜)</span>
            <span style={{ textAlign: 'right' }}>¥{grossRevenue.toLocaleString()}</span>
            <span>控除率 (個建のみ適用)</span>
            <span style={{ textAlign: 'right' }}>{deductionRate}%</span>
            <span>控除額</span>
            <span style={{ textAlign: 'right', color: '#b45309' }}>
              -¥{deduction.toLocaleString()}
            </span>
            <div style={styles.calcDivider} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>お支払い額</span>
            <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>
              ¥{payment.toLocaleString()}
            </span>
          </div>
        </div>

        <div style={styles.footer}>
          確定: {new Date(statement.finalized_at).toLocaleString('ja-JP')}
        </div>
      </div>
    );
  },
);

PaymentStatementDocument.displayName = 'PaymentStatementDocument';
export default PaymentStatementDocument;

const tableHeader: CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '2px solid ' + colors.border,
  background: '#f9fafb',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tableCell: CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid ' + colors.borderLight,
};

const styles: Record<string, CSSProperties> = {
  doc: {
    background: '#fff',
    padding: 24,
    color: colors.text,
    fontFamily: '"Hiragino Sans", "Meiryo", sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
  },
  modifiedNote: {
    fontSize: 11,
    color: '#b45309',
    marginTop: 4,
  },
  calcBox: {
    marginTop: 20,
    padding: 16,
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    fontSize: 13,
  },
  calcTitle: {
    fontWeight: 600,
    marginBottom: 12,
    fontSize: 14,
  },
  calcGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '6px 24px',
    maxWidth: 440,
  },
  calcDivider: {
    gridColumn: '1 / -1',
    borderTop: '1px solid #d1d5db',
    margin: '4px 0',
  },
  footer: {
    marginTop: 24,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'right',
  },
};
