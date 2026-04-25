import { forwardRef, type CSSProperties } from 'react';
import { colors, table } from '../lib/ui';
import type { ClosedPaymentStatement } from '../types/db';

interface Props {
  statements: ClosedPaymentStatement[];
  year: number;
  month: number;
  companyName?: string;
}

const SummaryStatementDocument = forwardRef<HTMLDivElement, Props>(
  ({ statements, year, month, companyName }, ref) => {
    const reiwaYear = year - 2018;
    const sorted = [...statements].sort((a, b) =>
      (a.driver_snapshot?.full_name ?? '').localeCompare(
        b.driver_snapshot?.full_name ?? '',
      ),
    );
    const totals = sorted.reduce(
      (acc, s) => ({
        kodate: acc.kodate + s.kodate_total,
        vehicle: acc.vehicle + s.vehicle_total,
        revenue: acc.revenue + s.revenue,
        deduction: acc.deduction + s.deduction_amount,
        payment: acc.payment + s.payment_amount,
      }),
      { kodate: 0, vehicle: 0, revenue: 0, deduction: 0, payment: 0 },
    );

    return (
      <div ref={ref} style={styles.doc}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>
              令和{reiwaYear}年 {month}月度 支払明細サマリー
            </div>
            <div style={styles.subtitle}>所属メンバー支払い一覧</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {companyName && (
              <div style={{ fontSize: 14, fontWeight: 600 }}>{companyName}</div>
            )}
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
              出力: {new Date().toLocaleString('ja-JP')}
            </div>
          </div>
        </div>

        <table style={{ ...table, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={tableHeader}>#</th>
              <th style={tableHeader}>ドライバー</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>個建合計</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>車建合計</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>売上(税抜)</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>控除率</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>控除額</th>
              <th style={{ ...tableHeader, textAlign: 'right' }}>支払額</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.id}>
                <td style={tableCell}>{i + 1}</td>
                <td style={tableCell}>{s.driver_snapshot?.full_name ?? '(不明)'}</td>
                <td style={{ ...tableCell, textAlign: 'right' }}>
                  {s.kodate_total.toLocaleString()}
                </td>
                <td style={{ ...tableCell, textAlign: 'right' }}>
                  {s.vehicle_total.toLocaleString()}
                </td>
                <td style={{ ...tableCell, textAlign: 'right' }}>
                  {s.revenue.toLocaleString()}
                </td>
                <td style={{ ...tableCell, textAlign: 'right' }}>
                  {s.deduction_rate}%
                </td>
                <td style={{ ...tableCell, textAlign: 'right', color: '#b45309' }}>
                  -{s.deduction_amount.toLocaleString()}
                </td>
                <td style={{ ...tableCell, textAlign: 'right', fontWeight: 600 }}>
                  {s.payment_amount.toLocaleString()}
                </td>
              </tr>
            ))}
            <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
              <td style={tableCell} colSpan={2}>
                合計 ({sorted.length}名)
              </td>
              <td style={{ ...tableCell, textAlign: 'right' }}>
                {totals.kodate.toLocaleString()}
              </td>
              <td style={{ ...tableCell, textAlign: 'right' }}>
                {totals.vehicle.toLocaleString()}
              </td>
              <td style={{ ...tableCell, textAlign: 'right' }}>
                {totals.revenue.toLocaleString()}
              </td>
              <td style={tableCell}></td>
              <td style={{ ...tableCell, textAlign: 'right', color: '#b45309' }}>
                -{totals.deduction.toLocaleString()}
              </td>
              <td style={{ ...tableCell, textAlign: 'right', fontSize: 14 }}>
                ¥{totals.payment.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={styles.note}>
          ※ 金額は確定時点のスナップショットです。再確定された場合は最新値が表示されます。
        </div>
      </div>
    );
  },
);

SummaryStatementDocument.displayName = 'SummaryStatementDocument';
export default SummaryStatementDocument;

const tableHeader: CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '2px solid ' + colors.border,
  background: '#f9fafb',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tableCell: CSSProperties = {
  padding: '6px 8px',
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
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  note: {
    marginTop: 16,
    fontSize: 11,
    color: colors.textMuted,
  },
};
