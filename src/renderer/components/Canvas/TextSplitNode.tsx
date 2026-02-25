import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStore, useStoreApi } from 'reactflow';

const MAX_OUTPUTS = 20;
const CIRCLE_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];

export interface TextSplitNodeData {
  inputText?: string;
  separator?: string;
  trimAndFilterEmpty?: boolean;
  convertType?: 'string' | 'number' | 'boolean';
  segments?: (string | number | boolean)[];
  segmentCount?: number;
  width?: number;
  height?: number;
  title?: string;
  isUserResized?: boolean;
}

interface TextSplitNodeProps extends NodeProps<TextSplitNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
  onCleanupEdgesForHandles?: (nodeId: string, keepSourceHandles: string[]) => void;
}

function tryConvert(value: string, mode: 'string' | 'number' | 'boolean'): string | number | boolean {
  if (mode === 'string') return value;
  if (mode === 'number') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
    return value;
  }
  if (mode === 'boolean') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0' || lower === '') return false;
    return value;
  }
  return value;
}

function unescapeSep(s: string): string {
  if (s === '\\n') return '\n';
  if (s === '\\t') return '\t';
  return s;
}

function computeSegments(
  inputText: string,
  separator: string,
  trimAndFilterEmpty: boolean,
  convertType: 'string' | 'number' | 'boolean'
): (string | number | boolean)[] {
  if (inputText == null || String(inputText).trim() === '') return [];
  const raw = String(inputText).replace(/\r?\n/g, ' ').trim();
  const sep = unescapeSep(separator === '' ? ',' : separator);
  let parts = raw.split(sep);
  if (trimAndFilterEmpty) {
    parts = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  } else {
    parts = parts.map((p) => p.trim());
  }
  return parts.map((p) => tryConvert(p, convertType));
}

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

export const TextSplitNode: React.FC<TextSplitNodeProps> = (props) => {
  const { id, data, selected, isDarkMode = true, performanceMode = false, dragging, xPos = 0, yPos = 0 } = props as any;
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const store = useStoreApi();
  const nodeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const [inputText, setInputText] = useState(data?.inputText ?? '');
  const [separator, setSeparator] = useState(data?.separator ?? '&&&');
  const [trimAndFilterEmpty] = useState(data?.trimAndFilterEmpty ?? true);
  const [convertType] = useState<'string' | 'number' | 'boolean'>(data?.convertType ?? 'string');

  const edges = useStore((s) => s.edges);
  const transform = useStore((s) => s.transform);
  const dispatchedHandles = useMemo(() => {
    const set = new Set<string>();
    edges.forEach((e) => {
      if (e.source === id && e.sourceHandle) set.add(e.sourceHandle);
    });
    return set;
  }, [edges, id]);

  // 连线传入的 data.inputText 优先，避免等 state 同步导致「有输入却算成 0 段」的帧，从而消除尺寸来回跳
  const effectiveInputText =
    data?.inputText != null && String(data.inputText).trim() !== ''
      ? String(data.inputText)
      : inputText;

  const segments = useMemo(() => {
    return computeSegments(effectiveInputText, separator, trimAndFilterEmpty, convertType);
  }, [effectiveInputText, separator, trimAndFilterEmpty, convertType]);

  const capped = segments.slice(0, MAX_OUTPUTS);
  const hasMore = segments.length > MAX_OUTPUTS;
  const segmentCount = capped.length;
  const isErrorOrEmpty = capped.length === 0;

  const updateNodeData = useCallback(
    (updates: Partial<TextSplitNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const next = { ...n, data: { ...n.data, ...updates } };
          if (updates.width !== undefined || updates.height !== undefined) {
            next.style = {
              ...(n.style || {}),
              width: `${updates.width ?? n.data?.width ?? MIN_WIDTH}px`,
              height: `${updates.height ?? n.data?.height ?? MIN_HEIGHT}px`,
              minWidth: `${MIN_WIDTH}px`,
              minHeight: `${MIN_HEIGHT}px`,
            };
          }
          return next;
        })
      );
    },
    [id, setNodes]
  );

  // 仅当 data 有值时把 data 同步到 state（便于断开连线后保留上次内容）；不把 data 空值写回 state
  useEffect(() => {
    const fromData = data?.inputText;
    if (fromData == null || String(fromData).trim() === '' || fromData === inputText) return;
    setInputText(String(fromData));
  }, [data?.inputText]);

  const prevCountRef = useRef<number>(segmentCount);
  const prevErrorRef = useRef<boolean>(isErrorOrEmpty);

  // 仅当输出数量或空状态变化时：更新 internals、边清理、写回 height，避免频繁 setNodes 导致节点跳动
  useEffect(() => {
    const countChanged = prevCountRef.current !== segmentCount;
    const errorChanged = prevErrorRef.current !== isErrorOrEmpty;
    prevCountRef.current = segmentCount;
    prevErrorRef.current = isErrorOrEmpty;

    if (countChanged || errorChanged) {
      const keepHandles = isErrorOrEmpty
        ? ['output-null']
        : capped.map((_, i) => `output-${i}`);
  const baseH = 100;
  const perHandle = 28;
  const outputBaseTop = 72;
  const bottomPad = 12;
  const newHeight = Math.max(baseH, outputBaseTop + segmentCount * perHandle + bottomPad);
  const prevHeight = data?.height ?? newHeight;
  const isUserResized = data?.isUserResized === true;
  const heightToSet = isUserResized ? Math.max(prevHeight, newHeight) : newHeight;
      updateNodeData({
        segments: capped,
        segmentCount: isErrorOrEmpty ? 0 : segmentCount,
        height: heightToSet,
      });
      updateNodeInternals(id);
      props.onCleanupEdgesForHandles?.(id, keepHandles);
    }
  }, [segmentCount, isErrorOrEmpty, id, updateNodeInternals, props.onCleanupEdgesForHandles]);

  const segmentsJson = JSON.stringify(capped);
  // 写回 segments/配置，用 effectiveInputText 作为持久化的 inputText，与计算一致，避免来回切换
  useEffect(() => {
    updateNodeData({
      segments: capped,
      inputText: effectiveInputText,
      separator,
      trimAndFilterEmpty,
      convertType,
    });
  }, [segmentsJson, effectiveInputText, separator, id, updateNodeData]);

  const handleSeparatorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setSeparator(v);
    updateNodeData({ separator: v });
  };

  const baseH = 100;
  const perHandle = 28;
  const outputBaseTop = 72;
  const bottomPad = 12;
  const computedHeight = Math.max(baseH, outputBaseTop + segmentCount * perHandle + bottomPad);
  const width = data?.width ?? MIN_WIDTH;
  const isUserResized = data?.isUserResized === true;
  const height = isUserResized ? Math.max(computedHeight, data?.height ?? computedHeight) : computedHeight;

  const handleSizeChange = useCallback(
    (newSize: { w: number; h: number }) => {
      updateNodeData({
        width: newSize.w,
        height: newSize.h,
        isUserResized: true,
      });
    },
    [updateNodeData]
  );

  const zoom = transform?.[2] ?? 1;
  const vx = transform?.[0] ?? 0;
  const vy = transform?.[1] ?? 0;
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging || isResizing) return false;
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + width;
    const nodeBottom = yPos + height;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, selected, dragging, isResizing, vx, vy, zoom, xPos, yPos, width, height]);
  const showPlaceholder = isResizing || isHardFrozen;

  return (
    <div
      ref={nodeRef}
      className={`rounded-lg border-2 overflow-visible relative group ${
        isDarkMode ? 'bg-[#1C1C1E] border-white/20' : 'bg-gray-50 border-gray-300'
      } ${selected && isDarkMode && !isResizing ? 'ring-2 ring-green-400/80 border-green-400/70' : ''} ${isResizing ? '!shadow-none !ring-0' : ''}`}
      style={{
        width,
        height,
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        userSelect: isResizing ? 'none' : 'auto',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Handle 必须始终渲染 */}
      <Handle type="target" position={Position.Left} id="input" className={`w-3 h-3 !left-0 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
      {isErrorOrEmpty || showPlaceholder ? (
        <Handle type="source" position={Position.Right} id="output-null" className={`w-3 h-3 !right-0 !top-1/2 !-translate-y-1/2 z-20 bg-red-500/80 border-2 border-[#1C1C1E] ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />
      ) : (
        capped.map((_, i) => (
          <div key={i} className="absolute z-20 flex items-center justify-end pr-0.5" style={{ right: 0, top: outputBaseTop + i * perHandle + perHandle / 2, transform: 'translateY(-50%)' }}>
            <Handle type="source" position={Position.Right} id={`output-${i}`} className={`w-3 h-3 !right-0 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'} ${dispatchedHandles.has(`output-${i}`) ? 'animate-pulse' : ''}`} />
          </div>
        ))
      )}
      {showPlaceholder ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
            {isHardFrozen ? 'text split（冻结）' : 'text split'}
          </span>
        </div>
      ) : (
      <>
      {/* 框体外左上角小标题 */}
      <div className="title-area absolute -top-7 left-0 z-10">
        <span className={`font-bold text-xs select-none ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
          text split
        </span>
      </div>

      <div className="p-2 space-y-1.5 nodrag">
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`text-xs shrink-0 ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>分隔符</label>
          <input
            type="text"
            value={separator}
            onChange={handleSeparatorChange}
            placeholder="如 \\n 或 ,"
            className={`nodrag flex-1 min-w-0 min-w-[80px] text-sm rounded px-2 py-1.5 border cursor-text ${
              isDarkMode ? 'bg-white/10 border-white/20 text-white placeholder:text-white/50' : 'bg-white border-gray-300 text-gray-900'
            }`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {/* 框内列表：无滚动条，高度随行数自动撑开；pr-4 使序号文字与右侧绿点间距约 2–4px，与替换角色等模块一致 */}
      {!isErrorOrEmpty && (
        <div
          className="absolute left-0 right-0 overflow-hidden pl-2 pr-4 pointer-events-none"
          style={{ top: outputBaseTop, height: segmentCount * perHandle }}
        >
          {capped.map((seg, i) => (
            <div
              key={i}
              className={`min-h-[28px] flex items-center gap-1.5 text-[11px] leading-tight ${isDarkMode ? 'text-white' : 'text-gray-800'}`}
              style={{ minHeight: perHandle }}
            >
              <span className="font-medium shrink-0">{CIRCLE_NUMS[i]}</span>
              <span className="flex-1 min-w-0 truncate" title={String(seg)}>{String(seg).trim() || '—'}</span>
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <div className={`absolute text-xs right-2 bottom-1 ${isDarkMode ? 'text-white' : 'text-gray-600'}`}>
          +{segments.length - MAX_OUTPUTS} More...
        </div>
      )}

      {/* 右下角缩放手柄 */}
      <div
        ref={resizeHandleRef}
        className="nodrag absolute -bottom-1.5 -right-1.5 w-5 h-5 cursor-nwse-resize flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-[9999]"
        style={{ pointerEvents: 'all' }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsResizing(true);
          const startX = e.clientX;
          const startY = e.clientY;
          const startW = width;
          const startH = height;
          const originalCursor = document.body.style.cursor;
          document.body.style.setProperty('cursor', 'nwse-resize', 'important');
          let rafId: number | null = null;
          const scheduleUpdate = () => {
            if (rafId == null) {
              rafId = requestAnimationFrame(() => {
                updateNodeInternals(id);
                rafId = null;
              });
            }
          };
          const onMouseMove = (moveEvent: MouseEvent) => {
            moveEvent.preventDefault();
            const zoom = store.getState().transform[2] || 1;
            const deltaX = (moveEvent.clientX - startX) / zoom;
            const deltaY = (moveEvent.clientY - startY) / zoom;
            const newW = Math.max(MIN_WIDTH, startW + deltaX);
            const newH = Math.max(computedHeight, startH + deltaY);
            if (nodeRef.current) {
              nodeRef.current.style.transition = 'none';
              nodeRef.current.style.width = `${newW}px`;
              nodeRef.current.style.height = `${newH}px`;
            }
            scheduleUpdate();
          };
          const onMouseUp = (upEvent: MouseEvent) => {
            setIsResizing(false);
            document.body.style.cursor = originalCursor;
            if (rafId != null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
            const finalW = nodeRef.current ? parseFloat(nodeRef.current.style.width) || width : width;
            const finalH = nodeRef.current ? parseFloat(nodeRef.current.style.height) || height : height;
            handleSizeChange({ w: finalW, h: finalH });
            updateNodeInternals(id);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };
          document.addEventListener('mousemove', onMouseMove, { passive: false });
          document.addEventListener('mouseup', onMouseUp, { passive: false });
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`w-2 h-2 rounded-sm border ${isDarkMode ? 'border-white/40' : 'border-gray-400'}`} />
      </div>
      </>
      )}
    </div>
  );
};
