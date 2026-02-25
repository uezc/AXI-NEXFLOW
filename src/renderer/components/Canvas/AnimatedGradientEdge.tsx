import React, { useMemo } from 'react';
import { BaseEdge, EdgeProps, getBezierPath } from 'reactflow';

/**
 * SVG 渐变流光连线：
 * - 主线：细线 + 流动高亮
 * - 光晕：粗线低透明度，提升“发光”质感
 */
export default function AnimatedGradientEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
    selected,
  } = props;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25,
  });

  const gradientId = useMemo(() => `edge-grad-${id}`, [id]);
  const glowGradientId = useMemo(() => `edge-glow-${id}`, [id]);

  const baseWidth = Number(style?.strokeWidth ?? 2);

  return (
    <>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor="rgba(160,160,160,0.35)" />
          <stop offset="35%" stopColor="rgba(255,255,255,0.95)">
            <animate attributeName="offset" values="-0.35;1.25" dur="2.2s" repeatCount="indefinite" />
          </stop>
          <stop offset="55%" stopColor="rgba(255,255,255,0.12)">
            <animate attributeName="offset" values="-0.15;1.45" dur="2.2s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="rgba(160,160,160,0.3)" />
        </linearGradient>
        <linearGradient id={glowGradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="42%" stopColor={selected ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.3)'}>
            <animate attributeName="offset" values="-0.25;1.35" dur="2.2s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      <BaseEdge
        id={`${id}-glow`}
        path={edgePath}
        style={{
          ...style,
          stroke: `url(#${glowGradientId})`,
          strokeWidth: selected ? baseWidth + 4 : baseWidth + 3,
          opacity: selected ? 0.9 : 0.7,
          filter: 'blur(2px)',
        }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: `url(#${gradientId})`,
          strokeWidth: selected ? baseWidth + 0.6 : baseWidth,
          opacity: 0.98,
        }}
      />
    </>
  );
}
