import React, { useState, useCallback, useRef } from 'react';
import { MiniMap, useReactFlow } from 'reactflow';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CustomMiniMapProps {
  isDarkMode: boolean;
}

const CustomMiniMap: React.FC<CustomMiniMapProps> = ({ isDarkMode }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { setCenter, getViewport } = useReactFlow();
  const minimapRef = useRef<HTMLDivElement>(null);

  // 处理点击 minimap 来快速移动画布
  const handleMiniMapClick = useCallback((e: React.MouseEvent) => {
    const minimapElement = minimapRef.current?.querySelector('.react-flow__minimap') as HTMLElement;
    if (!minimapElement) return;

    // 如果点击的是 mask（当前视口指示器），不处理
    if ((e.target as HTMLElement).closest('.react-flow__minimap-mask')) {
      return;
    }

    const rect = minimapElement.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // 计算在 minimap 中的相对位置（0-1）
    const relativeX = Math.max(0, Math.min(1, clickX / rect.width));
    const relativeY = Math.max(0, Math.min(1, clickY / rect.height));
    
    // 获取当前视口
    const viewport = getViewport();
    
    // 计算画布范围（使用较大的固定范围，实际应该根据节点范围计算）
    const canvasRange = 10000; // 假设画布范围是 -5000 到 5000
    
    // 将 minimap 中的相对位置转换为画布坐标
    const targetX = (relativeX - 0.5) * canvasRange;
    const targetY = (relativeY - 0.5) * canvasRange;
    
    // 移动到目标位置
    setCenter(targetX, targetY, { zoom: viewport.zoom });
  }, [setCenter, getViewport]);

  return (
    <div
      ref={minimapRef}
      className={`fixed bottom-4 right-4 z-50 transition-all duration-300 ${
        isCollapsed ? 'h-8' : 'h-[200px]'
      }`}
      style={{ width: isCollapsed ? '120px' : '200px' }}
    >
      {/* 收起/展开按钮 */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={`absolute -top-8 right-0 px-2 py-1 rounded-t-lg flex items-center gap-1 text-xs ${
          isDarkMode ? 'apple-panel text-white/80' : 'apple-panel-light text-gray-700'
        } hover:opacity-80 transition-opacity`}
      >
        {isCollapsed ? (
          <>
            <ChevronUp className="w-3 h-3" />
            <span>展开</span>
          </>
        ) : (
          <>
            <ChevronDown className="w-3 h-3" />
            <span>收起</span>
          </>
        )}
      </button>

      {/* MiniMap */}
      {!isCollapsed && (
        <div
          onClick={handleMiniMapClick}
          className={`${isDarkMode ? 'apple-panel' : 'apple-panel-light'} rounded-lg overflow-hidden cursor-pointer`}
        >
          <MiniMap
            nodeColor="#fff"
            maskColor="rgba(0, 0, 0, 0.5)"
            className="!bg-transparent"
          />
        </div>
      )}
    </div>
  );
};

export default CustomMiniMap;
