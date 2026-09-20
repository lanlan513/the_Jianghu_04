import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sectApi, swordApi } from '@/api';
import type { Sect, Sword } from '@/types';
import { SECT_COORDS } from '@/atlas/sect-coords';
import { buildAtlasModel } from '@/atlas/layout';
import type { AtlasModel, SectNode } from '@/atlas/layout';
import type { LngLat } from '@/atlas/geo';
import { parseUrlState, serializeState } from '@/atlas/url-state';
import type { UrlState } from '@/atlas/url-state';
import { getDefaultView } from '@/atlas/viewport';
import type { View } from '@/atlas/viewport';
import { useAtlasUrl } from '@/atlas/use-atlas-url';
import AtlasCanvas from '@/components/atlas/AtlasCanvas';
import type { AtlasCanvasHandle } from '@/components/atlas/AtlasCanvas';
import AtlasSidebar from '@/components/atlas/AtlasSidebar';

export default function AtlasPage() {
  const [sects, setSects] = useState<Sect[] | null>(null);
  const [swords, setSwords] = useState<Sword[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedSectId, setSelectedSectId] = useState<string | null>(null);
  const [focusSwordId, setFocusSwordId] = useState<string | null>(null);

  const canvasRef = useRef<AtlasCanvasHandle>(null);
  const initialViewRef = useRef<View | null>(null);
  const sizeRef = useRef({ width: window.innerWidth, height: window.innerHeight });

  // —— 首次读取 URL（非法参数会在 parseUrlState 内被丢弃） ——
  const initialUrl = useMemo<UrlState>(() => parseUrlState(window.location.search), []);
  if (!initialViewRef.current) {
    initialViewRef.current = initialUrl.view ?? getDefaultView(sizeRef.current);
  }

  const model: AtlasModel | null = useMemo(
    () => (sects && swords ? buildAtlasModel(sects, swords, SECT_COORDS) : null),
    [sects, swords],
  );

  // —— URL 是选中态唯一来源之外的「镜像」：popstate 时同步侧栏 ——
  const syncSelectionFromUrl = useCallback((state: UrlState) => {
    setSelectedSectId(state.sectId);
    setFocusSwordId(state.swordId);
  }, []);

  const handleViewChanged = useCallback((state: UrlState) => {
    if (state.view) canvasRef.current?.setViewAnimated(state.view);
  }, []);

  const urlOps = useAtlasUrl({
    onViewChanged: handleViewChanged,
    onSelectionChanged: syncSelectionFromUrl,
  });

  // —— 首屏：把清洗后的 URL 回写（丢弃非法参数），并同步初始选中态 ——
  useEffect(() => {
    syncSelectionFromUrl(initialUrl);
    const qs = serializeState({
      view: initialViewRef.current as View,
      sectId: initialUrl.sectId,
      swordId: initialUrl.swordId,
    });
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— 数据加载（后端只提供门派/名剑读取接口） ——
  useEffect(() => {
    let cancelled = false;
    Promise.all([sectApi.getSects(), swordApi.getSwords({ limit: 200 })])
      .then(([sectList, swordResp]) => {
        if (cancelled) return;
        setSects(sectList);
        setSwords(swordResp.list);
      })
      .catch(() => {
        if (!cancelled) setError('舆图卷轴未能展开，请稍后重试。');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const serializeView = useCallback((view: View) => {
    return serializeState({
      view,
      sectId: selectedSectId,
      swordId: focusSwordId,
    });
  }, [selectedSectId, focusSwordId]);

  // —— 选中门派：更新 URL（离散操作，入历史，可后退） ——
  const handleSelectSect = useCallback((id: string | null) => {
    setSelectedSectId(id);
    if (!id) setFocusSwordId(null);
    // 视口取画布实时值（惯性/飞行中也是最新），URL 中缺项时回退初始视角
    const liveView = canvasRef.current?.getView()
      ?? parseUrlState(window.location.search).view
      ?? (initialViewRef.current as View);
    const qs = serializeState({
      view: liveView,
      sectId: id,
      swordId: null,
    });
    if (id) urlOps.commitPush(qs ? `?${qs}` : '');
    else urlOps.commitReplace(qs ? `?${qs}` : '');
  }, [urlOps]);

  const handleLocate = useCallback((node: SectNode) => {
    if (node.lngLat) {
      const target: LngLat = node.lngLat;
      canvasRef.current?.flyTo(target, 4);
    }
  }, []);

  const handleSelectMissing = useCallback((sect: Sect) => {
    handleSelectSect(sect.id);
  }, [handleSelectSect]);

  if (error) {
    return (
      <div className="atlas-page">
        <div className="atlas-message">
          <p className="font-brush text-3xl text-cinnabar-700">{error}</p>
          <button
            type="button"
            className="atlas-locate-btn mt-6"
            onClick={() => window.location.reload()}
          >
            重展卷轴
          </button>
        </div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="atlas-page">
        <div className="atlas-message">
          <div className="atlas-loading-seal">舆</div>
          <p className="font-song text-ink-600 mt-4 tracking-widest">水墨渐次晕开，舆图展开中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="atlas-page">
      <AtlasCanvas
        ref={canvasRef}
        model={model}
        initialView={initialViewRef.current as View}
        selectedSectId={selectedSectId}
        hoveredSwordId={focusSwordId}
        onSelectSect={handleSelectSect}
        serializeView={serializeView}
        urlOps={urlOps}
      />

      {/* 标题 */}
      <div className="atlas-title" aria-hidden>
        <span className="font-brush">江湖舆图</span>
        <small className="font-song">据点大小与剑脉粗细，随江湖人气而变</small>
      </div>

      <AtlasSidebar
        model={model}
        selected={selectedSectId ? model.byId.get(selectedSectId) ?? null : null}
        focusSwordId={focusSwordId}
        onClose={() => handleSelectSect(null)}
        onLocate={handleLocate}
        onSelectMissing={handleSelectMissing}
      />
    </div>
  );
}
