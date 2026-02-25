import React from 'react';

export interface ModuleProgressBarProps {
  /** 进度 0-100；达到 100 时渐隐并触发 onFadeComplete（循环动画模式下不驱动宽度） */
  progress: number;
  /** 是否显示遮罩；为 false 或 progress>=100 时渐隐消失 */
  visible: boolean;
  /** 与模块外框一致的圆角（px），默认 16 对应 rounded-2xl */
  borderRadius?: number;
  /** 可选：完成或隐藏时的过渡时长（ms） */
  fadeDurationMs?: number;
  /** 可选：进度达到 100% 并渐隐结束后回调 */
  onFadeComplete?: () => void;
}

/**
 * 全模块覆盖进度条：纯 CSS 永动机式循环动画（0%→100% 匀速，瞬间重置）。
 * 仅当 generating 时挂载/显示；遮罩半透明，不依赖 JS 实时更新 width。
 */
export const ModuleProgressBar: React.FC<ModuleProgressBarProps> = ({
  progress,
  visible,
  borderRadius = 16,
  fadeDurationMs = 300,
  onFadeComplete,
}) => {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const isComplete = clampedProgress >= 100;
  const show = visible && !isComplete;
  const opacity = show ? 1 : 0;

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    if (e.propertyName === 'opacity' && !show && onFadeComplete) {
      onFadeComplete();
    }
  };

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: `${borderRadius}px`,
        overflow: 'hidden',
        opacity,
        transition: `opacity ${fadeDurationMs}ms ease-out`,
        zIndex: 50,
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      {/* 半透明遮罩，盖住底层内容 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.2)',
          borderRadius: `${borderRadius}px`,
        }}
      />
      {/* 进度条轨道：底部居中，宽度 80%，高度 8px */}
      <div
        style={{
          position: 'absolute',
          left: '10%',
          right: '10%',
          bottom: '24%',
          height: 8,
          borderRadius: 4,
          backgroundColor: 'rgba(255,255,255,0.1)',
          overflow: 'hidden',
        }}
      >
        {/* 填充层：使用 CSS 循环动画，匀速 0%→100% 无限循环，重置无过渡 */}
        <div className="module-progress-fill" />
      </div>
    </div>
  );
};
