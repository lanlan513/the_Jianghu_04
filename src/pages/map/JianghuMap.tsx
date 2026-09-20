import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Sect, Sword } from '@/types';
import {
  Bounds,
  DETAIL_SCALE,
  INERTIA_MAX_SPEED,
  INERTIA_STOP_SPEED,
  Point,
  Size,
  ViewState,
  clampView,
  decayVelocity,
  fitViewToBounds,
  hexagonPoints,
  panByScreen,
  viewsClose,
  zoomAt,
} from './mapMath';

export interface SwordNode {
  sword: Sword;
  pos: Point;
}

export interface MapSect {
  sect: Sect;
  pos: Point;
  radius: number;
  veinWidth: number;
  swordNodes: SwordNode[];
}

interface JianghuMapProps {
  mapSects: MapSect[];
  worldBounds: Bounds;
  /** URL 解析出的目标视口；null 表示需要自适应全图 */
  targetView: ViewState | null;
  selectedSectId: string | null;
  onViewCommit: (view: ViewState) => void;
  onSelectSect: (id: string | null, view: ViewState) => void;
  onOpenSword: (id: string) => void;
}

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
  moved: number;
  samples: { t: number; x: number; y: number }[];
}

/** 生成水墨山峦轮廓（确定性伪随机，随边界稳定） */
function buildRidge(bounds: Bounds, baseY: number, amp: number, seed: number): string {
  const pts: string[] = [`${bounds.minX},${baseY + amp * 1.6}`];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const x = bounds.minX + (i / n) * (bounds.maxX - bounds.minX);
    const h =
      Math.abs(Math.sin(i * 1.7 + seed)) * amp +
      Math.abs(Math.sin(i * 0.83 + seed * 2.3)) * amp * 0.55;
    pts.push(`${x.toFixed(1)},${(baseY - h).toFixed(1)}`);
  }
  pts.push(`${bounds.maxX},${baseY + amp * 1.6}`);
  return pts.join(' ');
}

export default function JianghuMap({
  mapSects,
  worldBounds,
  targetView,
  selectedSectId,
  onViewCommit,
  onSelectSect,
  onOpenSword,
}: JianghuMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const miniSvgRef = useRef<SVGSVGElement>(null);
  const miniRectRef = useRef<SVGRectElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // ---- 可变视口状态：唯一真源在 ref，渲染直接写 DOM，不经过 React state ----
  const viewRef = useRef<ViewState>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef<Size>({ width: 1, height: 1 });
  const rafRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const initializedRef = useRef(false);
  const hoverWorldRef = useRef<Point | null>(null);
  const commitTimerRef = useRef(0);

  const [hovered, setHovered] = useState<MapSect | null>(null);
  const [, setReady] = useState(false);

  // 最新回调/属性镜像，供事件与 rAF 闭包使用
  const propsRef = useRef({ onViewCommit, onSelectSect, onOpenSword, selectedSectId, targetView });
  propsRef.current = { onViewCommit, onSelectSect, onOpenSword, selectedSectId, targetView };

  /** 把 viewRef 应用到 SVG / 缩略图 / 提示框，全程 DOM 直写 */
  const render = useCallback(() => {
    const svg = svgRef.current;
    const world = worldRef.current;
    if (!svg || !world) return;
    const { width, height } = sizeRef.current;
    const v = viewRef.current;
    world.setAttribute(
      'transform',
      `translate(${width / 2} ${height / 2}) scale(${v.k}) translate(${-v.x} ${-v.y})`,
    );
    svg.classList.toggle('is-detail', v.k >= DETAIL_SCALE);
    const rect = miniRectRef.current;
    if (rect) {
      const w = width / v.k;
      const h = height / v.k;
      rect.setAttribute('x', String(v.x - w / 2));
      rect.setAttribute('y', String(v.y - h / 2));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
    }
    if (tooltipRef.current && hoverWorldRef.current) {
      const sx = (hoverWorldRef.current.x - v.x) * v.k + width / 2;
      const sy = (hoverWorldRef.current.y - v.y) * v.k + height / 2;
      tooltipRef.current.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -118%)`;
    }
  }, []);

  const stopMotion = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  /** 视口提交：立即或防抖后写入 URL（由父组件决定 push/replace） */
  const commitView = useCallback((immediate: boolean) => {
    window.clearTimeout(commitTimerRef.current);
    if (immediate) {
      propsRef.current.onViewCommit({ ...viewRef.current });
    } else {
      commitTimerRef.current = window.setTimeout(() => {
        propsRef.current.onViewCommit({ ...viewRef.current });
      }, 280);
    }
  }, []);

  const clampNow = useCallback(
    (v: ViewState) => clampView(v, worldBounds, sizeRef.current),
    [worldBounds],
  );

  /** 惯性滑动：rAF 循环内只做纯函数计算 + DOM 直写 */
  const startInertia = useCallback(
    (vx: number, vy: number) => {
      let v = { x: vx, y: vy };
      let last = performance.now();
      const step = (t: number) => {
        const dt = Math.min(48, t - last);
        last = t;
        v = decayVelocity(v, dt);
        if (Math.hypot(v.x, v.y) < INERTIA_STOP_SPEED) {
          commitView(true);
          return;
        }
        viewRef.current = clampNow(panByScreen(viewRef.current, v.x * dt, v.y * dt));
        render();
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [clampNow, commitView, render],
  );

  /** 平滑过渡到目标视口（URL 变化、后退/前进时触发） */
  const tweenTo = useCallback(
    (target: ViewState) => {
      stopMotion();
      const start = { ...viewRef.current };
      const t0 = performance.now();
      const dur = 360;
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        viewRef.current = clampNow({
          x: start.x + (target.x - start.x) * e,
          y: start.y + (target.y - start.y) * e,
          k: start.k * Math.pow(target.k / start.k, e),
        });
        render();
        if (p < 1) rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [clampNow, render, stopMotion],
  );

  // ---- 尺寸测量 + 初始化视口 ----
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      sizeRef.current = { width: rect.width, height: rect.height };
      if (!initializedRef.current) {
        initializedRef.current = true;
        const initial =
          propsRef.current.targetView ?? fitViewToBounds(worldBounds, sizeRef.current);
        viewRef.current = clampNow(initial);
        setReady(true);
        // URL 中没有合法视口时，把自适应结果回写（replace，不产生历史）
        if (!propsRef.current.targetView) commitView(true);
      }
      render();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [worldBounds, clampNow, commitView, render]);

  // ---- URL -> 视口同步（后退/前进/分享链接打开） ----
  useEffect(() => {
    if (!targetView || !initializedRef.current) return;
    if (viewsClose(viewRef.current, targetView)) return;
    tweenTo(targetView);
  }, [targetView, tweenTo]);

  // ---- 滚轮缩放（原生监听，passive: false 以阻止页面缩放/滚动） ----
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopMotion();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.exp(-e.deltaY * 0.0016);
      viewRef.current = clampNow(
        zoomAt(viewRef.current, anchor, sizeRef.current, viewRef.current.k * factor),
      );
      render();
      commitView(false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clampNow, commitView, render, stopMotion]);

  // ---- 卸载清理 ----
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(commitTimerRef.current);
    };
  }, []);

  // ---- 指针拖拽（Pointer Events 统一鼠标/触摸；touch-action: none 解决页面滚动冲突） ----
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest?.('[data-minimap]')) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    stopMotion();
    rootRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: 0,
      samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    const now = performance.now();
    drag.samples.push({ t: now, x: e.clientX, y: e.clientY });
    if (drag.samples.length > 8) drag.samples.shift();
    viewRef.current = clampNow(panByScreen(viewRef.current, dx, dy));
    render();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (drag.moved < 6) {
      // 视为点选：据点 -> 选中；名剑 -> 跳转详情；空白 -> 取消选中
      const target = e.target as Element;
      const sectEl = target.closest?.('[data-sect-id]');
      const swordEl = target.closest?.('[data-sword-id]');
      if (sectEl) {
        const id = sectEl.getAttribute('data-sect-id');
        if (id) propsRef.current.onSelectSect(id, { ...viewRef.current });
      } else if (swordEl) {
        const id = swordEl.getAttribute('data-sword-id');
        if (id) propsRef.current.onOpenSword(id);
      } else if (propsRef.current.selectedSectId) {
        propsRef.current.onSelectSect(null, { ...viewRef.current });
      }
      return;
    }

    // 惯性：取最近 120ms 的采样估算速度
    const now = performance.now();
    const samples = drag.samples.filter((s) => now - s.t < 120);
    if (samples.length >= 2) {
      const first = samples[0];
      const lastS = samples[samples.length - 1];
      const dt = lastS.t - first.t;
      if (dt > 16) {
        let vx = (lastS.x - first.x) / dt;
        let vy = (lastS.y - first.y) / dt;
        const speed = Math.hypot(vx, vy);
        if (speed > INERTIA_MAX_SPEED) {
          vx = (vx / speed) * INERTIA_MAX_SPEED;
          vy = (vy / speed) * INERTIA_MAX_SPEED;
        }
        if (Math.hypot(vx, vy) > 0.05) {
          startInertia(vx, vy);
          return;
        }
      }
    }
    commitView(true);
  };

  const onPointerCancel = () => {
    dragRef.current = null;
  };

  // ---- 键盘：+/- 缩放、方向键平移、0/R 复位 ----
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const v = viewRef.current;
    const size = sizeRef.current;
    const center = { x: size.width / 2, y: size.height / 2 };
    let next: ViewState | null = null;
    switch (e.key) {
      case '+':
      case '=':
        next = zoomAt(v, center, size, v.k * 1.25);
        break;
      case '-':
      case '_':
        next = zoomAt(v, center, size, v.k / 1.25);
        break;
      case 'ArrowLeft':
        next = panByScreen(v, -80, 0);
        break;
      case 'ArrowRight':
        next = panByScreen(v, 80, 0);
        break;
      case 'ArrowUp':
        next = panByScreen(v, 0, -80);
        break;
      case 'ArrowDown':
        next = panByScreen(v, 0, 80);
        break;
      case '0':
      case 'r':
      case 'R':
        next = fitViewToBounds(worldBounds, size);
        break;
      default:
        return;
    }
    e.preventDefault();
    stopMotion();
    viewRef.current = clampNow(next);
    render();
    commitView(false);
  };

  // ---- 缩略图点击跳转 ----
  const onMinimapClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = miniSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const pad = 24;
    const w = worldBounds.maxX - worldBounds.minX + pad * 2;
    const h = worldBounds.maxY - worldBounds.minY + pad * 2;
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    stopMotion();
    viewRef.current = clampNow({
      ...viewRef.current,
      x: worldBounds.minX - pad + fx * w,
      y: worldBounds.minY - pad + fy * h,
    });
    render();
    commitView(true);
  };

  // ---- 静态世界内容（山峦、云气） ----
  const scenery = useMemo(() => {
    const spanY = worldBounds.maxY - worldBounds.minY;
    const ridges = [
      { d: buildRidge(worldBounds, worldBounds.minY + spanY * 0.28, spanY * 0.1, 1.7), o: 0.1, delay: 0.2 },
      { d: buildRidge(worldBounds, worldBounds.minY + spanY * 0.52, spanY * 0.13, 4.1), o: 0.14, delay: 0.7 },
      { d: buildRidge(worldBounds, worldBounds.minY + spanY * 0.78, spanY * 0.11, 7.9), o: 0.18, delay: 1.2 },
    ];
    const cx = (worldBounds.minX + worldBounds.maxX) / 2;
    const clouds = [
      { x: cx - 130, y: worldBounds.minY + spanY * 0.2, rx: 46, ry: 9, fast: false },
      { x: cx + 90, y: worldBounds.minY + spanY * 0.38, rx: 60, ry: 11, fast: true },
      { x: cx - 30, y: worldBounds.minY + spanY * 0.62, rx: 52, ry: 10, fast: false },
      { x: cx + 170, y: worldBounds.minY + spanY * 0.75, rx: 40, ry: 8, fast: true },
    ];
    return { ridges, clouds };
  }, [worldBounds]);

  const miniPad = 24;
  const miniViewBox = `${worldBounds.minX - miniPad} ${worldBounds.minY - miniPad} ${
    worldBounds.maxX - worldBounds.minX + miniPad * 2
  } ${worldBounds.maxY - worldBounds.minY + miniPad * 2}`;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="application"
      aria-label="江湖舆图：滚轮缩放，拖拽平移，方向键移动，加减缩放，0 复位"
      className="absolute inset-0 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-cinnabar-600/40 cursor-grab active:cursor-grabbing select-none"
      style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
    >
      <svg ref={svgRef} className="block h-full w-full" aria-hidden="true">
        <g ref={worldRef}>
          {/* 水墨山峦：淡入 */}
          {scenery.ridges.map((r, i) => (
            <polygon
              key={i}
              points={r.d}
              className="ink-mountain fill-ink-800"
              style={{ ['--mo' as string]: r.o, animationDelay: `${r.delay}s` }}
            />
          ))}
          {/* 云气：漂移 */}
          {scenery.clouds.map((c, i) => (
            <g key={i} transform={`translate(${c.x} ${c.y})`}>
              <g className={c.fast ? 'ink-cloud-fast' : 'ink-cloud'}>
                <ellipse rx={c.rx} ry={c.ry} className="fill-ink-100" opacity={0.75} />
                <ellipse rx={c.rx * 0.6} ry={c.ry * 0.7} x={c.rx * 0.4} y={-c.ry * 0.5} className="fill-ink-50" opacity={0.6} />
              </g>
            </g>
          ))}

          {/* 剑脉：名剑按所属门派串联，线宽随人气 */}
          {mapSects.map((ms) => {
            if (ms.swordNodes.length === 0) return null;
            const d =
              `M ${ms.pos.x} ${ms.pos.y} ` +
              ms.swordNodes.map((sn) => `L ${sn.pos.x} ${sn.pos.y}`).join(' ');
            return (
              <g key={`vein-${ms.sect.id}`}>
                <path
                  d={d}
                  fill="none"
                  className="stroke-gold-700/50"
                  strokeWidth={ms.veinWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={d}
                  fill="none"
                  className="vein-flow stroke-gold-200"
                  strokeWidth={Math.max(0.6, ms.veinWidth * 0.55)}
                  strokeLinecap="round"
                />
              </g>
            );
          })}

          {/* 名剑节点 */}
          {mapSects.map((ms) =>
            ms.swordNodes.map((sn) => (
              <g
                key={`sword-${sn.sword.id}`}
                transform={`translate(${sn.pos.x} ${sn.pos.y})`}
                data-sword-id={sn.sword.id}
                className="cursor-pointer"
              >
                <rect
                  x={-2.4}
                  y={-2.4}
                  width={4.8}
                  height={4.8}
                  transform="rotate(45)"
                  className="fill-gold-400 stroke-gold-700"
                  strokeWidth={0.6}
                />
                <text
                  y={-5.5}
                  textAnchor="middle"
                  fontSize={4.6}
                  className="map-detail map-label fill-gold-800"
                >
                  {sn.sword.name}
                </text>
              </g>
            )),
          )}

          {/* 门派据点：六角形，大小随人气 */}
          {mapSects.map((ms) => {
            const selected = ms.sect.id === selectedSectId;
            const emblemR = ms.radius * 0.62;
            return (
              <g
                key={ms.sect.id}
                transform={`translate(${ms.pos.x} ${ms.pos.y})`}
                data-sect-id={ms.sect.id}
                className="sect-node cursor-pointer"
                onMouseEnter={() => {
                  hoverWorldRef.current = ms.pos;
                  setHovered(ms);
                  render();
                }}
                onMouseLeave={() => {
                  hoverWorldRef.current = null;
                  setHovered(null);
                }}
              >
                {selected && (
                  <circle
                    key={`ripple-${selectedSectId}`}
                    r={ms.radius + 3}
                    className="select-ripple fill-none stroke-cinnabar-600"
                    strokeWidth={1.2}
                  />
                )}
                <polygon
                  points={hexagonPoints(0, 0, ms.radius)}
                  className={`sect-hex ${
                    selected
                      ? 'fill-cinnabar-50 stroke-cinnabar-700'
                      : 'fill-ink-50 stroke-ink-800'
                  }`}
                  strokeWidth={selected ? 1.4 : 1}
                />
                <polygon
                  points={hexagonPoints(0, 0, ms.radius * 0.78)}
                  className="fill-none stroke-ink-400"
                  strokeWidth={0.4}
                  opacity={0.7}
                />
                <g className="emblem-rot">
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={emblemR * 1.1}
                    className="fill-ink-700 font-brush"
                  >
                    {ms.sect.name.charAt(0)}
                  </text>
                  <clipPath id={`emblem-clip-${ms.sect.id}`}>
                    <circle r={emblemR} />
                  </clipPath>
                  <image
                    href={ms.sect.emblemUrl}
                    x={-emblemR}
                    y={-emblemR}
                    width={emblemR * 2}
                    height={emblemR * 2}
                    clipPath={`url(#emblem-clip-${ms.sect.id})`}
                    preserveAspectRatio="xMidYMid slice"
                    onError={(e) => {
                      (e.currentTarget as SVGImageElement).style.display = 'none';
                    }}
                  />
                </g>
                <text
                  y={ms.radius + 8.5}
                  textAnchor="middle"
                  fontSize={7}
                  fontWeight={600}
                  className="map-detail map-label fill-ink-800"
                >
                  {ms.sect.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* 悬停提示：门派名 / 所在地 / 立派朝代 */}
      {hovered && (
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute left-0 top-0 z-20 whitespace-nowrap border border-ink-300 bg-ink-50/95 px-3 py-2 shadow-ink"
        >
          <p className="font-brush text-lg leading-tight text-ink-900">{hovered.sect.name}</p>
          <p className="font-song text-xs text-ink-600">
            {hovered.sect.location} · 立派于{hovered.sect.foundingDynasty}朝
          </p>
          <p className="font-song text-[10px] text-ink-400">点击查看门派详情</p>
        </div>
      )}

      {/* 缩略图：当前视口 + 点击跳转 */}
      <svg
        ref={miniSvgRef}
        data-minimap
        viewBox={miniViewBox}
        className="absolute bottom-3 right-3 z-10 h-28 w-40 cursor-crosshair border border-ink-300 bg-ink-100/90 shadow-ink md:h-32 md:w-48"
        onClick={onMinimapClick}
        aria-label="缩略图，点击跳转视角"
      >
        {scenery.ridges.map((r, i) => (
          <polygon key={i} points={r.d} className="fill-ink-800" opacity={0.08} />
        ))}
        {mapSects.map((ms) => (
          <circle
            key={ms.sect.id}
            cx={ms.pos.x}
            cy={ms.pos.y}
            r={2.2}
            className={ms.sect.id === selectedSectId ? 'fill-cinnabar-600' : 'fill-ink-700'}
          />
        ))}
        <rect
          ref={miniRectRef}
          className="fill-cinnabar-600/10 stroke-cinnabar-700"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
