import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStore } from 'reactflow';
import { User, Copy, Check } from 'lucide-react';
import { ModuleProgressBar } from './ModuleProgressBar';

interface CharacterNodeData {
  title?: string;
  nickname?: string;
  name?: string;
  avatar?: string;
  videoUrl?: string;
  timestamp?: string;
  roleId?: string; // 角色 ID
  progress?: number; // 进度（0-100）
  progressMessage?: string; // 进度文案
  errorMessage?: string; // 错误信息
}

interface CharacterNodeProps extends NodeProps<CharacterNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
}

const CharacterNodeComponent: React.FC<CharacterNodeProps> = (props) => {
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode = false,
    onDataChange,
    xPos = 0,
    yPos = 0,
    dragging,
    zIndex: _zIndex,
    width: _width,
    height: _height,
    type: _type,
    targetPosition: _targetPosition,
    sourcePosition: _sourcePosition,
    position: _position,
  } = props as any;
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  
  // 正方形尺寸（固定）
  const NODE_SIZE = 200;
  
  const [title, setTitle] = useState(data?.title || 'character');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(data?.progress || 0);
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  
  const nodeRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const transform = useStore((s) => s.transform);

  // 同步外部数据变化
  useEffect(() => {
    if (data?.title !== undefined && data.title !== title) {
      setTitle(data.title);
    }
    if (data?.progress !== undefined) {
      setProgress(data.progress);
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage);
    }
  }, [data?.title, data?.progress, data?.errorMessage]);

  // 更新节点数据
  const updateNodeData = useCallback((updates: Partial<CharacterNodeData>) => {
    setNodes((nds: any[]) =>
      nds.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...updates } } : node
      )
    );
    if (onDataChange) {
      onDataChange({ ...data, ...updates });
    }
  }, [id, data, setNodes, onDataChange]);

  // 双击标题编辑
  const handleTitleDoubleClick = useCallback(() => {
    setIsEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  }, []);

  // 复制 roleId（必须在所有 return 之前调用，遵守 hooks 规则）
  const handleCopyRoleId = useCallback(async () => {
    if (!data?.roleId) return;
    
    const roleIdText = `@${data.roleId}`;
    try {
      await navigator.clipboard.writeText(roleIdText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  }, [data?.roleId]);

  const zoom = transform?.[2] ?? 1;
  const vx = transform?.[0] ?? 0;
  const vy = transform?.[1] ?? 0;
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging) return false;
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + NODE_SIZE;
    const nodeBottom = yPos + NODE_SIZE;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, selected, dragging, vx, vy, zoom, xPos, yPos]);
  const showPlaceholder = isHardFrozen;

  return (
    <>
      <div
        ref={nodeRef}
        style={{
          width: NODE_SIZE,
          height: NODE_SIZE,
          userSelect: 'auto',
        }}
        className={`custom-node-container group relative rounded-2xl p-4 overflow-visible flex items-center justify-center ${
          isDarkMode
            ? 'bg-[#1C1C1E]'
            : 'apple-panel-light'
        } ${selected && isDarkMode ? 'ring-2 ring-green-400/80 border-green-400/70' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Handle type="target" position={Position.Left} id="input" className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
        {/* 角色模块已去除输出节点，仅支持从 video 输入 */}
        {showPlaceholder ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
              {isHardFrozen ? `${title || 'character'}（冻结）` : (title || 'character')}
            </span>
          </div>
        ) : (
        <>
        {/* 左上角标题区域 */}
        <div className="title-area absolute -top-7 left-0 z-10">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setIsEditingTitle(false);
                if (data?.title !== title) {
                  updateNodeData({ title });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setIsEditingTitle(false);
                  if (data?.title !== title) {
                    updateNodeData({ title });
                  }
                }
                if (e.key === 'Escape') {
                  setIsEditingTitle(false);
                  setTitle(data?.title || 'character');
                }
              }}
              className={`bg-transparent outline-none font-bold text-xs ${
                isDarkMode ? 'text-white/80' : 'text-gray-900'
              }`}
              style={{ 
                caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
                minWidth: '40px',
                maxWidth: '120px',
              }}
              title="编辑标题"
              autoFocus
            />
          ) : (
            <span
              onClick={handleTitleDoubleClick}
              className={`font-bold text-xs cursor-pointer select-none ${
                isDarkMode ? 'text-white/80' : 'text-gray-900'
              } hover:opacity-70 transition-opacity`}
            >
              {title || 'character'}
            </span>
          )}
        </div>

        {/* 全模块覆盖进度条（角色建模/生成中时覆盖整个节点顶层） */}
        <ModuleProgressBar
          visible={progress > 0}
          progress={progress}
          borderRadius={16}
          onFadeComplete={() => updateNodeData({ progress: 0 })}
        />

        {/* 角色内容显示区域 */}
        <div className="flex flex-col items-center justify-center gap-2 w-full">
          {errorMessage ? (
            // 显示错误信息
            <div className="flex flex-col items-center justify-center gap-2 p-2">
              <div className={`text-xl ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                ⚠️
              </div>
              <p className={`text-xs text-center line-clamp-2 ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
                {errorMessage}
              </p>
            </div>
          ) : (
            // 显示角色头像/图标
            <>
              {data?.avatar ? (
                <img
                  src={data.avatar}
                  alt={data.name || data.nickname || '角色'}
                  draggable={false}
                  className="w-24 h-24 rounded-full object-cover border-2 border-white/20"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              ) : (
                <div className={`w-24 h-24 rounded-full flex items-center justify-center ${
                  isDarkMode ? 'bg-white/10' : 'bg-gray-200/50'
                }`}>
                  <User className={`w-12 h-12 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`} />
                </div>
              )}
              {(data?.name || data?.nickname) && (
                <div className={`text-xs text-center truncate max-w-full px-2 ${
                  isDarkMode ? 'text-white/80' : 'text-gray-900'
                }`}>
                  {data.name || data.nickname}
                </div>
              )}
              {/* 角色 ID 显示和复制按钮 */}
              {data?.roleId && (
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${
                  isDarkMode ? 'bg-white/10 text-white/90' : 'bg-gray-100 text-gray-700'
                }`}>
                  <span className="font-mono">@{data.roleId}</span>
                  <button
                    onClick={handleCopyRoleId}
                    className={`p-0.5 rounded hover:bg-white/20 transition-colors ${
                      copied ? 'text-green-400' : isDarkMode ? 'text-white/60' : 'text-gray-500'
                    }`}
                    title={copied ? '已复制' : '复制角色ID'}
                  >
                    {copied ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        </>
        )}
      </div>
    </>
  );
};

export const CharacterNode = memo(CharacterNodeComponent);
