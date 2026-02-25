import React from 'react';

interface ProgressBarProps {
  taskType?: 'llm' | 'image' | 'video' | 'character';
  progress?: number; // 0-100，可选；不传或 indeterminate 时显示循环动画
  message?: string;
  isDarkMode?: boolean;
  className?: string;
  /** 循环动画（运行中）：深色轨道 + 绿色滑动块，不显示百分比 */
  indeterminate?: boolean;
  externalProgress?: number;
  simulatedTime?: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  taskType = 'llm',
  progress = 0,
  message,
  isDarkMode = true,
  className = '',
  indeterminate = true,
  externalProgress,
  simulatedTime = 10,
}) => {
  const displayProgress = externalProgress !== undefined ? externalProgress : progress;
  const clampedProgress = Math.max(0, Math.min(100, displayProgress));
  const showIndeterminate = indeterminate;

  return (
    <div className={`flex flex-col gap-2 w-full ${className}`}>
      {message && (
        <p className={`text-xs text-center ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
          {message}
        </p>
      )}
      {/* 轨道：深色背景，右侧圆角 */}
      <div
        className={`w-full overflow-hidden rounded-r-full ${
          isDarkMode ? 'bg-[#1A1A1A]' : 'bg-gray-300'
        }`}
        style={{ height: 10 }}
      >
        {showIndeterminate ? (
          /* 循环动画：绿色块滑动，右侧与轨道圆角一致 */
          <div
            className="h-full w-[30%] min-w-[80px] rounded-r-full bg-[#2ECC40] progress-bar-indeterminate"
            style={{ willChange: 'transform' }}
          />
        ) : (
          <div
            className={`h-full rounded-r-full transition-all duration-300 ${
              isDarkMode ? 'bg-[#2ECC40]' : 'bg-green-500'
            }`}
            style={{ width: `${Math.max(2, clampedProgress)}%` }}
          />
        )}
      </div>
    </div>
  );
};
