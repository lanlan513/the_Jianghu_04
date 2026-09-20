/**
 * 视口、锚点缩放、惯性衰减与飞行补间的纯函数。
 *
 * 视口 View = { center: 地图像素坐标, scale: 相对初始倍数 }
 * 屏幕坐标与地图坐标的关系：
 *   screen = (map - center) * scale + screenSize / 2
 *   map    = (screen - screenSize / 2) / scale + center
 */

import { MAP_SIZE, isFiniteNumber } from './geo';
import type { LngLat, Point } from './geo';
import { project, unproject } from './geo';

export interface View {
  /** 视口中心对应的地图像素坐标 */
  center: Point;
  /** 缩放倍数（1 为初始全览） */
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

/** 缩放上下限 */
export const MIN_SCALE = 1;
export const MAX_SCALE = 12;

/** 缩放分级（LOD）阈值：低于此值只画徽记 */
export const LABEL_SCALE = 2.2;
/** 高于此值再显示剑脉上的剑名 */
export const SWORD_LABEL_SCALE = 3.4;

/** 惯性参数 */
export const INERTIA = {
  /** 每帧速度保留比例（60fps 下约 0.85/帧） */
  friction: 0.92,
  /** 速度低于该值（像素/帧）即停止 */
  stopSpeed: 0.15,
  /** 最大甩动速度，避免极端 fling */
  maxSpeed: 90,
};

/** 飞行（补间）参数 */
export const FLY = {
  duration: 520,
};

export function clampScale(scale: number): number {
  if (!isFiniteNumber(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * 把视口中心限制在地图「四周可拖出半屏」的范围内，
 * 避免舆图被甩飞到无限空白之中。
 */
export function clampCenter(center: Point, scale: number, size: Size): Point {
  if (!size || (!isFiniteNumber(size.width) && !isFiniteNumber(size.height))) {
    return isFiniteNumber(center?.x) && isFiniteNumber(center?.y) ? center : { x: MAP_SIZE.width / 2, y: MAP_SIZE.height / 2 };
  }
  const s = clampScale(scale);
  const halfW = size.width / 2 / s;
  const halfH = size.height / 2 / s;
  const x = isFiniteNumber(center.x) ? center.x : MAP_SIZE.width / 2;
  const y = isFiniteNumber(center.y) ? center.y : MAP_SIZE.height / 2;
  return {
    x: Math.min(MAP_SIZE.width + halfW, Math.max(-halfW, x)),
    y: Math.min(MAP_SIZE.height + halfH, Math.max(-halfH, y)),
  };
}

/** 得到合法视口（缩放与中心双重钳制） */
export function clampView(view: View, size: Size): View {
  const scale = clampScale(view.scale);
  return { scale, center: clampCenter(view.center, scale, size) };
}

/**
 * 全览视角：整张舆图等比容纳于视口。
 * 屏幕比地图更宽时，视口中心向中原偏移，保证全部据点首屏可见；
 * 更高时上下留白，中心仍取地图中线。
 */
export function getFitView(size: Size): View {
  const scale = clampScale(Math.max(MIN_SCALE, Math.min(size.width / MAP_SIZE.width, size.height / MAP_SIZE.height)));
  // 宽屏下的水平可视地图范围
  const visibleW = size.width / scale;
  // 中原腹地（约经度 105）在地图 x≈653；默认中心取地图中点与中原可见中心的折中
  const overflowW = Math.max(0, visibleW - MAP_SIZE.width);
  const centerX = MAP_SIZE.width / 2 - overflowW * 0.18;
  const centerY = MAP_SIZE.height / 2;
  return { scale, center: { x: centerX, y: centerY } };
}

/** 初始（默认）视角 */
export function getDefaultView(size: Size): View {
  return getFitView(size);
}

/**
 * 锚点缩放（核心纯函数）。
 * 保证 anchor（屏幕坐标，通常是鼠标位置）在缩放前后对准同一地图像素点。
 */
export function zoomAtPoint(
  view: View,
  anchor: Point,
  factor: number,
  size: Size,
): View {
  if (!isFiniteNumber(factor) || factor <= 0) return clampView(view, size);

  const oldScale = clampScale(view.scale);
  const newScale = clampScale(oldScale * factor);
  // 触到上下限时 factor 实际被压成 1，锚点保持不动
  const effective = newScale / oldScale;

  const mapBefore: Point = {
    x: (anchor.x - size.width / 2) / oldScale + view.center.x,
    y: (anchor.y - size.height / 2) / oldScale + view.center.y,
  };

  const center: Point = {
    x: mapBefore.x - ((anchor.x - size.width / 2) / newScale),
    y: mapBefore.y - ((anchor.y - size.height / 2) / newScale),
  };

  // factor 被钳制时保持原中心，避免末端抖动
  const finalCenter = effective === factor ? center : view.center;
  return clampView({ center: finalCenter, scale: newScale }, size);
}

/** 键盘/按钮缩放：以视口中心为锚 */
export function zoomAtCenter(view: View, factor: number, size: Size): View {
  return zoomAtPoint(view, { x: size.width / 2, y: size.height / 2 }, factor, size);
}

/** 平移（delta 为屏幕像素位移） */
export function panBy(view: View, delta: Point, size: Size): View {
  return clampView(
    {
      scale: view.scale,
      center: { x: view.center.x - delta.x / view.scale, y: view.center.y - delta.y / view.scale },
    },
    size,
  );
}

/**
 * 惯性推进一帧：纯函数，输入当前速度，输出本帧位移与新速度。
 * 调用方累计位移后再交 panBy 钳制。
 */
export function stepInertia(velocity: Point): { delta: Point; velocity: Point; stopped: boolean } {
  const vx = clampVelocity(velocity.x);
  const vy = clampVelocity(velocity.y);
  const speed = Math.hypot(vx, vy);
  if (speed < INERTIA.stopSpeed) {
    return { delta: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, stopped: true };
  }
  return {
    delta: { x: vx, y: vy },
    velocity: { x: vx * INERTIA.friction, y: vy * INERTIA.friction },
    stopped: false,
  };
}

function clampVelocity(v: number): number {
  if (!isFiniteNumber(v)) return 0;
  return Math.max(-INERTIA.maxSpeed, Math.min(INERTIA.maxSpeed, v));
}

/** easeInOutCubic */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * 飞行补间的单帧视口。from -> to（to 已钳制）。
 * t∈[0,1]，返回插值后的视口。
 */
export function interpolateView(from: View, to: View, t: number): View {
  const k = easeInOut(t);
  return {
    scale: from.scale + (to.scale - from.scale) * k,
    center: {
      x: from.center.x + (to.center.x - from.center.x) * k,
      y: from.center.y + (to.center.y - from.center.y) * k,
    },
  };
}

/** 让某个经纬度点飞到视口中心（指定目标倍数） */
export function flyToLngLat(from: View, target: LngLat, scale: number, size: Size): View | null {
  const p = project(target.lng, target.lat);
  if (!p) return null;
  return clampView({ center: p, scale }, size);
}

/** 屏幕坐标 -> 地图像素坐标（供指针反查） */
export function screenToMap(view: View, screen: Point, size: Size): Point | null {
  if (!isFiniteNumber(screen.x) || !isFiniteNumber(screen.y)) return null;
  return {
    x: (screen.x - size.width / 2) / view.scale + view.center.x,
    y: (screen.y - size.height / 2) / view.scale + view.center.y,
  };
}

/** 地图像素坐标 -> 屏幕坐标 */
export function mapToScreen(view: View, map: Point, size: Size): Point | null {
  if (!isFiniteNumber(map.x) || !isFiniteNumber(map.y)) return null;
  return {
    x: (map.x - view.center.x) * view.scale + size.width / 2,
    y: (map.y - view.center.y) * view.scale + size.height / 2,
  };
}

/** 视口中心的经纬度（用于 URL 之外的调试） */
export function viewCenterLngLat(view: View): LngLat | null {
  return unproject(view.center);
}

/** 根据缩放倍数返回 LOD 等级：0 只显徽记，1 加门派标签，2 再加剑名 */
export function getLod(scale: number): 0 | 1 | 2 {
  if (scale >= SWORD_LABEL_SCALE) return 2;
  if (scale >= LABEL_SCALE) return 1;
  return 0;
}
