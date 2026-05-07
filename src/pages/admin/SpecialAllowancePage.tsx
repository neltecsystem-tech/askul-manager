import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import PageHeader from '../../components/PageHeader';
import { btn, btnPrimary, card, colors, input } from '../../lib/ui';

const TYPE_OPTIONS = ['個建+', '車建', '車建OR個建', '引継ぎ'];
const INPUTTER_OPTIONS = ['前橋', '吉田', '小林'];

type DriverOption = { id: string; full_name: string };
type Status = { ok: true; message: string } | { ok: false; message: string } | null;

function todayJST(): string {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return (
    jst.getUTCFullYear() +
    '-' +
    String(jst.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(jst.getUTCDate()).padStart(2, '0')
  );
}

export default function SpecialAllowancePage() {
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);

  const [eventDate, setEventDate] = useState<string>(todayJST());
  const [driverName, setDriverName] = useState<string>('');
  const [type, setType] = useState<string>(TYPE_OPTIONS[0]);
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [inputter, setInputter] = useState<string>(INPUTTER_OPTIONS[0]);

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, sort_order')
        .eq('active', true)
        .order('sort_order')
        .order('full_name');
      const arr = ((data ?? []) as { id: string; full_name: string }[])
        .filter((d) => !!d.full_name);
      setDrivers(arr);
      setLoadingDrivers(false);
    })();
  }, []);

  const submit = async () => {
    setStatus(null);
    if (!eventDate || !driverName || !type || !amount.trim() || !reason.trim() || !inputter) {
      setStatus({ ok: false, message: '全ての項目を入力してください' });
      return;
    }
    const numAmount = Number(String(amount).replace(/,/g, ''));
    if (!isFinite(numAmount) || numAmount <= 0) {
      setStatus({ ok: false, message: '金額は正の数値を入力してください' });
      return;
    }

    setSubmitting(true);
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      setSubmitting(false);
      setStatus({ ok: false, message: 'セッション切れ。再ログインしてください。' });
      return;
    }
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/append-form-response`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          event_date: eventDate,
          driver_name: driverName,
          type,
          amount: numAmount,
          reason: reason.trim(),
          inputter,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setStatus({ ok: false, message: data.error || `HTTP ${res.status}` });
      } else {
        setStatus({ ok: true, message: `登録完了 (${data.timestamp ?? ''})` });
        // 連続入力しやすいようにリセット (氏名・入力者は保持)
        setAmount('');
        setReason('');
      }
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title="特別日当 登録" />

      <div style={{ ...card, padding: 16, maxWidth: 560 }}>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
          Googleフォーム同等の入力で「フォームの回答 1」シートに直接書き込みます。
        </div>

        <Field label="日付">
          <input
            type="date"
            style={input}
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
        </Field>

        <Field label="氏名">
          <select
            style={input}
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            disabled={loadingDrivers}
          >
            <option value="">{loadingDrivers ? '読込中...' : '選択してください'}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.full_name}>
                {d.full_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="種別">
          <select style={input} value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="金額 (円)">
          <input
            type="number"
            inputMode="numeric"
            style={input}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="例: 22000"
          />
        </Field>

        <Field label="事由">
          <textarea
            style={{ ...input, minHeight: 80, fontFamily: 'inherit' }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: 祝日出勤、引継ぎ補助 等"
          />
        </Field>

        <Field label="入力者">
          <select style={input} value={inputter} onChange={(e) => setInputter(e.target.value)}>
            {INPUTTER_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btnPrimary} onClick={submit} disabled={submitting}>
            {submitting ? '送信中...' : '登録'}
          </button>
          <button
            style={btn}
            onClick={() => {
              setEventDate(todayJST());
              setDriverName('');
              setType(TYPE_OPTIONS[0]);
              setAmount('');
              setReason('');
              setInputter(INPUTTER_OPTIONS[0]);
              setStatus(null);
            }}
            disabled={submitting}
          >
            クリア
          </button>
          {status && (
            <div
              style={{
                fontSize: 13,
                color: status.ok ? '#059669' : colors.danger,
                fontWeight: 500,
              }}
            >
              {status.ok ? '✓ ' : '⚠ '}
              {status.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4, fontWeight: 600 }}>
        {label}
      </div>
      {children}
    </div>
  );
}
