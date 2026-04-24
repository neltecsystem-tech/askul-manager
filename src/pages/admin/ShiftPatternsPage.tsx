import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Course, Office, Profile, ShiftPattern } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnPrimary, card, colors, input, table, td, th } from '../../lib/ui';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const DOW_CODES = [0, 1, 2, 3, 4, 5, 6];

export default function ShiftPatternsPage() {
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [originalPatterns, setOriginalPatterns] = useState<ShiftPattern[]>([]);
  const [officeId, setOfficeId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [drvRes, crsRes, offRes, patRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('role', 'driver')
        .eq('active', true)
        .order('full_name'),
      supabase
        .from('courses')
        .select('*')
        .eq('active', true)
        .order('sort_order')
        .order('name'),
      supabase.from('offices').select('*').eq('active', true).order('sort_order').order('name'),
      supabase.from('shift_patterns').select('*'),
    ]);
    if (drvRes.error) setError(drvRes.error.message);
    else setDrivers((drvRes.data ?? []) as Profile[]);
    if (crsRes.error) setError(crsRes.error.message);
    else setCourses((crsRes.data ?? []) as Course[]);
    if (offRes.error) setError(offRes.error.message);
    else setOffices((offRes.data ?? []) as Office[]);
    if (patRes.error) setError(patRes.error.message);
    else {
      setPatterns((patRes.data ?? []) as ShiftPattern[]);
      setOriginalPatterns((patRes.data ?? []) as ShiftPattern[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filteredDrivers = useMemo(
    () => (officeId ? drivers.filter((d) => d.office_id === officeId) : drivers),
    [drivers, officeId],
  );

  const patternKey = (driverId: string, dow: number) => `${driverId}:${dow}`;

  const patternMap = useMemo(() => {
    const m = new Map<string, ShiftPattern>();
    for (const p of patterns) m.set(patternKey(p.driver_id, p.day_of_week), p);
    return m;
  }, [patterns]);

  const getCourseId = (driverId: string, dow: number): string =>
    patternMap.get(patternKey(driverId, dow))?.course_id ?? '';

  const setCourseId = (driverId: string, dow: number, courseId: string) => {
    setPatterns((prev) => {
      const filtered = prev.filter(
        (p) => !(p.driver_id === driverId && p.day_of_week === dow),
      );
      if (!courseId) return filtered;
      const existing = prev.find(
        (p) => p.driver_id === driverId && p.day_of_week === dow,
      );
      return [
        ...filtered,
        {
          id: existing?.id ?? `tmp-${driverId}-${dow}`,
          driver_id: driverId,
          day_of_week: dow,
          course_id: courseId,
          created_at: existing?.created_at ?? '',
        },
      ];
    });
  };

  const isDirty = useMemo(() => {
    const toKey = (p: ShiftPattern) => `${p.driver_id}:${p.day_of_week}:${p.course_id}`;
    const a = new Set(patterns.map(toKey));
    const b = new Set(originalPatterns.map(toKey));
    if (a.size !== b.size) return true;
    for (const k of a) if (!b.has(k)) return true;
    return false;
  }, [patterns, originalPatterns]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setInfo(null);
    // 対象ドライバーで全消し → insert
    const driverIds = filteredDrivers.map((d) => d.id);
    if (driverIds.length > 0) {
      const { error: delErr } = await supabase
        .from('shift_patterns')
        .delete()
        .in('driver_id', driverIds);
      if (delErr) {
        setError(delErr.message);
        setSaving(false);
        return;
      }
    }
    const inserts = patterns
      .filter((p) => driverIds.includes(p.driver_id))
      .map((p) => ({
        driver_id: p.driver_id,
        day_of_week: p.day_of_week,
        course_id: p.course_id,
      }));
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from('shift_patterns').insert(inserts);
      if (insErr) {
        setError(insErr.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setInfo(`${inserts.length} 件 保存しました`);
    setTimeout(() => setInfo(null), 3000);
    await load();
  };

  const revert = () => setPatterns(originalPatterns);

  const courseOptions = useMemo(() => {
    return officeId
      ? courses.filter((c) => c.office_id === officeId)
      : courses;
  }, [courses, officeId]);

  return (
    <div>
      <PageHeader
        title="基本シフトパターン"
        actions={
          <>
            {isDirty && (
              <button style={btn} onClick={revert} disabled={saving}>
                変更を破棄
              </button>
            )}
            <button style={btnPrimary} onClick={save} disabled={saving || !isDirty}>
              {saving ? '保存中...' : isDirty ? '保存' : '変更なし'}
            </button>
          </>
        }
      />

      <div
        style={{
          ...card,
          marginBottom: 12,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <label style={lbl}>
          営業所
          <select
            style={{ ...input, minWidth: 180 }}
            value={officeId}
            onChange={(e) => {
              if (isDirty && !confirm('未保存の変更があります。破棄して切替えますか?')) return;
              setOfficeId(e.target.value);
              revert();
            }}
          >
            <option value="">すべて</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>
          各ドライバーの曜日別・基本担当コースを設定します。シフト編成時にここから自動反映できます。
        </div>
      </div>

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}
      {info && <div style={{ color: colors.success, marginBottom: 12 }}>{info}</div>}

      <div style={{ ...card, overflow: 'auto' }}>
        {loading ? (
          <div style={{ color: colors.textMuted }}>読み込み中...</div>
        ) : filteredDrivers.length === 0 ? (
          <div style={{ color: colors.textMuted }}>対象ドライバーがいません。</div>
        ) : (
          <table style={{ ...table, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...th, position: 'sticky', left: 0, zIndex: 2, minWidth: 140 }}>
                  ドライバー
                </th>
                {DOW_CODES.map((dow) => (
                  <th
                    key={dow}
                    style={{
                      ...th,
                      textAlign: 'center',
                      minWidth: 140,
                      background: dow === 0 || dow === 6 ? '#fde8e8' : th.background,
                    }}
                  >
                    {DOW_LABELS[dow]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((drv) => (
                <tr key={drv.id}>
                  <td
                    style={{
                      ...td,
                      position: 'sticky',
                      left: 0,
                      background: '#f9fafb',
                      fontWeight: 600,
                    }}
                  >
                    {drv.full_name}
                  </td>
                  {DOW_CODES.map((dow) => (
                    <td
                      key={dow}
                      style={{
                        ...td,
                        background: dow === 0 || dow === 6 ? '#fef2f2' : '#fff',
                      }}
                    >
                      <select
                        style={{ ...input, width: '100%', fontSize: 12 }}
                        value={getCourseId(drv.id, dow)}
                        onChange={(e) => setCourseId(drv.id, dow, e.target.value)}
                      >
                        <option value="">(なし)</option>
                        {courseOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
