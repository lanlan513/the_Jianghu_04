/**
 * 江湖舆图 - 纯函数模块
 * 投影/逆投影、锚点缩放、惯性衰减、视口钳制、URL 解析与序列化。
 * 全部无副作用，可独立测试。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** 视口状态：世界坐标中心点 + 缩放倍数 */
export interface ViewState {
  x: number;
  y: number;
  k: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 10;
/** 达到该缩放倍数才显示门派标签与剑名 */
export const DETAIL_SCALE = 2.2;

/** 投影参考点：中国大致中心 */
const LNG0 = 104;
const LAT0 = 35;
/** 1 度经纬对应的世界单位 */
const UNIT = 10;
const COS_LAT0 = Math.cos((LAT0 * Math.PI) / 180);

/** 经纬度 -> 世界坐标（等距圆柱投影，带纬度修正）。非法输入返回 null */
export function project(lng: number, lat: number): Point | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const x = (lng - LNG0) * COS_LAT0 * UNIT;
  const y = (LAT0 - lat) * UNIT;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** 世界坐标 -> 经纬度（project 的逆变换）。非法输入返回 null */
export function unproject(x: number, y: number): { lng: number; lat: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const lng = x / (COS_LAT0 * UNIT) + LNG0;
  const lat = LAT0 - y / UNIT;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

export function isValidView(v: ViewState): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.k) && v.k > 0;
}

export function clampScale(k: number): number {
  if (!Number.isFinite(k)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));
}

/**
 * 以屏幕锚点为中心缩放：保持锚点下的世界点不动。
 * 缩放倍数会被钳制在 [MIN_SCALE, MAX_SCALE]。
 */
export function zoomAt(view: ViewState, anchorPx: Point, viewport: Size, nextK: number): ViewState {
  const k = clampScale(nextK);
  if (!isValidView(view) || viewport.width <= 0 || viewport.height <= 0) return view;
  if (!Number.isFinite(anchorPx.x) || !Number.isFinite(anchorPx.y)) return { ...view, k };
  // 锚点对应的世界坐标
  const wx = view.x + (anchorPx.x - viewport.width / 2) / view.k;
  const wy = view.y + (anchorPx.y - viewport.height / 2) / view.k;
  return {
    k,
    x: wx - (anchorPx.x - viewport.width / 2) / k,
    y: wy - (anchorPx.y - viewport.height / 2) / k,
  };
}

/** 按屏幕像素平移视口 */
export function panByScreen(view: ViewState, dxPx: number, dyPx: number): ViewState {
  if (!isValidView(view)) return view;
  return { ...view, x: view.x - dxPx / view.k, y: view.y - dyPx / view.k };
}

/** 惯性速度衰减（纯函数）：指数衰减，半衰期约 100ms */
export function decayVelocity(vPxPerMs: Point, dtMs: number): Point {
  if (dtMs <= 0) return vPxPerMs;
  const d = Math.exp(-dtMs / 140);
  return { x: vPxPerMs.x * d, y: vPxPerMs.y * d };
}

/** 惯性停止阈值（px/ms） */
export const INERTIA_STOP_SPEED = 0.015;
/** 惯性速度上限（px/ms） */
export const INERTIA_MAX_SPEED = 3;

/** 将视口中心钳制在边界附近（允许 marginPx 像素的越界） */
export function clampView(view: ViewState, bounds: Bounds, viewport: Size, marginPx = 80): ViewState {
  if (!isValidView(view)) return view;
  const k = clampScale(view.k);
  const mx = marginPx / k;
  const my = marginPx / k;
  let lo = bounds.minX - mx;
  let hi = bounds.maxX + mx;
  const x = lo > hi ? (bounds.minX + bounds.maxX) / 2 : Math.min(hi, Math.max(lo, view.x));
  lo = bounds.minY - my;
  hi = bounds.maxY + my;
  const y = lo > hi ? (bounds.minY + bounds.maxY) / 2 : Math.min(hi, Math.max(lo, view.y));
  return { x, y, k };
}

/** 计算让边界完整落入视口的初始视口 */
export function fitViewToBounds(bounds: Bounds, viewport: Size, paddingPx = 90): ViewState {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const availW = Math.max(1, viewport.width - paddingPx * 2);
  const availH = Math.max(1, viewport.height - paddingPx * 2);
  if (w <= 0 || h <= 0 || !Number.isFinite(w) || !Number.isFinite(h)) {
    return { x: Number.isFinite(cx) ? cx : 0, y: Number.isFinite(cy) ? cy : 0, k: 1 };
  }
  return { x: cx, y: cy, k: clampScale(Math.min(availW / w, availH / h)) };
}

/** 由一组世界坐标点计算边界；空集返回 null */
export function computeBounds(points: Point[], padding = 0): Bounds | null {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of valid) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

/** 六角据点顶点（平顶六边形），返回 SVG polygon points 字符串 */
export function hexagonPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(' ');
}

/** 判断两个视口是否足够接近（用于避免 URL 回写引发的抖动） */
export function viewsClose(a: ViewState, b: ViewState): boolean {
  return Math.abs(a.x - b.x) < 0.3 && Math.abs(a.y - b.y) < 0.3 && Math.abs(a.k - b.k) < 0.002;
}

/**
 * 从 URL query 解析视口与选中门派。
 * 参数缺失或非法（NaN、越界）时 view 返回 null，由调用方回退到默认视角。
 */
export function parseViewFromSearch(search: string): { view: ViewState | null; sectId: string | null } {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { view: null, sectId: null };
  }
  const sectRaw = params.get('sect');
  const sectId = sectRaw && sectRaw.trim() !== '' ? sectRaw : null;
  const cxRaw = params.get('cx');
  const cyRaw = params.get('cy');
  const zRaw = params.get('z');
  if (cxRaw == null && cyRaw == null && zRaw == null) {
    return { view: null, sectId };
  }
  const cx = Number(cxRaw);
  const cy = Number(cyRaw);
  const z = Number(zRaw);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(z)) {
    return { view: null, sectId };
  }
  if (Math.abs(cx) > 5000 || Math.abs(cy) > 5000) {
    return { view: null, sectId };
  }
  return { view: { x: cx, y: cy, k: clampScale(z) }, sectId };
}

/** 将视口与选中门派序列化为 URL query（数值取整，避免无意义的历史记录差异） */
export function buildSearchFromView(view: ViewState, sectId: string | null): string {
  const params = new URLSearchParams();
  params.set('cx', view.x.toFixed(1));
  params.set('cy', view.y.toFixed(1));
  params.set('z', view.k.toFixed(3));
  if (sectId) params.set('sect', sectId);
  return params.toString();
}
