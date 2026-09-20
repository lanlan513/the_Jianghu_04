import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapPinOff } from 'lucide-react';
import { sectApi, swordApi } from '@/api';
import type { Sect, Sword } from '@/types';
import JianghuMap, { MapSect } from './map/JianghuMap';
import MapSidebar from './map/MapSidebar';
import { SECT_GEO } from './map/sectGeo';
import {
  Bounds,
  ViewState,
  buildSearchFromView,
  computeBounds,
  parseViewFromSearch,
  project,
} from './map/mapMath';

/** 门派名归一化：去掉后缀以便与名剑的所属字段匹配 */
function normalizeSectName(name: string): string {
  return name.replace(/(派|门|宗|帮|教|阁|山庄|宫)$/, '');
}

interface Enriched {
  mapSects: MapSect[];
  worldBounds: Bounds;
  missingCount: number;
}

function enrich(sects: Sect[], swords: Sword[]): Enriched | null {
  const pops = sects.map((s) => s.popularity);
  const minPop = Math.min(...pops);
  const maxPop = Math.max(...pops);
  const norm = (p: number) => (maxPop > minPop ? (p - minPop) / (maxPop - minPop) : 0.5);

  const mapSects: MapSect[] = [];
  let missingCount = 0;

  for (const sect of sects) {
    const geo = SECT_GEO[sect.id];
    if (!geo) {
      // 坐标缺失：跳过该据点
      missingCount += 1;
      continue;
    }
    const pos = project(geo.lng, geo.lat);
    if (!pos) {
      // 投影结果为 NaN：跳过该据点
      missingCount += 1;
      continue;
    }
    const matched = swords.filter(
      (sw) =>
        normalizeSectName(sw.sect) === normalizeSectName(sect.name) ||
        sect.notableSwords.includes(sw.name),
    );
    const radius = 9 + norm(sect.popularity) * 7;
    const sorted = [...matched].sort((a, b) => b.popularity - a.popularity);
    const swordNodes = sorted.map((sword, i) => {
      const angle = -Math.PI / 2 + (i - (sorted.length - 1) / 2) * 0.85;
      const dist = radius + 15 + (i % 2) * 7;
      return {
        sword,
        pos: { x: pos.x + Math.cos(angle) * dist, y: pos.y + Math.sin(angle) * dist },
      };
    });
    mapSects.push({
      sect,
      pos,
      radius,
      veinWidth: 0.9 + norm(sect.popularity) * 1.8,
      swordNodes,
    });
  }

  const allPoints = mapSects.flatMap((ms) => [ms.pos, ...ms.swordNodes.map((sn) => sn.pos)]);
  const worldBounds = computeBounds(allPoints, 36) ?? {
    minX: -260,
    minY: -190,
    maxX: 260,
    maxY: 190,
  };
  return { mapSects, worldBounds, missingCount };
}

export default function MapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sects, setSects] = useState<Sect[]>([]);
  const [swords, setSwords] = useState<Sword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sectData, swordData] = await Promise.all([
          sectApi.getSects(),
          swordApi.getSwords({ limit: 100 }),
        ]);
        if (cancelled) return;
        setSects(sectData);
        setSwords(swordData.list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '数据加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enriched = useMemo(
    () => (sects.length > 0 ? enrich(sects, swords) : null),
    [sects, swords],
  );

  // ---- URL 是视口状态的唯一来源 ----
  const parsed = useMemo(
    () => parseViewFromSearch(searchParams.toString()),
    [searchParams],
  );
  const selectedSectId =
    parsed.sectId && sects.some((s) => s.id === parsed.sectId) ? parsed.sectId : null;
  const selectedSect = sects.find((s) => s.id === selectedSectId) ?? null;
  const selectedSectEntry = enriched?.mapSects.find((ms) => ms.sect.id === selectedSectId);

  // URL 无合法视口时，第一次回写用 replace（不产生历史）；此后均为 push，后退可回到上一视角
  const replaceNextRef = useRef(true);
  useEffect(() => {
    replaceNextRef.current = !parsed.view;
  }, [parsed.view]);

  const handleViewCommit = useCallback(
    (view: ViewState) => {
      const search = buildSearchFromView(view, selectedSectId);
      const replace = replaceNextRef.current;
      replaceNextRef.current = false;
      setSearchParams(search, { replace });
    },
    [selectedSectId, setSearchParams],
  );

  const handleSelectSect = useCallback(
    (id: string | null, view: ViewState) => {
      replaceNextRef.current = false;
      setSearchParams(buildSearchFromView(view, id), { replace: false });
    },
    [setSearchParams],
  );

  const handleOpenSword = useCallback(
    (id: string) => {
      navigate(`/swords/${id}`);
    },
    [navigate],
  );

  if (loading) {
    return (
      <div className="fixed inset-0 top-16 flex items-center justify-center bg-ink-100">
        <div className="text-center">
          <div className="mx-auto mb-4 h-14 w-14 animate-spin rounded-full border-4 border-ink-200 border-t-cinnabar-600" />
          <p className="font-song text-ink-600">正在展开江湖舆图…</p>
        </div>
      </div>
    );
  }

  if (error || !enriched) {
    return (
      <div className="fixed inset-0 top-16 flex items-center justify-center bg-ink-100">
        <p className="font-song text-ink-600">{error ?? '暂无门派数据'}</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 top-16 bg-ink-100 bg-ink-paper">
      <JianghuMap
        mapSects={enriched.mapSects}
        worldBounds={enriched.worldBounds}
        targetView={parsed.view}
        selectedSectId={selectedSectId}
        onViewCommit={handleViewCommit}
        onSelectSect={handleSelectSect}
        onOpenSword={handleOpenSword}
      />

      {/* 图例与快捷键 */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden border border-ink-300 bg-ink-50/90 px-3 py-2 font-song text-[11px] leading-relaxed text-ink-600 shadow-ink sm:block">
        <p className="mb-1 font-brush text-sm text-ink-900">江湖舆图</p>
        <p>◆ 六角据点：门派驻地（大小随人气）</p>
        <p>— 金色剑脉：名剑所属（线宽随人气）</p>
        <p className="mt-1 text-ink-400">滚轮缩放 · 拖拽平移 · 方向键移动</p>
        <p className="text-ink-400">+/− 缩放 · 0 复位 · 点击据点选门派</p>
      </div>

      {enriched.missingCount > 0 && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 border border-ink-300 bg-ink-50/90 px-2.5 py-1.5 font-song text-[11px] text-ink-500 shadow-ink">
          <MapPinOff className="h-3.5 w-3.5" />
          {enriched.missingCount} 个门派缺少驻地坐标，未在舆图标注
        </div>
      )}

      <MapSidebar
        sect={selectedSect}
        swords={selectedSectEntry?.swordNodes.map((sn) => sn.sword) ?? []}
        onClose={() => {
          // 仅移除 sect 参数，保留当前视角
          const params = new URLSearchParams(searchParams);
          params.delete('sect');
          replaceNextRef.current = false;
          setSearchParams(params, { replace: false });
        }}
        onOpenSword={handleOpenSword}
      />
    </div>
  );
}
