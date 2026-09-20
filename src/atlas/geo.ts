/**
 * 地理坐标与投影纯函数。
 *
 * 舆图采用「等距圆柱（方格）投影」：经纬度线性映射到地图平面坐标。
 * 所有函数均为无副作用纯函数，任何非法输入都会得到 null / 安全兜底，
 * 绝不向调用方返回 NaN。
 */

export interface LngLat {
  /** 经度（度） */
  lng: number;
  /** 纬度（度） */
  lat: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 舆图覆盖的经纬度范围（约为中原至西域） */
export const MAP_BOUNDS = {
  minLng: 73,
  maxLng: 134,
  minLat: 18,
  maxLat: 48,
};

/** 地图平面的设计尺寸（像素逻辑单位，宽高比与经纬度跨度一致） */
export const MAP_SIZE = {
  width: 1220,
  height: 600,
};

/** 判断一个值是否为可用的有限数 */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 判断坐标对象是否合法（后端未配坐标时为 null） */
export function isValidLngLat(p: Partial<LngLat> | null | undefined): p is LngLat {
  if (!p) return false;
  const { lng, lat } = p as LngLat;
  return (
    isFiniteNumber(lng) &&
    isFiniteNumber(lat) &&
    lng >= -180 && lng <= 180 &&
    lat >= -90 && lat <= 90
  );
}

/**
 * 正投影：经纬度 -> 地图平面坐标。
 * 非法坐标（含 NaN/Infinity）一律返回 null，由渲染层决定跳过。
 */
export function project(lng: number, lat: number): Point | null {
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;

  const { minLng, maxLng, minLat, maxLat } = MAP_BOUNDS;
  const x = ((lng - minLng) / (maxLng - minLng)) * MAP_SIZE.width;
  const y = ((maxLat - lat) / (maxLat - minLat)) * MAP_SIZE.height;

  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return { x, y };
}

/**
 * 逆投影：地图平面坐标 -> 经纬度。
 * 投影的精确逆变换，供缩略图跳转、指针反查使用。非法输入返回 null。
 */
export function unproject(p: Point | null | undefined): LngLat | null {
  if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null;

  const { minLng, maxLng, minLat, maxLat } = MAP_BOUNDS;
  const lng = minLng + (p.x / MAP_SIZE.width) * (maxLng - minLng);
  const lat = maxLat - (p.y / MAP_SIZE.height) * (maxLat - minLat);

  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
  return { lng, lat };
}

/** 平面两点距离（像素） */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
