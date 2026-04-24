import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import PageHeader from '../components/PageHeader';
import { btn, btnPrimary, card, input, table, td, th, colors } from '../lib/ui';

interface DeliveryRow {
  row_index: number;
  management_no: string;
  driver_code: string;
  driver_name: string;
  vendor_code: string;
  vendor_name: string;
  work_date: string; // YYYY-MM-DD
  product_code: string;
  product_name: string;
  shipper_code: string;
  shipper_name: string;
  size_code: string;
  tax_rate: number;
  offset_flag: number;
  quantity: number;
  unit_price: number;
  amount: number;
}

export default function DeliveriesPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [records, setRecords] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [appendOpen, setAppendOpen] = useState(false);

  // フィルタ
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [driverQuery, setDriverQuery] = useState('');
  const [shipperQuery, setShipperQuery] = useState('');
  const [sizeQuery, setSizeQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke('fetch-delivery-records', {
      body: {},
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    if (data?.error) {
      setError(data.error);
      setLoading(false);
      return;
    }
    setRecords((data?.records ?? []) as DeliveryRow[]);
    setFetchedAt(new Date());
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (dateFrom && r.work_date < dateFrom) return false;
      if (dateTo && r.work_date > dateTo) return false;
      if (driverQuery && !r.driver_name.includes(driverQuery) && !r.driver_code.includes(driverQuery))
        return false;
      if (shipperQuery && !r.shipper_name.includes(shipperQuery) && !r.shipper_code.includes(shipperQuery))
        return false;
      if (sizeQuery && r.size_code !== sizeQuery) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, driverQuery, shipperQuery, sizeQuery]);

  const totals = useMemo(() => {
    const qty = filtered.reduce((s, r) => s + (r.quantity || 0), 0);
    const amount = filtered.reduce((s, r) => s + (r.amount || 0), 0);
    return { qty, amount, count: filtered.length };
  }, [filtered]);

  const uniqueSizes = useMemo(() => {
    const set = new Set(records.map((r) => r.size_code).filter(Boolean));
    return Array.from(set).sort();
  }, [records]);

  return (
    <div>
      <PageHeader
        title="配送実績"
        actions={
          <>
            {isAdmin && (
              <button style={btn} onClick={() => setAppendOpen(true)} disabled={loading}>
                シートに追記
              </button>
            )}
            <button style={btnPrimary} onClick={load} disabled={loading}>
              {loading ? '読み込み中...' : '再読み込み'}
            </button>
          </>
        }
      />
      {appendOpen && (
        <AppendModal
          existingMgmtNos={
            new Set(records.map((r) => r.management_no).filter((n) => n && n.trim() !== ''))
          }
          onClose={() => setAppendOpen(false)}
          onDone={load}
        />
      )}

      {fetchedAt && (
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
          データ参照元: Google Sheets「DETA貼り付け」/ 取得時刻: {fetchedAt.toLocaleString()}
        </div>
      )}

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={filterGrid}>
          <label style={labelStyle}>
            開始日
            <input
              type="date"
              style={input}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            終了日
            <input
              type="date"
              style={input}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            ドライバー（氏名/コード）
            <input
              style={input}
              value={driverQuery}
              onChange={(e) => setDriverQuery(e.target.value)}
              placeholder="例: 笹澤"
            />
          </label>
          <label style={labelStyle}>
            荷主（名称/コード）
            <input
              style={input}
              value={shipperQuery}
              onChange={(e) => setShipperQuery(e.target.value)}
              placeholder="例: アスクル"
            />
          </label>
          <label style={labelStyle}>
            サイズ
            <select style={input} value={sizeQuery} onChange={(e) => setSizeQuery(e.target.value)}>
              <option value="">すべて</option>
              {uniqueSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              style={btn}
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setDriverQuery('');
                setShipperQuery('');
                setSizeQuery('');
              }}
            >
              クリア
            </button>
          </div>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 24 }}>
        <Stat label="件数" value={totals.count.toLocaleString()} />
        <Stat label="数量合計" value={totals.qty.toLocaleString()} />
        <Stat label="金額合計" value={`¥${totals.amount.toLocaleString()}`} />
      </div>

      <div style={card}>
        {loading ? (
          <div>読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: '#6b7280' }}>該当データがありません。</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>計上日</th>
                  <th style={th}>ドライバー</th>
                  <th style={th}>商品</th>
                  <th style={th}>荷主</th>
                  <th style={{ ...th, textAlign: 'right' }}>サイズ</th>
                  <th style={{ ...th, textAlign: 'right' }}>数量</th>
                  <th style={{ ...th, textAlign: 'right' }}>単価</th>
                  <th style={{ ...th, textAlign: 'right' }}>金額</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.row_index}`}>
                    <td style={td}>{r.work_date}</td>
                    <td style={td}>
                      {r.driver_name}
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{r.driver_code}</div>
                    </td>
                    <td style={td}>
                      {r.product_name}
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{r.product_code}</div>
                    </td>
                    <td style={td}>
                      {r.shipper_name}
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{r.shipper_code}</div>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.size_code}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      ¥{r.unit_price.toLocaleString()}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                      ¥{r.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

interface DriveFolderMeta {
  id: string;
  name: string;
  parents: string[];
}

type Cell = string | number;

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_LS_KEY = 'askul-manager:last-drive-folder';
const ROOT_FOLDER_URL =
  'https://drive.google.com/drive/folders/1exUIPO7JtWVKJrzFAk-Zp2ug8dDL3blt';

// URL/ID から folder_id 抽出
function extractFolderId(input: string): string {
  const m = input.match(/\/folders\/([^/?#]+)/);
  if (m) return m[1];
  return input.trim();
}

function AppendModal({
  existingMgmtNos,
  onClose,
  onDone,
}: {
  existingMgmtNos: Set<string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [folderInput, setFolderInput] = useState(
    () => localStorage.getItem(FOLDER_LS_KEY) ?? ROOT_FOLDER_URL,
  );
  const [currentFolder, setCurrentFolder] = useState<DriveFolderMeta | null>(null);
  const [history, setHistory] = useState<DriveFolderMeta[]>([]); // breadcrumb
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [values, setValues] = useState<Cell[][] | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [skipRows, setSkipRows] = useState(1);
  const [startCol, setStartCol] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const loadFolder = async (folderInputOrId: string, resetHistory = false) => {
    setLoadingFiles(true);
    setError(null);
    setSelectedFile(null);
    setValues(null);
    const folderId = folderInputOrId ? extractFolderId(folderInputOrId) : '';
    const { data, error } = await callFn('list-drive-files', {
      folder_id: folderId,
    });
    setLoadingFiles(false);
    if (error) {
      setError(error);
      return;
    }
    const folderMeta = data.folder as DriveFolderMeta;
    setFiles((data.files ?? []) as DriveFile[]);
    setCurrentFolder(folderMeta);
    setFolderInput(`https://drive.google.com/drive/folders/${folderMeta.id}`);
    if (resetHistory) setHistory([folderMeta]);
    else setHistory((h) => [...h, folderMeta]);
    localStorage.setItem(FOLDER_LS_KEY, folderMeta.id);
  };

  useEffect(() => {
    loadFolder(folderInput, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateToFolder = async (f: DriveFile) => {
    await loadFolder(f.id, false);
  };

  const navigateToCrumb = async (idx: number) => {
    const target = history[idx];
    if (!target) return;
    setHistory((h) => h.slice(0, idx + 1));
    setLoadingFiles(true);
    setError(null);
    setSelectedFile(null);
    setValues(null);
    const { data, error } = await callFn('list-drive-files', { folder_id: target.id });
    setLoadingFiles(false);
    if (error) {
      setError(error);
      return;
    }
    setFiles((data.files ?? []) as DriveFile[]);
    setCurrentFolder(data.folder as DriveFolderMeta);
    setFolderInput(`https://drive.google.com/drive/folders/${data.folder.id}`);
    localStorage.setItem(FOLDER_LS_KEY, data.folder.id);
  };

  const goToRoot = () => {
    setFolderInput(ROOT_FOLDER_URL);
    loadFolder(ROOT_FOLDER_URL, true);
  };

  const applyFolderInput = () => {
    if (!folderInput.trim()) return;
    loadFolder(folderInput, true);
  };

  const pickFile = async (f: DriveFile) => {
    setSelectedFile(f);
    setValues(null);
    setLoadingFile(true);
    setError(null);
    const { data, error } = await callFn('import-drive-file', { file_id: f.id });
    setLoadingFile(false);
    if (error) {
      setError(error);
      return;
    }
    setValues((data.values ?? []) as Cell[][]);
  };

  // 解析済みのデータ（skipRows + startCol 適用後）
  // 表示用に全行のステータスを保持する(追記/重複/計上日欠け/空)
  const parsed = useMemo(() => {
    if (!values)
      return { all: [] as { row: Cell[]; status: 'ok' | 'dup' | 'no-date' | 'empty' }[], rows: [] as Cell[][], errors: [] as string[], dupCount: 0 };
    const afterSkip = values.slice(skipRows);
    const errors: string[] = [];
    const rows: Cell[][] = [];
    const all: { row: Cell[]; status: 'ok' | 'dup' | 'no-date' | 'empty' }[] = [];
    let dupCount = 0;
    const EXPECTED = 16;
    afterSkip.forEach((row, idx) => {
      const sliced = row.slice(startCol, startCol + EXPECTED);
      while (sliced.length < EXPECTED) sliced.push('');
      if (sliced.every((c) => c === '' || c === undefined || c === null)) {
        all.push({ row: sliced, status: 'empty' });
        return;
      }
      if (!sliced[5]) {
        errors.push(`行 ${idx + skipRows + 1}: 計上日(F列)が空`);
        all.push({ row: sliced, status: 'no-date' });
        return;
      }
      const mgmtNo = String(sliced[0] ?? '').trim();
      if (mgmtNo && existingMgmtNos.has(mgmtNo)) {
        dupCount++;
        all.push({ row: sliced, status: 'dup' });
        return;
      }
      rows.push(sliced);
      all.push({ row: sliced, status: 'ok' });
    });
    return { all, rows, errors, dupCount };
  }, [values, skipRows, startCol, existingMgmtNos]);

  const submit = async () => {
    setError(null);
    setResult(null);
    if (parsed.rows.length === 0) {
      setError('追記する行がありません');
      return;
    }
    setBusy(true);
    // そのまま16列(A-P) を送る
    const rows = parsed.rows.map((r) => r.map((c) => (c == null ? '' : c)));
    const { data, error } = await callFn('append-delivery-records', { rows });
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setResult(`${data.updatedRows ?? rows.length}行 追記しました (${data.updatedRange ?? ''})`);
    setValues(null);
    setSelectedFile(null);
    onDone();
  };

  return (
    <div style={modalStyle.overlay}>
      <div style={modalStyle.modal}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Driveのファイルから追記</h2>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
          フォルダ内のファイルを選択 → プレビュー → 配送実績シートに追記。A列(管理番号)が既存シートに存在する行は自動スキップします。
          追記列順: A:管理番号 / B:ドライバーCD / C:氏名 / D:業者CD / E:業者名 / F:計上日 /
          G:商品CD / H:商品名 / I:荷主CD / J:荷主名 / K:サイズ / L:税率 / M:相殺 / N:数量 / O:単価 / P:金額 (16列)
        </div>

        {error && (
          <div style={{ color: '#dc2626', marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {error}
          </div>
        )}

        {!selectedFile ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                style={{ ...input, flex: 1 }}
                placeholder="フォルダ URL または ID"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyFolderInput();
                }}
              />
              <button style={btn} onClick={applyFolderInput}>
                移動
              </button>
              <button
                style={btn}
                onClick={goToRoot}
                title="請求データフォルダに戻る"
                disabled={currentFolder?.id === '1exUIPO7JtWVKJrzFAk-Zp2ug8dDL3blt'}
              >
                🏠 ルート
              </button>
            </div>

            {history.length > 0 && (
              <div style={{ marginBottom: 8, fontSize: 12, color: '#374151' }}>
                📁{' '}
                {history.map((h, i) => (
                  <span key={h.id + i}>
                    {i > 0 && <span style={{ color: '#9ca3af' }}> / </span>}
                    {i === history.length - 1 ? (
                      <strong>{h.name}</strong>
                    ) : (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          navigateToCrumb(i);
                        }}
                        style={{ color: '#2563eb', textDecoration: 'none' }}
                      >
                        {h.name}
                      </a>
                    )}
                  </span>
                ))}
              </div>
            )}

            <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, maxHeight: 380, overflow: 'auto' }}>
              {loadingFiles ? (
                <div style={{ padding: 12 }}>読み込み中...</div>
              ) : files.length === 0 ? (
                <div style={{ padding: 12, color: '#6b7280' }}>
                  このフォルダには対象ファイルがありません。
                </div>
              ) : (() => {
                // フォルダ→ファイルの順に並べ替え、各グループは更新日時降順
                const folders = files
                  .filter((f) => f.mimeType === FOLDER_MIME)
                  .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
                const docs = files
                  .filter((f) => f.mimeType !== FOLDER_MIME)
                  .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
                return (
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>名前</th>
                        <th style={th}>形式</th>
                        <th style={th}>更新日時</th>
                        <th style={{ ...th, width: 80 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {folders.length > 0 && (
                        <tr>
                          <td colSpan={4} style={{ ...td, background: '#f9fafb', fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
                            📁 フォルダ ({folders.length})
                          </td>
                        </tr>
                      )}
                      {folders.map((f) => (
                        <tr key={f.id}>
                          <td style={td}>📁 {f.name}</td>
                          <td style={{ ...td, fontSize: 11, color: '#6b7280' }}>フォルダ</td>
                          <td style={{ ...td, fontSize: 11 }}>
                            {new Date(f.modifiedTime).toLocaleDateString()}
                          </td>
                          <td style={td}>
                            <button style={btn} onClick={() => navigateToFolder(f)}>
                              開く
                            </button>
                          </td>
                        </tr>
                      ))}
                      {docs.length > 0 && (
                        <tr>
                          <td colSpan={4} style={{ ...td, background: '#f9fafb', fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
                            📄 ファイル ({docs.length})
                          </td>
                        </tr>
                      )}
                      {docs.map((f) => (
                        <tr key={f.id}>
                          <td style={td}>📄 {f.name}</td>
                          <td style={{ ...td, fontSize: 11, color: '#6b7280' }}>
                            {shortMime(f.mimeType)}
                          </td>
                          <td style={{ ...td, fontSize: 11 }}>
                            {new Date(f.modifiedTime).toLocaleString()}
                          </td>
                          <td style={td}>
                            <button style={btn} onClick={() => pickFile(f)}>
                              選択
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              選択中: <strong>{selectedFile.name}</strong>{' '}
              <button
                style={{ ...btn, marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
                onClick={() => {
                  setSelectedFile(null);
                  setValues(null);
                }}
              >
                ファイル変更
              </button>
            </div>

            {loadingFile ? (
              <div>ファイル読み込み中...</div>
            ) : values ? (
              <>
                <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12 }}>
                  <label style={labelStyle}>
                    飛ばす行数
                    <input
                      type="number"
                      min={0}
                      style={{ ...input, width: 80 }}
                      value={skipRows}
                      onChange={(e) => setSkipRows(Math.max(0, Number(e.target.value)))}
                    />
                  </label>
                  <label style={labelStyle}>
                    開始列(0=A, 1=B)
                    <input
                      type="number"
                      min={0}
                      style={{ ...input, width: 80 }}
                      value={startCol}
                      onChange={(e) => setStartCol(Math.max(0, Number(e.target.value)))}
                    />
                  </label>
                  <div style={{ alignSelf: 'end', color: '#374151', fontSize: 12 }}>
                    検出: 全 {values.length} 行 / 追記候補 {parsed.rows.length} 行 / 管理番号重複 {parsed.dupCount} 行スキップ
                  </div>
                </div>

                <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, maxHeight: 300, overflow: 'auto' }}>
                  <table style={{ ...table, fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={th}>#</th>
                        <th style={th}>状態</th>
                        {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'].map((c) => (
                          <th key={c} style={th}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.all.slice(0, 20).map((entry, i) => {
                        const label =
                          entry.status === 'ok'
                            ? { text: '追記', color: '#16a34a' }
                            : entry.status === 'dup'
                              ? { text: '重複', color: '#b45309' }
                              : entry.status === 'no-date'
                                ? { text: '日付なし', color: '#6b7280' }
                                : { text: '空', color: '#9ca3af' };
                        return (
                          <tr key={i} style={{ opacity: entry.status === 'ok' ? 1 : 0.6 }}>
                            <td style={td}>{i + 1 + skipRows}</td>
                            <td style={{ ...td, color: label.color, fontWeight: 600 }}>{label.text}</td>
                            {entry.row.map((v, j) => (
                              <td key={j} style={{ ...td, whiteSpace: 'nowrap' }}>
                                {String(v)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                      {parsed.all.length > 20 && (
                        <tr>
                          <td style={{ ...td, color: '#6b7280' }} colSpan={18}>
                            ... 他 {parsed.all.length - 20} 行
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {parsed.errors.length > 0 && (
                  <div style={{ color: '#b45309', marginTop: 8, fontSize: 11, whiteSpace: 'pre-wrap' }}>
                    スキップ警告 ({parsed.errors.length}件):
                    {'\n' + parsed.errors.slice(0, 5).join('\n')}
                  </div>
                )}
              </>
            ) : null}
          </>
        )}

        {result && <div style={{ color: '#16a34a', marginTop: 10, fontSize: 12 }}>{result}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button style={btn} onClick={onClose} disabled={busy}>
            閉じる
          </button>
          {selectedFile && values && (
            <button
              style={btnPrimary}
              onClick={submit}
              disabled={busy || parsed.rows.length === 0}
            >
              {busy ? '追記中...' : `追記 (${parsed.rows.length}行)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function shortMime(mime: string): string {
  if (mime === 'application/vnd.google-apps.folder') return 'フォルダ';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'Google Sheets';
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'Excel (xlsx)';
  if (mime === 'application/vnd.ms-excel') return 'Excel (xls)';
  if (mime === 'text/csv') return 'CSV';
  return mime;
}

// Edge Function 呼び出し(エラー本文を保持)
async function callFn(name: string, body: unknown): Promise<{ data: any; error: string | null }> {
  const session = (await supabase.auth.getSession()).data.session;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      const text = await res.text();
      return { data: null, error: `HTTP ${res.status}: ${text}` };
    }
    if (!res.ok || data?.error) {
      return { data, error: `HTTP ${res.status}: ${data?.error ?? '不明なエラー'}` };
    }
    return { data, error: null };
  } catch (err) {
    return { data: null, error: '通信エラー: ' + (err instanceof Error ? err.message : String(err)) };
  }
}

const modalStyle = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modal: {
    background: '#fff',
    borderRadius: 6,
    padding: 20,
    width: 700,
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflow: 'auto',
  },
};

const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
const filterGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
};
