import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { LngLat, Point } from '@/atlas/geo';
import { project } from '@/atlas/geo';
import {
  FLY,
  MIN_SCALE,
  MAX_SCALE,
  clampView,
  getDefaultView,
  getLod,
  interpolateView,
  panBy,
  screenToMap,
  stepInertia,
  zoomAtCenter,
  zoomAtPoint,
} from '@/atlas/viewport';
import type { Size, View } from '@/atlas/viewport';
import {
  BORDER_PATH,
  CLOUDS,
  MOUNTAINS,
  YANGTZE_PATH,
  YELLOW_PATH,
  mountainPath,
} from '@/atlas/decor';
import type { AtlasModel, SectNode } from '@/atlas/layout';
import MiniMap from './MiniMap';

export interface AtlasCanvasHandle {
  /** 读取当前实时视口（惯性/飞行中也为最新值） */
  getView: () => View;
  /** 飞行到指定经纬度（缩放下限内可选），用于侧栏「定位」与后退 */
  flyTo: (target: LngLat, scale?: number) => void;
  /** 直接应用视口（来自 popstate），带补间 */
  setViewAnimated: (view: View) => void;
  resetView: () => void;
}

interface UrlOps {
  beginGesture: () => void;
  liveReplace: (search: string) => void;
  commitReplace: (search: string) => void;
  commitPush: (search: string) => void;
}

interface Props {
  model: AtlasModel;
  /** 初始视口（来自 URL 或默认） */
  initialView: View;
  selectedSectId: string | null;
  hoveredSwordId?: string | null;
  onSelectSect: (id: string | null) => void;
  serializeView: (view: View) => string;
  urlOps: UrlOps;
}

type Mode = 'idle' | 'pan' | 'inertia' | 'fly';

const KEY_ZOOM_FACTOR = 1.25;
const KEY_PAN_RATIO = 0.12; // 方向键每按平移视口的比例
const LIVE_URL_THROTTLE = 90; // ms

const AtlasCanvas = forwardRef<AtlasCanvasHandle, Props>(function AtlasCanvas(
  {
    model,
    initialView,
    selectedSectId,
    hoveredSwordId,
    onSelectSect,
    serializeView,
    urlOps,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mapLayerRef = useRef<SVGGElement>(null);
  const veinLayerRef = useRef<SVGGElement>(null);
  const markerLayerRef = useRef<SVGGElement>(null);
  const swordDotLayerRef = useRef<SVGGElement>(null);
  const swordNameLayerRef = useRef<SVGGElement>(null);
  const lodRef = useRef<SVGGElement>(null);
  const minimapViewRef = useRef<SVGRectElement>(null);

  // —— 视口唯一可变状态存在 ref 中，每帧直写 DOM，绝不 setState ——
  const viewRef = useRef<View>(initialView);
  const sizeRef = useRef<Size>({ width: 0, height: 0 });
  const modeRef = useRef<Mode>('idle');

  // 拖拽
  const gestureRef = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    vx: 0,
    vy: 0,
    moved: false,
    downX: 0,
    downY: 0,
    historyPushed: false,
  });

  // 惯性
  const inertiaRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });

  // 飞行补间
  const flyRef = useRef<{ from: View; to: View; start: number; pushed: boolean } | null>(null);

  // URL 高频写入节流
  const lastLiveWriteRef = useRef(0);

  const [rippleKey, setRippleKey] = useState(0);
  const [hoverNode, setHoverNode] = useState<SectNode | null>(null);
  const zoomReadoutRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverIdRef = useRef<string | null>(null);
  const lastPointerRef = useRef<Point>({ x: 0, y: 0 });

  useEffect(() => {
    if (selectedSectId) setRippleKey((k) => k + 1);
  }, [selectedSectId]);

  /** 计算并直写当前视口对应的全部 transform —— 纯 DOM 操作，不触发 React */
  const renderFrame = useCallback(() => {
    const view = viewRef.current;
    const size = sizeRef.current;
    if (!mapLayerRef.current || size.width === 0) return;

    const tx = size.width / 2 - view.center.x * view.scale;
    const ty = size.height / 2 - view.center.y * view.scale;
    const mapTransform = `matrix(${view.scale} 0 0 ${view.scale} ${tx} ${ty})`;
    const inv = 1 / view.scale;
    mapLayerRef.current.setAttribute('transform', mapTransform);
    if (veinLayerRef.current) veinLayerRef.current.setAttribute('transform', mapTransform);

    // 据点/剑名反向缩放：标记层整体写「缩放+定位」矩阵（与地图层同变换），
    // 其内部 .atlas-marker-scale 再乘 inv，使徽记在屏幕上大小恒定
    if (markerLayerRef.current) {
      markerLayerRef.current.setAttribute('transform', mapTransform);
      const scales = markerLayerRef.current.querySelectorAll<SVGGElement>('.atlas-marker-scale');
      const scaleAttr = `scale(${inv})`;
      for (let i = 0; i < scales.length; i++) {
        if (scales[i].getAttribute('transform') !== scaleAttr) {
          scales[i].setAttribute('transform', scaleAttr);
        }
      }
    }

    // 剑点随地图缩放；剑名层定位用 zoom 矩阵，文字本身乘 inv 保持屏显恒定
    if (swordDotLayerRef.current) {
      swordDotLayerRef.current.setAttribute('transform', mapTransform);
    }
    if (swordNameLayerRef.current) {
      swordNameLayerRef.current.setAttribute('transform', mapTransform);
      const texts = swordNameLayerRef.current.querySelectorAll<SVGTextElement>('.atlas-sword-name');
      const fontScale = `scale(${inv})`;
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].getAttribute('transform') !== fontScale) {
          texts[i].setAttribute('transform', fontScale);
        }
      }
    }

    // LOD 切换：直接写 data-lod，CSS 控制标签与剑名显隐
    const lod = getLod(view.scale);
    if (lodRef.current && lodRef.current.dataset.lod !== String(lod)) {
      lodRef.current.dataset.lod = String(lod);
    }
    if (swordNameLayerRef.current && swordNameLayerRef.current.dataset.lod !== String(lod)) {
      swordNameLayerRef.current.dataset.lod = String(lod);
    }

    // 缩放倍数读数：直接写 DOM，避免任何 setState
    if (zoomReadoutRef.current) {
      zoomReadoutRef.current.textContent = '×' + view.scale.toFixed(1);
    }

    // 缩略图视口框
    if (minimapViewRef.current) {
      const tl = screenToMap(view, { x: 0, y: 0 }, size);
      const br = screenToMap(view, { x: size.width, y: size.height }, size);
      if (tl && br) {
        minimapViewRef.current.setAttribute('x', String(tl.x));
        minimapViewRef.current.setAttribute('y', String(tl.y));
        minimapViewRef.current.setAttribute('width', String(Math.max(0, br.x - tl.x)));
        minimapViewRef.current.setAttribute('height', String(Math.max(0, br.y - tl.y)));
      }
    }
  }, []);

  const scheduleLiveUrl = useCallback(() => {
    const now = performance.now();
    if (now - lastLiveWriteRef.current >= LIVE_URL_THROTTLE) {
      lastLiveWriteRef.current = now;
      urlOps.liveReplace('?' + serializeView(viewRef.current));
    }
  }, [serializeView, urlOps]);

  /** 主循环：惯性 / 飞行；结束后把最终视口收口进 URL。全程无 setState。 */
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const mode = modeRef.current;

      if (mode === 'inertia') {
        const step = stepInertia({ x: inertiaRef.current.vx, y: inertiaRef.current.vy });
        if (step.stopped) {
          modeRef.current = 'idle';
          urlOps.commitReplace('?' + serializeView(viewRef.current));
        } else {
          inertiaRef.current = { vx: step.velocity.x, vy: step.velocity.y };
          viewRef.current = panBy(viewRef.current, step.delta, sizeRef.current);
        }
      } else if (mode === 'fly' && flyRef.current) {
        const f = flyRef.current;
        const t = Math.min(1, (performance.now() - f.start) / FLY.duration);
        viewRef.current = interpolateView(f.from, f.to, t);
        scheduleLiveUrl();
        if (t >= 1) {
          viewRef.current = f.to;
          modeRef.current = 'idle';
          urlOps.commitReplace('?' + serializeView(viewRef.current));
          flyRef.current = null;
        }
      }

      renderFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [renderFrame, scheduleLiveUrl, serializeView, urlOps]);

  // —— 容器尺寸测量 ——
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next: Size = { width: rect.width, height: rect.height };
      const first = sizeRef.current.width === 0;
      sizeRef.current = next;
      if (first) {
        // URL 无视角时使用全览默认
        const fromUrl = viewRef.current;
        const def = getDefaultView(next);
        const using = fromUrl.scale >= MIN_SCALE && fromUrl.scale <= MAX_SCALE ? clampView(fromUrl, next) : def;
        viewRef.current = using;
      } else {
        viewRef.current = clampView(viewRef.current, next);
      }
      renderFrame();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [renderFrame]);

  const startFly = useCallback((to: View, pushHistory: boolean) => {
    // 先把起始视角固化为一条历史项，飞行过程中只 replace 顶部，
    // 这样「后退」正好落在飞行前视角
    if (pushHistory) urlOps.beginGesture();
    flyRef.current = { from: viewRef.current, to, start: performance.now(), pushed: pushHistory };
    modeRef.current = 'fly';
  }, [urlOps]);

  useImperativeHandle(ref, () => ({
    getView: () => viewRef.current,
    flyTo: (target: LngLat, scale = Math.max(viewRef.current.scale * 1.4, 3.2)) => {
      const p = project(target.lng, target.lat);
      if (!p) return;
      startFly(clampView({ center: p, scale }, sizeRef.current), true);
    },
    setViewAnimated: (view: View) => {
      startFly(clampView(view, sizeRef.current), false);
    },
    resetView: () => {
      startFly(getDefaultView(sizeRef.current), true);
    },
  }), [startFly]);

  // —— 滚轮：以鼠标位置为锚缩放（preventDefault 必须在非被动监听里） ——
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let stopTimer = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.exp(-e.deltaY * 0.0014);
      const before = viewRef.current.scale;
      viewRef.current = zoomAtPoint(viewRef.current, anchor, factor, sizeRef.current);
      if (viewRef.current.scale !== before) {
        const g = gestureRef.current;
        if (!g.historyPushed) {
          urlOps.beginGesture();
          g.historyPushed = true;
        }
        scheduleLiveUrl();
      }
      // 滚轮停止后惯性模式不启用；松手收口由一个短暂延时完成
      window.clearTimeout(stopTimer);
      stopTimer = window.setTimeout(() => {
        if (modeRef.current === 'idle') {
          urlOps.commitReplace('?' + serializeView(viewRef.current));
          gestureRef.current.historyPushed = false;
        }
      }, 160);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', onWheel);
      window.clearTimeout(stopTimer);
    };
  }, [scheduleLiveUrl, serializeView, urlOps]);

  // —— 指针：拖拽平移 + 松手惯性 ——
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    // 只响应背景 / 舆图层上的按下；据点按下由其自身处理器 stopPropagation
    flyRef.current = null;
    modeRef.current = 'pan';
    const g = gestureRef.current;
    g.active = true;
    g.pointerId = e.pointerId;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    g.downX = e.clientX;
    g.downY = e.clientY;
    g.lastT = performance.now();
    g.vx = 0;
    g.vy = 0;
    g.moved = false;
    g.historyPushed = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gestureRef.current;
    if (!g.active || e.pointerId !== g.pointerId) return;
    const now = performance.now();
    const dx = e.clientX - g.lastX;
    const dy = e.clientY - g.lastY;
    const dt = Math.max(1, now - g.lastT);

    if (Math.abs(e.clientX - g.downX) + Math.abs(e.clientY - g.downY) > 4) g.moved = true;

    viewRef.current = panBy(viewRef.current, { x: dx, y: dy }, sizeRef.current);

    // 像素/毫秒 -> 像素/帧（60fps）的瞬时速度，带平滑
    const instVx = (dx / dt) * 16.7;
    const instVy = (dy / dt) * 16.7;
    g.vx = g.vx * 0.6 + instVx * 0.4;
    g.vy = g.vy * 0.6 + instVy * 0.4;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    g.lastT = now;

    if (!g.historyPushed) {
      urlOps.beginGesture();
      g.historyPushed = true;
    }
    scheduleLiveUrl();
  };

  const endGesture = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gestureRef.current;
    if (!g.active || e.pointerId !== g.pointerId) return;
    g.active = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);

    urlOps.commitReplace('?' + serializeView(viewRef.current));
    g.historyPushed = false;

    // 有甩动速度 -> 进入惯性；否则停在原地（点击空白也走这里，不误选）
    const speed = Math.hypot(g.vx, g.vy);
    if (g.moved && speed > 1.2) {
      inertiaRef.current = { vx: g.vx, vy: g.vy };
      modeRef.current = 'inertia';
    } else {
      modeRef.current = 'idle';
      if (!g.moved) {
        // 点击空白处：清除选中
        onSelectSect(null);
      }
    }
  };

  // —— 据点交互 ——
  const onSectPointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
  };

  const onSectClick = (e: React.MouseEvent, node: SectNode) => {
    e.stopPropagation();
    onSelectSect(node.sect.id);
  };

  const onSectEnter = (node: SectNode) => (e: ReactPointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const local = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
    lastPointerRef.current = local;
    // 浮签位置：直接写 DOM，鼠标移动不触发任何 React 更新
    if (tooltipRef.current) {
      tooltipRef.current.style.left = `${local.x + 16}px`;
      tooltipRef.current.style.top = `${local.y + 16}px`;
    }
    // 只有悬停目标门派变化时才 setState（离散事件，绝不在帧循环中发生）
    if (hoverIdRef.current !== node.sect.id) {
      hoverIdRef.current = node.sect.id;
      setHoverNode(node);
    }
  };

  const onSectLeave = () => {
    if (hoverIdRef.current !== null) {
      hoverIdRef.current = null;
      setHoverNode(null);
    }
  };

  // —— 键盘：缩放 / 平移 / 重置（仅舆图容器聚焦时） ——
  const commitZoom = useCallback((factor: number) => {
    viewRef.current = zoomAtCenter(viewRef.current, factor, sizeRef.current);
    renderFrame();
    urlOps.commitReplace('?' + serializeView(viewRef.current));
  }, [renderFrame, serializeView, urlOps]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const size = sizeRef.current;
    const step = { x: 0, y: 0 };
    let handled = true;
    switch (e.key) {
      case '+': case '=':
        commitZoom(KEY_ZOOM_FACTOR); break;
      case '-': case '_':
        commitZoom(1 / KEY_ZOOM_FACTOR); break;
      case '0':
        startFly(getDefaultView(size), true); return;
      case 'ArrowLeft': step.x = size.width * KEY_PAN_RATIO; break;
      case 'ArrowRight': step.x = -size.width * KEY_PAN_RATIO; break;
      case 'ArrowUp': step.y = size.height * KEY_PAN_RATIO; break;
      case 'ArrowDown': step.y = -size.height * KEY_PAN_RATIO; break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    if (step.x || step.y) {
      startFly(panBy(viewRef.current, step, size), true);
    }
  };

  const minimapJump = useCallback((mapPoint: Point) => {
    startFly(clampView({ center: mapPoint, scale: Math.max(viewRef.current.scale, 2.4) }, sizeRef.current), true);
  }, [startFly]);

  const selectedNode = useMemo(
    () => model.nodes.find((n) => n.sect.id === selectedSectId) ?? null,
    [model, selectedSectId],
  );

  return (
    <div
      ref={containerRef}
      className={`atlas-stage ${selectedSectId ? 'has-sidebar' : ''}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <svg
        ref={svgRef}
        className="atlas-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        role="application"
        aria-label="江湖舆图"
      >
        <defs>
          <radialGradient id="paperVignette" cx="50%" cy="46%" r="72%">
            <stop offset="0%" stopColor="rgba(245,240,230,0)" />
            <stop offset="78%" stopColor="rgba(120,98,62,0.05)" />
            <stop offset="100%" stopColor="rgba(80,60,30,0.18)" />
          </radialGradient>
          <filter id="inkBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
        </defs>

        {/* —— 随地图变换的底图层（国界/江河/山峦） —— */}
        <g ref={mapLayerRef}>
          {/* 水墨山峦：外层负责一次性淡入，内层负责无限呼吸，避免动画互相覆盖 */}
          <g>
            {MOUNTAINS.map((m, i) => (
              <g key={`mtn-${i}`} className="atlas-mountain-in" style={{ animationDelay: `${m.delay}s` }}>
                <path
                  d={mountainPath(m)}
                  className="atlas-mountain-breathe"
                  fill={`rgba(45,58,74,${m.ink})`}
                  filter="url(#inkBlur)"
                  style={{ animationDuration: `${m.duration}s` }}
                />
              </g>
            ))}
          </g>

          {/* 国界与江河 */}
          <path d={BORDER_PATH} className="atlas-border" />
          <path d={YANGTZE_PATH} className="atlas-river atlas-river--yangtze" />
          <path d={YELLOW_PATH} className="atlas-river atlas-river--yellow" />
        </g>

        {/* —— 剑脉层：与底图层同变换但相互独立，vector-effect 保证线宽不随缩放变粗 —— */}
        <g ref={veinLayerRef}>
          {model.nodes.map((node) =>
            node.point && node.swords.length > 0
              ? node.swords.map((sn, i) =>
                  sn.point ? (
                    <g key={`vein-${node.sect.id}-${i}`}>
                      <line
                        className="atlas-vein"
                        x1={node.point.x} y1={node.point.y}
                        x2={sn.point.x} y2={sn.point.y}
                        style={{ strokeWidth: node.veinWidth }}
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        className="atlas-vein-flow"
                        x1={node.point.x} y1={node.point.y}
                        x2={sn.point.x} y2={sn.point.y}
                        style={{
                          strokeWidth: Math.max(1.2, node.veinWidth * 0.7),
                          animationDelay: `${-(i * 0.7 + node.veinWidth).toFixed(2)}s`,
                        }}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  ) : null,
                )
              : null,
          )}
        </g>

        {/* —— 标记层：rAF 写 zoom 矩阵；各据点内层再反向缩放，徽记屏显恒定 —— */}
        <g ref={lodRef} data-lod="0">
          <g ref={markerLayerRef}>
            {model.nodes.map((node) =>
              node.point ? (
                <g key={node.sect.id} transform={`translate(${node.point.x} ${node.point.y})`}>
                  <g
                    className={`atlas-marker ${selectedSectId === node.sect.id ? 'is-selected' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={onSectPointerDown}
                    onClick={(e) => onSectClick(e, node)}
                    onPointerEnter={onSectEnter(node)}
                    onPointerMove={onSectEnter(node)}
                    onPointerLeave={onSectLeave}
                  >
                    <g className="atlas-marker-scale">
                      <circle r={node.radius + 12} fill="transparent" />
                      {selectedSectId === node.sect.id && (
                        <circle
                          key={`ripple-${rippleKey}`}
                          className="atlas-ripple"
                          r={node.radius + 6}
                          fill="none"
                          stroke="rgba(196,30,58,0.55)"
                          strokeWidth={2}
                        />
                      )}
                      <HexShape radius={node.radius} selected={selectedSectId === node.sect.id} />
                      <g className="atlas-emblem">
                        <circle r={node.radius * 0.52} className="atlas-emblem-disc" />
                        <EmblemGlyph sectId={node.sect.id} radius={node.radius} />
                      </g>
                      <g className="atlas-label">
                        <text y={node.radius + 16} textAnchor="middle" className="atlas-label-text">
                          {node.sect.name}
                        </text>
                      </g>
                    </g>
                  </g>
                </g>
              ) : null,
            )}
          </g>

          {/* 剑点 + 剑脉端点：随地图缩放的小金点 */}
          <g ref={swordDotLayerRef}>
            {model.nodes.map((node) =>
              node.point
                ? node.swords.map((sn) =>
                    sn.point ? (
                      <circle
                        key={`dot-${sn.sword.id}`}
                        cx={sn.point.x}
                        cy={sn.point.y}
                        r={2.6}
                        className="atlas-sword-dot"
                      />
                    ) : null,
                  )
                : null,
            )}
          </g>

          {/* 剑名：zoom 矩阵定位 + 文字反向缩放，屏显恒定大小；LOD>=2 可见 */}
          <g ref={swordNameLayerRef} data-lod="0">
            {model.nodes.map((node) =>
              node.point
                ? node.swords.map((sn) =>
                    sn.point ? (
                      <g key={`sn-${sn.sword.id}`} transform={`translate(${sn.point.x} ${sn.point.y})`}>
                        <text
                          y={-7}
                          textAnchor="middle"
                          className={`atlas-sword-name ${hoveredSwordId === sn.sword.id ? 'is-hot' : ''}`}
                        >
                          {sn.sword.name}
                        </text>
                      </g>
                    ) : null,
                  )
                : null,
            )}
          </g>
        </g>

        {/* 四角暗角，始终屏幕对齐 */}
        <rect x={0} y={0} width="100%" height="100%" fill="url(#paperVignette)" pointerEvents="none" />
      </svg>

      {/* 云气：屏幕空间缓慢漂移，不随地图变换 */}
      <div className="atlas-clouds" aria-hidden>
        {CLOUDS.map((c, i) => (
          <div
            key={`cloud-${i}`}
            className="atlas-cloud"
            style={{
              top: c.top,
              width: c.width,
              opacity: c.opacity,
              ['--drift' as string]: `${c.duration}s`,
              animationDelay: `${c.delay}s, 0s`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* 悬停浮签：门派名 / 所在地 / 立派朝代；位置由指针事件直接写 DOM */}
      {hoverNode && (
        <div
          ref={tooltipRef}
          className="atlas-tooltip pointer-events-none"
          style={{ left: lastPointerRef.current.x + 16, top: lastPointerRef.current.y + 16 }}
        >
          <div className="font-brush text-2xl text-ink-900">{hoverNode.sect.name}</div>
          <div className="text-xs text-ink-700 mt-0.5">{hoverNode.sect.location}</div>
          <div className="text-xs text-bronze-700">立派于 {hoverNode.sect.foundingDynasty}</div>
        </div>
      )}

      {/* 左下角控制条 */}
      <div className="atlas-controls">
        <button type="button" title="放大 (+)" aria-label="放大"
          onClick={() => commitZoom(KEY_ZOOM_FACTOR)}>
          ＋
        </button>
        <button type="button" title="缩小 (-)" aria-label="缩小"
          onClick={() => commitZoom(1 / KEY_ZOOM_FACTOR)}>
          －
        </button>
        <button type="button" title="重置视角 (0)" aria-label="重置视角"
          onClick={() => startFly(getDefaultView(sizeRef.current), true)}>
          ◎
        </button>
        <span ref={zoomReadoutRef} className="atlas-zoom-readout" />
      </div>

      {/* 右下角缩略图 */}
      <MiniMap
        model={model}
        viewRectRef={minimapViewRef}
        selectedNode={selectedNode}
        onJump={minimapJump}
      />
    </div>
  );
});

/** 六角据点外形 */
function HexShape({ radius, selected }: { radius: number; selected: boolean }) {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${(Math.cos(a) * radius).toFixed(2)},${(Math.sin(a) * radius).toFixed(2)}`);
  }
  return (
    <>
      <polygon points={pts.join(' ')} className={selected ? 'atlas-hex is-selected' : 'atlas-hex'} />
      <polygon points={pts.join(' ')} className="atlas-hex-inner" />
    </>
  );
}

/** 各门派徽记的简化符形（纯 SVG，无外部图片依赖） */
function EmblemGlyph({ sectId, radius }: { sectId: string; radius: number }) {
  const r = radius * 0.34;
  const common = { className: 'atlas-emblem-glyph', strokeWidth: 1.6 } as const;
  switch (sectId) {
    case '1': // 武当：太极
      return (
        <g {...common}>
          <circle r={r} />
          <path d={`M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} A ${r / 2} ${r / 2} 0 0 1 0 0 A ${r / 2} ${r / 2} 0 0 0 0 ${-r} Z`} />
          <circle cy={-r / 2} r={0.9} fill="currentColor" stroke="none" />
          <circle cy={r / 2} r={0.9} fill="none" stroke="currentColor" />
        </g>
      );
    case '2': // 少林：卍字方框
      return (
        <g {...common}>
          <rect x={-r * 0.7} y={-r * 0.7} width={r * 1.4} height={r * 1.4} />
          <path d={`M ${-r * 0.35} ${-r * 0.7} V ${r * 0.2} H 0 M ${r * 0.35} ${r * 0.7} V ${-r * 0.2} H 0`} />
        </g>
      );
    case '3': // 峨眉：莲花
      return (
        <g {...common}>
          <path d={`M 0 ${r} C ${-r} ${r * 0.2} ${-r * 0.5} ${-r} 0 ${-r * 0.4} C ${r * 0.5} ${-r} ${r} ${r * 0.2} 0 ${r} Z`} />
        </g>
      );
    case '5': // 华山：剑锋
      return <path {...common} d={`M 0 ${-r} L ${r * 0.7} ${r} L 0 ${r * 0.35} L ${-r * 0.7} ${r} Z`} />;
    case '15': // 桃花岛：桃
      return (
        <g {...common}>
          <circle cx={-r * 0.3} cy={r * 0.1} r={r * 0.45} />
          <circle cx={r * 0.3} cy={r * 0.1} r={r * 0.45} />
          <path d={`M 0 ${-r * 0.3} Q ${r * 0.15} ${-r * 0.7} ${r * 0.5} ${-r * 0.75}`} />
        </g>
      );
    default:
      return (
        <g {...common}>
          <path d={`M 0 ${-r} L ${r * 0.55} ${r * 0.8} L ${-r * 0.55} ${r * 0.8} Z`} />
        </g>
      );
  }
}

export default AtlasCanvas;
export type { Props as AtlasCanvasProps };
