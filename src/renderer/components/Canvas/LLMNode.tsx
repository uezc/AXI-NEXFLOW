import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStoreApi, useStore } from 'reactflow';
import { Copy, Pencil, Check, AlignLeft, AlignCenter, AlignRight, Bold, Italic } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { ModuleProgressBar } from './ModuleProgressBar';

interface LLMNodeData {
  prompt?: string;
  savedPrompts?: Array<{
    id: string;
    name: string;
    content: string;
  }>;
  width?: number;
  height?: number;
  inputText?: string;
  outputText?: string;
  userInput?: string;
  systemPrompt?: string;
  title?: string;
  errorMessage?: string;
  isUserResized?: boolean; // 标记用户是否手动调整过尺寸
  /** 输出文本对齐 */
  textAlign?: 'left' | 'center' | 'right';
  /** 输出文本加粗 */
  fontWeight?: 'normal' | 'bold';
  /** 输出文本斜体 */
  fontStyle?: 'normal' | 'italic';
}

interface LLMNodeProps extends NodeProps<LLMNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
}

const LLMNodeComponent: React.FC<LLMNodeProps> = (props) => {
  // 解构出 React Flow 专有属性，避免透传给 DOM
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode = false,
    // React Flow 专有属性，不应传递给 DOM（显式解构以过滤）
    xPos,
    yPos,
    dragging,
    zIndex: _zIndex,
    width: _width,
    height: _height,
    type: _type,
    targetPosition: _targetPosition,
    sourcePosition: _sourcePosition,
    position: _position,
    // 确保不会透传任何其他 React Flow 内部属性
  } = props as any;
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const store = useStoreApi();
  // 最小尺寸约束（与 Text 模块相同）
  const MIN_WIDTH = 280;
  const MIN_HEIGHT = 160;
  // 默认初始宽度（生成内容后）
  const DEFAULT_WIDTH = 616.53;
  
  // 初始化尺寸：优先从节点的 style 属性读取，其次从 data 读取
  const getInitialSize = () => {
    // 从 props 中获取节点的 style（React Flow 传递的）
    const nodeStyle = (props as any).style;
    let width = data?.width;
    let height = data?.height;
    
    // 如果 style 中有尺寸，优先使用
    if (nodeStyle?.width) {
      const styleWidth = parseFloat(String(nodeStyle.width).replace('px', ''));
      if (!isNaN(styleWidth) && styleWidth > 0) {
        width = styleWidth;
      }
    }
    if (nodeStyle?.height) {
      const styleHeight = parseFloat(String(nodeStyle.height).replace('px', ''));
      if (!isNaN(styleHeight) && styleHeight > 0) {
        height = styleHeight;
      }
    }
    
    // 新建节点时（没有 width/height 数据），使用与 Text 模块相同的初始尺寸
    return {
      w: Math.max(MIN_WIDTH, width || MIN_WIDTH),
      h: Math.max(MIN_HEIGHT, height || MIN_HEIGHT),
    };
  };
  
  const [size, setSize] = useState(getInitialSize);
  const [isResizing, setIsResizing] = useState(false);
  const [outputText, setOutputText] = useState(data?.outputText || '');
  const [title, setTitle] = useState(data?.title || 'llm');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingOutput, setIsEditingOutput] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(data?.textAlign ?? 'left');
  const [fontWeight, setFontWeight] = useState<'normal' | 'bold'>(data?.fontWeight ?? 'normal');
  const [fontStyle, setFontStyle] = useState<'normal' | 'italic'>(data?.fontStyle ?? 'normal');
  const transform = useStore((s) => s.transform);
  
  const nodeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const outputTextareaRef = useRef<HTMLTextAreaElement>(null);

  // AI Hook（仅用于接收状态更新）
  const { status: aiStatus } = useAI({
    nodeId: id,
    modelId: 'chat',
    onStatusUpdate: (packet) => {
      if (!packet) return;
      const packetNodeId = String(packet.nodeId || '').trim();
      const currentNodeId = String(id || '').trim();
      
      if (packetNodeId !== currentNodeId) {
        return;
      }
      
      if (packet.status === 'START') {
        setIsTimerRunning(true);
        setElapsedSeconds(0);
      } else if (packet.status === 'SUCCESS' || packet.status === 'ERROR') {
        setIsTimerRunning(false);
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }
      
      // SUCCESS 状态：显示结果
      if (packet.status === 'SUCCESS') {
        const text = (packet.payload as any)?.text;
        if (text && typeof text === 'string' && text.trim()) {
          setOutputText(text);
          setErrorMessage('');
          
          const updateData: Partial<LLMNodeData> = {
            outputText: text,
            errorMessage: undefined,
          };
          
          if (!data?.isUserResized && size.w < DEFAULT_WIDTH) {
            updateData.width = DEFAULT_WIDTH;
            setSize((prev) => ({ ...prev, w: DEFAULT_WIDTH }));
          }
          
          updateNodeData(updateData);
        }
        return;
      }
      
      // ERROR 状态：显示错误信息
      if (packet.status === 'ERROR') {
        const errorMsg = packet.payload?.error || '未知错误';
        setErrorMessage(errorMsg);
        updateNodeData({ 
          errorMessage: errorMsg,
        });
        return;
      }
    },
    onComplete: (result) => {
      if (result?.text && typeof result.text === 'string' && result.text.trim()) {
        setOutputText(result.text);
        setErrorMessage('');
        
        const updateData: Partial<LLMNodeData> = {
          outputText: result.text,
          errorMessage: undefined,
        };
        
        if (!data?.isUserResized && size.w < DEFAULT_WIDTH) {
          updateData.width = DEFAULT_WIDTH;
          setSize((prev) => ({ ...prev, w: DEFAULT_WIDTH }));
        }
        
        updateNodeData(updateData);
      }
    },
    onError: (error) => {
      setErrorMessage(error?.error || '生成失败');
      updateNodeData({ 
        errorMessage: error?.error || '生成失败',
      });
    },
  });

  // 判断是否正在处理中（aiStatus 与 isTimerRunning 任一为真即显示生成中，避免状态丢失导致计时器消失）
  const isProcessing = aiStatus === 'START' || aiStatus === 'PROCESSING';
  const showTimer = isTimerRunning || isProcessing;

  // 计时器：生成中每秒更新已用时间
  useEffect(() => {
    if (!showTimer) return;
    setElapsedSeconds(0);
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [showTimer]);

  // 同步外部数据变化
  // 注意：编辑模式时不应该改变尺寸
  useEffect(() => {
    // 如果正在编辑，不更新尺寸（避免编辑模式时改变尺寸）
    if (isEditingOutput || isEditingTitle) {
      // 只更新文本内容，不更新尺寸
      if (data?.outputText !== undefined) {
        setOutputText(data.outputText);
      }
      if (data?.title !== undefined) {
        setTitle(data.title);
      }
      if (data?.errorMessage !== undefined) {
        setErrorMessage(data.errorMessage);
      }
      return; // 编辑模式时提前返回，不更新尺寸
    }
    
    // 优先从节点的 style 属性读取尺寸，其次从 data 读取
    const nodeStyle = (props as any).style;
    let width = data?.width;
    let height = data?.height;
    
    if (nodeStyle?.width) {
      const styleWidth = parseFloat(String(nodeStyle.width).replace('px', ''));
      if (!isNaN(styleWidth) && styleWidth > 0) {
        width = styleWidth;
      }
    }
    if (nodeStyle?.height) {
      const styleHeight = parseFloat(String(nodeStyle.height).replace('px', ''));
      if (!isNaN(styleHeight) && styleHeight > 0) {
        height = styleHeight;
      }
    }
    
    // 只有在非编辑模式时才更新尺寸
    // 并且只有当尺寸真正改变时才更新，避免不必要的重新渲染
    if (width !== undefined && width > 0) {
      setSize((prev) => {
        // 只有当尺寸真正改变时才更新
        if (Math.abs(prev.w - width) > 0.1) {
          return { ...prev, w: width };
        }
        return prev;
      });
    }
    if (height !== undefined && height > 0) {
      setSize((prev) => {
        // 只有当尺寸真正改变时才更新
        if (Math.abs(prev.h - height) > 0.1) {
          return { ...prev, h: height };
        }
        return prev;
      });
    }
    if (data?.outputText !== undefined) {
      setOutputText(data.outputText);
    }
    if (data?.title !== undefined) {
      setTitle(data.title);
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage);
    }
    if (data?.textAlign !== undefined) setTextAlign(data.textAlign);
    if (data?.fontWeight !== undefined) setFontWeight(data.fontWeight);
    if (data?.fontStyle !== undefined) setFontStyle(data.fontStyle);
  }, [data?.width, data?.height, data?.outputText, data?.title, data?.errorMessage, data?.textAlign, data?.fontWeight, data?.fontStyle, props, isEditingOutput, isEditingTitle]);

  // 双击进入编辑模式
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 双击输出区域进入编辑模式
    setIsEditingOutput(true);
  }, []);

  // 双击输出文本进入编辑模式
  const handleOutputDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingOutput(true);
    setTimeout(() => outputTextareaRef.current?.focus(), 0);
  }, []);

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, []);

  // 更新节点数据
  // 注意：编辑模式时不应该改变尺寸
  const updateNodeData = useCallback((updates: Partial<LLMNodeData>, preserveSize = true) => {
    // 如果正在编辑，强制 preserveSize = true，确保不改变尺寸
    const shouldPreserveSize = preserveSize || isEditingOutput || isEditingTitle;
    
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          const updatedNode = {
            ...node,
            data: {
              ...node.data,
              ...updates,
            },
          };
          
          // 如果更新了 width 或 height，同时更新节点的 style 属性
          // preserveSize 为 true 时，如果只更新 outputText 等非尺寸字段，不改变尺寸
          if (updates.width !== undefined || updates.height !== undefined) {
            updatedNode.style = {
              ...(node.style || {}),
              width: updates.width !== undefined ? `${updates.width}px` : (node.style?.width || `${size.w}px`),
              height: updates.height !== undefined ? `${updates.height}px` : (node.style?.height || `${size.h}px`),
              minWidth: '280px',
              minHeight: '160px',
            };
          } else {
            // 无论 preserveSize 是否为 true，只要没有更新 width/height，就完全保持原有 style
            // 这样可以确保编辑模式下尺寸不会改变
            if (node.style) {
              updatedNode.style = { ...node.style };
            } else {
              // 如果没有 style，从 props 中获取，如果也没有，使用当前 size
              const nodeStyle = (props as any).style;
              if (nodeStyle) {
                updatedNode.style = { ...nodeStyle };
              } else {
                updatedNode.style = {
                  width: `${size.w}px`,
                  height: `${size.h}px`,
                  minWidth: '280px',
                  minHeight: '160px',
                };
              }
            }
          }
          
          return updatedNode;
        }
        return node;
      })
    );
  }, [id, setNodes, size, isEditingOutput, isEditingTitle, props]);

  const applyFormat = useCallback((key: 'textAlign' | 'fontWeight' | 'fontStyle', value: 'left' | 'center' | 'right' | 'normal' | 'bold' | 'italic') => {
    if (key === 'textAlign') {
      setTextAlign(value as 'left' | 'center' | 'right');
      updateNodeData({ textAlign: value as 'left' | 'center' | 'right' }, true);
    } else if (key === 'fontWeight') {
      const v = value as 'normal' | 'bold';
      setFontWeight(v);
      updateNodeData({ fontWeight: v }, true);
    } else if (key === 'fontStyle') {
      const v = value as 'normal' | 'italic';
      setFontStyle(v);
      updateNodeData({ fontStyle: v }, true);
    }
  }, [updateNodeData]);

  // 点击非编辑区域退出编辑模式
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // 检查是否点击在节点外部
      if (isEditingOutput && nodeRef.current && !nodeRef.current.contains(target)) {
        // 确保不是点击在 textarea 内部
        if (!outputTextareaRef.current?.contains(target)) {
          setIsEditingOutput(false);
          // 保存文本更改
          if (data?.outputText !== outputText) {
            updateNodeData({ outputText }, true);
          }
        }
      }
      if (isEditingTitle && nodeRef.current && !nodeRef.current.contains(target)) {
        // 确保不是点击在 title input 内部
        if (!titleInputRef.current?.contains(target)) {
          setIsEditingTitle(false);
          // 保存标题更改
          if (data?.title !== title) {
            updateNodeData({ title });
          }
        }
      }
    };

    if (isEditingOutput || isEditingTitle) {
      // 使用捕获阶段，确保在其他事件之前处理
      document.addEventListener('mousedown', handleClickOutside, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [isEditingOutput, isEditingTitle, outputText, title, data?.outputText, data?.title, updateNodeData]);

  // 处理尺寸变化（用户手动调整）
  // 注意：编辑模式时不应该改变尺寸
  const handleSizeChange = useCallback((newSize: { w: number; h: number }) => {
    // 如果正在编辑，不改变尺寸
    if (isEditingOutput || isEditingTitle) {
      return;
    }
    setSize(newSize);
    // 使用 requestAnimationFrame 确保在下一帧更新，避免状态冲突
    requestAnimationFrame(() => {
      updateNodeData({ 
        width: newSize.w, 
        height: newSize.h,
        isUserResized: true, // 标记为用户手动调整
      }, false); // 尺寸变化时，preserveSize = false
    });
  }, [updateNodeData, isEditingOutput, isEditingTitle]);

  // 复制输出文本（必须在 early return 之前调用，遵守 hooks 规则）
  const handleCopyOutput = useCallback(async () => {
    if (outputText) {
      try {
        await navigator.clipboard.writeText(outputText);
        setShowCopySuccess(true);
        setTimeout(() => setShowCopySuccess(false), 2000);
      } catch (err) {
        console.error('复制失败:', err);
      }
    }
  }, [outputText]);

  const zoom = transform?.[2] ?? 1;
  const vx = transform?.[0] ?? 0;
  const vy = transform?.[1] ?? 0;
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging || isResizing) return false;
    const nodeX = Number(xPos ?? 0);
    const nodeY = Number(yPos ?? 0);
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = nodeX + size.w;
    const nodeBottom = nodeY + size.h;
    const intersects = !(nodeRight < viewportLeft || nodeX > viewportRight || nodeBottom < viewportTop || nodeY > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (nodeX > viewportRight ? nodeX - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (nodeY > viewportBottom ? nodeY - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, selected, dragging, isResizing, xPos, yPos, vx, vy, zoom, size.w, size.h]);
  const showPlaceholder = isResizing || isHardFrozen;

  return (
    <>
      <div
        ref={nodeRef}
        style={{
          width: size.w,
          height: size.h,
          minWidth: '280px',
          minHeight: '160px',
          userSelect: isResizing ? 'none' : 'auto',
          willChange: isResizing ? 'width, height' : 'auto',
          backfaceVisibility: isResizing ? 'hidden' : 'visible',
          transition: isResizing ? 'none' : 'background-color 0.2s, border-color 0.2s',
          overflow: 'visible', // 使左上角小标题可见；内容区由内部 overflow 控制
          boxSizing: 'border-box', // 确保边框包含在尺寸内
        }}
        className={`custom-node-container group relative rounded-2xl p-4 overflow-visible flex flex-col ${
          isDarkMode
            ? 'bg-[#1C1C1E]'
            : 'apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
        } ${
          selected && !isResizing
            ? isDarkMode
              ? 'border-[1.5px] border-green-500 ring-2 ring-green-400/80 border-green-400/70'
              : 'border-[1.5px] border-green-500'
            : isDarkMode
              ? 'border border-gray-600/50'
              : ''
        } ${isResizing ? '!shadow-none !ring-0' : ''}`}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Handle 必须始终渲染，否则连线会断 */}
        <Handle type="target" position={Position.Left} id="input" className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
        <Handle type="source" position={Position.Right} id="output" className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
        {showPlaceholder ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
              {isHardFrozen ? `${data?.title || 'llm'}（冻结）` : (data?.title || 'llm')}
            </span>
          </div>
        ) : (
        <>
        {/* 左上角标题区域（在文本框外部，节点边框外） */}
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
                  setTitle(data?.title || 'llm');
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
              {title || 'llm'}
            </span>
          )}
        </div>

        {/* 全模块覆盖进度条（与 Image 模块相同：匀速循环 0%→100% 动画） */}
        <ModuleProgressBar
          visible={showTimer}
          progress={data?.progress ?? 0}
          borderRadius={16}
          onFadeComplete={() => updateNodeData({ progress: 0 })}
        />

        {/* 模块内右上角复制按钮 */}
        {/* 复制成功后显示勾标记，否则显示复制按钮 */}
        {selected && outputText && (
          <button
            onClick={handleCopyOutput}
            className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all z-10 ${
              isDarkMode 
                ? 'apple-panel hover:bg-white/20' 
                : 'apple-panel-light hover:bg-gray-200/30'
            }`}
            title={showCopySuccess ? "已复制" : "复制"}
          >
            {showCopySuccess ? (
              <Check className={`w-3.5 h-3.5 ${
                isDarkMode ? 'text-green-400' : 'text-green-600'
              }`} />
            ) : (
              <Copy className={`w-3.5 h-3.5 ${
                isDarkMode ? 'text-white/80' : 'text-gray-700'
              }`} />
            )}
          </button>
        )}

             {/* 文本内容显示区域（与文本模块样式一致，支持双击编辑） */}
             <div 
               className={`drag-handle-area custom-scrollbar w-full h-full flex overflow-auto p-2 relative flex-1 min-h-0 ${
                 isEditingOutput ? '' : 'items-center justify-center'
               }`}
               onDoubleClick={handleDoubleClick}
             >
               {errorMessage ? (
                 // 显示错误信息
                 <div className="flex flex-col items-center justify-center gap-3 p-4">
                   <div className={`text-2xl ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                     ⚠️
                   </div>
                   <p className={`text-sm font-semibold text-center ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
                     生成失败
                   </p>
                   <p className={`text-xs text-center line-clamp-3 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
                     {errorMessage}
                   </p>
                 </div>
               ) : showTimer ? (
                 // 生成中状态：由 ModuleProgressBar 全模块遮罩展示进度条动画，此处仅保留占位文案
                 <p className={`text-xs text-center ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>
                   等待生成…
                 </p>
               ) : isEditingOutput ? (
                 <textarea
                   ref={outputTextareaRef}
                   value={outputText || ''}
                   onChange={(e) => {
                     setOutputText(e.target.value);
                   }}
                   onBlur={() => {
                     setIsEditingOutput(false);
                     // 只更新 outputText，不改变尺寸（preserveSize = true）
                     updateNodeData({ outputText }, true);
                   }}
                   onKeyDown={(e) => {
                     if (e.key === 'Escape') {
                       setIsEditingOutput(false);
                       setOutputText(data?.outputText || '');
                     }
                   }}
                   onMouseDown={(e) => {
                     // 阻止事件冒泡，防止触发外部点击处理
                     e.stopPropagation();
                   }}
                   onClick={(e) => {
                     // 阻止事件冒泡，防止触发外部点击处理
                     e.stopPropagation();
                   }}
                   className={`nodrag w-full h-full bg-transparent resize-none outline-none text-sm break-words whitespace-pre-wrap ${
                     textAlign === 'left' ? 'text-left' : textAlign === 'right' ? 'text-right' : 'text-center'
                   } ${fontWeight === 'bold' ? 'font-bold' : ''} ${fontStyle === 'italic' ? 'italic' : ''} ${
                     isDarkMode ? 'text-white/80' : 'text-gray-900'
                   }`}
                   style={{
                     caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
                     wordBreak: 'break-word',
                     overflowWrap: 'break-word',
                     height: '100%',
                   }}
                   title="编辑输出文本，按 Escape 取消"
                   placeholder="双击编辑文本..."
                   autoFocus
                 />
               ) : (
                 <div className="relative w-full h-full">
                   <p 
                     className={`break-words whitespace-pre-wrap ${
                       textAlign === 'left' ? 'text-left' : textAlign === 'right' ? 'text-right' : 'text-center'
                     } ${fontWeight === 'bold' ? 'font-bold' : ''} ${fontStyle === 'italic' ? 'italic' : ''} ${
                       isDarkMode ? 'text-white/80' : 'text-gray-900'
                     }`} 
                     style={{
                       maxWidth: '100%',
                       wordBreak: 'break-word',
                       overflowWrap: 'break-word',
                       cursor: 'text',
                     }}
                     onDoubleClick={handleOutputDoubleClick}
                   >
                     {outputText || '双击编辑文本...'}
                   </p>
                   {/* 左下角编辑按钮（仅在有文本时显示） */}
                   {/* 复制成功后显示勾标记，否则显示编辑按钮 */}
                   {outputText && (
                     <button
                       onClick={(e) => {
                         e.stopPropagation();
                         if (showCopySuccess) {
                           // 如果显示勾标记，点击后恢复编辑按钮
                           setShowCopySuccess(false);
                         } else {
                           // 点击编辑按钮，不改变尺寸
                           setIsEditingOutput(true);
                           setTimeout(() => outputTextareaRef.current?.focus(), 0);
                         }
                       }}
                       onMouseDown={(e) => {
                         e.stopPropagation();
                         e.preventDefault();
                       }}
                       className={`nodrag absolute bottom-2 left-2 p-1.5 rounded-lg transition-all z-[100] ${
                         isDarkMode 
                           ? 'apple-panel hover:bg-white/20' 
                           : 'apple-panel-light hover:bg-gray-200/30'
                       }`}
                       title={showCopySuccess ? "已复制" : "编辑文本"}
                       style={{ pointerEvents: 'all' }}
                       type="button"
                     >
                       {showCopySuccess ? (
                         <Check className={`w-4 h-4 ${
                           isDarkMode ? 'text-green-400' : 'text-green-600'
                         }`} />
                       ) : (
                         <Pencil className={`w-4 h-4 ${
                           isDarkMode ? 'text-white/80' : 'text-gray-700'
                         }`} />
                       )}
                     </button>
                   )}
                 </div>
               )}
             </div>

        {/* 底部：对齐、加粗、斜体 */}
        {!errorMessage && (
          <div
            className={`nodrag flex items-center gap-2 flex-shrink-0 pt-2 mt-2 border-t ${
              isDarkMode ? 'border-white/20' : 'border-gray-300/50'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => applyFormat('textAlign', 'left')}
              className={`p-1.5 rounded transition-all ${
                textAlign === 'left'
                  ? isDarkMode ? 'bg-green-500/30 text-green-400' : 'bg-green-500/20 text-green-600'
                  : isDarkMode ? 'hover:bg-white/15 text-white/70' : 'hover:bg-gray-200/50 text-gray-600'
              }`}
              title="左对齐"
            >
              <AlignLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => applyFormat('textAlign', 'center')}
              className={`p-1.5 rounded transition-all ${
                textAlign === 'center'
                  ? isDarkMode ? 'bg-green-500/30 text-green-400' : 'bg-green-500/20 text-green-600'
                  : isDarkMode ? 'hover:bg-white/15 text-white/70' : 'hover:bg-gray-200/50 text-gray-600'
              }`}
              title="居中"
            >
              <AlignCenter className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => applyFormat('textAlign', 'right')}
              className={`p-1.5 rounded transition-all ${
                textAlign === 'right'
                  ? isDarkMode ? 'bg-green-500/30 text-green-400' : 'bg-green-500/20 text-green-600'
                  : isDarkMode ? 'hover:bg-white/15 text-white/70' : 'hover:bg-gray-200/50 text-gray-600'
              }`}
              title="右对齐"
            >
              <AlignRight className="w-4 h-4" />
            </button>
            <span className={`w-px h-4 ${isDarkMode ? 'bg-white/20' : 'bg-gray-300'}`} />
            <button
              type="button"
              onClick={() => applyFormat('fontWeight', fontWeight === 'bold' ? 'normal' : 'bold')}
              className={`p-1.5 rounded transition-all ${
                fontWeight === 'bold'
                  ? isDarkMode ? 'bg-green-500/30 text-green-400' : 'bg-green-500/20 text-green-600'
                  : isDarkMode ? 'hover:bg-white/15 text-white/70' : 'hover:bg-gray-200/50 text-gray-600'
              }`}
              title="加粗"
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => applyFormat('fontStyle', fontStyle === 'italic' ? 'normal' : 'italic')}
              className={`p-1.5 rounded transition-all ${
                fontStyle === 'italic'
                  ? isDarkMode ? 'bg-green-500/30 text-green-400' : 'bg-green-500/20 text-green-600'
                  : isDarkMode ? 'hover:bg-white/15 text-white/70' : 'hover:bg-gray-200/50 text-gray-600'
              }`}
              title="斜体"
            >
              <Italic className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 右下角框外圆弧角缩放手柄 */}
        <div
          ref={resizeHandleRef}
          className="nodrag absolute -bottom-2 -right-2 w-6 h-6 cursor-nwse-resize flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity z-[9999]"
          style={{ pointerEvents: 'all' }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            
            setIsResizing(true);
            
            // 标记节点正在调整大小，阻止拖动
            updateNodeData({ _isResizing: true } as any);
            
            // 在 body 上设置 cursor 样式（使用 !important 防止鼠标移动过快时样式闪烁）
            const originalCursor = document.body.style.cursor;
            document.body.style.setProperty('cursor', 'nwse-resize', 'important');
            
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = size.w;
            const startH = size.h;
            
            // 使用 requestAnimationFrame 优化 updateNodeInternals 调用
            let rafId: number | null = null;
            const scheduleUpdate = () => {
              if (rafId === null) {
                rafId = requestAnimationFrame(() => {
                  // Tapnow 秘密：在修改 DOM 后立即执行更新，确保连线实时同步
                  updateNodeInternals(id);
                  rafId = null;
                });
              }
            };

            const onMouseMove = (moveEvent: MouseEvent) => {
              moveEvent.preventDefault();
              moveEvent.stopPropagation();
              
              // 获取当前缩放比例（可能在缩放过程中变化）
              // 使用 useStoreApi().getState().transform[2] 获取精确的 zoom 值
              const currentZoom = store.getState().transform[2] || 1;
              
              // 将鼠标移动距离除以缩放比例，转换为画布坐标
              // 确保鼠标指针永远死死地扣住节点边缘
              const deltaX = (moveEvent.clientX - startX) / currentZoom;
              const deltaY = (moveEvent.clientY - startY) / currentZoom;
              
            // 计算新尺寸（最小尺寸约束：280px * 160px）
            const newW = Math.max(280, startW + deltaX);
            const newH = Math.max(160, startH + deltaY);
              
              // 直接操作 DOM，不触发 React 状态更新（非受控样式操作）
              // 禁用 transition 确保零延迟响应
              if (nodeRef.current) {
                nodeRef.current.style.transition = 'none';
                nodeRef.current.style.width = `${newW}px`;
                nodeRef.current.style.height = `${newH}px`;
              }
              
              // Tapnow 秘密：在修改 DOM 后立即调度 updateNodeInternals，确保连线实时同步
              scheduleUpdate();
            };
            
            const onMouseUp = (upEvent: MouseEvent) => {
              setIsResizing(false);
              
              // 恢复 body cursor
              document.body.style.cursor = originalCursor;
              
              // 恢复 transition（仅在非缩放时生效）
              if (nodeRef.current) {
                nodeRef.current.style.transition = '';
              }
              
              // 取消待处理的 requestAnimationFrame
              if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
              }
              
              // 获取最终尺寸（从 DOM 读取）
              const finalSize = {
                w: nodeRef.current ? parseFloat(nodeRef.current.style.width) || size.w : size.w,
                h: nodeRef.current ? parseFloat(nodeRef.current.style.height) || size.h : size.h,
              };
              
              // 仅在 onMouseUp 时更新 React 状态（数据持久化）
              handleSizeChange(finalSize);
              
              // 清除调整大小标记
              updateNodeData({ _isResizing: false } as any);
              
              // 强制刷新节点连接线位置（最终更新）
              updateNodeInternals(id);
              
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
              upEvent.preventDefault();
              upEvent.stopPropagation();
            };
            
            document.addEventListener('mousemove', onMouseMove, { passive: false });
            document.addEventListener('mouseup', onMouseUp, { passive: false });
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className={`w-4 h-4 rounded-br-2xl border-r-2 border-b-2 ${
            isDarkMode ? 'border-white/40' : 'border-gray-400/60'
          }`} />
        </div>
        </>
        )}
      </div>
    </>
  );
};

export const LLMNode = memo(LLMNodeComponent);
LLMNode.displayName = 'LLMNode';
