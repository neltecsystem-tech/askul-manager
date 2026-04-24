import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { DayTypeDef, SpecialDate } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, colors, input, table, td, th } from '../../lib/ui';

interface Editing {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD (範囲登録用)
  day_type_code: string;
  note: string;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function* dateRange(from: string, to: string): Generator<string> {
  const start = new Date(from);
  const end = new Date(to);
  const cur = new Date(start);
  while (cur <= end) {
    yield `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    cur.setDate(cur.getDate() + 1);
  }
}

export default function SpecialDatesPage() {
  const [rows, setRows] = useState<SpecialDate[]>([]);
  const [dayTypes, setDayTypes] = useState<DayTypeDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('');

  const load = async () => {
    setLoading(true);
    const [dtRes, spRes] = await Promise.all([
      supabase.from('day_types').select('*').order('sort_order').order('code'),
      supabase.from('special_dates').select('*').order('date', { ascending: false }),
    ]);
    if (dtRes.error) setError(dtRes.error.message);
    else setDayTypes((dtRes.data ?? []) as DayTypeDef[]);
    if (spRes.error) setError(spRes.error.message);
    else setRows((spRes.data ?? []) as SpecialDate[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const customDayTypes = useMemo(
    () => dayTypes.filter((d) => !d.is_system),
    [dayTypes],
  );

  const dayTypeLabel = (code: string) =>
    dayTypes.find((d) => d.code === code)?.label ?? code;

  const filteredRows = useMemo(
    () => (filterType ? rows.filter((r) => r.day_type_code === filterType) : rows),
    [rows, filterType],
  );

  const save = async () => {
    if (!editing) return;
    setError(null);
    if (!editing.day_type_code) {
      setError('区分を選択してください');
      return;
    }
    if (!editing.dateFrom) {
      setError('日付を入力してください');
      return;
    }
    const from = editing.dateFrom;
    const to = editing.dateTo || editing.dateFrom;
    if (from > to) {
      setError('終了日が開始日より前になっています');
      return;
    }
    setSaving(true);
    const payload: SpecialDate[] = [];
    for (const d of dateRange(from, to)) {
      payload.push({
        date: d,
        day_type_code: editing.day_type_code,
        note: editing.note.trim() || null,
        created_at: '', // ignored by DB default
      });
    }
    const { error } = await supabase
      .from('special_dates')
      .upsert(
        payload.map(({ date, day_type_code, note }) => ({ date, day_type_code, note })),
        { onConflict: 'date' },
      );
    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditing(null);
    await load();
  };

  const del = async (row: SpecialDate) => {
    if (!confirm(`${row.date} (${dayTypeLabel(row.day_type_code)}) を削除しますか?`)) return;
    setError(null);
    const { error } = await supabase.from('special_dates').delete().eq('date', row.date);
    if (error) setError(error.message);
    await load();
  };

  const openNew = () => {
    const t = today();
    setEditing({
      dateFrom: t,
      dateTo: '',
      day_type_code: customDayTypes[0]?.code ?? '',
      note: '',
    });
  };

  return (
    <div>
      <PageHeader
        title="特別日マスタ"
        actions={
          <button style={btnPrimary} onClick={openNew} disabled={customDayTypes.length === 0}>
            新規追加
          </button>
        }
      />

      <div style={{ ...card, marginBottom: 12, fontSize: 12, color: colors.textMuted }}>
        GW・年末年始など特定の日付を 曜日区分マスタ で作ったカスタム区分に紐付けます。日付範囲 (開始〜終了) で一括登録可能。
        シフト上の優先順位: <strong>特別日 &gt; 祝日 &gt; 土/日 &gt; 平日</strong>
      </div>

      {customDayTypes.length === 0 && (
        <div style={{ color: colors.textMuted, marginBottom: 12, fontSize: 12 }}>
          まず「曜日区分マスタ」で GW や 年末年始 などのカスタム区分を追加してください。
        </div>
      )}

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <div style={{ ...card, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={lbl}>
          区分フィルタ
          <select
            style={input}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">すべて</option>
            {dayTypes.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 12, color: colors.textMuted, marginLeft: 'auto' }}>
          {filteredRows.length} 件
        </div>
      </div>

      <div style={card}>
        {loading ? (
          <div style={{ color: colors.textMuted }}>読み込み中...</div>
        ) : filteredRows.length === 0 ? (
          <div style={{ color: colors.textMuted }}>登録されていません。</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>日付</th>
                <th style={th}>曜日区分</th>
                <th style={th}>メモ</th>
                <th style={{ ...th, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.date}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.date}</td>
                  <td style={td}>{dayTypeLabel(r.day_type_code)}</td>
                  <td style={td}>{r.note ?? ''}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button style={btnDanger} onClick={() => del(r)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div style={modal.overlay}>
          <div style={modal.modal}>
            <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>特別日 新規追加</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={lbl}>
                曜日区分
                <select
                  style={input}
                  value={editing.day_type_code}
                  onChange={(e) => setEditing({ ...editing, day_type_code: e.target.value })}
                >
                  {dayTypes.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ ...lbl, flex: 1 }}>
                  開始日
                  <input
                    type="date"
                    style={input}
                    value={editing.dateFrom}
                    onChange={(e) => setEditing({ ...editing, dateFrom: e.target.value })}
                  />
                </label>
                <label style={{ ...lbl, flex: 1 }}>
                  終了日 (省略可)
                  <input
                    type="date"
                    style={input}
                    value={editing.dateTo}
                    onChange={(e) => setEditing({ ...editing, dateTo: e.target.value })}
                  />
                </label>
              </div>
              <label style={lbl}>
                メモ
                <input
                  style={input}
                  value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                  placeholder="例: ゴールデンウィーク"
                />
              </label>
              <div style={{ fontSize: 11, color: colors.textMuted }}>
                既存の日付に同じ操作をすると上書きされます。
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button style={btn} onClick={() => setEditing(null)} disabled={saving}>
                キャンセル
              </button>
              <button style={btnPrimary} onClick={save} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
const modal = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modal: { background: '#fff', borderRadius: 6, padding: 20, width: 460, maxWidth: '90vw' },
};
