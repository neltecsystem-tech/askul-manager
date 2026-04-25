import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import PageHeader from '../components/PageHeader';
import PaymentStatementDocument from '../components/PaymentStatementDocument';
import SummaryStatementDocument from '../components/SummaryStatementDocument';
import EditStatementModal from '../components/EditStatementModal';
import { btn, btnPrimary, card, colors, input, table, td, th } from '../lib/ui';
import type { ClosedPaymentStatement } from '../types/db';

async function elementToPdfBlob(el: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const imgHeight = (canvas.height * pdfWidth) / canvas.width;
  let heightLeft = imgHeight;
  let position = 0;
  const data = canvas.toDataURL('image/jpeg', 0.95);
  pdf.addImage(data, 'JPEG', 0, position, pdfWidth, imgHeight);
  heightLeft -= pdfHeight;
  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(data, 'JPEG', 0, position, pdfWidth, imgHeight);
    heightLeft -= pdfHeight;
  }
  return pdf.output('blob');
}

function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_');
}

export default function PaymentStatementsPage() {
  const { profile } = useAuth();
  const [statements, setStatements] = useState<ClosedPaymentStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYearMonth, setSelectedYearMonth] = useState<string>('');
  const [openStatement, setOpenStatement] = useState<ClosedPaymentStatement | null>(null);
  const [editingStatement, setEditingStatement] = useState<ClosedPaymentStatement | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  const summaryDocRef = useRef<HTMLDivElement>(null);
  const docRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const isAdmin = profile?.role === 'admin';
  const isOwner = profile?.business_type === 'corporation_owner';
  const canBulkExport = isAdmin || isOwner;

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('closed_payment_statements')
      .select('*')
      .order('year', { ascending: false })
      .order('month', { ascending: false });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setStatements((data ?? []) as ClosedPaymentStatement[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // 年月リスト (重複排除)
  const yearMonths = useMemo(() => {
    const set = new Set<string>();
    for (const s of statements) {
      set.add(`${s.year}-${String(s.month).padStart(2, '0')}`);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [statements]);

  // 初期選択: 最新月
  useEffect(() => {
    if (!selectedYearMonth && yearMonths.length > 0) {
      setSelectedYearMonth(yearMonths[0]);
    }
  }, [yearMonths, selectedYearMonth]);

  const filtered = useMemo(() => {
    if (!selectedYearMonth) return [];
    const [y, m] = selectedYearMonth.split('-').map(Number);
    return statements
      .filter((s) => s.year === y && s.month === m)
      .sort((a, b) =>
        (a.driver_snapshot?.full_name ?? '').localeCompare(
          b.driver_snapshot?.full_name ?? '',
        ),
      );
  }, [statements, selectedYearMonth]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        revenue: acc.revenue + s.revenue,
        deduction: acc.deduction + s.deduction_amount,
        payment: acc.payment + s.payment_amount,
      }),
      { revenue: 0, deduction: 0, payment: 0 },
    );
  }, [filtered]);

  const [summaryYear, summaryMonth] = useMemo(() => {
    if (!selectedYearMonth) return [0, 0];
    const [y, m] = selectedYearMonth.split('-').map(Number);
    return [y, m];
  }, [selectedYearMonth]);

  const downloadSummaryPdf = async () => {
    if (!summaryDocRef.current || filtered.length === 0) return;
    setBulkBusy('summary');
    try {
      const blob = await elementToPdfBlob(summaryDocRef.current);
      const company = filtered[0]?.driver_snapshot?.company_name ?? '';
      const ymStr = `${summaryYear}-${String(summaryMonth).padStart(2, '0')}`;
      const fname = safeFileName(`${ymStr}_サマリー${company ? '_' + company : ''}.pdf`);
      saveAs(blob, fname);
    } catch (e: unknown) {
      alert('サマリーPDFエラー: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBulkBusy(null);
    }
  };

  const downloadBulkZip = async () => {
    if (filtered.length === 0) return;
    setBulkBusy('zip');
    try {
      const zip = new JSZip();
      const ymStr = `${summaryYear}-${String(summaryMonth).padStart(2, '0')}`;
      for (const s of filtered) {
        const el = docRefs.current.get(s.id);
        if (!el) continue;
        const blob = await elementToPdfBlob(el);
        const name = safeFileName(s.driver_snapshot?.full_name ?? s.id);
        zip.file(`${ymStr}_${name}.pdf`, blob);
      }
      const company = filtered[0]?.driver_snapshot?.company_name ?? '';
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, safeFileName(`${ymStr}_明細一括${company ? '_' + company : ''}.zip`));
    } catch (e: unknown) {
      alert('一括PDFエラー: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBulkBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="支払明細書"
        actions={
          <>
            {canBulkExport && filtered.length > 0 && (
              <>
                <button
                  style={btn}
                  onClick={downloadSummaryPdf}
                  disabled={!!bulkBusy}
                  title="月別の合計サマリーPDF"
                >
                  {bulkBusy === 'summary' ? '生成中...' : 'サマリーPDF'}
                </button>
                <button
                  style={btn}
                  onClick={downloadBulkZip}
                  disabled={!!bulkBusy}
                  title="メンバー全員の個別PDFをZIPでダウンロード"
                >
                  {bulkBusy === 'zip' ? '生成中...' : '個別PDF一括(ZIP)'}
                </button>
              </>
            )}
            <button style={btnPrimary} onClick={load} disabled={loading}>
              {loading ? '読み込み中...' : '再読み込み'}
            </button>
          </>
        }
      />

      {error && (
        <div style={{ color: colors.danger, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <div style={{ ...card, marginBottom: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          対象月
          <select
            style={{ ...input, minWidth: 160 }}
            value={selectedYearMonth}
            onChange={(e) => setSelectedYearMonth(e.target.value)}
          >
            {yearMonths.length === 0 && <option value="">(確定済データなし)</option>}
            {yearMonths.map((ym) => {
              const [y, m] = ym.split('-');
              return (
                <option key={ym} value={ym}>
                  {y}年{parseInt(m)}月度
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {(isAdmin || isOwner) && filtered.length > 0 && (
        <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 32 }}>
          <Stat label="人数" value={filtered.length.toLocaleString() + '名'} />
          <Stat label="総売上(税抜)" value={`¥${totals.revenue.toLocaleString()}`} />
          <Stat label="控除合計" value={`¥${totals.deduction.toLocaleString()}`} />
          <Stat label="支払合計" value={`¥${totals.payment.toLocaleString()}`} />
        </div>
      )}

      <div style={card}>
        {loading ? (
          <div>読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: colors.textMuted }}>
            {yearMonths.length === 0
              ? '確定済の支払明細書がまだありません。'
              : 'この月のデータはありません。'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>ドライバー</th>
                  {(isAdmin || isOwner) && <th style={th}>所属会社</th>}
                  <th style={{ ...th, textAlign: 'right' }}>売上(税抜)</th>
                  <th style={{ ...th, textAlign: 'right' }}>控除額</th>
                  <th style={{ ...th, textAlign: 'right' }}>支払額</th>
                  <th style={th}>確定日時</th>
                  <th style={{ ...th, width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td style={td}>{s.driver_snapshot?.full_name ?? '(不明)'}</td>
                    {(isAdmin || isOwner) && (
                      <td style={td}>{s.driver_snapshot?.company_name ?? ''}</td>
                    )}
                    <td style={{ ...td, textAlign: 'right' }}>
                      ¥{s.revenue.toLocaleString()}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: '#b45309' }}>
                      -¥{s.deduction_amount.toLocaleString()}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                      ¥{s.payment_amount.toLocaleString()}
                    </td>
                    <td style={{ ...td, fontSize: 12, color: colors.textMuted }}>
                      {new Date(s.finalized_at).toLocaleString('ja-JP')}
                      {s.modified_at && (
                        <div style={{ fontSize: 11, color: '#b45309' }}>
                          修正: {new Date(s.modified_at).toLocaleString('ja-JP')}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <button style={btn} onClick={() => setOpenStatement(s)}>
                        明細を見る
                      </button>
                      {isAdmin && (
                        <button
                          style={{ ...btn, marginLeft: 4 }}
                          onClick={() => setEditingStatement(s)}
                        >
                          編集
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openStatement && (
        <StatementModal
          statement={openStatement}
          onClose={() => setOpenStatement(null)}
        />
      )}

      {editingStatement && (
        <EditStatementModal
          statement={editingStatement}
          onClose={() => setEditingStatement(null)}
          onSaved={load}
        />
      )}

      {/* PDF生成用 オフスクリーン領域 */}
      {canBulkExport && filtered.length > 0 && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: -10000,
            top: 0,
            width: 800,
            pointerEvents: 'none',
          }}
        >
          <SummaryStatementDocument
            ref={summaryDocRef}
            statements={filtered}
            year={summaryYear}
            month={summaryMonth}
            companyName={filtered[0]?.driver_snapshot?.company_name ?? undefined}
          />
          {filtered.map((s) => (
            <div
              key={s.id}
              ref={(el) => {
                if (el) docRefs.current.set(s.id, el);
                else docRefs.current.delete(s.id);
              }}
            >
              <PaymentStatementDocument statement={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: colors.textMuted }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function StatementModal({
  statement,
  onClose,
}: {
  statement: ClosedPaymentStatement;
  onClose: () => void;
}) {
  const docRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const downloadPdf = async () => {
    if (!docRef.current) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(docRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      const data = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(data, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(data, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      const safeName = (statement.driver_snapshot?.full_name ?? 'driver').replace(
        /[\\/:*?"<>|]/g,
        '_',
      );
      pdf.save(`${statement.year}-${String(statement.month).padStart(2, '0')}_${safeName}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.toolbar}>
          <button style={btnPrimary} onClick={downloadPdf} disabled={downloading}>
            {downloading ? '生成中...' : 'PDFダウンロード'}
          </button>
          <button style={btn} onClick={() => window.print()}>
            印刷
          </button>
          <button style={btn} onClick={onClose}>
            閉じる
          </button>
        </div>
        <PaymentStatementDocument ref={docRef} statement={statement} />
      </div>
    </div>
  );
}

const modalStyles: Record<string, CSSProperties> = {
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
    padding: 16,
  },
  toolbar: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    marginBottom: 12,
  },
};
