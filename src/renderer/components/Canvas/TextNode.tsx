import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useStore } from 'reactflow';

interface TextNodeProps {
  id: string;
  initialPos: { x: number; y: number };
  onLinkStart: (nodeId: string, startPos: { x: number; y: number }) => void;
  isSelected?: boolean;
  isDarkMode?: boolean;
  performanceMode?: boolean;
  data?: {
    text?: string;
    width?: number;
    height?: number;
  };
  onTextChange?: (id: string, text: string) => void;
  onSizeChange?: (id: string, size: { w: number; h: number }) => void;
}

export const TextNode: React.FC<TextNodeProps> = ({
  id,
  initialPos,
  onLinkStart,
  isSelected = false,
  isDarkMode = true,
  performanceMode = false,
  data = {},
  onTextChange,
  onSizeChange,
}) => {
  const [size, setSize] = useState({
    w: data.width || 280,
    h: data.height || 160,
  });
  const [text, setText] = useState(data.text || '');
  const nodeRef = useRef<HTMLDivElement>(null);
  const transform = useStore((s) => s.transform);

  // 同步外部数据变化
  useEffect(() => {
    if (data.width !== undefined) setSize((prev) => ({ ...prev, w: data.width! }));
    if (data.height !== undefined) setSize((prev) => ({ ...prev, h: data.height! }));
    if (data.text !== undefined) setText(data.text);
  }, [data.width, data.height, data.text]);

  // 处理文本变化
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    if (onTextChange) {
      onTextChange(id, newText);
    }
  };

  // 处理尺寸变化
  const handleSizeChange = (newSize: { w: number; h: number }) => {
    setSize(newSize);
    if (onSizeChange) {
      onSizeChange(id, newSize);
    }
  };

  // 处理链接锚点点击
  const handleAnchorMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发画布拖拽或框选
    if (nodeRef.current) {
      const rect = nodeRef.current.getBoundingClientRect();
      // 计算锚点在画布中心的位置 (右侧边缘中间)
      // React Flow 会管理位置，所以这里使用相对位置
      const startX = size.w;
      const startY = size.h / 2;
      onLinkStart(id, { x: startX, y: startY });
    }
  };

  const zoom = transform?.[2] ?? 1;
  const vx = transform?.[0] ?? 0;
  const vy = transform?.[1] ?? 0;
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || isSelected) return false;
    const xPos = initialPos?.x ?? 0;
    const yPos = initialPos?.y ?? 0;
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + size.w;
    const nodeBottom = yPos + size.h;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, isSelected, initialPos?.x, initialPos?.y, vx, vy, zoom, size.w, size.h]);

  return (
    <div
      ref={nodeRef}
      style={{
        width: size.w,
        height: size.h,
      }}
      className={`group flex flex-col shadow-2xl transition-all duration-300 select-none rounded-lg ${
        isDarkMode 
          ? 'apple-panel' 
          : 'apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
      }       ${
        isSelected
          ? 'ring-2 ring-green-400/80 border-green-400/70'
          : isDarkMode 
            ? 'border border-white/10 hover:border-apple-blue/50'
            : 'border border-gray-300/50 hover:border-apple-blue/50'
      }`}
    >
      {isHardFrozen ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>text（冻结）</span>
        </div>
      ) : (
      <>
      {/* 顶部标题栏 - 科技感装饰 */}
      <div className="h-6 bg-white/5 flex items-center px-2 justify-between border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-apple-blue rounded-full" />
          <span className="text-[10px] font-mono text-white/80 uppercase tracking-tighter">
            Text_Payload_{id.split('-')[1] || id.slice(-4)}
          </span>
        </div>
        <div className="flex gap-1">
          <div className="w-1 h-1 bg-white/40 rounded-full" />
          <div className="w-1 h-1 bg-white/40 rounded-full" />
        </div>
      </div>

      {/* 文本输入区 */}
      <textarea
        className="flex-grow bg-transparent text-white text-xs p-3 outline-none resize-none font-mono placeholder:text-white/40"
        placeholder="ENTER MISSION PROMPT..."
        value={text}
        onChange={handleTextChange}
        onFocus={(e) => e.stopPropagation()}
      />

      {/* 右侧输出节点 (绿色圆点) */}
      <div
        onMouseDown={handleAnchorMouseDown}
        className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center cursor-pointer group/anchor z-10"
      >
        <div className="w-2 h-2 bg-green-500 rounded-full border border-black group-hover/anchor:scale-150 group-hover/anchor:shadow-[0_0_10px_#22c55e] transition-all" />
      </div>

      {/* 右下角缩放手柄 */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startW = size.w;
          const startH = size.h;

          const onMouseMove = (moveEvent: MouseEvent) => {
            const newSize = {
              w: Math.max(200, startW + (moveEvent.clientX - startX)),
              h: Math.max(120, startH + (moveEvent.clientY - startY)),
            };
            handleSizeChange(newSize);
          };
          const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }}
      >
        <div className="w-2 h-2 border-r-2 border-b-2 border-white/40" />
      </div>

      {/* 底部装饰条 - 选中时显示 */}
      {isSelected && (
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-apple-blue/50 to-transparent" />
      )}
      </>
      )}
    </div>
  );
};
