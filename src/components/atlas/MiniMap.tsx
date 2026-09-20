import { useMemo, useRef, type RefObject } from 'react';
import { MAP_SIZE } from '@/atlas/geo';
import type { Point } from '@/atlas/geo';
import { BORDER_PATH, YANGTZE_PATH, YELLOW_PATH } from '@/atlas/decor';
import type { AtlasModel, SectNode } from '@/atlas/layout';

interface Props {
  model: AtlasModel;
  /** 主画布中代表当前视口的 rect，其 x/y/width/height 由父级 rAF 直写（无 setState） */
  viewRectRef: RefObject<SVGRectElement | null>;
  selectedNode: SectNode | null;
  onJump: (mapPoint: Point) => void;
}

const MINI_W = 168;
const MINI_H = MINI_W * (MAP_SIZE.height / MAP_SIZE.width);
const SX = MINI_W / MAP_SIZE.width;

/**
 * 缩略图：独立的小 SVG，按相同投影把全部据点画成小点，
 * 视口矩形的 x/y/width/height 由父级 rAF 直写（无 setState）。
 * 点击任意位置 -> 跳转（飞行补间）。
 */
export default function MiniMap({ model, viewRectRef, selectedNode, onJump }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  const dots = useMemo(
    () =>
      model.nodes
        .filter((n) => n.point)
        .map((n) => ({
          id: n.sect.id,
          x: (n.point as Point).x * SX,
          y: (n.point as Point).y * SX,
          hot: n.swords.length > 0,
        })),
    [model],
  );

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * MAP_SIZE.width;
    const y = ((e.clientY - rect.top) / rect.height) * MAP_SIZE.height;
    onJump({ x, y });
  };

  return (
    <div className="atlas-minimap">
      <div className="atlas-minimap-title">舆图缩略</div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MINI_W} ${MINI_H}`}
        width={MINI_W}
        height={MINI_H}
        onClick={handleClick}
        role="button"
        aria-label="缩略图，点击跳转视角"
      >
        <rect x={0} y={0} width={MINI_W} height={MINI_H} className="atlas-minimap-bg" />
        <g transform={`scale(${SX})`}>
          <path d={BORDER_PATH} className="atlas-minimap-border" />
          <path d={YANGTZE_PATH} className="atlas-minimap-river" />
          <path d={YELLOW_PATH} className="atlas-minimap-river" />
        </g>
        {dots.map((d) => (
          <circle
            key={d.id}
            cx={d.x}
            cy={d.y}
            r={d.id === selectedNode?.sect.id ? 2.6 : 1.6}
            className={d.id === selectedNode?.sect.id ? 'atlas-minimap-dot is-selected' : 'atlas-minimap-dot'}
          />
        ))}
        {/* 当前视口：map 空间属性由父级每帧直写，再缩放到缩略图坐标系 */}
        <g transform={`scale(${SX})`}>
          <rect ref={viewRectRef} className="atlas-minimap-view" />
        </g>
      </svg>
    </div>
  );
}
