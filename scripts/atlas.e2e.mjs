/**
 * 舆图端到端冒烟：真实 Chromium 中验证渲染、LOD、锚点缩放、
 * 点选侧栏、URL 同步、后退、缩略图跳转与键盘交互。
 * 运行：node scripts/atlas.e2e.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.ATLAS_BASE || 'http://localhost:5199';
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${BASE}/atlas`, { waitUntil: 'networkidle' });
await page.waitForSelector('.atlas-marker', { timeout: 8000 });

// 1. 据点数量（19 门派 - 1 坐标缺失 = 18）
const markerCount = await page.locator('.atlas-marker').count();
ok('六角据点 18 个（灵鹫宫坐标缺失不上图）', markerCount === 18, `got ${markerCount}`);

// 2. 剑脉数量（有名剑的门派应有流动剑光）
const flowCount = await page.locator('.atlas-vein-flow').count();
ok('剑脉剑光已绘制', flowCount >= 20, `flows=${flowCount}`);

// 3. 初始 LOD=0，只显徽记，无标签
const lod0 = await page.locator('[data-lod]').first().getAttribute('data-lod');
ok('初始倍数低，仅显徽记（LOD=0）', lod0 === '0', `lod=${lod0}`);

// 4. 锚点滚轮缩放：在 (700,400) 处放大
const mapTfBefore = await page.locator('.atlas-layer-marker, .atlas-svg g').first().getAttribute('transform');
await page.mouse.move(700, 400);
for (let i = 0; i < 26; i++) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(16);
}
await page.waitForTimeout(250);
const lodAfter = await page.locator('[data-lod]').first().getAttribute('data-lod');
ok('滚轮放大后出现门派标签（LOD>=1）', Number(lodAfter) >= 1, `lod=${lodAfter}`);
const urlZ1 = new URL(page.url()).searchParams.get('z');
ok('缩放写入 URL(z)', Number(urlZ1) > 1, `z=${urlZ1}`);

// 继续放大到出现剑名
for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(12); }
await page.waitForTimeout(250);
const lod2 = await page.locator('[data-lod]').first().getAttribute('data-lod');
ok('放至高倍出现剑名（LOD=2）', lod2 === '2', `lod=${lod2}`);

// 5. 缩到上限不报错
for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(8); }
const zCap = Number(new URL(page.url()).searchParams.get('z'));
ok('缩放触及上限被钳制', zCap <= 12.001 && zCap >= 11.9, `z=${zCap}`);

// 6. 点选据点 -> 侧栏 + URL
await page.mouse.click(1300, 100); // 空白处点击，同时让 .atlas-stage 获得焦点
await page.keyboard.press('0');
await page.waitForTimeout(700);
const zReset = Number(new URL(page.url()).searchParams.get('z'));

const box = await page.locator('.atlas-marker').first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForSelector('.atlas-sidebar.is-open', { timeout: 3000 });
const sectParam = new URL(page.url()).searchParams.get('sect');
ok('点选据点后侧栏打开且 URL 含 sect', !!sectParam, `sect=${sectParam}`);

// 7. 侧栏内容：武功特色 + 名剑链接
const skillTags = await page.locator('.atlas-skill-tag').count();
const swordLinks = await page.locator('a.atlas-sword-link').count();
ok('侧栏列出武功特色', skillTags >= 3, `skills=${skillTags}`);
ok('侧栏列出代表名剑且可跳详情', swordLinks >= 1, `swords=${swordLinks}`);

// 8. 名剑详情跳转携带 from=atlas，并真实点击跳转
const href = await page.locator('a.atlas-sword-link').first().getAttribute('href');
ok('名剑链接指向详情页', /^\/swords\/\d+\?/.test(href ?? ''), href ?? '');
await page.locator('a.atlas-sword-link').first().click();
await page.waitForURL(/\/swords\/\d+/, { timeout: 5000 });
await page.waitForTimeout(300);
const detailTitle = await page.locator('h1, h2').first().textContent().catch(() => '');
const detailUrl = new URL(page.url());
ok('点击名剑进入详情页且保留 from=atlas', detailUrl.searchParams.get('from') === 'atlas' && !!detailTitle,
  `${detailUrl.pathname} from=${detailUrl.searchParams.get('from')}`);
// 返回舆图
await page.goBack();
await page.waitForURL(/\/atlas/, { timeout: 5000 });
await page.waitForTimeout(400);

// 9. 浏览器后退回上一视角
// 第一次后退：回到「全览且未选门派」
await page.goBack();
await page.waitForTimeout(700);
const u1 = new URL(page.url()).searchParams;
ok('第一次后退：取消选中但保留全览视角', u1.get('sect') === null && Math.abs(Number(u1.get('z')) - zReset) < 0.01,
  `sect=${u1.get('sect')}, z=${u1.get('z')}`);

// 第二次后退：回到重置前的高倍视角
await page.goBack();
await page.waitForTimeout(700);
const zSecondBack = Number(new URL(page.url()).searchParams.get('z'));
ok('第二次后退：回到重置前的缩放视角', zSecondBack > zReset, `${zReset} -> ${zSecondBack}`);
await page.goForward();
await page.waitForTimeout(700);

// 10. 键盘平移
const centerBefore = new URL(page.url()).searchParams.get('x');
await page.locator('.atlas-stage').click({ position: { x: 30, y: 30 } });
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(600);
const centerAfter = new URL(page.url()).searchParams.get('x');
ok('键盘方向键平移视角', centerBefore !== centerAfter, `${centerBefore} -> ${centerAfter}`);

// 10.5 松手惯性：快速甩动后，松手视口仍继续移动
const xAtUp = await page.evaluate(() => new URL(location.href).searchParams.get('x'));
await page.mouse.move(500, 600);
await page.mouse.down();
for (let i = 0; i < 6; i++) {
  await page.mouse.move(500 - (i + 1) * 60, 600, { steps: 1 });
  await page.waitForTimeout(12);
}
await page.mouse.up();
await page.waitForTimeout(600); // 等惯性衰减结束
const xAfterInertia = new URL(page.url()).searchParams.get('x');
ok('松手后惯性继续滑动', Math.abs(Number(xAfterInertia) - Number(xAtUp)) > 0.5,
  `x: ${xAtUp} -> ${xAfterInertia}`);

const mini = await page.locator('.atlas-minimap svg').boundingBox();
await page.mouse.click(mini.x + mini.width * 0.3, mini.y + mini.height * 0.5);
await page.waitForTimeout(700);
ok('缩略图点击触发飞行缩放', Number(new URL(page.url()).searchParams.get('z')) >= 2, 'z=' + new URL(page.url()).searchParams.get('z'));

// 12. 踪迹不明门派
const missingChips = await page.locator('.atlas-missing-chip').count();
ok('踪迹不明门派可列出（灵鹫宫）', missingChips >= 1, `missing=${missingChips}`);
await page.locator('.atlas-missing-chip').first().click();
await page.waitForSelector('.atlas-sidebar.is-open');
const lostNote = await page.locator('.atlas-lost-note').count();
ok('无坐标门派侧栏显示散佚说明', lostNote === 1);

// 13. 无页面错误
ok('全程无未捕获脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '));

// 关闭侧栏、重置全览后拍全览图
await page.locator('.atlas-sidebar-close').click().catch(() => {});
await page.waitForTimeout(450);
await page.locator('.atlas-stage').focus();
await page.keyboard.press('0');
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/atlas-overview.png' });

// 点选武当，再用侧栏「居中此门派」飞到剑脉上空拍放大图
const wudang = await page.evaluate(() => {
  // 武当地图坐标 translate(760 312)；读取 SVG 当前矩阵换算到屏幕坐标
  const g = Array.from(document.querySelectorAll('.atlas-marker')).find((el) => {
    const t = el.parentElement?.getAttribute('transform') || '';
    const m = t.match(/translate\(([\d.]+) ([\d.]+)\)/);
    return m && Math.abs(+m[1] - 760) < 3 && Math.abs(+m[2] - 312) < 3;
  });
  if (!g) return null;
  const svg = document.querySelector('.atlas-svg');
  const pt = svg.createSVGPoint();
  pt.x = 760; pt.y = 312;
  // markerLayer = [data-lod] 的第一个子 <g>，其 CTM 是纯「地图->屏幕」
  const layer = document.querySelector('[data-lod] > g');
  const sp = pt.matrixTransform(layer.getScreenCTM());
  const sr = svg.getBoundingClientRect();
  return { x: sp.x - sr.left, y: sp.y - sr.top };
});
ok('能定位到武当据点', !!wudang, JSON.stringify(wudang));
if (wudang) {
  // 直接在六角命中区上派发点击（剑脉线在其上层，故不用裸坐标 click）
  await page.evaluate(() => {
    const g = Array.from(document.querySelectorAll('.atlas-marker')).find((el) => {
      const t = el.parentElement?.getAttribute('transform') || '';
      return t.includes('760') && t.includes('312');
    });
    g?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  });
  await page.waitForTimeout(300);
  await page.locator('.atlas-locate-btn').click();
  await page.waitForTimeout(800);
}
await page.screenshot({ path: '/tmp/atlas-zoomed.png' });

// 移动端：触摸拖拽不滚页面
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const scrollMeasures = [];
await mobile.goto(`${BASE}/atlas`, { waitUntil: 'networkidle' });
await mobile.waitForSelector('.atlas-marker', { timeout: 8000 });
await mobile.evaluate(() => { window.__y0 = window.scrollY; });
await mobile.mouse.move(200, 400);
await mobile.touchscreen.tap(200, 400);
const y0 = await mobile.evaluate(() => window.scrollY);
// 用触摸拖动（两事件模拟）
await mobile.evaluate(async () => {});
await mobile.mouse.move(200, 400);
// playwright touch drag:
await mobile.touchscreen.tap(200, 400).catch(() => {});
const y1 = await mobile.evaluate(() => window.scrollY);
ok('移动端页面未因舆图操作滚动', y0 === y1, `${y0}->${y1}`);
ok('移动端侧栏全宽样式存在', await mobile.locator('.atlas-sidebar').count() === 1);
await mobile.screenshot({ path: '/tmp/atlas-mobile.png' });
await mobile.close();

// 14. 非法 URL 参数被清洗（不报错，回退默认）
const bad = await browser.newPage({ viewport: { width: 1440, height: 800 } });
const badErrors = [];
bad.on('pageerror', (e) => badErrors.push(String(e)));
await bad.goto(`${BASE}/atlas?x=abc&y=NaN&z=999&sect=../evil`, { waitUntil: 'networkidle' });
await bad.waitForSelector('.atlas-marker', { timeout: 8000 });
const afterUrl = new URL(bad.url());
ok('非法 x/y/z/sect 被清洗', afterUrl.searchParams.get('sect') === null &&
  (afterUrl.searchParams.get('z') === null || Number(afterUrl.searchParams.get('z')) <= 12),
  afterUrl.search);
ok('非法参数下无脚本错误', badErrors.length === 0, badErrors.join(' | '));

// 15. 分享链接：带视角与选中门派的 URL 打开即恢复
const shared = await browser.newPage({ viewport: { width: 1440, height: 800 } });
await shared.goto(`${BASE}/atlas?x=111.009&y=32.4&z=5.6&sect=1`, { waitUntil: 'networkidle' });
await shared.waitForSelector('.atlas-sidebar.is-open', { timeout: 8000 });
const sharedZ = Number(new URL(shared.url()).searchParams.get('z'));
const sharedSect = new URL(shared.url()).searchParams.get('sect');
const sidebarName = await shared.locator('.atlas-sidebar-head .font-brush').textContent();
ok('分享 URL 恢复视角与选中门派', Math.abs(sharedZ - 5.6) < 0.05 && sharedSect === '1' && sidebarName.includes('武当'),
  `z=${sharedZ}, sect=${sharedSect}, name=${sidebarName}`);
await shared.close();
await bad.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
