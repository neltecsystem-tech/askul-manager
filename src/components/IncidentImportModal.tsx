import { useMemo, useRef, useState, type CSSProperties } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import type { Incident, Profile } from '../types/db';
import { btn, btnPrimary, colors, input, table, td, th } from '../lib/ui';

interface ParsedRow {
  occurred_at: string; // YYYY-MM-DD
  category: string;
  content: string;
  countermeasure: string;
  driverNameRaw: string;
  target_driver_id: string; // '' = 未照合
  include: boolean;
  duplicate: boolean;
}

interface Props {
  drivers: Profile[];
  existing: Incident[];
  adminId: string;
  onClose: () => void;
  onComplete: () => void;
}

const TARGET_SHEET = '不良配送';

function normalize(s: string): string {
  return (s ?? '').replace(/[\s　]/g, '').trim();
}

function toYmd(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(
      v.getDate(),
    ).padStart(2, '0')}`;
  }
  if (typeof v === 'number') {
    // Excel シリアル値
    const parsed = XLSX.SSF?.parse_date_code(v);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
    return '';
  }
  const s = String(v).trim();
  // 2026/2/19 や 2026-2-19 形式
  const m = s.match(/(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  return '';
}

// 苗字(Dr氏名)からドライバーを照合。完全一致 > 前方一致 > 部分一致 の順で1件に絞れたら採用
function matchDriver(raw: string, drivers: Profile[]): string {
  const r = normalize(raw);
  if (!r) return '';
  const exact = drivers.filter((d) => normalize(d.full_name) === r);
  if (exact.length === 1) return exact[0].id;
  const prefix = drivers.filter((d) => normalize(d.full_name).startsWith(r));
  if (prefix.length === 1) return prefix[0].id;
  const includes = drivers.filter((d) => normalize(d.full_name).includes(r));
  if (includes.length === 1) return includes[0].id;
  return '';
}

export default function IncidentImportModal({
  drivers,
  existing,
  adminId,
  onClose,
  onComplete,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 既存データの重複判定キー
  const existingKeys = useMemo(() => {
    const set = new Set<string>();
    for (const e of existing) {
      set.add(`${e.occurred_at}|${e.target_driver_id ?? ''}|${normalize(e.content).slice(0, 30)}`);
    }
    return set;
  }, [existing]);

  const handleFile = async (file: File) => {
    setParseError(null);
    setRows([]);
    setSaveError(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const name = wb.SheetNames.includes(TARGET_SHEET) ? TARGET_SHEET : wb.SheetNames[0];
      setSheetName(name);
      const ws = wb.Sheets[name];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: true,
        blankrows: false,
      });

      // ヘッダー行 (発生日 を含む行) を探す
      let headerIdx = -1;
      for (let i = 0; i < grid.length; i++) {
        if (grid[i].some((c) => normalize(String(c ?? '')).includes('発生日'))) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) {
        setParseError('「発生日」を含むヘッダー行が見つかりませんでした。シート構成を確認してください。');
        return;
      }
      const header = grid[headerIdx].map((c) => normalize(String(c ?? '')));
      const colOf = (...keys: string[]) =>
        header.findIndex((h) => keys.some((k) => h.includes(k)));

      const cDate = colOf('発生日');
      const cDistrict = colOf('行政区');
      const cWaybill = colOf('送り状');
      const cMajor = colOf('大分類');
      const cMinor = colOf('中分類');
      const cContent = colOf('内容', '原因');
      const cMeasure = colOf('対策');
      const cDriver = colOf('氏名', 'Dr');

      const out: ParsedRow[] = [];
      for (let i = headerIdx + 1; i < grid.length; i++) {
        const row = grid[i];
        const at = (idx: number) => (idx >= 0 ? row[idx] : undefined);
        const occurred_at = toYmd(at(cDate));
        const contentMain = String(at(cContent) ?? '').trim();
        const driverNameRaw = String(at(cDriver) ?? '').trim();
        // 内容も発生日も無い行はスキップ
        if (!occurred_at && !contentMain && !driverNameRaw) continue;

        const major = String(at(cMajor) ?? '').trim();
        const minor = String(at(cMinor) ?? '').trim();
        const category = major && minor && major !== minor ? `${major}/${minor}` : major || minor;

        const district = String(at(cDistrict) ?? '').trim();
        const waybill = String(at(cWaybill) ?? '').trim();
        const extras: string[] = [];
        if (district) extras.push(`行政区: ${district}`);
        if (waybill) extras.push(`送り状: ${waybill}`);
        const content = extras.length ? `${contentMain}\n\n【${extras.join(' / ')}】` : contentMain;

        const target_driver_id = matchDriver(driverNameRaw, drivers);
        const dupKey = `${occurred_at}|${target_driver_id}|${normalize(content).slice(0, 30)}`;
        const duplicate = existingKeys.has(dupKey);

        out.push({
          occurred_at,
          category,
          content,
          countermeasure: String(at(cMeasure) ?? '').trim(),
          driverNameRaw,
          target_driver_id,
          include: !duplicate,
          duplicate,
        });
      }

      if (out.length === 0) {
        setParseError('取り込めるデータ行が見つかりませんでした。');
        return;
      }
      setRows(out);
    } catch (e) {
      setParseError(`ファイルの解析に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const updateRow = (idx: number, patch: Partial<ParsedRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const includedRows = rows.filter((r) => r.include);
  // 内容がある行を取り込む（発生日が不明でも可。不足行は自動スキップ）
  const validRows = includedRows.filter((r) => r.content.trim());
  const skippedCount = includedRows.length - validRows.length;
  const noDateCount = validRows.filter((r) => !r.occurred_at).length;
  const unmatchedCount = validRows.filter((r) => !r.target_driver_id).length;
  const canImport = validRows.length > 0 && !saving;

  const doImport = async () => {
    if (!canImport) return;
    setSaving(true);
    setSaveError(null);
    const nowIso = new Date().toISOString();
    const payload = validRows.map((r) => ({
      occurred_at: r.occurred_at || null,
      target_driver_id: r.target_driver_id || null,
      // 未照合の場合は元の氏名を reporter_name に残す（一覧で表示される）
      reporter_name: r.target_driver_id ? null : r.driverNameRaw.trim() || null,
      category: r.category.trim() || null,
      content: r.content.trim(),
      cause: null,
      countermeasure: r.countermeasure.trim() || null,
      status: 'approved' as const,
      reviewed_by: adminId,
      reviewed_at: nowIso,
      created_by: adminId,
    }));
    const { error } = await supabase.from('incidents').insert(payload);
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    onComplete();
    onClose();
  };

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>不具合データ 一括取込</h2>

        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
          品質実績Excelの「{TARGET_SHEET}」シートを取り込みます。発生日・該当者・内容が揃った行を
          <strong>承認済</strong>として登録します。
        </div>

        <div style={{ marginBottom: 12 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <button style={btn} onClick={() => fileRef.current?.click()}>
            ファイルを選択
          </button>
          {fileName && (
            <span style={{ marginLeft: 10, fontSize: 12 }}>
              {fileName}
              {sheetName && (
                <span style={{ color: colors.textMuted }}>（シート: {sheetName}）</span>
              )}
            </span>
          )}
        </div>

        {parseError && (
          <div style={{ color: colors.danger, fontSize: 12, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
            {parseError}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              読み込み {rows.length} 件 ／ 取込{' '}
              <strong>{validRows.length}</strong> 件
              {skippedCount > 0 && (
                <span style={{ color: colors.danger, marginLeft: 8 }}>
                  ※ 内容が空の {skippedCount} 件は自動スキップ。
                </span>
              )}
              {noDateCount > 0 && (
                <span style={{ color: '#b45309', marginLeft: 8 }}>
                  ※ 発生日不明が {noDateCount} 件（日付なしで記録されます）。
                </span>
              )}
              {unmatchedCount > 0 && (
                <span style={{ color: '#b45309', marginLeft: 8 }}>
                  ※ 該当者が未照合の行が {unmatchedCount} 件（氏名はそのまま記録されます）。
                </span>
              )}
            </div>
            <div style={{ maxHeight: '50vh', overflow: 'auto', border: `1px solid ${colors.borderLight}` }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 40 }}>取込</th>
                    <th style={{ ...th, width: 110 }}>発生日</th>
                    <th style={{ ...th, width: 150 }}>該当者</th>
                    <th style={{ ...th, width: 90 }}>区分</th>
                    <th style={th}>内容</th>
                    <th style={{ ...th, width: 200 }}>対策</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const unmatched = r.include && !r.target_driver_id;
                    const noDate = r.include && !r.occurred_at;
                    return (
                      <tr key={i} style={{ background: r.include ? undefined : '#f3f4f6' }}>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={r.include}
                            onChange={(e) => updateRow(i, { include: e.target.checked })}
                          />
                          {r.duplicate && (
                            <div style={{ fontSize: 9, color: colors.danger }}>重複?</div>
                          )}
                        </td>
                        <td style={td}>
                          <input
                            type="date"
                            value={r.occurred_at}
                            onChange={(e) => updateRow(i, { occurred_at: e.target.value })}
                            style={{
                              ...input,
                              padding: '3px 6px',
                              fontSize: 12,
                              ...(noDate ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}),
                            }}
                          />
                          {noDate && (
                            <div style={{ fontSize: 9, color: '#b45309' }}>不明可</div>
                          )}
                        </td>
                        <td style={td}>
                          <select
                            value={r.target_driver_id}
                            onChange={(e) => updateRow(i, { target_driver_id: e.target.value })}
                            style={{
                              ...input,
                              padding: '3px 6px',
                              fontSize: 12,
                              width: '100%',
                              ...(unmatched ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}),
                            }}
                          >
                            <option value="">
                              {r.driverNameRaw ? `(未照合: ${r.driverNameRaw})` : '(選択)'}
                            </option>
                            {drivers.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.full_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ ...td, fontSize: 11 }}>{r.category || '—'}</td>
                        <td style={{ ...td, fontSize: 11, maxWidth: 360, whiteSpace: 'pre-wrap' }}>
                          {r.content}
                        </td>
                        <td style={{ ...td, fontSize: 11, whiteSpace: 'pre-wrap' }}>
                          {r.countermeasure || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {saveError && (
          <div style={{ color: colors.danger, fontSize: 12, marginTop: 12, whiteSpace: 'pre-wrap' }}>
            {saveError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button style={btn} onClick={onClose} disabled={saving}>
            キャンセル
          </button>
          <button style={btnPrimary} onClick={doImport} disabled={!canImport}>
            {saving ? '取込中...' : `${validRows.length}件を承認済で取込`}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20,
};

const modalBox: CSSProperties = {
  background: '#fff',
  borderRadius: 6,
  padding: 20,
  width: 920,
  maxWidth: '95vw',
  maxHeight: '92vh',
  overflow: 'auto',
};
