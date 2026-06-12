import { useMemo, useState, type CSSProperties } from 'react';
import { btnPrimary, card, colors } from '../lib/ui';

type Item = { q: string; a: string };
type Section = { key: string; icon: string; title: string; admin?: boolean; items: Item[] };

const SECTIONS: Section[] = [
  {
    key: 'start', icon: '🚀', title: 'はじめに',
    items: [
      { q: 'ログインする', a: '配布されたID（例: 0001@askul.local）とパスワードでログインします。ドライバー本人のIDでログインすると、自分の配送実績や支払明細が見られます。' },
      { q: '画面の切り替え', a: '左側のメニュー（スマホは左上☰）から各画面に移動します。管理者とドライバーで表示されるメニューが異なります。' },
      { q: '管理者とドライバーの違い', a: '管理者は全機能（請求・支払明細・マスタ管理など）、ドライバーは自分に関する画面（配送実績・支払明細など）が見られます。' },
    ],
  },
  {
    key: 'dashboard', icon: '📊', title: 'ダッシュボード',
    items: [
      { q: '今日のシフト / 不具合状況', a: 'トップ画面で、本日のコース担当や不具合の発生状況（前日・今月＝請求と同じ21日〜20日サイクル）を確認できます。' },
    ],
  },
  {
    key: 'deliveries', icon: '🚚', title: '配送実績',
    items: [
      { q: '配送実績（管理者）', a: 'Google スプレッドシートの実績を直接参照します。Driveのファイルから取り込むこともできます（重複する管理番号は自動スキップ）。' },
      { q: '自分の配送実績', a: 'ドライバーは自分の実績を月別で確認できます。法人所属の方は金額が非表示、法人オーナーは同社メンバー分も閲覧できます。' },
      { q: '稼働登録', a: '日々の稼働を記録します。' },
    ],
  },
  {
    key: 'incidents', icon: '⚠', title: '不具合登録・分析',
    items: [
      { q: '不具合を登録する', a: '「新規追加」で発生日・該当者・内容を登録します。該当ドライバーが原因/対策を記入し、管理者が承認します。' },
      { q: '一括取込（Excel）', a: '品質実績Excelの「不良配送」シートを「一括取込」で読み込めます。氏名からドライバーを自動照合し、承認済みとして登録します。発生日が不明な行も取り込めます。' },
      { q: '不具合分析', a: '月別件数・区分別・該当者別をグラフで表示します。右上の「PDF出力」でPDF保存できます。' },
    ],
  },
  {
    key: 'quality', icon: '📈', title: '品質実績',
    items: [
      { q: 'Excelを取り込む', a: '右上「Excel取込」で品質実績Excelの「品質実績」シートを読み込み、保存します。月次の配完個数・不良件数・不良率（PPM）を蓄積できます。' },
      { q: 'グラフ・PDF', a: '不良率(ALL)の月別推移（目標ライン付き）、件数推移、区分別マトリクスを表示。右上「PDF出力」でPDF化できます。' },
    ],
  },
  {
    key: 'closing', icon: '💴', title: '月次締め・請求・支払明細',
    items: [
      { q: '月次締め / 請求書', a: '締め期間（前月21日〜当月20日）で請求書・支払明細を作成します。全員分を一括ZIP（個別PDF）で出力できます。' },
      { q: '支払明細書', a: 'ドライバー別の月次明細を確認・出力します。控除率は日付時点の履歴で計算され、車建は控除対象外です。' },
      { q: '立替金精算 / 特別日当', a: '立替金はGoogle シート連携で精算、特別日当（車建/個建+）はフォームの回答から自動加算されます。' },
    ],
  },
  {
    key: 'masters', icon: '🗂', title: 'マスタ・地図', admin: true,
    items: [
      { q: '各種マスタ', a: '営業所・サイズ区分・コース・車建日などのマスタを管理します。' },
      { q: 'コースエリア地図', a: 'Leaflet地図でコースのエリア（ポリゴン）を描画・保存します。' },
      { q: 'データ付け替え', a: '配送データの付け替え（担当変更など）を行えます。' },
    ],
  },
  {
    key: 'admin', icon: '🛡', title: '管理者向け', admin: true,
    items: [
      { q: 'ドライバー管理', a: 'ドライバーの追加・編集を行います。事業形態（個人事業主/法人/法人オーナー/社員）、控除率（適用開始日付きで履歴管理）、インボイス番号を設定できます。' },
      { q: '表示ページ設定', a: '設定画面で、各画面を管理者/ドライバーに表示するかを切り替えられます（メニューに反映）。' },
    ],
  },
  {
    key: 'faq', icon: '❓', title: '困ったとき（FAQ）',
    items: [
      { q: '文字が変な日本語になる', a: 'ブラウザの自動翻訳がオンの可能性があります。翻訳をオフにしてください。' },
      { q: '最新の状態にならない', a: 'ブラウザを再読み込み（Ctrl + Shift + R）してください。' },
      { q: '金額が表示されない', a: '法人所属の場合は仕様で金額が非表示です。法人オーナー・管理者は表示されます。' },
    ],
  },
];

export default function ManualPage() {
  const [open, setOpen] = useState<Set<string>>(new Set(['start']));
  const [query, setQuery] = useState('');

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!q) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((it) => it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q)),
    })).filter((s) => s.items.length > 0 || s.title.toLowerCase().includes(q));
  }, [q]);

  const manualUrl = `${import.meta.env.BASE_URL}manual.html`;

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>マニュアル（使い方）</h1>
        <a href={manualUrl} target="_blank" rel="noopener" style={{ ...btnPrimary, textDecoration: 'none' }}>
          🖨 印刷用マニュアル(PDF)
        </a>
      </div>

      <div style={{ ...card, background: colors.primary, marginBottom: 14 }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 2 }}>📖 アスクル配送管理ツール</div>
        <div style={{ color: '#dbe3f4', fontSize: 12 }}>知りたい項目をクリックすると説明が開きます。キーワード検索もできます。</div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="🔍 キーワードで検索（例: 不具合, 支払, 取込）"
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${colors.border}`,
          fontSize: 14, marginBottom: 16, boxSizing: 'border-box',
        }}
      />

      {sections.length === 0 && (
        <div style={{ color: colors.textMuted, textAlign: 'center', padding: 20 }}>
          「{query}」に一致する項目はありません。
        </div>
      )}

      {sections.map((s) => {
        const isOpen = !!q || open.has(s.key);
        return (
          <div key={s.key} style={{ ...card, padding: 0, marginBottom: 12, overflow: 'hidden' }}>
            <div onClick={() => toggle(s.key)} style={accHead}>
              <span style={{ fontSize: 18, width: 26, textAlign: 'center' }}>{s.icon}</span>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{s.title}</span>
              {s.admin && <span style={adminTag}>管理者</span>}
              <span style={{ color: colors.textMuted, fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && (
              <div style={{ padding: '0 16px 8px' }}>
                {s.items.map((it, i) => (
                  <div key={i} style={{ padding: '11px 0', borderTop: i > 0 ? `1px solid ${colors.borderLight}` : 'none' }}>
                    <div style={{ fontWeight: 700, color: colors.primary, fontSize: 14, marginBottom: 3 }}>{it.q}</div>
                    <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.6 }}>{it.a}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ ...card, background: '#eff6ff', border: '1px solid #bfdbfe', marginTop: 8 }}>
        <div style={{ fontSize: 12, color: '#1e40af', textAlign: 'center' }}>
          解決しない場合は、システム担当（NELTEC）までご連絡ください。
        </div>
      </div>
    </div>
  );
}

const accHead: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: 16, cursor: 'pointer',
};
const adminTag: CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#7c3aed', background: '#f3e8ff',
  padding: '2px 8px', borderRadius: 8,
};
