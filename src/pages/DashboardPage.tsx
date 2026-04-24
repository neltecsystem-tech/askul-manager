import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import type { Course, Incident, Office, Profile, ShiftAssignment } from '../types/db';
import { card, colors, table, td, th } from '../lib/ui';

const COURSE_COLORS = [
  '#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#059669',
  '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#db2777',
  '#be185d', '#9a3412', '#166534', '#1e40af', '#6b21a8',
  '#0f766e', '#a16207', '#b91c1c', '#0e7490', '#4338ca',
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayLabel(): string {
  const d = new Date();
  const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 (${dow})`;
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [incidentsYesterday, setIncidentsYesterday] = useState<Incident[]>([]);
  const [incidentsThisMonth, setIncidentsThisMonth] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const mapLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const today = todayStr();
      // 前日
      const yd = new Date();
      yd.setDate(yd.getDate() - 1);
      const yesterday = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;
      // 今月の範囲
      const now = new Date();
      const mFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const mTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const [asgRes, courseRes, drvRes, offRes, incYesRes, incMonRes] = await Promise.all([
        supabase.from('shift_assignments').select('*').eq('work_date', today),
        supabase.from('courses').select('*').eq('active', true).order('sort_order').order('name'),
        supabase.from('profiles').select('*').eq('active', true).order('full_name'),
        supabase.from('offices').select('*').eq('active', true).order('sort_order').order('name'),
        supabase.from('incidents').select('*').eq('occurred_at', yesterday),
        supabase.from('incidents').select('*').gte('occurred_at', mFrom).lte('occurred_at', mTo),
      ]);
      if (asgRes.error) setError(asgRes.error.message);
      else setAssignments((asgRes.data ?? []) as ShiftAssignment[]);
      if (!courseRes.error) setCourses((courseRes.data ?? []) as Course[]);
      if (!drvRes.error) setDrivers((drvRes.data ?? []) as Profile[]);
      if (!offRes.error) setOffices((offRes.data ?? []) as Office[]);
      if (!incYesRes.error) setIncidentsYesterday((incYesRes.data ?? []) as Incident[]);
      if (!incMonRes.error) setIncidentsThisMonth((incMonRes.data ?? []) as Incident[]);
      setLoading(false);
    };
    load();
  }, []);

  const courseById = useMemo(() => {
    const m = new Map<string, Course>();
    for (const c of courses) m.set(c.id, c);
    return m;
  }, [courses]);

  const driverById = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const d of drivers) m.set(d.id, d);
    return m;
  }, [drivers]);

  // 管理者向け: 営業所ごとにグルーピング
  const byOffice = useMemo(() => {
    const m = new Map<string | null, ShiftAssignment[]>();
    for (const a of assignments) {
      const course = courseById.get(a.course_id);
      const key = course?.office_id ?? null;
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return m;
  }, [assignments, courseById]);

  // ドライバー向け: 自分の今日の割当
  const myAssignments = useMemo(
    () => (profile ? assignments.filter((a) => a.driver_id === profile.id) : []),
    [assignments, profile],
  );

  const courseColorMap = useMemo(() => {
    const m = new Map<string, string>();
    courses.forEach((c, i) => m.set(c.id, COURSE_COLORS[i % COURSE_COLORS.length]));
    return m;
  }, [courses]);

  // 今日表示すべきコース (管理者: 全今日の割当、ドライバー: 自分の割当)
  const relevantCourses = useMemo(() => {
    const ids = new Set<string>();
    const source = isAdmin ? assignments : myAssignments;
    for (const a of source) ids.add(a.course_id);
    return courses.filter((c) => ids.has(c.id));
  }, [courses, assignments, myAssignments, isAdmin]);

  // 地図初期化
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, {
      center: [35.68, 139.3],
      zoom: 10,
      zoomControl: true,
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      mapLayerRef.current = null;
    };
  }, []);

  // コース地図描画
  useEffect(() => {
    if (!mapRef.current) return;
    if (mapLayerRef.current) mapRef.current.removeLayer(mapLayerRef.current);
    const group = L.layerGroup().addTo(mapRef.current);
    mapLayerRef.current = group;

    let hasBounds = false;
    let bounds: L.LatLngBounds | null = null;
    for (const c of relevantCourses) {
      const gj = c.area_geojson as GeoJSON.FeatureCollection | null | undefined;
      if (!gj?.features?.length) continue;
      const color = courseColorMap.get(c.id) ?? '#888';
      const gl = L.geoJSON(gj, {
        style: () => ({
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.35,
        }),
        interactive: false,
      });
      gl.addTo(group);
      try {
        const b = gl.getBounds();
        if (b.isValid()) {
          if (!bounds) bounds = L.latLngBounds(b.getSouthWest(), b.getNorthEast());
          else bounds.extend(b);
          hasBounds = true;
        }
      } catch {
        /* ignore */
      }
    }
    if (hasBounds && bounds) {
      mapRef.current.fitBounds(bounds, { padding: [20, 20] });
    } else {
      // 東京本土のデフォルト領域
      mapRef.current.fitBounds(
        L.latLngBounds(L.latLng(35.48, 138.92), L.latLng(35.92, 139.95)),
        { padding: [20, 20] },
      );
    }
  }, [relevantCourses, courseColorMap]);

  const officeName = (id: string | null): string =>
    id ? offices.find((o) => o.id === id)?.name ?? '(不明)' : '(営業所未設定)';

  return (
    <div>
      <h1 style={{ fontSize: 18, margin: '0 0 16px' }}>ダッシュボード</h1>

      <div style={{ ...card, marginBottom: 16 }}>
        <p style={{ margin: 0 }}>
          こんにちは、{profile?.full_name || 'ユーザー'}さん。
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: colors.textMuted }}>
          {todayLabel()}
        </p>
      </div>

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12 }}>{error}</div>
      )}

      {/* 不具合件数サマリ */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Link to="/incidents" style={statLink}>
          <div style={statCard}>
            <div style={statLabel}>前日の不具合発生件数</div>
            <div
              style={{
                ...statValue,
                color: incidentsYesterday.length > 0 ? '#dc2626' : colors.text,
              }}
            >
              {incidentsYesterday.length}
              <span style={statUnit}>件</span>
            </div>
          </div>
        </Link>
        <Link to="/incidents" style={statLink}>
          <div style={statCard}>
            <div style={statLabel}>今月の不具合件数</div>
            <div
              style={{
                ...statValue,
                color: incidentsThisMonth.length > 0 ? '#ea580c' : colors.text,
              }}
            >
              {incidentsThisMonth.length}
              <span style={statUnit}>件</span>
            </div>
          </div>
        </Link>
      </div>

      {/* 今日のコース地図 */}
      <div style={{ ...card, marginBottom: 16 }}>
        <h2 style={sectionTitle}>今日のコースエリア</h2>
        {relevantCourses.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 12 }}>
            今日は表示対象のコースがありません。
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginBottom: 8,
              }}
            >
              {relevantCourses.map((c) => {
                const color = courseColorMap.get(c.id) ?? '#888';
                return (
                  <span
                    key={c.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: color + '22',
                      border: `1px solid ${color}`,
                      fontSize: 11,
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: color,
                      }}
                    />
                    {c.name}
                  </span>
                );
              })}
            </div>
          </>
        )}
        <div
          ref={mapDivRef}
          style={{
            height: 360,
            border: '1px solid ' + colors.borderLight,
            borderRadius: 4,
            background: '#ffffff',
          }}
        />
        <style>{`.leaflet-container { background: #ffffff !important; }`}</style>
      </div>

      {/* ドライバー: 自分の今日のシフト */}
      {!isAdmin && (
        <div style={{ ...card, marginBottom: 16 }}>
          <h2 style={sectionTitle}>今日のあなたのシフト</h2>
          {loading ? (
            <div style={{ color: colors.textMuted }}>読み込み中...</div>
          ) : myAssignments.length === 0 ? (
            <div style={{ color: colors.textMuted }}>
              今日のシフトは入っていません。
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
              {myAssignments.map((a) => {
                const c = courseById.get(a.course_id);
                return (
                  <li key={a.id} style={{ marginBottom: 4 }}>
                    <strong>{c?.name ?? '(不明コース)'}</strong>
                    <span style={{ fontSize: 12, color: colors.textMuted, marginLeft: 8 }}>
                      {officeName(c?.office_id ?? null)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 管理者: 全営業所のシフト */}
      {isAdmin && (
        <div style={card}>
          <h2 style={sectionTitle}>今日のシフト ({assignments.length}件)</h2>
          {loading ? (
            <div style={{ color: colors.textMuted }}>読み込み中...</div>
          ) : assignments.length === 0 ? (
            <div style={{ color: colors.textMuted }}>
              今日のシフトはまだ割当されていません。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {Array.from(byOffice.entries())
                .sort(([a], [b]) => {
                  const oa = offices.find((o) => o.id === a)?.sort_order ?? 9999;
                  const ob = offices.find((o) => o.id === b)?.sort_order ?? 9999;
                  return oa - ob;
                })
                .map(([officeId, asgs]) => (
                  <div key={officeId ?? 'none'}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: colors.text,
                        marginBottom: 6,
                      }}
                    >
                      {officeName(officeId)} ({asgs.length}件)
                    </div>
                    <table style={table}>
                      <thead>
                        <tr>
                          <th style={{ ...th, width: '50%' }}>コース</th>
                          <th style={th}>ドライバー</th>
                        </tr>
                      </thead>
                      <tbody>
                        {asgs
                          .slice()
                          .sort((x, y) => {
                            const cx = courseById.get(x.course_id)?.sort_order ?? 9999;
                            const cy = courseById.get(y.course_id)?.sort_order ?? 9999;
                            return cx - cy;
                          })
                          .map((a) => {
                            const c = courseById.get(a.course_id);
                            const d = driverById.get(a.driver_id);
                            return (
                              <tr key={a.id}>
                                <td style={td}>{c?.name ?? '(不明)'}</td>
                                <td style={td}>{d?.full_name ?? '(不明)'}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const sectionTitle = {
  fontSize: 14,
  margin: '0 0 12px',
  color: colors.text,
};

const statLink = {
  textDecoration: 'none',
  color: 'inherit',
};
const statCard = {
  ...card,
  padding: '12px 16px',
  transition: 'box-shadow 0.15s',
  cursor: 'pointer',
};
const statLabel = {
  fontSize: 12,
  color: colors.textMuted,
  marginBottom: 4,
};
const statValue = {
  fontSize: 28,
  fontWeight: 700,
  lineHeight: 1,
  color: colors.text,
};
const statUnit = {
  fontSize: 14,
  fontWeight: 400,
  marginLeft: 4,
  color: colors.textMuted,
};
