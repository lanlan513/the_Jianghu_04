/**
 * 舆图纯函数测试：node --test + tsx 运行。
 * 覆盖：投影/逆投影、NaN 防御、锚点缩放、缩放上下限、平移钳制、
 *       惯性衰减、URL 非法参数、坐标缺失、无关联名剑、剑脉归属。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, isValidLngLat, MAP_BOUNDS, MAP_SIZE } from '../src/atlas/geo.ts';
import {
  MIN_SCALE, MAX_SCALE, clampScale, clampView, clampCenter,
  zoomAtPoint, zoomAtCenter, panBy, stepInertia, interpolateView,
  getDefaultView, getLod, LABEL_SCALE, SWORD_LABEL_SCALE,
} from '../src/atlas/viewport.ts';
import { parseUrlState, serializeState } from '../src/atlas/url-state.ts';
import { buildAtlasModel, matchSect, swordAngle } from '../src/atlas/layout.ts';
import type { Sect, Sword } from '../src/types/index.ts';

const SIZE = { width: 1220, height: 600 };

// ---------- geo ----------
test('project/unproject 互为逆变换', () => {
  const cases: Array<[number, number]> = [[116.4, 39.9], [80, 47], [134, 18], [103, 32]];
  for (const [lng, lat] of cases) {
    const p = project(lng, lat)!;
    assert.ok(p);
    const back = unproject(p)!;
    assert.ok(Math.abs(back.lng - lng) < 1e-9);
    assert.ok(Math.abs(back.lat - lat) < 1e-9);
  }
});

test('投影四角落在地图矩形四角', () => {
  const nw = project(MAP_BOUNDS.minLng, MAP_BOUNDS.maxLat)!;
  assert.deepEqual(nw, { x: 0, y: 0 });
  const se = project(MAP_BOUNDS.maxLng, MAP_BOUNDS.minLat)!;
  assert.deepEqual(se, { x: MAP_SIZE.width, y: MAP_SIZE.height });
});

test('非法坐标不产生 NaN，返回 null', () => {
  assert.equal(project(NaN, 30), null);
  assert.equal(project(116, Infinity), null);
  assert.equal(project(999, 0), null);
  assert.equal(unproject({ x: NaN, y: 0 }), null);
  assert.equal(unproject(null), null);
  assert.equal(isValidLngLat(null), false);
  assert.equal(isValidLngLat({ lng: 200, lat: 0 }), false);
});

// ---------- viewport ----------
test('缩放在上下限处被钳制', () => {
  assert.equal(clampScale(0.01), MIN_SCALE);
  assert.equal(clampScale(999), MAX_SCALE);
  assert.equal(clampScale(NaN), MIN_SCALE);
});

test('锚点缩放：鼠标处地图点缩放前后保持不动', () => {
  const view = getDefaultView(SIZE);
  const anchor = { x: 400, y: 250 };
  const mapBefore = {
    x: (anchor.x - SIZE.width / 2) / view.scale + view.center.x,
    y: (anchor.y - SIZE.height / 2) / view.scale + view.center.y,
  };
  const zoomed = zoomAtPoint(view, anchor, 2.5, SIZE);
  const mapAfter = {
    x: (anchor.x - SIZE.width / 2) / zoomed.scale + zoomed.center.x,
    y: (anchor.y - SIZE.height / 2) / zoomed.scale + zoomed.center.y,
  };
  assert.ok(Math.abs(mapAfter.x - mapBefore.x) < 1e-9);
  assert.ok(Math.abs(mapAfter.y - mapBefore.y) < 1e-9);
});

test('触到缩放上限时锚点不再漂移、倍数不再增加', () => {
  const view = { scale: MAX_SCALE, center: { x: 500, y: 300 } };
  const out = zoomAtPoint(view, { x: 300, y: 300 }, 4, SIZE);
  assert.equal(out.scale, MAX_SCALE);
  assert.deepEqual(out.center, view.center);
});

test('以视口中心缩放等价于以屏幕中心为锚', () => {
  const view = getDefaultView(SIZE);
  const a = zoomAtCenter(view, 2, SIZE);
  const b = zoomAtPoint(view, { x: SIZE.width / 2, y: SIZE.height / 2 }, 2, SIZE);
  assert.ok(Math.abs(a.center.x - b.center.x) < 1e-9);
  assert.ok(Math.abs(a.center.y - b.center.y) < 1e-9);
  assert.equal(a.scale, b.scale);
});

test('平移后中心被限制在半屏范围内', () => {
  const view = { scale: MIN_SCALE, center: { x: 3050, y: 1500 } };
  const panned = panBy(view, { x: -100000, y: 0 }, SIZE);
  const halfW = SIZE.width / 2 / MIN_SCALE;
  assert.ok(panned.center.x >= -halfW - 1e-6);
  assert.ok(panned.center.x <= MAP_SIZE.width + halfW + 1e-6);
});

test('clampCenter 对 NaN 输入安全兜底', () => {
  const c = clampCenter({ x: NaN, y: NaN }, 1, SIZE);
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
});

test('惯性逐帧衰减并最终停止', () => {
  let v = { x: 30, y: 0 };
  let frames = 0;
  for (;;) {
    const s = stepInertia(v);
    v = s.velocity;
    frames++;
    if (s.stopped) break;
    assert.ok(frames < 300, '惯性必须在有限帧内停止');
  }
  assert.deepEqual(v, { x: 0, y: 0 });
});

test('惯性速度被限幅，不会无限甩动', () => {
  const s = stepInertia({ x: 1_000_000, y: -1_000_000 });
  assert.ok(Math.abs(s.velocity.x) <= 200);
  assert.ok(Math.abs(s.velocity.y) <= 200);
});

test('飞行补间端点正确且单调', () => {
  const from = { scale: 1, center: { x: 0, y: 0 } };
  const to = { scale: 4, center: { x: 400, y: 200 } };
  assert.deepEqual(interpolateView(from, to, 0).scale, 1);
  assert.ok(Math.abs(interpolateView(from, to, 1).scale - 4) < 1e-9);
  const mid = interpolateView(from, to, 0.5);
  assert.ok(mid.scale > 1 && mid.scale < 4);
});

test('LOD 分级：低倍仅徽记，中倍加标签，高倍出剑名', () => {
  assert.equal(getLod(1), 0);
  assert.equal(getLod(LABEL_SCALE), 1);
  assert.equal(getLod((LABEL_SCALE + SWORD_LABEL_SCALE) / 2), 1);
  assert.equal(getLod(SWORD_LABEL_SCALE), 2);
});

// ---------- url-state ----------
test('合法 URL 解析出视口与选中态', () => {
  const s = parseUrlState('?x=112.5&y=30.2&z=4&sect=3&sword=15');
  assert.ok(s.view);
  assert.ok(Math.abs(s.view!.scale - 4) < 1e-9);
  assert.equal(s.sectId, '3');
  assert.equal(s.swordId, '15');
});

test('非法 URL 参数全部丢弃回退 null', () => {
  assert.equal(parseUrlState('?x=abc&y=30&z=2').view, null);
  assert.equal(parseUrlState('?z=999').view, null);
  assert.equal(parseUrlState('?z=Infinity').view, null);
  assert.equal(parseUrlState('?z=0.5').view, null);
  assert.equal(parseUrlState('?sect=../evil').sectId, null);
  assert.equal(parseUrlState('?x=110&y=30').view, null); // 缺 z
});

test('序列化 -> 解析往返一致', () => {
  const view = clampView({ scale: 3.5, center: { x: 2400, y: 1200 } }, SIZE);
  const qs = serializeState({ view, sectId: '7', swordId: null });
  const back = parseUrlState(qs);
  assert.ok(back.view);
  assert.ok(Math.abs(back.view!.scale - view.scale) < 2e-3);
  assert.equal(back.sectId, '7');
  assert.equal(back.swordId, null);
});

// ---------- layout ----------
const mkSect = (id: string, name: string, pop: number, notable: string[] = []): Sect => ({
  id, name, location: '测试', foundingDynasty: '唐', description: '',
  emblemUrl: '', skills: [], notableSwords: notable, popularity: pop,
});
const mkSword = (id: string, name: string, sect: string): Sword => ({
  id, name, alias: '', dynasty: '唐', owner: '', sect, description: '',
  history: '', legend: '', imageUrl: '',
  attributes: { sharpness: 1, hardness: 1, flexibility: 1, craftsmanship: 1 },
  popularity: 1, createdAt: '',
});

test('matchSect 精确与长短名兼容', () => {
  assert.equal(matchSect(mkSword('1', '真武剑', '武当派'), mkSect('1', '武当派', 1)), true);
  assert.equal(matchSect(mkSword('2', '青釭', '蜀汉'), mkSect('2', '少林派', 1)), false);
});

test('坐标缺失门派进入 missing，且不产生据点 NaN', () => {
  const sects = [mkSect('1', '甲派', 100), mkSect('2', '乙派', 100)];
  const model = buildAtlasModel(sects, [], { '1': { lng: 110, lat: 30 } });
  assert.equal(model.nodes.length, 2);
  assert.equal(model.missing.length, 1);
  assert.equal(model.missing[0].id, '2');
  assert.equal(model.byId.get('2')!.located, false);
  assert.equal(model.byId.get('2')!.point, null);
  assert.ok(model.byId.get('1')!.point);
});

test('无关联名剑的门派剑脉为空，不报错', () => {
  const model = buildAtlasModel([mkSect('1', '甲派', 100)], [], { '1': { lng: 110, lat: 30 } });
  assert.deepEqual(model.byId.get('1')!.swords, []);
});

test('notableSwords 提名可补回名剑；查无此剑时列入 missingSwordNames', () => {
  const sects = [mkSect('1', '甲派', 100, ['存在剑', '失传剑'])];
  const swords = [mkSword('9', '存在剑', '毫不相干的门派名')];
  const model = buildAtlasModel(sects, swords, { '1': { lng: 110, lat: 30 } });
  const node = model.byId.get('1')!;
  assert.equal(node.swords.length, 1);
  assert.equal(node.swords[0].sword.name, '存在剑');
  assert.deepEqual(node.missingSwordNames, ['失传剑']);
});

test('名剑节点投影有效且环绕门派一周', () => {
  const sects = [mkSect('1', '甲派', 100, ['剑一', '剑二', '剑三', '剑四'])];
  const swords = [1, 2, 3, 4].map((i) => mkSword(String(i), `剑${['一', '二', '三', '四'][i - 1]}`, '甲派'));
  const model = buildAtlasModel(sects, swords, { '1': { lng: 110, lat: 30 } });
  const node = model.byId.get('1')!;
  assert.equal(node.swords.length, 4);
  for (const sn of node.swords) assert.ok(sn.point && Number.isFinite(sn.point.x));
  assert.ok(Math.abs(swordAngle(0, 4) - -Math.PI / 2) < 1e-9);
});

test('据点半径与线宽随人气单调变化', () => {
  const sects = [mkSect('1', '冷门', 100), mkSect('2', '热门', 9000)];
  const model = buildAtlasModel(sects, [], {
    '1': { lng: 110, lat: 30 }, '2': { lng: 111, lat: 31 },
  });
  const cold = model.byId.get('1')!;
  const hot = model.byId.get('2')!;
  assert.ok(hot.radius > cold.radius);
  assert.ok(hot.veinWidth > cold.veinWidth);
});
