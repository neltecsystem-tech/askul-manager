import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { BusinessType, Office, Profile, Role } from '../../types/db';
import { businessTypeLabels } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, input, table, td, th } from '../../lib/ui';
import { useAuth } from '../../lib/AuthContext';

interface NewDriver {
  email: string;
  password: string;
  full_name: string;
  deduction_rate: number;
  office_id: string;
  business_type: BusinessType | '';
  company_name: string;
  monthly_salary: number;
}
const emptyNew: NewDriver = {
  email: '',
  password: '',
  full_name: '',
  deduction_rate: 0,
  office_id: '',
  business_type: '',
  company_name: '',
  monthly_salary: 0,
};

// 初回セットアップ用: マスタシートのA2:B34を重複排除したドライバーリスト
const bulkImportList: { full_name: string; deduction_rate: number }[] = [
  { full_name: '笹澤 竜次', deduction_rate: 17 },
  { full_name: '渡辺 誠一郎', deduction_rate: 15 },
  { full_name: '飯島 裕喜', deduction_rate: 17 },
  { full_name: '小林 恵香', deduction_rate: 15 },
  { full_name: '町田 正幸', deduction_rate: 15 },
  { full_name: '斉藤 卓実', deduction_rate: 17 },
  { full_name: '生源寺 祐', deduction_rate: 16 },
  { full_name: '石黒 大樹', deduction_rate: 16 },
  { full_name: '岡村 歩', deduction_rate: 17 },
  { full_name: '山形 浩輝', deduction_rate: 15 },
  { full_name: '沼口 将太朗', deduction_rate: 15 },
  { full_name: '前橋 直弥', deduction_rate: 0 },
  { full_name: '大江 瑞穂', deduction_rate: 17 },
  { full_name: 'NELTEC車建1', deduction_rate: 17 },
  { full_name: 'NELTEC車建2', deduction_rate: 17 },
  { full_name: 'NELTEC車建3', deduction_rate: 0 },
  { full_name: '秋山 研吾', deduction_rate: 17 },
  { full_name: '田村 龍真', deduction_rate: 15 },
  { full_name: '利嶋 将治', deduction_rate: 17 },
];

interface EditDriver {
  id: string;
  full_name: string;
  deduction_rate: number;
  original_deduction_rate: number; // 編集前の値(変更検出用)
  effective_from: string; // YYYY-MM-DD
  office_id: string;
  active: boolean;
  role: Role;
  email: string;
  new_password: string;
  business_type: BusinessType | '';
  company_name: string;
  monthly_salary: number;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DriversPage() {
  const { profile: me } = useAuth();
  const [rows, setRows] = useState<Profile[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<NewDriver | null>(null);
  const [editing, setEditing] = useState<EditDriver | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [profilesRes, officesRes, emailsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('offices').select('*').order('sort_order').order('name'),
      supabase.rpc('list_user_emails'),
    ]);
    if (profilesRes.error) setError(profilesRes.error.message);
    else setRows(profilesRes.data as Profile[]);
    if (officesRes.error) setError(officesRes.error.message);
    else setOffices(officesRes.data as Office[]);
    if (!emailsRes.error && emailsRes.data) {
      const map: Record<string, string> = {};
      for (const r of emailsRes.data as { id: string; email: string }[]) map[r.id] = r.email;
      setEmails(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const officeName = (id: string | null) =>
    id ? offices.find((o) => o.id === id)?.name ?? '(不明)' : '—';

  const createDriver = async () => {
    if (!creating) return;
    setError(null);
    if (!creating.email || !creating.password || !creating.full_name) {
      setError('氏名/ID/パスワードは必須です');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('create-driver', {
      body: {
        email: creating.email.trim(),
        password: creating.password,
        full_name: creating.full_name.trim(),
        deduction_rate: creating.deduction_rate,
        office_id: creating.office_id || null,
        business_type: creating.business_type || null,
        company_name:
          creating.business_type === 'corporation' || creating.business_type === 'corporation_owner'
            ? creating.company_name.trim() || null
            : null,
        monthly_salary: creating.business_type === 'employee' ? creating.monthly_salary : 0,
      },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }
    setCreating(null);
    await load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null);
    setBusy(true);

    // 1) profiles 更新
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({
        full_name: editing.full_name.trim(),
        deduction_rate: editing.deduction_rate,
        office_id: editing.office_id || null,
        active: editing.active,
        role: editing.role,
        business_type: editing.business_type || null,
        company_name:
          editing.business_type === 'corporation' || editing.business_type === 'corporation_owner'
            ? editing.company_name.trim() || null
            : null,
        monthly_salary: editing.business_type === 'employee' ? editing.monthly_salary : 0,
      })
      .eq('id', editing.id);
    if (profileErr) {
      setBusy(false);
      setError(profileErr.message);
      return;
    }

    // 1b) 控除率が変わっていたら履歴にも記録(upsert: 同日の場合は上書き)
    if (editing.deduction_rate !== editing.original_deduction_rate) {
      const { error: rateErr } = await supabase
        .from('driver_deduction_rates')
        .upsert(
          {
            driver_id: editing.id,
            effective_from: editing.effective_from,
            deduction_rate: editing.deduction_rate,
          },
          { onConflict: 'driver_id,effective_from' },
        );
      if (rateErr) {
        setBusy(false);
        setError('控除率履歴の保存に失敗: ' + rateErr.message);
        return;
      }
    }

    // 2) email/password 変更がある場合のみ Edge Function 呼び出し
    const currentEmail = emails[editing.id] ?? '';
    const emailChanged = editing.email.trim() !== '' && editing.email.trim() !== currentEmail;
    const passwordChanged = editing.new_password !== '';
    if (emailChanged || passwordChanged) {
      const payload: { user_id: string; email?: string; password?: string } = {
        user_id: editing.id,
      };
      if (emailChanged) payload.email = editing.email.trim();
      if (passwordChanged) payload.password = editing.new_password;
      const { data, error } = await supabase.functions.invoke('update-driver-auth', {
        body: payload,
      });
      if (error || data?.error) {
        setBusy(false);
        setError(error?.message ?? data?.error);
        await load();
        return;
      }
    }

    setBusy(false);
    setEditing(null);
    await load();
  };

  const deleteDriver = async (p: Profile) => {
    if (p.id === me?.id) {
      alert('自分自身は削除できません');
      return;
    }
    const msg =
      `「${p.full_name || '(未設定)'}」を完全削除します。\n\n` +
      `・profile / auth ユーザーが削除されます\n` +
      `・シフト割当 / 控除率履歴 も連動削除されます\n` +
      `・配送実績 / 立替金 は記録は残り、ドライバー欄が空欄になります\n\n` +
      `※この操作は取り消せません。続行しますか？`;
    if (!confirm(msg)) return;
    setError(null);
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('delete-driver', {
      body: { user_id: p.id },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }
    await load();
  };

  const toggleRole = async (p: Profile) => {
    const next: Role = p.role === 'admin' ? 'driver' : 'admin';
    const action = next === 'admin' ? '管理者に昇格' : 'ドライバーに降格';
    if (!confirm(`${p.full_name || '(未設定)'} を${action}します。よろしいですか？`)) return;
    setError(null);
    const { error } = await supabase.from('profiles').update({ role: next }).eq('id', p.id);
    if (error) setError(error.message);
    await load();
  };

  const bulkImport = async () => {
    if (
      !confirm(
        `マスタシートから ${bulkImportList.length}名 を一括登録します。\nログインID: 0001〜${String(bulkImportList.length).padStart(4, '0')}\nパスワード: askul2026（全員共通）\n営業所: 杉並営業所\n\n続行しますか？`,
      )
    )
      return;
    const office = offices.find((o) => o.name === '杉並営業所');
    if (!office) {
      setError('杉並営業所が営業所マスタに見つかりません。先に登録してください。');
      return;
    }
    setError(null);
    setBusy(true);
    const errors: string[] = [];
    for (let i = 0; i < bulkImportList.length; i++) {
      const row = bulkImportList[i];
      const seq = String(i + 1).padStart(4, '0');
      setBulkProgress(`${i + 1}/${bulkImportList.length}: ${row.full_name}`);
      const { data, error } = await supabase.functions.invoke('create-driver', {
        body: {
          email: `${seq}@askul.local`,
          password: 'askul2026',
          full_name: row.full_name,
          deduction_rate: row.deduction_rate,
          office_id: office.id,
        },
      });
      if (error || data?.error) {
        errors.push(`${seq} ${row.full_name}: ${error?.message ?? data?.error}`);
      }
    }
    setBulkProgress(null);
    setBusy(false);
    if (errors.length > 0) {
      setError(`一部失敗:\n${errors.join('\n')}`);
    }
    await load();
  };

  const startEdit = (p: Profile) =>
    setEditing({
      id: p.id,
      full_name: p.full_name,
      deduction_rate: Number(p.deduction_rate ?? 0),
      original_deduction_rate: Number(p.deduction_rate ?? 0),
      effective_from: todayStr(),
      office_id: p.office_id ?? '',
      active: p.active,
      role: p.role,
      email: emails[p.id] ?? '',
      new_password: '',
      business_type: p.business_type ?? '',
      company_name: p.company_name ?? '',
      monthly_salary: Number(p.monthly_salary ?? 0),
    });

  const drivers = rows.filter((r) => r.role === 'driver');
  const admins = rows.filter((r) => r.role === 'admin');

  const renderRow = (p: Profile) => (
    <tr key={p.id}>
      <td style={td}>{p.full_name || '(未設定)'}</td>
      <td style={{ ...td, color: '#6b7280' }}>{emails[p.id] ?? '—'}</td>
      <td style={td}>
        {p.business_type ? businessTypeLabels[p.business_type] : '—'}
        {(p.business_type === 'corporation' || p.business_type === 'corporation_owner') && p.company_name ? (
          <div style={{ fontSize: 11, color: '#6b7280' }}>{p.company_name}</div>
        ) : null}
        {p.business_type === 'employee' && (p.monthly_salary ?? 0) > 0 ? (
          <div style={{ fontSize: 11, color: '#6b7280' }}>月給 ¥{Number(p.monthly_salary).toLocaleString()}</div>
        ) : null}
      </td>
      <td style={td}>{officeName(p.office_id)}</td>
      <td style={{ ...td, textAlign: 'right' }}>
        {p.deduction_rate === null ? '—' : `${p.deduction_rate}%`}
      </td>
      <td style={td}>{p.active ? '有効' : '無効'}</td>
      <td style={td}>
        <button style={btn} onClick={() => startEdit(p)}>
          編集
        </button>
        <button style={{ ...btn, marginLeft: 4 }} onClick={() => toggleRole(p)}>
          {p.role === 'admin' ? 'ドライバーへ' : '管理者へ'}
        </button>
        {p.id !== me?.id && (
          <button
            style={{ ...btnDanger, marginLeft: 4 }}
            onClick={() => deleteDriver(p)}
            disabled={busy}
          >
            削除
          </button>
        )}
      </td>
    </tr>
  );

  return (
    <div>
      <PageHeader
        title="ドライバー管理"
        actions={
          <>
            {drivers.length === 0 && admins.length <= 1 && (
              <button style={btn} onClick={bulkImport} disabled={busy}>
                マスタから一括インポート
              </button>
            )}
            <button
              style={btnPrimary}
              onClick={() => setCreating({ ...emptyNew })}
              disabled={busy}
            >
              ドライバー登録
            </button>
          </>
        }
      />
      {bulkProgress && (
        <div style={{ color: '#2563eb', marginBottom: 12 }}>登録中: {bulkProgress}</div>
      )}
      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      <div style={card}>
        <h2 style={sectionTitle}>ドライバー ({drivers.length}人)</h2>
        {loading ? (
          <div>読み込み中...</div>
        ) : drivers.length === 0 ? (
          <div style={{ color: '#6b7280' }}>まだドライバーが登録されていません。</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>氏名</th>
                <th style={th}>ログインID</th>
                <th style={th}>事業形態 / 所属</th>
                <th style={th}>営業所</th>
                <th style={{ ...th, textAlign: 'right' }}>控除率（%）</th>
                <th style={th}>状態</th>
                <th style={{ ...th, width: 200 }}></th>
              </tr>
            </thead>
            <tbody>{drivers.map(renderRow)}</tbody>
          </table>
        )}
      </div>

      <div style={{ ...card, marginTop: 16 }}>
        <h2 style={sectionTitle}>管理者 ({admins.length}人)</h2>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>氏名</th>
              <th style={th}>ログインID</th>
              <th style={th}>営業所</th>
              <th style={{ ...th, textAlign: 'right' }}>控除率（%）</th>
              <th style={th}>状態</th>
              <th style={{ ...th, width: 200 }}></th>
            </tr>
          </thead>
          <tbody>{admins.map(renderRow)}</tbody>
        </table>
      </div>

      {creating && (
        <div style={modal.overlay}>
          <div style={modal.modal}>
            <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>ドライバー登録</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={labelStyle}>
                氏名
                <input
                  style={input}
                  value={creating.full_name}
                  onChange={(e) => setCreating({ ...creating, full_name: e.target.value })}
                  placeholder="山田 太郎"
                />
              </label>
              <label style={labelStyle}>
                ID（ログイン用メールアドレス）
                <input
                  type="email"
                  style={input}
                  value={creating.email}
                  onChange={(e) => setCreating({ ...creating, email: e.target.value })}
                  placeholder="driver01@askul.local"
                />
                <span style={hint}>
                  メール形式で入力してください（実在メール不要。例: driver01@askul.local）
                </span>
              </label>
              <label style={labelStyle}>
                パスワード（6文字以上）
                <input
                  type="text"
                  style={input}
                  value={creating.password}
                  onChange={(e) => setCreating({ ...creating, password: e.target.value })}
                  placeholder="本人に共有するパスワード"
                />
              </label>
              <label style={labelStyle}>
                控除率（管理費 %）
                <input
                  type="number"
                  step="0.01"
                  style={input}
                  value={creating.deduction_rate}
                  onChange={(e) =>
                    setCreating({ ...creating, deduction_rate: Number(e.target.value) })
                  }
                />
                <span style={hint}>
                  支払い額 = 売上 × (1 - 控除率/100)。例: 20 なら管理費20%控除
                </span>
              </label>
              <label style={labelStyle}>
                営業所
                <select
                  style={input}
                  value={creating.office_id}
                  onChange={(e) => setCreating({ ...creating, office_id: e.target.value })}
                >
                  <option value="">(未所属)</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                事業形態
                <select
                  style={input}
                  value={creating.business_type}
                  onChange={(e) =>
                    setCreating({
                      ...creating,
                      business_type: e.target.value as BusinessType | '',
                    })
                  }
                >
                  <option value="">(未選択)</option>
                  <option value="sole_proprietor">個人事業主</option>
                  <option value="corporation">法人</option>
                  <option value="corporation_owner">法人オーナー</option>
                  <option value="employee">社員</option>
                </select>
              </label>
              {(creating.business_type === 'corporation' || creating.business_type === 'corporation_owner') && (
                <label style={labelStyle}>
                  所属会社名
                  <input
                    style={input}
                    value={creating.company_name}
                    onChange={(e) => setCreating({ ...creating, company_name: e.target.value })}
                    placeholder="例: 株式会社○○"
                  />
                </label>
              )}
              {creating.business_type === 'employee' && (
                <label style={labelStyle}>
                  月給 (円)
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    style={input}
                    value={creating.monthly_salary}
                    onChange={(e) => setCreating({ ...creating, monthly_salary: Number(e.target.value) || 0 })}
                    placeholder="例: 250000"
                  />
                </label>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button style={btn} onClick={() => setCreating(null)} disabled={busy}>
                キャンセル
              </button>
              <button style={btnPrimary} onClick={createDriver} disabled={busy}>
                {busy ? '登録中...' : '登録'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div style={modal.overlay}>
          <div style={modal.modal}>
            <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>ユーザー編集</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={labelStyle}>
                氏名
                <input
                  style={input}
                  value={editing.full_name}
                  onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                />
              </label>
              <label style={labelStyle}>
                ログインID（メール形式）
                <input
                  type="email"
                  style={input}
                  value={editing.email}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </label>
              <label style={labelStyle}>
                新しいパスワード（変更する場合のみ入力、6文字以上）
                <input
                  type="text"
                  style={input}
                  value={editing.new_password}
                  onChange={(e) => setEditing({ ...editing, new_password: e.target.value })}
                  placeholder="(空欄なら変更しない)"
                />
              </label>
              <label style={labelStyle}>
                権限
                <select
                  style={input}
                  value={editing.role}
                  onChange={(e) =>
                    setEditing({ ...editing, role: e.target.value as Role })
                  }
                >
                  <option value="driver">ドライバー</option>
                  <option value="admin">管理者</option>
                </select>
              </label>
              <label style={labelStyle}>
                控除率（管理費 %）
                <input
                  type="number"
                  step="0.01"
                  style={input}
                  value={editing.deduction_rate}
                  onChange={(e) =>
                    setEditing({ ...editing, deduction_rate: Number(e.target.value) })
                  }
                />
              </label>
              {editing.deduction_rate !== editing.original_deduction_rate && (
                <label style={labelStyle}>
                  控除率の適用開始日
                  <input
                    type="date"
                    style={input}
                    value={editing.effective_from}
                    onChange={(e) =>
                      setEditing({ ...editing, effective_from: e.target.value })
                    }
                  />
                  <span style={hint}>
                    この日以降の配送実績に新しい控除率が適用されます。過去分には影響しません。
                  </span>
                </label>
              )}
              <label style={labelStyle}>
                営業所
                <select
                  style={input}
                  value={editing.office_id}
                  onChange={(e) => setEditing({ ...editing, office_id: e.target.value })}
                >
                  <option value="">(未所属)</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                事業形態
                <select
                  style={input}
                  value={editing.business_type}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      business_type: e.target.value as BusinessType | '',
                    })
                  }
                >
                  <option value="">(未選択)</option>
                  <option value="sole_proprietor">個人事業主</option>
                  <option value="corporation">法人</option>
                  <option value="corporation_owner">法人オーナー</option>
                  <option value="employee">社員</option>
                </select>
              </label>
              {(editing.business_type === 'corporation' || editing.business_type === 'corporation_owner') && (
                <label style={labelStyle}>
                  所属会社名
                  <input
                    style={input}
                    value={editing.company_name}
                    onChange={(e) => setEditing({ ...editing, company_name: e.target.value })}
                    placeholder="例: 株式会社○○"
                  />
                </label>
              )}
              {editing.business_type === 'employee' && (
                <label style={labelStyle}>
                  月給 (円)
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    style={input}
                    value={editing.monthly_salary}
                    onChange={(e) => setEditing({ ...editing, monthly_salary: Number(e.target.value) || 0 })}
                    placeholder="例: 250000"
                  />
                </label>
              )}
              <label
                style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                />
                有効（チェックを外すとログイン不可＆シフト編成対象外）
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button style={btn} onClick={() => setEditing(null)} disabled={busy}>
                キャンセル
              </button>
              <button style={btnPrimary} onClick={saveEdit} disabled={busy}>
                {busy ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const sectionTitle = { fontSize: 14, margin: '0 0 12px', color: '#374151' };
const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
const hint = { fontSize: 11, color: '#6b7280' };
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
  modal: { background: '#fff', borderRadius: 6, padding: 20, width: 440, maxWidth: '90vw' },
};
