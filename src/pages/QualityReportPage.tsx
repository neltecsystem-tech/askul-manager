import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { parseQualitySheet, type QualityData } from '../lib/quality';
import PageHeader from '../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, colors, table, td, th } from '../lib/ui';

interface QualityReport {
  id: string;
  title: string;
  source_name: string | null;
  data: QualityData;
  created_at: string;
}

const TARGET_SHEET = '品質実績';

function fmtRate(n: number | null): string {
  return n == null ? '—' : n.toFixed(1);
}
function fmtInt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('ja-JP');
}

export default function QualityReportPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const fileRef = useRef<HTMLInputElement>(null);

  const [reports, setReports] = useState<QualityReport[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ data: QualityData; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('quality_reports')
      .select('*')
      .order('created_at', { ascending: false });
    const list = (data ?? []) as QualityReport[];
    setReports(list);
    setSelectedId((prev) => prev || (list[0]?.id ?? ''));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const current = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  const handleFile = async (file: File) => {
    setError(null);
    setPending(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      const name = wb.SheetNames.includes(TARGET_SHEET) ? TARGET_SHEET : '';
      if (!name) {
        setError(`「${TARGET_SHEET}」シートが見つかりませんでした。シート: ${wb.SheetNames.join(', ')}`);
        return;
      }
      const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
        header: 1,
        raw: true,
        blankrows: false,
      });
      const parsed = parseQualitySheet(grid);
      if (!parsed) {
        setError('品質実績シートの構成を解析できませんでした（「不良配送」見出しが必要）。');
        return;
      }
      setPending({ data: parsed, name: file.name });
    } catch (e) {
      setError(`解析に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const save = async () => {
    if (!pending || !profile) return;
    setSaving(true);
    setError(null);
    const title = pending.name.replace(/\.[^.]+$/, '');
    const { error: insErr } = await supabase.from('quality_reports').insert({
      title,
      source_name: pending.name,
      data: pending.data,
      created_by: profile.id,
    });
    setSaving(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setPending(null);
    await load();
  };

  const del = async () => {
    if (!current || !isAdmin) return;
    if (!confirm(`「${current.title}」を削除しますか?`)) return;
    const { error: delErr } = await supabase.from('quality_reports').delete().eq('id', current.id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setSelectedId('');
    await load();
  };

  const view = pending?.data ?? current?.data ?? null;

  return (
    <div>
      <PageHeader
        title="品質実績"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {reports.length > 0 && !pending && (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{ ...selectStyle }}
              >
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            )}
            {isAdmin && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = '';
                  }}
                />
                <button style={btn} onClick={() => fileRef.current?.click()}>
                  Excel取込
                </button>
              </>
            )}
          </div>
        }
      />

      {error && (
        <div style={{ color: colors.danger, marginBottom: 12, whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {error}
        </div>
      )}

      {pending && (
        <div
          style={{
            ...card,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
          }}
        >
          <div style={{ fontSize: 13 }}>
            <strong>{pending.name}</strong> を読み込みました（プレビュー表示中）。保存しますか？
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} onClick={() => setPending(null)} disabled={saving}>
              キャンセル
            </button>
            <button style={btnPrimary} onClick={save} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ ...card, color: colors.textMuted }}>読み込み中...</div>
      ) : !view ? (
        <div style={{ ...card, color: colors.textMuted }}>
          品質実績データがありません。{isAdmin ? '右上の「Excel取込」から品質実績Excelを取り込んでください。' : ''}
        </div>
      ) : (
        <QualityView data={view} />
      )}

      {current && !pending && isAdmin && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button style={btnDanger} onClick={del}>
            この実績を削除
          </button>
        </div>
      )}
    </div>
  );
}

function QualityView({ data }: { data: QualityData }) {
  const lastIdx = data.months.length - 1;
  const all = data.rateAll;
  const latestRate = all?.values[lastIdx] ?? null;
  const target = all?.target ?? null;
  const overTarget = latestRate != null && target != null && latestRate > target;

  // ALL 不良率 月別グラフ
  const rateVals = all?.values ?? [];
  const maxRate = Math.max(1, ...rateVals.map((v) => v ?? 0), target ?? 0);

  // 合計件数 月別グラフ
  const countVals = data.countTotal?.values ?? [];
  const maxCount = Math.max(1, ...countVals.map((v) => v ?? 0));

  return (
    <>
      {/* ヘッドライン */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Kpi
          label={`不良率 (${data.months[lastIdx] ?? '最新'} ALL)`}
          value={fmtRate(latestRate)}
          unit="PPM"
          color={overTarget ? colors.danger : colors.success}
        />
        <Kpi label="目標値" value={fmtRate(target)} unit="PPM" color={colors.text} />
        <Kpi label="通期 不良率 (ALL)" value={fmtRate(all?.total ?? null)} unit="PPM" color={colors.text} />
        <Kpi
          label={`不良配送 件数 (${data.months[lastIdx] ?? '最新'})`}
          value={fmtInt(data.countTotal?.values[lastIdx] ?? null)}
          unit="件"
          color={colors.text}
        />
        <Kpi label="通期 不良件数" value={fmtInt(data.countTotal?.total ?? null)} unit="件" color={colors.text} />
      </div>

      {/* 不良率 月別推移（目標ライン付き） */}
      <div style={{ ...card, marginBottom: 16 }}>
        <h3 style={chartTitle}>
          不良率 (ALL) 月別推移{' '}
          {target != null && <span style={{ fontSize: 12, color: colors.textMuted }}>（赤破線=目標 {fmtRate(target)} PPM）</span>}
        </h3>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 6, height: 180, paddingTop: 16, overflowX: 'auto' }}>
          {/* 目標ライン */}
          {target != null && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: `${(target / maxRate) * 140 + 24}px`,
                borderTop: '2px dashed #dc2626',
                zIndex: 1,
                pointerEvents: 'none',
              }}
            />
          )}
          {data.months.map((m, i) => {
            const v = rateVals[i] ?? null;
            const over = v != null && target != null && v > target;
            return (
              <div key={m} style={{ flex: '1 0 36px', minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 2 }}>{v == null ? '' : v.toFixed(0)}</div>
                <div
                  title={`${m}: ${fmtRate(v)} PPM`}
                  style={{
                    width: '70%',
                    height: `${((v ?? 0) / maxRate) * 140}px`,
                    minHeight: v ? 2 : 0,
                    background: over ? colors.danger : colors.primary,
                    borderRadius: '3px 3px 0 0',
                  }}
                />
                <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 4, whiteSpace: 'nowrap' }}>
                  {m.replace('月度', '月')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 月別 不良件数 */}
      <div style={{ ...card, marginBottom: 16 }}>
        <h3 style={chartTitle}>月別 不良配送件数（合計）</h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150, paddingTop: 14, overflowX: 'auto' }}>
          {data.months.map((m, i) => {
            const v = countVals[i] ?? 0;
            return (
              <div key={m} style={{ flex: '1 0 36px', minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{v}</div>
                <div
                  style={{
                    width: '70%',
                    height: `${(v / maxCount) * 110}px`,
                    minHeight: v ? 2 : 0,
                    background: '#ea580c',
                    borderRadius: '3px 3px 0 0',
                  }}
                />
                <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 4, whiteSpace: 'nowrap' }}>
                  {m.replace('月度', '月')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 区分別 件数マトリクス */}
      <div style={{ ...card, marginBottom: 16, overflowX: 'auto' }}>
        <h3 style={chartTitle}>不良配送件数（区分 × 月）</h3>
        <MatrixTable
          months={data.months}
          rows={data.counts}
          totalRow={data.countTotal}
          fmt={(v) => (v == null ? '' : String(v))}
          tsujiLabel="通期"
        />
      </div>

      {/* 区分別 不良率（通期）vs 目標 */}
      {(data.rates.length > 0 || data.rateAll) && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <h3 style={chartTitle}>不良率 実績値（PPM）</h3>
          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, position: 'sticky', left: 0, background: '#f9fafb' }}>区分</th>
                {data.months.map((m) => (
                  <th key={m} style={{ ...th, textAlign: 'right' }}>{m.replace('月度', '月')}</th>
                ))}
                <th style={{ ...th, textAlign: 'right' }}>通期</th>
                <th style={{ ...th, textAlign: 'right', color: colors.primary }}>目標</th>
                <th style={{ ...th, textAlign: 'right' }}>17期</th>
              </tr>
            </thead>
            <tbody>
              {[...data.rates, ...(data.rateAll ? [data.rateAll] : [])].map((r) => {
                const isAll = r.name === 'ALL';
                const over = r.total != null && r.target != null && r.total > r.target;
                return (
                  <tr key={r.name} style={isAll ? { fontWeight: 700, background: '#f8fafc' } : undefined}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: isAll ? '#f8fafc' : '#fff' }}>{r.name}</td>
                    {r.values.map((v, i) => (
                      <td key={i} style={{ ...td, textAlign: 'right' }}>{fmtRate(v)}</td>
                    ))}
                    <td style={{ ...td, textAlign: 'right', color: over ? colors.danger : undefined }}>{fmtRate(r.total)}</td>
                    <td style={{ ...td, textAlign: 'right', color: colors.primary }}>{fmtRate(r.target)}</td>
                    <td style={{ ...td, textAlign: 'right', color: colors.textMuted }}>{fmtRate(r.prevFy)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
            ※ PPM(百万分率) = 不良件数 ÷ 配完個数 × 1,000,000。通期が目標超過は赤字。
          </div>
        </div>
      )}
    </>
  );
}

function MatrixTable({
  months,
  rows,
  totalRow,
  fmt,
  tsujiLabel,
}: {
  months: string[];
  rows: { name: string; values: (number | null)[]; total: number | null }[];
  totalRow: { name: string; values: (number | null)[]; total: number | null } | null;
  fmt: (v: number | null) => string;
  tsujiLabel: string;
}) {
  return (
    <table style={table}>
      <thead>
        <tr>
          <th style={{ ...th, position: 'sticky', left: 0, background: '#f9fafb' }}>区分</th>
          {months.map((m) => (
            <th key={m} style={{ ...th, textAlign: 'right' }}>{m.replace('月度', '月')}</th>
          ))}
          <th style={{ ...th, textAlign: 'right' }}>{tsujiLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td style={{ ...td, position: 'sticky', left: 0, background: '#fff' }}>{r.name}</td>
            {r.values.map((v, i) => (
              <td key={i} style={{ ...td, textAlign: 'right', color: v ? undefined : colors.borderLight }}>
                {v ? fmt(v) : '0'}
              </td>
            ))}
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(r.total)}</td>
          </tr>
        ))}
        {totalRow && (
          <tr style={{ fontWeight: 700, background: '#f8fafc' }}>
            <td style={{ ...td, position: 'sticky', left: 0, background: '#f8fafc' }}>{totalRow.name}</td>
            {totalRow.values.map((v, i) => (
              <td key={i} style={{ ...td, textAlign: 'right' }}>{v ? fmt(v) : '0'}</td>
            ))}
            <td style={{ ...td, textAlign: 'right' }}>{fmt(totalRow.total)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Kpi({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ ...card, flex: '1 1 150px', minWidth: 130, padding: 14, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 12, color: colors.textMuted }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>
        {value}
        <span style={{ fontSize: 13, fontWeight: 400, color: colors.textMuted, marginLeft: 3 }}>{unit}</span>
      </div>
    </div>
  );
}

const chartTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  margin: '0 0 12px',
  color: colors.text,
};

const selectStyle: CSSProperties = {
  padding: '6px 10px',
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  fontSize: 13,
  background: '#fff',
  maxWidth: 220,
};
