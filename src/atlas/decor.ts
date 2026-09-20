/**
 * 舆图底纹：宣纸之上的水墨国界、江河、山峦与云气。
 * 全部为静态数据（地图空间坐标 / 屏幕空间云气），由 SVG 渲染并以 CSS 呼吸。
 */

import { project } from './geo';
import type { Point } from './geo';

/** 取一串经纬度的投影像素，丢弃投影失败的点 */
function chain(coords: Array<[number, number]>): Point[] {
  return coords
    .map(([lng, lat]) => project(lng, lat))
    .filter((p): p is Point => p !== null);
}

function toPath(points: Point[], close = false): string {
  if (points.length === 0) return '';
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return close ? `${d} Z` : d;
}

/**
 * 艺术化的中原国界线（非精确测绘，仅作水墨意境），沿主要城市外围勾勒。
 */
const BORDER_COORDS: Array<[number, number]> = [
  [81, 47], [85, 48], [91, 46.5], [96, 42.8], [102, 42.5], [107, 42.4],
  [111.5, 45], [116.5, 46.3], [120, 47.5], [124, 48], [128, 46],
  [131, 44.8], [134.5, 42.5], [130.7, 42.5], [128, 41.5], [125, 40.8],
  [124.3, 39.9], [121.8, 39.2], [121.2, 38.9], [119.5, 37.8],
  [122.7, 37.4], [121, 36.4], [120.3, 35.5], [119.8, 34.6],
  [121.2, 32.6], [121.9, 31], [121.3, 30.3], [120.5, 28],
  [119.6, 26.5], [118, 24.5], [115.5, 22.8], [112, 21.5],
  [109.5, 21], [108.2, 21.6], [106.7, 21.7], [105.3, 23.1],
  [102.5, 22.4], [101.2, 21.2], [99.2, 22], [97.6, 24],
  [97.5, 25.5], [98.7, 27.5], [98.2, 28.3], [96.3, 29],
  [94.5, 28.5], [92, 27.8], [89, 28], [85.5, 28.2],
  [82, 30.2], [79, 32], [78.5, 34.5], [80.2, 35.8],
  [78, 37.5], [80.5, 41], [82, 45], [81, 47],
];

/** 长江（意写） */
const YANGTZE_COORDS: Array<[number, number]> = [
  [91, 33.5], [97, 32.5], [101.8, 30], [103.5, 29.5], [106.5, 29.5],
  [110, 30], [112, 30.5], [114.3, 30.6], [117, 30.5], [119, 31.5],
  [121, 31.9],
];

/** 黄河（意写，河套一笔） */
const YELLOW_COORDS: Array<[number, number]> = [
  [96, 35], [99, 36], [103.8, 36], [106, 38], [107.5, 40.2],
  [110.5, 40.5], [111.5, 38.5], [110.5, 36], [110.3, 34.6],
  [113.5, 34.8], [116.5, 35.5], [118.5, 37], [119.2, 37.8],
];

export const BORDER_PATH = toPath(chain(BORDER_COORDS), true);
export const YANGTZE_PATH = toPath(chain(YANGTZE_COORDS));
export const YELLOW_PATH = toPath(chain(YELLOW_COORDS));

export interface MountainSpec {
  x: number;
  y: number;
  /** 底宽（地图像素） */
  w: number;
  /** 峰高 */
  h: number;
  /** 墨色浓淡 0..1 */
  ink: number;
  /** 动画错峰（秒） */
  delay: number;
  /** 呼吸周期（秒） */
  duration: number;
}

function M(lng: number, lat: number, w: number, h: number, ink: number, delay: number, duration = 11): MountainSpec | null {
  const p = project(lng, lat);
  return p ? { x: p.x, y: p.y, w, h, ink, delay, duration } : null;
}

/** 水墨山峦层叠位置（远山淡、近山浓） */
export const MOUNTAINS: MountainSpec[] = [
  M(100, 27, 340, 105, 0.1, 0),
  M(112, 31, 400, 124, 0.13, 1.8),
  M(88, 40, 320, 96, 0.08, 3.2),
  M(108, 39, 360, 112, 0.11, 4.6),
  M(118, 36, 300, 86, 0.09, 2.6, 13),
  M(105, 33, 280, 84, 0.07, 5.8, 12),
].filter((m): m is MountainSpec => m !== null);

/** 山峦的三峰剪影路径（以 x,y 为山体中轴底边） */
export function mountainPath(m: MountainSpec): string {
  const { x, y, w, h } = m;
  const l = x - w / 2;
  return [
    `M${l.toFixed(0)} ${y.toFixed(0)}`,
    `Q${(l + w * 0.18).toFixed(0)} ${(y - h * 0.72).toFixed(0)} ${(l + w * 0.32).toFixed(0)} ${(y - h * 0.55).toFixed(0)}`,
    `Q${(l + w * 0.42).toFixed(0)} ${(y - h * 1.02).toFixed(0)} ${(l + w * 0.55).toFixed(0)} ${(y - h * 0.7).toFixed(0)}`,
    `Q${(l + w * 0.66).toFixed(0)} ${(y - h * 0.9).toFixed(0)} ${(l + w * 0.78).toFixed(0)} ${(y - h * 0.45).toFixed(0)}`,
    `Q${(x + w / 2).toFixed(0)} ${(y - h * 0.35).toFixed(0)} ${(x + w / 2).toFixed(0)} ${y.toFixed(0)}`,
    'Z',
  ].join(' ');
}

export interface CloudSpec {
  /** 屏幕空间百分比位置 */
  top: string;
  width: number;
  duration: number;
  delay: number;
  opacity: number;
}

/** 云气固定在屏幕空间（不随地图平移），缓慢横移并淡入淡出 */
export const CLOUDS: CloudSpec[] = [
  { top: '14%', width: 520, duration: 85, delay: 0, opacity: 0.5 },
  { top: '30%', width: 380, duration: 110, delay: -30, opacity: 0.4 },
  { top: '58%', width: 620, duration: 130, delay: -60, opacity: 0.45 },
  { top: '74%', width: 300, duration: 95, delay: -15, opacity: 0.35 },
];
