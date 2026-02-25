import React from 'react';
import { Play } from 'lucide-react';
import { Node } from 'reactflow';

interface BatchRunButtonProps {
  selectedNodes: Node[];
  position: { x: number; y: number };
  isDarkMode: boolean;
  onBatchRun: () => void;
  isRunning?: boolean; // 批量运行中：禁用按钮并显示绿色
  totalPrice?: number | null; // 批量任务总价（元）
}

const BatchRunButton: React.FC<BatchRunButtonProps> = ({
  selectedNodes,
  position,
  isDarkMode,
  onBatchRun,
  isRunning = false,
  totalPrice,
}) => {
  const count = selectedNodes.length;

  return (
    <div
      className="flex flex-col items-end gap-2"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-100%, 0)',
        position: 'absolute',
        pointerEvents: 'auto',
        zIndex: 1000,
        // 确保不影响 React Flow 的布局计算
        isolation: 'isolate',
      }}
    >
      {/* 预计总价（如果有） */}
      {totalPrice != null && totalPrice > 0 && !isRunning && (
        <div
          className={`px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg ${
            isDarkMode
              ? 'bg-amber-500/90 text-white'
              : 'bg-amber-100 text-amber-800'
          }`}
          title="根据当前各节点模型与参数估算"
        >
          ¥{totalPrice.toFixed(2)}
        </div>
      )}
      {/* 批量运行按钮：运行中为绿色且不可再次点击 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isRunning) return;
          onBatchRun();
        }}
        disabled={isRunning}
        className={`
          flex items-center gap-2 px-4 py-2 rounded-full shadow-lg transition-all
          animate-in fade-in zoom-in
          ${isRunning
            ? 'bg-emerald-600 text-white cursor-not-allowed opacity-95'
            : isDarkMode
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }
        `}
        title={isRunning ? '批量运行中…' : `批量运行 ${count} 个任务`}
      >
        <Play className="w-4 h-4" />
        <span className="text-sm font-medium">
          {isRunning ? '运行中…' : `运行 ${count} 个任务`}
        </span>
      </button>
    </div>
  );
};

export default BatchRunButton;
