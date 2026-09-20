/**
 * 舆图布局：把后端「门派 + 名剑」组装成渲染模型的纯函数层。
 *
 * 负责：
 *  - 坐标缺失门派的隔离（归入 missing，不上舆图）
 *  - 名剑与门派的归属匹配（精确名 + 名称包含 + notableSwords 提名三路兜底）
 *  - 剑脉上名剑的环绕定位（地理坐标级偏移）
 *  - 据点半径与剑脉线宽随人气归一化
 */

import type { Sect, Sword } from '@/types';
import type { LngLat, Point } from './geo';
import { MAP_BOUNDS, MAP_SIZE, project, isValidLngLat } from './geo';

export interface SwordNode {
  sword: Sword;
  /** 归属门派（必然存在） */
  sectId: string;
  /** 名剑节点的地理坐标 */
  lngLat: LngLat;
  /** 名剑节点的地图像素坐标；投影失败为 null（渲染层跳过） */
  point: Point | null;
}

export interface SectNode {
  sect: Sect;
  /** 是否有可用坐标（false = 踪迹不明，不上舆图据点，但侧栏仍可查看） */
  located: boolean;
  /** 无坐标时为 null */
  lngLat: LngLat | null;
  /** 门派据点的地图像素坐标；投影失败为 null（渲染层跳过） */
  point: Point | null;
  /** 六角据点半径（屏幕像素，随人气） */
  radius: number;
  /** 剑脉线宽（屏幕像素，随人气） */
  veinWidth: number;
  /** 剑脉上的名剑节点（无关联名剑时为空数组） */
  swords: SwordNode[];
  /** notableSwords 里有提名、但后端找不到对应剑数据的名字 */
  missingSwordNames: string[];
}

export interface AtlasModel {
  /** 全部门派（含坐标缺失者，located=false） */
  nodes: SectNode[];
  /** 坐标缺失/非法门派的便捷子集（用于「踪迹不明」） */
  missing: Sect[];
  /** id -> 节点索引，侧栏与选中态共用 */
  byId: Map<string, SectNode>;
}

/** 名剑归属门派的判定（纯函数，便于单测） */
export function matchSect(sword: Sword, sect: Sect): boolean {
  if (!sword.sect || !sect.name) return false;
  if (sword.sect === sect.name) return true;
  // 兼容「武当」↔「武当派」这类长短名
  if (sword.sect.length >= 2 && sect.name.includes(sword.sect)) return true;
  if (sect.name.length >= 2 && sword.sect.includes(sect.name)) return true;
  return false;
}

/** 名剑节点环绕门派的半径（地图像素） */
const SWORD_ORBIT = 76;

/** 第 i / n 把名剑的环绕角（弧度，正上方起均布），纯函数便于单测 */
export function swordAngle(i: number, n: number): number {
  if (n <= 1) return -Math.PI / 2;
  return -Math.PI / 2 + (i * 2 * Math.PI) / n;
}

function t(min: number, max: number, value: number): number {
  if (max === min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/**
 * 组装舆图模型（核心纯函数）。
 * @param sects  后端门派列表
 * @param swords 后端名剑列表
 * @param coords 前端补充的门派坐标表（id -> 经纬度）
 */
export function buildAtlasModel(
  sects: Sect[],
  swords: Sword[],
  coords: Record<string, LngLat>,
): AtlasModel {
  const locatedCoords = sects
    .map((sect) => ({ sect, c: coords[sect.id] }))
    .filter((x): x is { sect: Sect; c: LngLat } => isValidLngLat(x.c));

  const pops = locatedCoords.map((l) => l.sect.popularity || 0);
  const minPop = pops.length ? Math.min(...pops) : 0;
  const maxPop = pops.length ? Math.max(...pops) : 1;

  const nodes: SectNode[] = sects.map((sect) => {
    const c = coords[sect.id];
    const located = isValidLngLat(c);
    const lngLat: LngLat | null = located ? c : null;
    const k = t(minPop, maxPop, sect.popularity || 0);
    const radius = 18 + k * 18; // 18 ~ 36
    const veinWidth = 1.4 + k * 3.2; // 1.4 ~ 4.6

    // 归属名剑：先精确/包含匹配，再用 notableSwords 提名补漏
    const owned = swords.filter((s) => matchSect(s, sect));
    const ownedNames = new Set(owned.map((s) => s.name));
    const nominated: Sword[] = [];
    const missingSwordNames: string[] = [];
    for (const name of sect.notableSwords ?? []) {
      if (ownedNames.has(name)) continue;
      const hit = swords.find((s) => s.name === name);
      if (hit) {
        nominated.push(hit);
        ownedNames.add(name);
      } else {
        missingSwordNames.push(name);
      }
    }
    const all = [...owned, ...nominated];

    const swordNodes: SwordNode[] = all.map((sword, i) => {
      const angle = swordAngle(i, Math.max(1, all.length));
      const dx = Math.cos(angle) * SWORD_ORBIT;
      const dy = Math.sin(angle) * SWORD_ORBIT;
      const sLngLat: LngLat = lngLat
        ? {
            lng: lngLat.lng + (dx / MAP_SIZE.width) * (MAP_BOUNDS.maxLng - MAP_BOUNDS.minLng),
            lat: lngLat.lat - (dy / MAP_SIZE.height) * (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat),
          }
        : { lng: NaN, lat: NaN };
      return { sword, sectId: sect.id, lngLat: sLngLat, point: project(sLngLat.lng, sLngLat.lat) };
    });

    return {
      sect,
      located,
      lngLat,
      point: lngLat ? project(lngLat.lng, lngLat.lat) : null,
      radius,
      veinWidth,
      swords: swordNodes,
      missingSwordNames,
    };
  });

  const missingNodes = nodes.filter((n) => !n.located).map((n) => n.sect);
  const byId = new Map(nodes.map((n) => [n.sect.id, n]));
  return { nodes, missing: missingNodes, byId };
}
