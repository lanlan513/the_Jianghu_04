/**
 * 视口状态 <-> URL 的纯函数编解码。
 *
 * 视口状态的唯一来源是 URL：?x=..&y=..&z=..&sect=..&sword=..
 * - x/y 为视口中心经纬度，z 为缩放倍数
 * - 解析时任何参数非法（NaN、越界、格式错误）都被静默丢弃并回退默认
 * - 序列化输出精简且稳定，便于刷新与分享
 */

import { MAP_BOUNDS, isFiniteNumber } from './geo';
import type { LngLat } from './geo';
import { MIN_SCALE, MAX_SCALE, getDefaultView } from './viewport';
import type { View, Size } from './viewport';
import { project, unproject } from './geo';

export interface UrlState {
  /** 来自 URL 的视口；非法/缺省时为 null，由调用方给默认视角 */
  view: View | null;
  /** 选中的门派 id */
  sectId: string | null;
  /** 指定查看详情的名剑 id */
  swordId: string | null;
}

export interface UrlStateInput {
  view: View;
  sectId?: string | null;
  swordId?: string | null;
}

function parseNum(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  // 严格拒绝 12abc、Infinity、0x1p 等写法
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return isFiniteNumber(n) ? n : null;
}

/**
 * 解析 URL 查询串。search 可以是 location.search 或任意 query 字符串。
 * 永远不抛异常。
 */
export function parseUrlState(search: string | URLSearchParams): UrlState {
  const q = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;

  const lng = parseNum(q.get('x'));
  const lat = parseNum(q.get('y'));
  const z = parseNum(q.get('z'));

  let view: View | null = null;
  if (
    lng !== null && lat !== null && z !== null &&
    lng >= MAP_BOUNDS.minLng - 30 && lng <= MAP_BOUNDS.maxLng + 30 &&
    lat >= MAP_BOUNDS.minLat - 20 && lat <= MAP_BOUNDS.maxLat + 20 &&
    z >= MIN_SCALE && z <= MAX_SCALE
  ) {
    const p = project(lng, lat);
    if (p) view = { center: p, scale: z };
  }

  const sectRaw = q.get('sect');
  const swordRaw = q.get('sword');
  const sectId = sectRaw && /^[A-Za-z0-9_-]{1,32}$/.test(sectRaw) ? sectRaw : null;
  const swordId = swordRaw && /^[A-Za-z0-9_-]{1,32}$/.test(swordRaw) ? swordRaw : null;

  return { view, sectId, swordId };
}

function fmt(n: number): string {
  // 视口参数保留 3 位小数，URL 足够短且无肉眼可察误差
  return (Math.round(n * 1000) / 1000).toString();
}

/** 序列化视口与选中态为 query string（不含前导 ?） */
export function serializeState(input: UrlStateInput): string {
  const ll: LngLat | null = unproject(input.view.center);
  const q = new URLSearchParams();
  if (ll) {
    q.set('x', fmt(ll.lng));
    q.set('y', fmt(ll.lat));
    q.set('z', fmt(input.view.scale));
  }
  if (input.sectId) q.set('sect', input.sectId);
  if (input.swordId) q.set('sword', input.swordId);
  return q.toString();
}

/** 组合成完整 path+search，便于 history.pushState */
export function buildUrl(input: UrlStateInput, pathname: string): string {
  const qs = serializeState(input);
  return qs ? `${pathname}?${qs}` : pathname;
}

/** 当 URL 完全缺省/非法时，给出默认视口的初始 state */
export function withDefaultView(state: UrlState, size: Size): UrlState {
  if (state.view) return state;
  const def: View = getDefaultView(size);
  return { ...state, view: def };
}
