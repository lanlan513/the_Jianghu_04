# 江湖名剑谱 · 水墨江湖

水墨风格的名剑收藏展示平台。门派与名剑数据由 Express 只读接口提供。

## 江湖舆图（`/atlas`）

把各门派驻地按地理位置绘于宣纸之上的可交互 SVG 舆图：

- **六角据点**：大小随门派人气变化；徽记悬停缓转；选中有涟漪扩散
- **剑脉**：名剑按所属门派与据点以金线相连，线宽随人气，剑光沿线流动
- **LOD**：低倍只显徽记，放大后出现门派标签，再放大出现剑名
- **呼吸感**：淡入并呼吸的水墨山峦、屏幕空间漂移的云气
- **交互**：鼠标锚点滚轮缩放、拖拽平移、松手惯性滑动；键盘 `+/-` 缩放、方向键平移、`0` 重置；右下角缩略图显示当前视口并可点击跳转
- **URL 即状态**：`?x=&y=&z=&sect=&sword=` 是视口与选中态的唯一来源，刷新/分享回到同一视角，浏览器后退回上一视角
- **纯函数内核**（`src/atlas/`）：`geo.ts` 投影与逆变换、`viewport.ts` 锚点缩放/钳制/惯性衰减、`url-state.ts` 参数编解码、`layout.ts` 渲染模型组装
- 全部用 SVG 原生事件与 `requestAnimationFrame` 实现，无任何地图/图形库；动画每帧直写 DOM transform，不触发 React state
- 边界处理：坐标缺失门派列入「踪迹不明」、投影 NaN 返回 null 跳过、缩放上下限钳制、无关联名剑空态、URL 非法参数清洗、移动端 `touch-action: none` 接管拖拽避免页面滚动

门派经纬度在 `src/atlas/sect-coords.ts` 前端补充配置。

## 开发

```bash
npm install
npm run dev          # 同时启动 Vite 与 API（:3002）

npm run check        # TypeScript 类型检查
npm run test:atlas   # 舆图纯函数单元测试（node --test）
npm run build        # 生产构建
npm run lint
```

---

## React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  extends: [
    // other configs...
    // Enable lint rules for React
    reactX.configs['recommended-typescript'],
    // Enable lint rules for React DOM
    reactDom.configs.recommended,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```
