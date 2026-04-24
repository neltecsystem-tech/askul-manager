import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import * as topojsonClient from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { supabase } from '../../lib/supabase';
import type { Course } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnPrimary, card, colors } from '../../lib/ui';

const WARDS_URL = 'https://raw.githubusercontent.com/dataofjapan/land/master/tokyo.geojson';
const CHOME_TOPO_URL =
  'https://raw.githubusercontent.com/nyampire/jp_chome_boundary/master/TopoJSON/13-tokyo-all.topojson';

// 20色パレット (各コースに自動割り当て)
const COURSE_COLORS = [
  '#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#059669',
  '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#db2777',
  '#be185d', '#9a3412', '#166534', '#1e40af', '#6b21a8',
  '#0f766e', '#a16207', '#b91c1c', '#0e7490', '#4338ca',
];

function getCourseColor(index: number): string {
  return COURSE_COLORS[index % COURSE_COLORS.length];
}

type TownKey = string; // `${wardName}:${townName}`

// モジュールレベルの町丁目データキャッシュ (ページ遷移でも保持)
let chomeGeoJsonCache: GeoJSON.FeatureCollection | null = null;
let chomeFetchPromise: Promise<GeoJSON.FeatureCollection> | null = null;

async function loadChomeData(): Promise<GeoJSON.FeatureCollection> {
  if (chomeGeoJsonCache) return chomeGeoJsonCache;
  if (chomeFetchPromise) return chomeFetchPromise;
  chomeFetchPromise = (async () => {
    const res = await fetch(CHOME_TOPO_URL);
    if (!res.ok) throw new Error('chome topojson http ' + res.status);
    const topo = (await res.json()) as Topology;
    const firstKey = Object.keys(topo.objects)[0];
    const obj = topo.objects[firstKey] as GeometryCollection;
    const gj = topojsonClient.feature(topo, obj) as unknown as GeoJSON.FeatureCollection;
    chomeGeoJsonCache = gj;
    console.log(`町丁目データ読み込み完了: ${gj.features.length} features`);
    return gj;
  })();
  return chomeFetchPromise;
}

function extractTownName(moji: string): string {
  const m = moji.match(/^(.+?)[0-9０-９一二三四五六七八九十]+丁目$/);
  return m ? m[1] : moji;
}

function featureCenter(f: GeoJSON.Feature): L.LatLng | null {
  const g = f.geometry;
  let coords: number[][] = [];
  if (g.type === 'Polygon') {
    coords = g.coordinates[0] ?? [];
  } else if (g.type === 'MultiPolygon') {
    let biggest: number[][] = [];
    for (const poly of g.coordinates) {
      const ring = poly[0] ?? [];
      if (ring.length > biggest.length) biggest = ring;
    }
    coords = biggest;
  }
  if (coords.length === 0) return null;
  let sumLat = 0;
  let sumLng = 0;
  for (const c of coords) {
    sumLng += c[0];
    sumLat += c[1];
  }
  return L.latLng(sumLat / coords.length, sumLng / coords.length);
}

export default function CoursesMapPage() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const wardsLayerRef = useRef<L.GeoJSON | null>(null);
  const wardLabelsRef = useRef<L.LayerGroup | null>(null);
  const detailLayerRef = useRef<L.LayerGroup | null>(null);
  const exitDetailRef = useRef<(() => void) | null>(null);
  const mainlandBoundsRef = useRef<L.LatLngBounds | null>(null);
  const selectedTownsRef = useRef<Map<TownKey, GeoJSON.Feature[]>>(new Map());
  const townLayersRef = useRef<Map<TownKey, L.GeoJSON>>(new Map());
  const selectedOverlayRef = useRef<L.LayerGroup | null>(null);
  const otherCoursesLayerRef = useRef<L.LayerGroup | null>(null);
  const editingColorRef = useRef<string>(COURSE_COLORS[0]);
  // コース別 保留中の編集状態 (保存前の複数コース同時編集用)
  const pendingByCourseRef = useRef<
    Map<string, { towns: Map<TownKey, GeoJSON.Feature[]>; manual: GeoJSON.Feature[] }>
  >(new Map());
  // 未保存コースID集合
  const dirtyCoursesRef = useRef<Set<string>>(new Set());

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [dirtyCount, setDirtyCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wardsLoading, setWardsLoading] = useState(true);
  const [detailWardName, setDetailWardName] = useState<string | null>(null);
  const [chomeLoading, setChomeLoading] = useState(false);
  type ToolMode = 'none' | 'fill' | 'erase';
  const [toolMode, setToolMode] = useState<ToolMode>('none');
  const freehandLineRef = useRef<L.Polyline | null>(null);
  const [chomeClickMode, setChomeClickMode] = useState(false);
  const chomeClickModeRef = useRef(false);
  useEffect(() => {
    chomeClickModeRef.current = chomeClickMode;
  }, [chomeClickMode]);

  // コース別の色マップ (sort_order 順のインデックスで自動割当)
  const courseColorMap = useMemo(() => {
    const m = new Map<string, string>();
    courses.forEach((c, i) => m.set(c.id, getCourseColor(i)));
    return m;
  }, [courses]);

  const editingColor = selectedCourseId
    ? courseColorMap.get(selectedCourseId) ?? COURSE_COLORS[0]
    : COURSE_COLORS[0];

  // editingColorRef を同期
  useEffect(() => {
    editingColorRef.current = editingColor;
  }, [editingColor]);

  // 派生値
  const currentIsDirty = !!selectedCourseId && dirtyCoursesRef.current.has(selectedCourseId);
  const hasAnyDirty = dirtyCount > 0;

  // 現在編集中コースを dirty としてマーク
  const markCurrentDirty = () => {
    if (!selectedCourseId) return;
    const before = dirtyCoursesRef.current.size;
    dirtyCoursesRef.current.add(selectedCourseId);
    if (dirtyCoursesRef.current.size !== before) {
      setDirtyCount(dirtyCoursesRef.current.size);
    }
  };

  // useEffect 内 closure からマーク関数を呼べるように ref に保持 (同期は後段で)
  const markDirtyRef = useRef<() => void>(() => {});
  const renderOtherCoursesRef = useRef<() => void>(() => {});

  // 現在編集中の drawnItems を pending に吸い上げる
  const flushCurrentToPending = () => {
    if (!selectedCourseId || !drawnItemsRef.current) return;
    const pending = pendingByCourseRef.current.get(selectedCourseId) ?? {
      towns: selectedTownsRef.current,
      manual: [],
    };
    const drawnGj = drawnItemsRef.current.toGeoJSON() as GeoJSON.FeatureCollection;
    pending.manual = drawnGj.features;
    pending.towns = selectedTownsRef.current;
    pendingByCourseRef.current.set(selectedCourseId, pending);
  };

  const loadCourses = async () => {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .order('name');
    if (error) setError(error.message);
    else setCourses((data ?? []) as Course[]);
  };

  useEffect(() => {
    loadCourses();
  }, []);

  // 編集中コースの選択済み町をメインビューで色付け表示
  const renderSelectedOverlay = () => {
    if (!mapRef.current) return;
    if (!selectedOverlayRef.current) {
      selectedOverlayRef.current = L.layerGroup().addTo(mapRef.current);
    } else {
      selectedOverlayRef.current.clearLayers();
      if (!mapRef.current.hasLayer(selectedOverlayRef.current)) {
        selectedOverlayRef.current.addTo(mapRef.current);
      }
    }
    const color = editingColorRef.current;
    for (const feats of selectedTownsRef.current.values()) {
      L.geoJSON({ type: 'FeatureCollection', features: feats } as GeoJSON.FeatureCollection, {
        style: () => ({
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.4,
        }),
        interactive: false,
      }).addTo(selectedOverlayRef.current);
    }
  };

  // 他コース (編集中以外) のエリアをオーバーレイ表示 (pending があれば優先、無ければ DB)
  const renderOtherCourses = () => {
    if (!mapRef.current) return;
    if (!otherCoursesLayerRef.current) {
      otherCoursesLayerRef.current = L.layerGroup().addTo(mapRef.current);
    } else {
      otherCoursesLayerRef.current.clearLayers();
      if (!mapRef.current.hasLayer(otherCoursesLayerRef.current)) {
        otherCoursesLayerRef.current.addTo(mapRef.current);
      }
    }
    for (const c of courses) {
      if (c.id === selectedCourseId) continue;
      const color = courseColorMap.get(c.id) ?? '#888';
      let features: GeoJSON.Feature[] = [];
      const pending = pendingByCourseRef.current.get(c.id);
      if (pending) {
        features = [...pending.manual];
        for (const feats of pending.towns.values()) {
          for (const f of feats) features.push(f);
        }
      } else {
        const gj = c.area_geojson as GeoJSON.FeatureCollection | null | undefined;
        features = gj?.features ?? [];
      }
      if (features.length === 0) continue;
      L.geoJSON(
        { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
        {
          style: () => ({
            color,
            weight: 1.2,
            fillColor: color,
            fillOpacity: 0.3,
          }),
          interactive: false,
        },
      ).addTo(otherCoursesLayerRef.current);
    }
  };

  // 最新の関数を ref に同期 (useEffect closure 内から最新を参照できる)
  useEffect(() => {
    markDirtyRef.current = markCurrentDirty;
    renderOtherCoursesRef.current = renderOtherCourses;
  });

  // 地図初期化
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const map = L.map(mapDivRef.current, {
      center: [35.68, 139.3],
      zoom: 10,
      zoomControl: true,
    });

    // 町全体 (同じ町名の全丁目) を一括選択/解除
    const toggleWholeTown = (wardName: string, townName: string) => {
      const keys: TownKey[] = [];
      for (const key of townLayersRef.current.keys()) {
        if (!key.startsWith(`${wardName}:`)) continue;
        const moji = key.substring(wardName.length + 1);
        if (extractTownName(moji) !== townName) continue;
        keys.push(key);
      }
      if (keys.length === 0) return;
      const allSelected = keys.every((k) => selectedTownsRef.current.has(k));
      const willSelect = !allSelected;
      const color = editingColorRef.current;
      for (const key of keys) {
        const gjLayer = townLayersRef.current.get(key);
        if (!gjLayer) continue;
        if (willSelect) {
          if (!selectedTownsRef.current.has(key)) {
            const gj = gjLayer.toGeoJSON() as GeoJSON.FeatureCollection;
            selectedTownsRef.current.set(key, gj.features);
          }
        } else {
          selectedTownsRef.current.delete(key);
        }
        gjLayer.setStyle({
          color: willSelect ? color : '#6b7280',
          weight: willSelect ? 1.2 : 0.6,
          fillColor: willSelect ? color : '#ffffff',
          fillOpacity: willSelect ? 0.45 : 0,
        });
      }
      markDirtyRef.current();
    };

    const toggleTown = (key: TownKey, feats: GeoJSON.Feature[]) => {
      const willSelect = !selectedTownsRef.current.has(key);
      if (willSelect) selectedTownsRef.current.set(key, feats);
      else selectedTownsRef.current.delete(key);
      const color = editingColorRef.current;
      const gjLayer = townLayersRef.current.get(key);
      if (gjLayer) {
        gjLayer.setStyle({
          color: willSelect ? color : '#6b7280',
          weight: willSelect ? 1.2 : 0.8,
          fillColor: willSelect ? color : '#ffffff',
          fillOpacity: willSelect ? 0.45 : 0,
        });
      }
      markDirtyRef.current();
    };

    const loadChomeForWard = async (wardName: string, group: L.LayerGroup) => {
      setChomeLoading(true);
      try {
        const all = await loadChomeData();
        const wardFeatures = all.features.filter(
          (f) => (f.properties as { GST_NAME?: string } | null)?.GST_NAME === wardName,
        );
        if (wardFeatures.length === 0) {
          console.warn(`${wardName}: 町丁目データなし`);
          return;
        }
        // 丁目単位で個別にポリゴン描画。ラベルは 町 単位で集約表示。
        const byTown = new Map<string, GeoJSON.Feature[]>();
        for (const f of wardFeatures) {
          const moji = (f.properties as { MOJI?: string } | null)?.MOJI ?? '';
          if (!moji) continue;
          const key: TownKey = `${wardName}:${moji}`;
          const isSelected = selectedTownsRef.current.has(key);
          const color = editingColorRef.current;
          const gjLayer = L.geoJSON(f, {
            style: () => ({
              color: isSelected ? color : '#6b7280',
              weight: isSelected ? 1.2 : 0.6,
              fillColor: isSelected ? color : '#ffffff',
              fillOpacity: isSelected ? 0.45 : 0,
            }),
            onEachFeature: (_, lyr) => {
              lyr.on('mouseover', () => {
                (lyr as L.Path).setStyle({ weight: 2 });
              });
              lyr.on('mouseout', () => {
                const sel = selectedTownsRef.current.has(key);
                (lyr as L.Path).setStyle({ weight: sel ? 1.2 : 0.6 });
              });
              lyr.on('click', () => {
                if (chomeClickModeRef.current) {
                  toggleTown(key, [f]);
                } else {
                  toggleWholeTown(wardName, extractTownName(moji));
                }
              });
            },
          });
          gjLayer.addTo(group);
          townLayersRef.current.set(key, gjLayer);

          const townName = extractTownName(moji);
          if (!byTown.has(townName)) byTown.set(townName, []);
          byTown.get(townName)!.push(f);
        }
        // 町単位のラベル (複数丁目をまとめた重心に1つ)
        for (const [townName, feats] of byTown) {
          let sumLat = 0;
          let sumLng = 0;
          let cnt = 0;
          for (const f of feats) {
            const c = featureCenter(f);
            if (c) {
              sumLat += c.lat;
              sumLng += c.lng;
              cnt++;
            }
          }
          if (cnt > 0) {
            const icon = L.divIcon({
              className: 'town-label-icon',
              html: `<div>${townName}</div>`,
              iconSize: [80, 14],
              iconAnchor: [40, 7],
            });
            L.marker([sumLat / cnt, sumLng / cnt], {
              icon,
              interactive: false,
              keyboard: false,
            }).addTo(group);
          }
        }
        console.log(`${wardName}: ${wardFeatures.length}丁目 / ${byTown.size}町 表示`);
      } catch (err) {
        console.warn('chome load failed', err);
        setError('町丁目データ読み込みに失敗: ' + (err as Error).message);
      } finally {
        setChomeLoading(false);
      }
    };

    const enterDetail = (feature: GeoJSON.Feature, name: string) => {
      if (!mapRef.current) return;
      if (wardsLayerRef.current) mapRef.current.removeLayer(wardsLayerRef.current);
      if (wardLabelsRef.current) mapRef.current.removeLayer(wardLabelsRef.current);
      // 他コースのオーバーレイは残す (エリア重複を視認するため)
      // 自身の selectedOverlay は chome 塗りで重複表現するので除去
      if (selectedOverlayRef.current) mapRef.current.removeLayer(selectedOverlayRef.current);
      if (detailLayerRef.current) mapRef.current.removeLayer(detailLayerRef.current);
      townLayersRef.current.clear();
      renderOtherCoursesRef.current();

      const group = L.layerGroup().addTo(mapRef.current);
      detailLayerRef.current = group;

      // 区の輪郭: 塗りは透明 (下の otherCourses 色が透けて見える)
      const wardLayer = L.geoJSON(feature, {
        style: () => ({
          color: '#111827',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 0,
        }),
        interactive: false,
      });
      wardLayer.addTo(group);
      let bounds: L.LatLngBounds | null = null;
      try {
        bounds = wardLayer.getBounds();
        if (bounds.isValid()) mapRef.current.fitBounds(bounds, { padding: [20, 20] });
      } catch {
        /* ignore */
      }
      setDetailWardName(name);
      void loadChomeForWard(name, group);
    };

    exitDetailRef.current = () => {
      if (!mapRef.current) return;
      if (detailLayerRef.current) {
        mapRef.current.removeLayer(detailLayerRef.current);
        detailLayerRef.current = null;
      }
      townLayersRef.current.clear();
      if (wardsLayerRef.current) wardsLayerRef.current.addTo(mapRef.current);
      if (wardLabelsRef.current) wardLabelsRef.current.addTo(mapRef.current);
      renderOtherCourses();
      renderSelectedOverlay();
      if (mainlandBoundsRef.current) {
        try {
          mapRef.current.fitBounds(mainlandBoundsRef.current, { padding: [20, 20] });
        } catch {
          /* ignore */
        }
      }
      setDetailWardName(null);
    };

    const enterDetailLocal = enterDetail;

    // 東京本土の境界読み込み
    let cancelled = false;
    fetch(WARDS_URL)
      .then((r) => r.json())
      .then((data: GeoJSON.FeatureCollection) => {
        if (cancelled || !mapRef.current) return;
        const ISLAND_NAMES = [
          '大島町', '利島村', '新島村', '神津島村', '三宅村',
          '御蔵島村', '八丈町', '青ヶ島村', '小笠原村',
        ];
        const isMainlandFeature = (f: GeoJSON.Feature): boolean => {
          const name = (f.properties as { N03_004?: string } | null)?.N03_004 ?? '';
          if (ISLAND_NAMES.includes(name)) return false;
          const g = f.geometry;
          let lat = 0;
          if (g.type === 'Polygon') {
            const ring = g.coordinates[0]?.[0];
            if (ring) lat = ring[1];
          } else if (g.type === 'MultiPolygon') {
            const ring = g.coordinates[0]?.[0]?.[0];
            if (ring) lat = ring[1];
          }
          return lat >= 35.4 && lat <= 36.0;
        };
        const mainland: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: data.features.filter(isMainlandFeature),
        };
        try {
          const layer = L.geoJSON(mainland, {
            style: () => ({
              color: '#111827',
              weight: 0.8,
              fillColor: '#ffffff',
              fillOpacity: 1,
            }),
            onEachFeature: (feature, lyr) => {
              lyr.on('mouseover', () => {
                (lyr as L.Path).setStyle({ fillColor: '#dbeafe', weight: 1.5 });
              });
              lyr.on('mouseout', () => {
                (lyr as L.Path).setStyle({ fillColor: '#ffffff', weight: 0.8 });
              });
              lyr.on('click', () => {
                const props = feature.properties as {
                  ward_ja?: string; area_ja?: string; N03_004?: string; N03_003?: string;
                } | null;
                const name =
                  props?.ward_ja || props?.area_ja || props?.N03_004 || props?.N03_003 || '';
                if (name) enterDetailLocal(feature, name);
              });
              (lyr as L.Layer & { feature?: GeoJSON.Feature }).feature = feature;
            },
          });
          layer.addTo(mapRef.current);
          wardsLayerRef.current = layer;
        } catch (e) {
          console.error('geoJSON layer add failed', e);
        }

        const labelGroup = L.layerGroup().addTo(mapRef.current);
        wardLabelsRef.current = labelGroup;
        for (const f of mainland.features) {
          const props = f.properties as {
            ward_ja?: string; area_ja?: string; N03_004?: string; N03_003?: string;
          } | null;
          const name =
            props?.ward_ja || props?.area_ja || props?.N03_004 || props?.N03_003 || '';
          if (!name) continue;
          const center = featureCenter(f);
          if (!center) continue;
          const icon = L.divIcon({
            className: 'ward-label-icon',
            html: `<div>${name}</div>`,
            iconSize: [80, 16],
            iconAnchor: [40, 8],
          });
          L.marker(center, { icon, interactive: false, keyboard: false }).addTo(labelGroup);
        }

        try {
          const mainlandBounds = L.latLngBounds(
            L.latLng(35.48, 138.92),
            L.latLng(35.92, 139.95),
          );
          mainlandBoundsRef.current = mainlandBounds;
          mapRef.current.fitBounds(mainlandBounds, { padding: [20, 20] });
        } catch {
          /* ignore */
        }
        setWardsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setError('地図データの読み込みに失敗: ' + err.message);
        setWardsLoading(false);
      });

    (map as L.Map & { _cancelFlag?: () => void })._cancelFlag = () => {
      cancelled = true;
    };

    const drawn = new L.FeatureGroup();
    map.addLayer(drawn);
    drawnItemsRef.current = drawn;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const DrawControl = (L.Control as any).Draw;
    const drawControl = new DrawControl({
      position: 'topright',
      edit: { featureGroup: drawn, edit: {}, remove: {} },
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: '#dc2626', weight: 2 },
        },
        polyline: { shapeOptions: { color: '#dc2626', weight: 3 } },
        rectangle: { shapeOptions: { color: '#dc2626' } },
        circle: false,
        circlemarker: false,
        marker: false,
      },
    });
    map.addControl(drawControl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on((L as any).Draw.Event.CREATED, (e: { layer: L.Layer }) => {
      const color = editingColorRef.current;
      const lyr = e.layer as L.Path;
      if ('setStyle' in lyr && typeof lyr.setStyle === 'function') {
        lyr.setStyle({ color, fillColor: color, fillOpacity: 0.3 });
      }
      drawn.addLayer(e.layer);
      markDirtyRef.current();
    });
    map.on('draw:edited', () => markDirtyRef.current());
    map.on('draw:deleted', () => markDirtyRef.current());

    mapRef.current = map;

    return () => {
      const cancel = (map as L.Map & { _cancelFlag?: () => void })._cancelFlag;
      if (cancel) cancel();
      map.remove();
      mapRef.current = null;
      drawnItemsRef.current = null;
      wardsLayerRef.current = null;
      wardLabelsRef.current = null;
      detailLayerRef.current = null;
      exitDetailRef.current = null;
      mainlandBoundsRef.current = null;
      selectedOverlayRef.current = null;
      otherCoursesLayerRef.current = null;
      selectedTownsRef.current.clear();
      townLayersRef.current.clear();
    };
  }, []);

  // フリーハンド (囲って塗る/消しゴム)
  useEffect(() => {
    const map = mapRef.current;
    const drawn = drawnItemsRef.current;
    if (!map || !drawn || toolMode === 'none') return;

    map.dragging.disable();
    map.doubleClickZoom.disable();
    map.getContainer().style.cursor = 'crosshair';

    // 点が多角形の内側か判定 (レイキャスト)
    const pointInRing = (pt: L.LatLng, ring: L.LatLng[]): boolean => {
      let inside = false;
      const x = pt.lng;
      const y = pt.lat;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i].lng;
        const yi = ring[i].lat;
        const xj = ring[j].lng;
        const yj = ring[j].lat;
        const intersect =
          yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      freehandLineRef.current?.addLatLng(e.latlng);
    };
    const onMouseUp = () => {
      map.off('mousemove', onMouseMove);
      const line = freehandLineRef.current;
      freehandLineRef.current = null;
      if (!line) return;
      const latlngs = line.getLatLngs() as L.LatLng[];
      map.removeLayer(line);
      if (latlngs.length < 3) return;
      const ring: L.LatLng[] = [...latlngs, latlngs[0]];

      if (toolMode === 'fill') {
        const color = editingColorRef.current;
        const inDetail = townLayersRef.current.size > 0;
        if (inDetail) {
          // 詳細モード: 囲った範囲内の丁目を選択
          let cnt = 0;
          for (const [key, gjLayer] of townLayersRef.current) {
            if (selectedTownsRef.current.has(key)) continue;
            const b = gjLayer.getBounds();
            if (!b.isValid()) continue;
            if (!pointInRing(b.getCenter(), ring)) continue;
            const townGj = gjLayer.toGeoJSON() as GeoJSON.FeatureCollection;
            selectedTownsRef.current.set(key, townGj.features);
            gjLayer.setStyle({
              color,
              weight: 1.2,
              fillColor: color,
              fillOpacity: 0.45,
            });
            cnt++;
          }
          console.log(`自由線で ${cnt}丁目 選択`);
        } else {
          // メインビュー: 自由形状の手動ポリゴンとして追加
          const polygon = L.polygon(ring, {
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.45,
          });
          drawn.addLayer(polygon);
        }
        markDirtyRef.current();
      } else if (toolMode === 'erase') {
        const isChomeMode = chomeClickModeRef.current;
        // 囲った範囲内にある丁目を特定
        const hitKeys: TownKey[] = [];
        for (const [key, gjLayer] of townLayersRef.current) {
          const b = gjLayer.getBounds();
          if (!b.isValid()) continue;
          if (pointInRing(b.getCenter(), ring)) hitKeys.push(key);
        }
        // 町モードなら、引っかかった丁目を含む町全体を消去対象に拡張
        const keysToErase = new Set<TownKey>();
        if (isChomeMode) {
          for (const k of hitKeys) keysToErase.add(k);
        } else {
          const townTags = new Set<string>();
          for (const k of hitKeys) {
            const idx = k.indexOf(':');
            const w = k.slice(0, idx);
            const moji = k.slice(idx + 1);
            townTags.add(`${w}:${extractTownName(moji)}`);
          }
          for (const key of townLayersRef.current.keys()) {
            const idx = key.indexOf(':');
            const w = key.slice(0, idx);
            const moji = key.slice(idx + 1);
            if (townTags.has(`${w}:${extractTownName(moji)}`)) {
              keysToErase.add(key);
            }
          }
        }
        for (const key of keysToErase) {
          selectedTownsRef.current.delete(key);
          const gjLayer = townLayersRef.current.get(key);
          if (gjLayer) {
            gjLayer.setStyle({
              color: '#6b7280',
              weight: 0.6,
              fillColor: '#ffffff',
              fillOpacity: 0,
            });
          }
        }
        console.log(
          `消しゴム: ${keysToErase.size}丁目 解除 (${isChomeMode ? '丁目' : '町'}モード)`,
        );
        // 囲った範囲内の手動ポリゴンを削除
        const toRemove: L.Layer[] = [];
        drawn.eachLayer((l) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyL = l as any;
          if (typeof anyL.getBounds === 'function') {
            const lb = anyL.getBounds() as L.LatLngBounds;
            if (lb.isValid() && pointInRing(lb.getCenter(), ring)) {
              toRemove.push(l);
            }
          } else if (typeof anyL.getLatLng === 'function') {
            const pt = anyL.getLatLng() as L.LatLng;
            if (pointInRing(pt, ring)) toRemove.push(l);
          }
        });
        for (const l of toRemove) drawn.removeLayer(l);
        markDirtyRef.current();
      }
    };
    const onMouseDown = (e: L.LeafletMouseEvent) => {
      const strokeColor = toolMode === 'erase' ? '#6b7280' : editingColorRef.current;
      freehandLineRef.current = L.polyline([e.latlng], {
        color: strokeColor,
        weight: toolMode === 'erase' ? 2 : 3,
        dashArray: toolMode === 'erase' ? '4 4' : undefined,
      }).addTo(map);
      map.on('mousemove', onMouseMove);
      map.once('mouseup', onMouseUp);
    };
    map.on('mousedown', onMouseDown);

    return () => {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = '';
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      if (freehandLineRef.current) {
        map.removeLayer(freehandLineRef.current);
        freehandLineRef.current = null;
      }
    };
  }, [toolMode]);

  // コース切替時: pending があれば読込、無ければ DB から初期化
  useEffect(() => {
    if (!drawnItemsRef.current) return;
    drawnItemsRef.current.clearLayers();
    // selectedTownsRef.current は pending と共有するので clear しない (別コースの pending に再割当で切替)
    if (selectedOverlayRef.current) selectedOverlayRef.current.clearLayers();

    if (selectedCourseId) {
      let pending = pendingByCourseRef.current.get(selectedCourseId);
      if (!pending) {
        // 初回: DB データから pending を作成
        const course = courses.find((c) => c.id === selectedCourseId);
        const gj = course?.area_geojson as GeoJSON.FeatureCollection | null | undefined;
        const towns = new Map<TownKey, GeoJSON.Feature[]>();
        const manual: GeoJSON.Feature[] = [];
        for (const f of gj?.features ?? []) {
          const p = f.properties as { _wardName?: string; _townName?: string } | null;
          if (p?._wardName && p?._townName) {
            const key: TownKey = `${p._wardName}:${p._townName}`;
            if (!towns.has(key)) towns.set(key, []);
            towns.get(key)!.push(f);
          } else {
            manual.push(f);
          }
        }
        pending = { towns, manual };
        pendingByCourseRef.current.set(selectedCourseId, pending);
      }
      // pending.towns を selectedTownsRef が参照 (同一 Map インスタンス)
      selectedTownsRef.current = pending.towns;
      // manual feature を drawnItems に復元
      if (pending.manual.length > 0) {
        const color = editingColor;
        L.geoJSON(
          { type: 'FeatureCollection', features: pending.manual } as GeoJSON.FeatureCollection,
          {
            style: () => ({
              color,
              weight: 2,
              fillColor: color,
              fillOpacity: 0.3,
            }),
          },
        ).eachLayer((l) => drawnItemsRef.current!.addLayer(l));
      }
    } else {
      selectedTownsRef.current = new Map();
    }
    // 詳細モード中: chome ポリゴンを新しい編集コースの色に再スタイリング
    if (detailWardName && townLayersRef.current.size > 0) {
      const color = editingColor;
      for (const [key, gjLayer] of townLayersRef.current) {
        const isSelected = selectedTownsRef.current.has(key);
        gjLayer.setStyle({
          color: isSelected ? color : '#6b7280',
          weight: isSelected ? 1.2 : 0.8,
          fillColor: isSelected ? color : '#ffffff',
          fillOpacity: isSelected ? 0.45 : 0,
        });
      }
    }
    renderSelectedOverlay();
    renderOtherCourses();
    // 編集中コースのエリアにズーム (詳細モード中は維持)
    if (!detailWardName) {
      try {
        const layers: L.Layer[] = [];
        if (drawnItemsRef.current) layers.push(drawnItemsRef.current);
        if (selectedOverlayRef.current) layers.push(selectedOverlayRef.current);
        if (layers.length > 0) {
          const combined = L.featureGroup(layers);
          const b = combined.getBounds();
          if (b.isValid()) mapRef.current?.fitBounds(b, { padding: [20, 20] });
        }
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourseId, courses]);

  const saveArea = async () => {
    if (dirtyCoursesRef.current.size === 0) return;
    setSaving(true);
    setError(null);
    // 現在編集中の drawnItems を pending に吸い上げ
    flushCurrentToPending();
    const errors: string[] = [];
    for (const courseId of Array.from(dirtyCoursesRef.current)) {
      const pending = pendingByCourseRef.current.get(courseId);
      if (!pending) continue;
      const townFeatures: GeoJSON.Feature[] = [];
      for (const [key, feats] of pending.towns) {
        const [wardName, townName] = key.split(':');
        for (const f of feats) {
          townFeatures.push({
            ...f,
            properties: { ...(f.properties ?? {}), _wardName: wardName, _townName: townName },
          });
        }
      }
      const combined: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [...pending.manual, ...townFeatures],
      };
      const payload = combined.features.length === 0 ? null : combined;
      const { error } = await supabase
        .from('courses')
        .update({ area_geojson: payload })
        .eq('id', courseId);
      if (error) {
        errors.push(`${courseId}: ${error.message}`);
      } else {
        dirtyCoursesRef.current.delete(courseId);
      }
    }
    setSaving(false);
    setDirtyCount(dirtyCoursesRef.current.size);
    if (errors.length > 0) {
      setError('一部保存失敗:\n' + errors.join('\n'));
    }
    await loadCourses();
  };

  const clearArea = () => {
    drawnItemsRef.current?.clearLayers();
    selectedTownsRef.current.clear();
    // pending も同期してクリア
    if (selectedCourseId) {
      const pending = pendingByCourseRef.current.get(selectedCourseId);
      if (pending) {
        pending.manual = [];
        pending.towns = selectedTownsRef.current;
      }
    }
    for (const gj of townLayersRef.current.values()) {
      gj.setStyle({
        color: '#6b7280', weight: 0.8, fillColor: '#ffffff', fillOpacity: 0,
      });
    }
    if (selectedOverlayRef.current) selectedOverlayRef.current.clearLayers();
    markCurrentDirty();
  };

  const changeEditingCourse = (newId: string) => {
    // 現在の編集を pending に退避してからコース切替 (詳細モードは維持)
    flushCurrentToPending();
    setSelectedCourseId(newId);
  };

  return (
    <div>
      <PageHeader
        title="コースエリア地図"
        actions={
          <>
            {detailWardName && (
              <button
                style={btn}
                onClick={() => exitDetailRef.current?.()}
                disabled={saving}
              >
                ← 全体表示に戻る
              </button>
            )}
            {detailWardName && (
              <button
                style={{
                  ...btn,
                  background: chomeClickMode ? editingColor : btn.background,
                  color: chomeClickMode ? '#fff' : btn.color,
                  borderColor: chomeClickMode ? editingColor : btn.borderColor,
                }}
                onClick={() => setChomeClickMode((v) => !v)}
                disabled={saving || !selectedCourseId}
                title="ONでクリック時に1丁目のみ選択。OFFで町全体(全丁目)を一括選択"
              >
                {chomeClickMode ? '丁目 (ON)' : '丁目'}
              </button>
            )}
            <button
              style={{
                ...btn,
                background: toolMode === 'fill' ? editingColor : btn.background,
                color: toolMode === 'fill' ? '#fff' : btn.color,
                borderColor: toolMode === 'fill' ? editingColor : btn.borderColor,
              }}
              onClick={() =>
                setToolMode((m) => (m === 'fill' ? 'none' : 'fill'))
              }
              disabled={saving || !selectedCourseId}
              title="マウスドラッグで囲うと中を塗ります"
            >
              {toolMode === 'fill' ? '🖌 囲って塗る (ON)' : '🖌 囲って塗る'}
            </button>
            <button
              style={{
                ...btn,
                background: toolMode === 'erase' ? '#6b7280' : btn.background,
                color: toolMode === 'erase' ? '#fff' : btn.color,
                borderColor: toolMode === 'erase' ? '#6b7280' : btn.borderColor,
              }}
              onClick={() =>
                setToolMode((m) => (m === 'erase' ? 'none' : 'erase'))
              }
              disabled={saving || !selectedCourseId}
              title="マウスドラッグで囲うと中の塗りを消します"
            >
              {toolMode === 'erase' ? '🧹 消しゴム (ON)' : '🧹 消しゴム'}
            </button>
            {!!selectedCourseId && (currentIsDirty || selectedTownsRef.current.size > 0) && (
              <button style={btn} onClick={clearArea} disabled={saving}>
                このコースを全消去
              </button>
            )}
            <button
              style={btnPrimary}
              onClick={saveArea}
              disabled={saving || !hasAnyDirty}
            >
              {saving
                ? '保存中...'
                : hasAnyDirty
                  ? `保存 (${dirtyCount}コース)`
                  : '変更なし'}
            </button>
          </>
        }
      />

      <div style={{ ...card, marginBottom: 12, padding: '10px 12px' }}>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
          編集対象のコースをクリック。コースを切り替えても編集内容は保持され、保存ボタンで未保存のコースをまとめて保存します。
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            maxHeight: 120,
            overflowY: 'auto',
          }}
        >
          {courses.map((c) => {
            const color = courseColorMap.get(c.id) ?? '#888';
            const isEditing = c.id === selectedCourseId;
            const hasArea = !!c.area_geojson;
            const isDirty = dirtyCoursesRef.current.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => changeEditingCourse(isEditing ? '' : c.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 14,
                  border: isEditing ? `2px solid ${color}` : '1px solid ' + colors.borderLight,
                  background: isEditing ? color + '22' : '#fff',
                  fontSize: 12,
                  fontWeight: isEditing ? 700 : 500,
                  color: colors.text,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title={isEditing ? 'クリックで編集解除' : 'クリックで編集開始'}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: color,
                    flexShrink: 0,
                  }}
                />
                {c.name}
                {isDirty && (
                  <span
                    style={{ color: '#ea580c', fontSize: 11, fontWeight: 700 }}
                    title="未保存の変更あり"
                  >
                    ＊
                  </span>
                )}
                {hasArea && !isDirty && (
                  <span style={{ color, fontSize: 10 }} title="保存済みエリア">
                    ●
                  </span>
                )}
              </button>
            );
          })}
          {courses.length === 0 && (
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              コースが未登録です。コースマスタで作成してください。
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
          {wardsLoading
            ? '23区データ読み込み中...'
            : detailWardName
              ? chomeLoading
                ? `${detailWardName} 町丁目データ読み込み中...`
                : `${detailWardName}: 町をクリックで選択/解除、描画ツールで半分割り可能`
              : selectedCourseId
                ? '区をクリックで白地図表示 → 町クリックでエリア指定。描画ツール/自由線で補正可。'
                : '編集するコースを上から選択してください。'}
        </div>
      </div>

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <div
        ref={mapDivRef}
        style={{
          height: 'calc(100vh - 320px)',
          minHeight: 400,
          border: '1px solid ' + colors.borderLight,
          borderRadius: 6,
          background: '#ffffff',
        }}
      />
      <style>{`
        .leaflet-container { background: #ffffff !important; }
        .town-label-icon {
          background: transparent !important;
          border: 0 !important;
          font-size: 10px;
          font-weight: 600;
          color: #111827;
          text-align: center;
          white-space: nowrap;
          line-height: 1;
          text-shadow: 1px 1px 0 #fff, -1px 1px 0 #fff, 1px -1px 0 #fff, -1px -1px 0 #fff, 0 1px 0 #fff, 0 -1px 0 #fff, 1px 0 0 #fff, -1px 0 0 #fff;
          pointer-events: none;
          user-select: none;
        }
        .ward-label-icon {
          background: transparent !important;
          border: 0 !important;
          font-size: 11px;
          font-weight: 700;
          color: #111827;
          text-align: center;
          white-space: nowrap;
          line-height: 1.2;
          text-shadow: 1px 1px 0 #fff, -1px 1px 0 #fff, 1px -1px 0 #fff, -1px -1px 0 #fff, 0 1px 0 #fff, 0 -1px 0 #fff, 1px 0 0 #fff, -1px 0 0 #fff, 2px 0 0 #fff, -2px 0 0 #fff, 0 2px 0 #fff, 0 -2px 0 #fff;
          pointer-events: none;
          user-select: none;
        }
      `}</style>
    </div>
  );
}
