import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Course, DayType, DayTypeDef, Office, OfficeDayCourse } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnPrimary, card, colors, input, table, td, th } from '../../lib/ui';

export default function ShiftScheduleSettingsPage() {
  const [offices, setOffices] = useState<Office[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [dayTypes, setDayTypes] = useState<DayTypeDef[]>([]);
  const [officeId, setOfficeId] = useState<string>('');
  // key: `${office_id}:${course_id}:${day_type}` -> true
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [originalChecked, setOriginalChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [officesRes, coursesRes, odcRes, dtRes] = await Promise.all([
      supabase.from('offices').select('*').eq('active', true).order('sort_order').order('name'),
      supabase.from('courses').select('*').eq('active', true).order('sort_order').order('name'),
      supabase.from('office_day_courses').select('*'),
      supabase.from('day_types').select('*').order('sort_order').order('code'),
    ]);
    if (officesRes.error) setError(officesRes.error.message);
    else setOffices((officesRes.data ?? []) as Office[]);
    if (coursesRes.error) setError(coursesRes.error.message);
    else setCourses((coursesRes.data ?? []) as Course[]);
    if (dtRes.error) setError(dtRes.error.message);
    else setDayTypes((dtRes.data ?? []) as DayTypeDef[]);
    if (odcRes.error) setError(odcRes.error.message);
    else {
      const s = new Set<string>();
      for (const r of (odcRes.data ?? []) as OfficeDayCourse[]) {
        s.add(`${r.office_id}:${r.course_id}:${r.day_type}`);
      }
      setChecked(s);
      setOriginalChecked(new Set(s));
    }
    setLoading(false);
    if (officesRes.data && officesRes.data.length > 0 && !officeId) {
      setOfficeId((officesRes.data[0] as Office).id);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const officeCourses = useMemo(
    () => courses.filter((c) => c.office_id === officeId),
    [courses, officeId],
  );

  const dayTypeCodes = useMemo(() => dayTypes.map((d) => d.code), [dayTypes]);

  const makeKey = (courseId: string, dayType: DayType) =>
    `${officeId}:${courseId}:${dayType}`;

  const isChecked = (courseId: string, dayType: DayType) =>
    checked.has(makeKey(courseId, dayType));

  const toggle = (courseId: string, dayType: DayType) => {
    const k = makeKey(courseId, dayType);
    const next = new Set(checked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setChecked(next);
  };

  const toggleAllForDay = (dayType: DayType) => {
    const next = new Set(checked);
    const allOn = officeCourses.every((c) => next.has(makeKey(c.id, dayType)));
    for (const c of officeCourses) {
      const k = makeKey(c.id, dayType);
      if (allOn) next.delete(k);
      else next.add(k);
    }
    setChecked(next);
  };

  const toggleAllForCourse = (courseId: string) => {
    const next = new Set(checked);
    const allOn = dayTypeCodes.every((dt) => next.has(makeKey(courseId, dt)));
    for (const dt of dayTypeCodes) {
      const k = makeKey(courseId, dt);
      if (allOn) next.delete(k);
      else next.add(k);
    }
    setChecked(next);
  };

  const isDirty = useMemo(() => {
    if (checked.size !== originalChecked.size) return true;
    for (const k of checked) if (!originalChecked.has(k)) return true;
    return false;
  }, [checked, originalChecked]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setInfo(null);
    // この営業所について全削除 → checked のみ insert
    const { error: delErr } = await supabase
      .from('office_day_courses')
      .delete()
      .eq('office_id', officeId);
    if (delErr) {
      setError(delErr.message);
      setSaving(false);
      return;
    }
    const inserts: { office_id: string; course_id: string; day_type: DayType }[] = [];
    for (const k of checked) {
      const [oid, courseId, dayType] = k.split(':') as [string, string, DayType];
      if (oid !== officeId) continue;
      inserts.push({ office_id: oid, course_id: courseId, day_type: dayType });
    }
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from('office_day_courses').insert(inserts);
      if (insErr) {
        setError(insErr.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setOriginalChecked(new Set(checked));
    setInfo(`${inserts.length}件 保存しました`);
    setTimeout(() => setInfo(null), 3000);
  };

  const revert = () => {
    setChecked(new Set(originalChecked));
  };

  const selectedOffice = offices.find((o) => o.id === officeId);

  return (
    <div>
      <PageHeader
        title="シフト曜日別コース設定"
        actions={
          <>
            {isDirty && (
              <button style={btn} onClick={revert} disabled={saving}>
                変更を破棄
              </button>
            )}
            <button
              style={btnPrimary}
              onClick={save}
              disabled={saving || !isDirty || !officeId}
            >
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
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          営業所
          <select
            style={{ ...input, minWidth: 200 }}
            value={officeId}
            onChange={(e) => {
              if (isDirty && !confirm('未保存の変更があります。破棄して切替えますか?')) return;
              setOfficeId(e.target.value);
              setChecked(new Set(originalChecked));
            }}
          >
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>
          コース × 曜日区分のチェックで、その曜日に稼働するコースを設定します。行/列ヘッダーをクリックで一括 ON/OFF。
        </div>
      </div>

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}
      {info && (
        <div style={{ color: colors.success, marginBottom: 12 }}>{info}</div>
      )}

      {loading ? (
        <div style={{ color: colors.textMuted }}>読み込み中...</div>
      ) : !selectedOffice ? (
        <div style={{ color: colors.textMuted }}>営業所が登録されていません。</div>
      ) : officeCourses.length === 0 ? (
        <div style={{ color: colors.textMuted }}>
          この営業所にアクティブなコースがありません。
        </div>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, minWidth: 160 }}>コース</th>
                {dayTypes.map((dt) => {
                  const allOn = officeCourses.every((c) => isChecked(c.id, dt.code));
                  return (
                    <th
                      key={dt.code}
                      style={{ ...th, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => toggleAllForDay(dt.code)}
                      title="クリックでこの曜日区分を一括 ON/OFF"
                    >
                      {dt.label}
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 400,
                          color: allOn ? colors.primary : colors.textMuted,
                        }}
                      >
                        {allOn ? '全ON' : '一部/OFF'}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {officeCourses.map((c) => {
                const allOn = dayTypeCodes.every((dt) => isChecked(c.id, dt));
                return (
                  <tr key={c.id}>
                    <td
                      style={{ ...td, cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => toggleAllForCourse(c.id)}
                      title="クリックでこのコースを全曜日 ON/OFF"
                    >
                      <span style={{ fontWeight: allOn ? 600 : 400 }}>{c.name}</span>
                    </td>
                    {dayTypes.map((dt) => (
                      <td key={dt.code} style={{ ...td, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isChecked(c.id, dt.code)}
                          onChange={() => toggle(c.id, dt.code)}
                          style={{ cursor: 'pointer', width: 18, height: 18 }}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
