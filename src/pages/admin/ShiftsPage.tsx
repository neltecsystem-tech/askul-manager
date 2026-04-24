import { useEffect, useMemo, useState } from 'react';
import * as JapaneseHolidays from 'japanese-holidays';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import type { Course, DayTypeDef, Office, Profile, ShiftAssignment, ShiftPattern, SpecialDate } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, colors, input, th } from '../../lib/ui';

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export default function ShiftsPage() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin';
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [officeId, setOfficeId] = useState<string>('');

  const [offices, setOffices] = useState<Office[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [dayTypes, setDayTypes] = useState<DayTypeDef[]>([]);
  const [specialDates, setSpecialDates] = useState<SpecialDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'course' | 'driver'>('course');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<
    | { mode: 'course'; date: string; course: Course }
    | { mode: 'driver'; date: string; driver: Profile }
    | null
  >(null);
  const [saving, setSaving] = useState(false);

  const loadMasters = async () => {
    const [offRes, drvRes, dtRes, spRes] = await Promise.all([
      supabase.from('offices').select('*').eq('active', true).order('sort_order').order('name'),
      supabase.from('profiles').select('*').eq('role', 'driver').eq('active', true).order('full_name'),
      supabase.from('day_types').select('*').order('sort_order').order('code'),
      supabase.from('special_dates').select('*'),
    ]);
    if (!offRes.error && offRes.data) setOffices(offRes.data as Office[]);
    if (!drvRes.error && drvRes.data) setDrivers(drvRes.data as Profile[]);
    if (!dtRes.error && dtRes.data) setDayTypes(dtRes.data as DayTypeDef[]);
    if (!spRes.error && spRes.data) setSpecialDates(spRes.data as SpecialDate[]);
  };

  const loadMonth = async () => {
    setLoading(true);
    setError(null);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;

    // コースは営業所フィルタも(あれば)
    let courseQuery = supabase
      .from('courses')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .order('name');
    if (officeId) courseQuery = courseQuery.eq('office_id', officeId);
    const [courseRes, shiftRes] = await Promise.all([
      courseQuery,
      supabase
        .from('shift_assignments')
        .select('*')
        .gte('work_date', from)
        .lte('work_date', to),
    ]);
    if (courseRes.error) setError(courseRes.error.message);
    else setCourses((courseRes.data ?? []) as Course[]);
    if (shiftRes.error) setError(shiftRes.error.message);
    else setAssignments((shiftRes.data ?? []) as ShiftAssignment[]);
    setLoading(false);
  };

  useEffect(() => {
    loadMasters();
  }, []);

  useEffect(() => {
    loadMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, officeId]);

  const specialByDate = useMemo(() => {
    const m = new Map<string, SpecialDate>();
    for (const s of specialDates) m.set(s.date, s);
    return m;
  }, [specialDates]);

  const dayTypeByCode = useMemo(() => {
    const m = new Map<string, DayTypeDef>();
    for (const d of dayTypes) m.set(d.code, d);
    return m;
  }, [dayTypes]);

  // 優先順位: 特別日 > 祝日 > 土/日 > 平日
  const resolveDayType = (dateStr: string, dateObj: Date): string => {
    const special = specialByDate.get(dateStr);
    if (special) return special.day_type_code;
    if (JapaneseHolidays.isHoliday(dateObj)) return 'holiday';
    const dow = dateObj.getDay();
    if (dow === 6) return 'saturday';
    if (dow === 0) return 'sunday';
    return 'weekday';
  };

  const days = useMemo(() => {
    const n = daysInMonth(year, month);
    const arr: {
      date: string;
      dow: string;
      isWeekend: boolean;
      isHoliday: boolean;
      holidayName: string | null;
      dayTypeCode: string;
      dayTypeLabel: string;
      isCustomType: boolean;
      specialNote: string | null;
    }[] = [];
    for (let d = 1; d <= n; d++) {
      const date = new Date(year, month - 1, d);
      const ds = fmtDate(date);
      const holidayName = JapaneseHolidays.isHoliday(date) ?? null;
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const dtCode = resolveDayType(ds, date);
      const dtDef = dayTypeByCode.get(dtCode);
      const isCustomType = !!dtDef && !dtDef.is_system;
      arr.push({
        date: ds,
        dow: ['日', '月', '火', '水', '木', '金', '土'][date.getDay()],
        isWeekend,
        isHoliday: !!holidayName,
        holidayName,
        dayTypeCode: dtCode,
        dayTypeLabel: dtDef?.label ?? dtCode,
        isCustomType,
        specialNote: specialByDate.get(ds)?.note ?? null,
      });
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, specialByDate, dayTypeByCode]);

  // (date, course_id) -> assignment
  const assignmentIndex = useMemo(() => {
    const m = new Map<string, ShiftAssignment>();
    for (const a of assignments) m.set(`${a.work_date}::${a.course_id}`, a);
    return m;
  }, [assignments]);

  // (driver_id, date) -> assignments[]
  const driverDateIndex = useMemo(() => {
    const m = new Map<string, ShiftAssignment[]>();
    for (const a of assignments) {
      const k = `${a.driver_id}::${a.work_date}`;
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    return m;
  }, [assignments]);

  const driverById = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const d of drivers) m.set(d.id, d);
    return m;
  }, [drivers]);

  const courseById = useMemo(() => {
    const m = new Map<string, Course>();
    for (const c of courses) m.set(c.id, c);
    return m;
  }, [courses]);

  const filteredDrivers = useMemo(() => {
    let d = drivers;
    if (officeId) d = d.filter((x) => x.office_id === officeId);
    const q = search.trim().toLowerCase();
    if (q) d = d.filter((x) => x.full_name.toLowerCase().includes(q));
    return d;
  }, [drivers, officeId, search]);

  const assignDriver = async (date: string, course: Course, driverId: string | null) => {
    setSaving(true);
    setError(null);
    const key = `${date}::${course.id}`;
    const existing = assignmentIndex.get(key);

    if (driverId === null) {
      if (existing) {
        const { error } = await supabase.from('shift_assignments').delete().eq('id', existing.id);
        if (error) setError(error.message);
      }
    } else if (existing) {
      const { error } = await supabase
        .from('shift_assignments')
        .update({ driver_id: driverId })
        .eq('id', existing.id);
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.from('shift_assignments').insert({
        work_date: date,
        driver_id: driverId,
        course_id: course.id,
      });
      if (error) setError(error.message);
    }
    setSaving(false);
    setEditing(null);
    await loadMonth();
  };

  // ドライバー起点: (date, driver) の割当を courseId に置き換える (既存削除→insert)
  const assignCourseForDriver = async (
    date: string,
    driver: Profile,
    courseId: string | null,
  ) => {
    setSaving(true);
    setError(null);
    const existing = driverDateIndex.get(`${driver.id}::${date}`) ?? [];
    // 既存割当を全削除
    for (const a of existing) {
      const { error } = await supabase.from('shift_assignments').delete().eq('id', a.id);
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
    }
    if (courseId) {
      const { error } = await supabase.from('shift_assignments').insert({
        work_date: date,
        driver_id: driver.id,
        course_id: courseId,
      });
      if (error) setError(error.message);
    }
    setSaving(false);
    setEditing(null);
    await loadMonth();
  };

  const displayDriverName = (driverId: string | null): string => {
    if (!driverId) return '';
    const p = driverById.get(driverId);
    return p?.full_name ?? '(不明)';
  };

  const applyPatterns = async () => {
    if (!canEdit) return;
    const overwrite = confirm(
      `基本シフトパターンを ${year}年${month}月 に適用します。\n\n` +
        `OK: 既存の割当を上書きしてパターン通りに全置換\n` +
        `キャンセル: 空いている日だけ埋める (既存は維持)\n\n` +
        `※ このダイアログで「キャンセル」→次のダイアログで「OK」を押すと空欄埋めモードになります。`,
    );
    if (!overwrite) {
      if (!confirm('空欄のみパターンで埋めます。よろしいですか？')) return;
    }
    setSaving(true);
    setError(null);
    const { data: patternData, error: patErr } = await supabase
      .from('shift_patterns')
      .select('*');
    if (patErr) {
      setError(patErr.message);
      setSaving(false);
      return;
    }
    const patterns = (patternData ?? []) as ShiftPattern[];
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
    // 既存割当を取得
    const { data: existing } = await supabase
      .from('shift_assignments')
      .select('*')
      .gte('work_date', from)
      .lte('work_date', to);
    const existingList = (existing ?? []) as ShiftAssignment[];
    // 上書きモード: その月の既存を全削除
    if (overwrite && existingList.length > 0) {
      const { error: delErr } = await supabase
        .from('shift_assignments')
        .delete()
        .gte('work_date', from)
        .lte('work_date', to);
      if (delErr) {
        setError(delErr.message);
        setSaving(false);
        return;
      }
    }
    // パターンを日ごとに展開 → insert
    const inserts: { work_date: string; driver_id: string; course_id: string }[] = [];
    for (const d of days) {
      const date = new Date(d.date);
      const dow = date.getDay();
      for (const p of patterns) {
        if (p.day_of_week !== dow) continue;
        // 非上書き: 既に (date, course) または (date, driver) が埋まっていればスキップ
        if (!overwrite) {
          const courseTaken = existingList.some(
            (a) => a.work_date === d.date && a.course_id === p.course_id,
          );
          const driverTaken = existingList.some(
            (a) => a.work_date === d.date && a.driver_id === p.driver_id,
          );
          if (courseTaken || driverTaken) continue;
        }
        inserts.push({
          work_date: d.date,
          driver_id: p.driver_id,
          course_id: p.course_id,
        });
      }
    }
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from('shift_assignments').insert(inserts);
      if (insErr) {
        setError(insErr.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    alert(`${inserts.length} 件を登録しました`);
    await loadMonth();
  };

  const shiftMonth = (delta: number) => {
    let y = year;
    let m = month + delta;
    if (m < 1) {
      m = 12;
      y--;
    } else if (m > 12) {
      m = 1;
      y++;
    }
    setYear(y);
    setMonth(m);
  };

  return (
    <div>
      <PageHeader
        title={canEdit ? 'コース割（シフト編成）' : 'シフト表 (閲覧)'}
        actions={
          <>
            {canEdit && (
              <button style={btn} onClick={applyPatterns} disabled={loading || saving}>
                基本パターン適用
              </button>
            )}
            <button style={btnPrimary} onClick={loadMonth} disabled={loading}>
              {loading ? '読み込み中...' : '再読み込み'}
            </button>
          </>
        }
      />

      {error && <div style={{ color: '#dc2626', marginBottom: 12 }}>{error}</div>}

      <div style={{ ...card, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <button style={btn} onClick={() => shiftMonth(-1)}>
          ← 前月
        </button>
        <label style={labelStyle}>
          年
          <input
            type="number"
            style={{ ...input, width: 90 }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label style={labelStyle}>
          月
          <input
            type="number"
            min={1}
            max={12}
            style={{ ...input, width: 70 }}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          />
        </label>
        <button style={btn} onClick={() => shiftMonth(1)}>
          次月 →
        </button>
        <label style={labelStyle}>
          営業所
          <select style={input} value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
            <option value="">すべて</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          表示
          <div style={{ display: 'flex', gap: 0 }}>
            <button
              style={{
                ...btn,
                borderTopRightRadius: 0,
                borderBottomRightRadius: 0,
                background: viewMode === 'course' ? colors.primary : btn.background,
                color: viewMode === 'course' ? '#fff' : btn.color,
                borderColor: viewMode === 'course' ? colors.primary : btn.borderColor,
              }}
              onClick={() => setViewMode('course')}
            >
              コース起点
            </button>
            <button
              style={{
                ...btn,
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                marginLeft: -1,
                background: viewMode === 'driver' ? colors.primary : btn.background,
                color: viewMode === 'driver' ? '#fff' : btn.color,
                borderColor: viewMode === 'driver' ? colors.primary : btn.borderColor,
              }}
              onClick={() => setViewMode('driver')}
            >
              ドライバー起点
            </button>
          </div>
        </label>
        {viewMode === 'driver' && (
          <label style={labelStyle}>
            ドライバー検索
            <input
              type="search"
              placeholder="名前で絞込"
              style={{ ...input, width: 160 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        )}
        <div style={{ fontSize: 12, color: colors.textMuted, marginLeft: 'auto' }}>
          {viewMode === 'course'
            ? `コース ${courses.length} × 日数 ${days.length}`
            : `ドライバー ${filteredDrivers.length} × 日数 ${days.length}`}
          {` / 登録済み ${assignments.length} 件`}
        </div>
      </div>

      <div style={{ ...card, overflow: 'auto' }}>
        {viewMode === 'course' ? (
          courses.length === 0 ? (
            <div style={{ color: colors.textMuted }}>
              コースが登録されていません。マスタ → コースマスタ で追加してください。
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...cellTh, position: 'sticky', left: 0, zIndex: 2, minWidth: 140 }}>
                    コース
                  </th>
                  {days.map((d) => (
                    <th
                      key={d.date}
                      style={{
                        ...cellTh,
                        background: d.isCustomType ? '#e9d5ff' : d.isHoliday ? '#fed7aa' : d.isWeekend ? '#fde8e8' : cellTh.background,
                        minWidth: 60,
                      }}
                      title={
                        d.isCustomType
                          ? `${d.dayTypeLabel}${d.specialNote ? ' / ' + d.specialNote : ''}`
                          : (d.holidayName ?? '')
                      }
                    >
                      <div>{Number(d.date.slice(8))}</div>
                      <div style={{ fontWeight: 400 }}>{d.dow}</div>
                      {d.isCustomType ? (
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#6b21a8' }}>
                          {d.dayTypeLabel}
                        </div>
                      ) : d.holidayName ? (
                        <div style={{ fontSize: 9, fontWeight: 400, color: '#9a3412' }}>
                          祝
                        </div>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...cellTd, position: 'sticky', left: 0, background: '#f9fafb', fontWeight: 600 }}>
                      {c.name}
                    </td>
                    {days.map((d) => {
                      const a = assignmentIndex.get(`${d.date}::${c.id}`);
                      const name = a ? displayDriverName(a.driver_id) : '';
                      return (
                        <td
                          key={d.date}
                          style={{
                            ...cellTd,
                            cursor: canEdit ? 'pointer' : 'default',
                            background: d.isCustomType ? '#faf5ff' : d.isHoliday ? '#fff7ed' : d.isWeekend ? '#fef2f2' : '#fff',
                            fontWeight: name ? 600 : 400,
                            color: name ? colors.text : colors.textMuted,
                          }}
                          onClick={
                            canEdit
                              ? () => setEditing({ mode: 'course', date: d.date, course: c })
                              : undefined
                          }
                          title={name || (canEdit ? 'クリックして割当' : '')}
                        >
                          {name || '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filteredDrivers.length === 0 ? (
          <div style={{ color: colors.textMuted }}>
            条件に合うドライバーがいません。
          </div>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...cellTh, position: 'sticky', left: 0, zIndex: 2, minWidth: 140 }}>
                  ドライバー
                </th>
                {days.map((d) => (
                  <th
                    key={d.date}
                    style={{
                      ...cellTh,
                      background: d.isCustomType ? '#e9d5ff' : d.isHoliday ? '#fed7aa' : d.isWeekend ? '#fde8e8' : cellTh.background,
                      minWidth: 60,
                    }}
                  >
                    <div>{Number(d.date.slice(8))}</div>
                    <div style={{ fontWeight: 400 }}>{d.dow}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((drv) => (
                <tr key={drv.id}>
                  <td style={{ ...cellTd, position: 'sticky', left: 0, background: '#f9fafb', fontWeight: 600 }}>
                    {drv.full_name}
                  </td>
                  {days.map((d) => {
                    const asgs = driverDateIndex.get(`${drv.id}::${d.date}`) ?? [];
                    const names = asgs
                      .map((a) => courseById.get(a.course_id)?.name ?? '?')
                      .join('／');
                    return (
                      <td
                        key={d.date}
                        style={{
                          ...cellTd,
                          cursor: canEdit ? 'pointer' : 'default',
                          background: d.isCustomType ? '#faf5ff' : d.isHoliday ? '#fff7ed' : d.isWeekend ? '#fef2f2' : '#fff',
                          fontWeight: names ? 600 : 400,
                          color: names ? colors.text : colors.textMuted,
                        }}
                        onClick={
                          canEdit
                            ? () => setEditing({ mode: 'driver', date: d.date, driver: drv })
                            : undefined
                        }
                        title={names || (canEdit ? 'クリックして割当' : '')}
                      >
                        {names || '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing?.mode === 'course' && (
        <AssignModal
          date={editing.date}
          course={editing.course}
          drivers={drivers}
          current={assignmentIndex.get(`${editing.date}::${editing.course.id}`) ?? null}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={(driverId) => assignDriver(editing.date, editing.course, driverId)}
        />
      )}
      {editing?.mode === 'driver' && (
        <AssignByDriverModal
          date={editing.date}
          driver={editing.driver}
          courses={courses}
          current={driverDateIndex.get(`${editing.driver.id}::${editing.date}`) ?? []}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={(courseId) => assignCourseForDriver(editing.date, editing.driver, courseId)}
        />
      )}
    </div>
  );
}

function AssignModal({
  date,
  course,
  drivers,
  current,
  saving,
  onClose,
  onSave,
}: {
  date: string;
  course: Course;
  drivers: Profile[];
  current: ShiftAssignment | null;
  saving: boolean;
  onClose: () => void;
  onSave: (driverId: string | null) => void;
}) {
  const [selected, setSelected] = useState<string>(current?.driver_id ?? '');

  return (
    <div style={modal.overlay}>
      <div style={modal.modal}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>コース割当</h2>
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
          {date} ／ <strong>{course.name}</strong>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          ドライバー
          <select
            style={input}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">(未割当)</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
          <div>
            {current && (
              <button style={btnDanger} onClick={() => onSave(null)} disabled={saving}>
                割当解除
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} onClick={onClose} disabled={saving}>
              キャンセル
            </button>
            <button
              style={btnPrimary}
              onClick={() => onSave(selected || null)}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssignByDriverModal({
  date,
  driver,
  courses,
  current,
  saving,
  onClose,
  onSave,
}: {
  date: string;
  driver: Profile;
  courses: Course[];
  current: ShiftAssignment[];
  saving: boolean;
  onClose: () => void;
  onSave: (courseId: string | null) => void;
}) {
  const [selected, setSelected] = useState<string>(current[0]?.course_id ?? '');
  const hasCurrent = current.length > 0;

  return (
    <div style={modal.overlay}>
      <div style={modal.modal}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>コース割当 (ドライバー起点)</h2>
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
          {date} ／ <strong>{driver.full_name}</strong>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          コース
          <select
            style={input}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">(未割当)</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
          <div>
            {hasCurrent && (
              <button style={btnDanger} onClick={() => onSave(null)} disabled={saving}>
                割当解除
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} onClick={onClose} disabled={saving}>
              キャンセル
            </button>
            <button
              style={btnPrimary}
              onClick={() => onSave(selected || null)}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
const cellTh = {
  ...th,
  fontSize: 11,
  padding: '4px 6px',
  border: '1px solid #d1d5db',
  background: '#f3f4f6',
  textAlign: 'center' as const,
};
const cellTd = {
  border: '1px solid #e5e7eb',
  padding: '4px 6px',
  textAlign: 'center' as const,
  whiteSpace: 'nowrap' as const,
};
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
  modal: { background: '#fff', borderRadius: 6, padding: 20, width: 380, maxWidth: '90vw' },
};
