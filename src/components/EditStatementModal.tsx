import { useMemo, useState, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import { btn, btnPrimary, colors, input } from '../lib/ui';
import type {
  ClosedPaymentStatement,
  ClosedPaymentStatementDailyRow,
} from '../types/db';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  statement: ClosedPaymentStatement;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditStatementModal({ statement, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<ClosedPaymentStatementDailyRow[]>(
    statement.daily_rows.map((r) => ({ ...r })),
  );
  const [deductionRate, setDeductionRate] = useState<number>(statement.deduction_rate);
  const [deductionAmount, setDeductionAmount] = useState<number>(statement.deduction_amount);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const kodate = rows.reduce((s, r) => s + (Number(r.kodate) || 0), 0);
    const vehicle = rows.reduce((s, r) => s + (Number(r.vehicle) || 0), 0);
    const count = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
    const revenue = kodate + vehicle;
    const payment = revenue - (Number(deductionAmount) || 0);
    return { kodate, vehicle, count, revenue, payment };
  }, [rows, deductionAmount]);

  const updateRow = (idx: number, key: keyof ClosedPaymentStatementDailyRow, value: number) => {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      // subtotal も再計算
      next[idx].subtotal = (Number(next[idx].kodate) || 0) + (Number(next[idx].vehicle) || 0);
      return next;
    });
  };

  const recalcDeduction = () => {
    // 個建合計 × 控除率 % で計算
    const calc = Math.round((totals.kodate * (Number(deductionRate) || 0)) / 100);
    setDeductionAmount(calc);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('closed_payment_statements')
        .update({
          daily_rows: rows,
          kodate_total: totals.kodate,
          vehicle_total: totals.vehicle,
          revenue: totals.revenue,
          deduction_rate: Number(deductionRate) || 0,
          deduction_amount: Number(deductionAmount) || 0,
          payment_amount: totals.payment,
          modified_at: new Date().toISOString(),
          modified_by: user?.id ?? null,
        })
        .eq('id', statement.id);
      if (error) throw error;
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.toolbar}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              支払明細書 編集 - {statement.driver_snapshot?.full_name ?? '(不明)'}
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
              {statement.year}年{statement.month}月度
            </div>
          </div>
          <button style={btnPrimary} onClick={save} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          <button style={btn} onClick={onClose} disabled={saving}>
            キャンセル
          </button>
        </div>

        {error && (
          <div style={{ color: colors.danger, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
            {error}
          </div>
        )}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>日付</th>
                <th style={styles.th}>曜</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>個建金額</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>車建金額</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>個数</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>小計</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isHoliday = r.day_of_week === 0 || r.day_of_week === 6;
                const d = new Date(r.date);
                return (
                  <tr key={i} style={isHoliday ? { background: '#fde8e8' } : undefined}>
                    <td style={styles.td}>
                      {d.getMonth() + 1}/{d.getDate()}
                    </td>
                    <td style={styles.td}>{DOW_LABELS[r.day_of_week]}</td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        style={styles.numInput}
                        value={r.kodate}
                        onChange={(e) => updateRow(i, 'kodate', Number(e.target.value))}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        style={styles.numInput}
                        value={r.vehicle}
                        onChange={(e) => updateRow(i, 'vehicle', Number(e.target.value))}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        style={styles.numInput}
                        value={r.count}
                        onChange={(e) => updateRow(i, 'count', Number(e.target.value))}
                      />
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', color: colors.textMuted }}>
                      {(r.subtotal || 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
                <td style={styles.td} colSpan={2}>
                  合計
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  {totals.kodate.toLocaleString()}
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  {totals.vehicle.toLocaleString()}
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  {totals.count.toLocaleString()}
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  {totals.revenue.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={styles.calcBox}>
          <div style={styles.calcTitle}>支払額計算</div>
          <div style={styles.calcGrid}>
            <span>総売上(税抜)</span>
            <span style={{ textAlign: 'right' }}>¥{totals.revenue.toLocaleString()}</span>

            <span>控除率 (%)</span>
            <span style={{ textAlign: 'right' }}>
              <input
                type="number"
                step="0.01"
                style={{ ...input, width: 100, textAlign: 'right' }}
                value={deductionRate}
                onChange={(e) => setDeductionRate(Number(e.target.value))}
              />
              <button
                style={{ ...btn, marginLeft: 8 }}
                onClick={recalcDeduction}
                title="個建合計 × 控除率 で控除額を再計算"
              >
                控除額を再計算
              </button>
            </span>

            <span>控除額</span>
            <span style={{ textAlign: 'right' }}>
              <input
                type="number"
                style={{ ...input, width: 140, textAlign: 'right', color: '#b45309' }}
                value={deductionAmount}
                onChange={(e) => setDeductionAmount(Number(e.target.value))}
              />
            </span>

            <div style={styles.divider} />

            <span style={{ fontWeight: 700, fontSize: 15 }}>お支払い額</span>
            <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>
              ¥{totals.payment.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 9999,
    overflowY: 'auto',
    padding: 24,
  },
  modal: {
    background: '#fff',
    maxWidth: 900,
    margin: '0 auto',
    borderRadius: 6,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    padding: 20,
  },
  toolbar: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: '1px solid ' + colors.borderLight,
  },
  tableWrap: {
    maxHeight: 400,
    overflowY: 'auto',
    border: '1px solid ' + colors.borderLight,
    borderRadius: 4,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  th: {
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: '2px solid ' + colors.border,
    background: '#f9fafb',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
  },
  td: {
    padding: '4px 8px',
    borderBottom: '1px solid ' + colors.borderLight,
  },
  numInput: {
    width: 100,
    padding: '4px 6px',
    border: '1px solid ' + colors.border,
    borderRadius: 3,
    fontSize: 12,
    textAlign: 'right',
    background: '#fff',
    color: colors.text,
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
    gap: '8px 24px',
    maxWidth: 520,
    alignItems: 'center',
  },
  divider: {
    gridColumn: '1 / -1',
    borderTop: '1px solid #d1d5db',
    margin: '4px 0',
  },
};
