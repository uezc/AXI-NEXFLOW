import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useStore, useUpdateNodeInternals, useStoreApi } from 'reactflow';
import { Copy, Pencil, Check, AlignLeft, AlignCenter, AlignRight, Bold, Italic } from 'lucide-react';
import { useAI } from '../../hooks/useAI';

/** 10 个常用字体选项 */
const TEXT_FONT_OPTIONS: { value: string; label: string }[] = [
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'PingFang SC', label: '苹方' },
  { value: 'Noto Sans SC', label: '思源黑体' },
  { value: 'SimSun', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

interface MinimalistTextNodeData {
  text?: string;
  width?: number;
  height?: number;
  title?: string;
  isUserResized?: boolean;
  progress?: number;
  progressMessage?: string;
  errorMessage?: string;
  /** 文本对齐 */
  textAlign?: 'left' | 'center' | 'right';
  /** 加粗 */
  fontWeight?: 'normal' | 'bold';
  /** 斜体 */
  fontStyle?: 'normal' | 'italic';
  /** 字体 */
  fontFamily?: string;
}


interface MinimalistTextNodeProps extends NodeProps<MinimalistTextNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
}

export const MinimalistTextNode: React.FC<MinimalistTextNodeProps> = (props) => {
  // 解构出 React Flow 专有属性，避免透传给 DOM
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode = false,
    // React Flow 专有属性，不应传递给 DOM（显式解构以过滤）
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
    // 确保不会透传任何其他 React Flow 内部属性
  } = props as any;
  const { setNodes, getViewport } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const store = useStoreApi();
  // 订阅画布 transform，用于超远节点冻结判定
  const transform = useStore((state) => state.transform);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [text, setText] = useState(data?.text || '');
  const [title, setTitle] = useState(data?.title || 'text');
  const [progress, setProgress] = useState(data?.progress || 0);
  const [progressMessage, setProgressMessage] = useState(data?.progressMessage || '');
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(data?.textAlign || 'center');
  const [fontWeight, setFontWeight] = useState<'normal' | 'bold'>(data?.fontWeight || 'normal');
  const [fontStyle, setFontStyle] = useState<'normal' | 'italic'>(data?.fontStyle || 'normal');
  const [fontFamily, setFontFamily] = useState(data?.fontFamily || TEXT_FONT_OPTIONS[0].value);
  // 最小尺寸约束（与 TextNode 相同）
  const MIN_WIDTH = 280;
  const MIN_HEIGHT = 160;
  
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
    
    return {
      w: Math.max(MIN_WIDTH, width || MIN_WIDTH),
      h: Math.max(MIN_HEIGHT, height || MIN_HEIGHT),
    };
  };
  
  const [size, setSize] = useState(getInitialSize);
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);


  // AI Hook（用于接收状态更新，支持进度条和内容回传）
  const { status: aiStatus } = useAI({
    nodeId: id,
    modelId: 'chat', // text 节点也使用 chat 模型
    onStatusUpdate: (packet) => {
      // START 状态：初始化进度条
      if (packet.status === 'START') {
        setErrorMessage('');
        const initialProgress = Math.max(1, packet.payload?.progress || 1);
        const initialMessage = packet.payload?.text || '正在初始化模型...';
        setProgress(initialProgress);
        setProgressMessage(initialMessage);
        updateNodeData({ 
          errorMessage: undefined,
          progress: initialProgress,
          progressMessage: initialMessage,
        });
        return;
      }
      
      // PROCESSING 状态：更新进度和消息
      if (packet.status === 'PROCESSING') {
        if (packet.payload?.progress !== undefined) {
          const newProgress = Math.max(1, packet.payload.progress);
          setProgress(newProgress);
          updateNodeData({ progress: newProgress });
        } else {
          if (progress === 0) {
            setProgress(1);
            updateNodeData({ progress: 1 });
          }
        }
        
        if (packet.payload?.text) {
          setProgressMessage(packet.payload.text);
          updateNodeData({ progressMessage: packet.payload.text });
        }
        return;
      }
      
      // SUCCESS 状态：更新文本内容，清除进度条
      // 双重保障：优先使用 text，而不是等待 localPath 读取
      if (packet.status === 'SUCCESS') {
        try {
          // 优先使用 text 字段（后端已经发送了 text）
          const resultText = packet.payload?.text;
          if (resultText) {
            setText(resultText);
            setProgress(0);
            setProgressMessage('');
            setErrorMessage('');
            updateNodeData({ 
              text: resultText,
              progress: 0,
              progressMessage: undefined,
              errorMessage: undefined,
            });
            console.log(`[MinimalistTextNode] SUCCESS 状态：使用 text 字段，长度: ${resultText.length}`);
            return;
          }
          
          // 如果没有 text，尝试从 localPath 读取（备用方案）
          // 注意：这可能会因为乱码路径而失败，所以用 try-catch 包裹
          const localPath = packet.payload?.localPath;
          if (localPath) {
            console.log(`[MinimalistTextNode] 尝试从 localPath 读取: ${localPath}`);
            // 这里可以添加文件读取逻辑，但优先使用 text 更可靠
            // 暂时跳过，因为后端已经发送了 text
          }
        } catch (error) {
          // 解决乱码中断：即使处理失败，也不阻塞界面
          console.warn('[MinimalistTextNode] 处理 SUCCESS 状态时出错（可能是乱码路径导致）:', error);
          // 如果出错，至少清除进度条
          setProgress(0);
          setProgressMessage('');
          updateNodeData({ 
            progress: 0,
            progressMessage: undefined,
          });
        }
        return;
      }
      
      // ERROR 状态：显示错误信息，清除进度条
      if (packet.status === 'ERROR') {
        const errorMsg = packet.payload?.error || '未知错误';
        setErrorMessage(errorMsg);
        setProgress(0);
        setProgressMessage('');
        updateNodeData({ 
          errorMessage: errorMsg,
          progress: 0,
          progressMessage: undefined,
        });
        return;
      }
    },
    onComplete: (result) => {
      // 完成回调：确保结果正确显示
      // 双重保障：优先使用 text，而不是等待 localPath 读取
      try {
        if (result?.text) {
          setText(result.text);
          setProgress(0);
          setProgressMessage('');
          setErrorMessage('');
          updateNodeData({
            text: result.text,
            progress: 0,
            progressMessage: undefined,
            errorMessage: undefined,
          });
          console.log(`[MinimalistTextNode] onComplete：使用 text 字段，长度: ${result.text.length}`);
        } else if (result?.localPath) {
          // 如果没有 text，尝试从 localPath 读取（备用方案）
          // 注意：这可能会因为乱码路径而失败，所以用 try-catch 包裹
          console.warn('[MinimalistTextNode] onComplete：没有 text 字段，尝试从 localPath 读取（可能失败）:', result.localPath);
          // 暂时跳过，因为后端应该已经发送了 text
        }
      } catch (error) {
        // 解决乱码中断：即使处理失败，也不阻塞界面
        console.warn('[MinimalistTextNode] onComplete 处理时出错（可能是乱码路径导致）:', error);
        // 如果出错，至少清除进度条
        setProgress(0);
        setProgressMessage('');
        updateNodeData({
          progress: 0,
          progressMessage: undefined,
        });
      }
    },
  });

  // 同步外部数据变化
  useEffect(() => {
    if (data?.text !== undefined) {
      setText(data.text);
    }
    if (data?.title !== undefined) {
      setTitle(data.title);
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
    
    if (width !== undefined && width > 0) {
      setSize((prev) => {
        if (prev.w !== width) {
          return { ...prev, w: width };
        }
        return prev;
      });
    }
    if (height !== undefined && height > 0) {
      setSize((prev) => {
        if (prev.h !== height) {
          return { ...prev, h: height };
        }
        return prev;
      });
    }
    if (data?.progress !== undefined) {
      setProgress(data.progress);
    }
    if (data?.progressMessage !== undefined) {
      setProgressMessage(data.progressMessage);
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage);
    }
    if (data?.textAlign !== undefined) setTextAlign(data.textAlign);
    if (data?.fontWeight !== undefined) setFontWeight(data.fontWeight);
    if (data?.fontStyle !== undefined) setFontStyle(data.fontStyle);
    if (data?.fontFamily !== undefined) setFontFamily(data.fontFamily);
  }, [data?.text, data?.title, data?.width, data?.height, data?.progress, data?.progressMessage, data?.errorMessage, data?.textAlign, data?.fontWeight, data?.fontStyle, data?.fontFamily, props]);

  // 点击编辑按钮进入编辑模式（文本内容）
  const handleEditClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setTimeout(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(
          textareaRef.current.value.length,
          textareaRef.current.value.length
        );
      }
    }, 0);
  }, []);

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.focus();
      if (titleInputRef.current) {
        titleInputRef.current.select();
      }
    }, 0);
  }, []);

  // 更新节点数据
  const updateNodeData = useCallback((updates: Partial<MinimalistTextNodeData>) => {
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
          if (updates.width !== undefined || updates.height !== undefined) {
            updatedNode.style = {
              ...(node.style || {}),
              width: updates.width !== undefined ? `${updates.width}px` : (node.style?.width || `${size.w}px`),
              height: updates.height !== undefined ? `${updates.height}px` : (node.style?.height || `${size.h}px`),
              minWidth: '280px',
              minHeight: '160px',
            };
          }
          
          return updatedNode;
        }
        return node;
      })
    );
  }, [id, setNodes, size]);

  // 处理尺寸变化（用户手动调整）
  const handleSizeChange = useCallback((newSize: { w: number; h: number }) => {
    setSize(newSize);
    // 使用 requestAnimationFrame 确保在下一帧更新，避免状态冲突
    requestAnimationFrame(() => {
      updateNodeData({ 
        width: newSize.w, 
        height: newSize.h,
        isUserResized: true, // 标记为用户手动调整
      });
    });
  }, [updateNodeData]);

  // 点击非编辑区域退出编辑模式
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isEditing && nodeRef.current && !nodeRef.current.contains(e.target as HTMLElement)) {
        setIsEditing(false);
        // 保存文本更改
        if (data?.text !== text) {
          updateNodeData({ text });
        }
      }
      if (isEditingTitle && nodeRef.current && !nodeRef.current.contains(e.target as HTMLElement)) {
        setIsEditingTitle(false);
        // 保存标题更改
        if (data?.title !== title) {
          updateNodeData({ title });
        }
      }
    };

    if (isEditing || isEditingTitle) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isEditing, isEditingTitle, text, title, data?.text, data?.title, updateNodeData]);

  // 复制到剪贴板
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setShowCopySuccess(true);
      setTimeout(() => {
        setShowCopySuccess(false);
      }, 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  }, [text]);


  // 处理文本变化（内容变化不影响尺寸，如果用户已经手动调整过）
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // 不修改尺寸，让内容区域滚动
  }, []);

  // 文本样式（对齐、加粗、斜体、字体）
  const textContentStyle = useMemo((): React.CSSProperties => ({
    textAlign,
    fontWeight,
    fontStyle,
    fontFamily: fontFamily || TEXT_FONT_OPTIONS[0].value,
  }), [textAlign, fontWeight, fontStyle, fontFamily]);

  const applyFormat = useCallback((key: 'textAlign' | 'fontWeight' | 'fontStyle' | 'fontFamily', value: string) => {
    if (key === 'textAlign') {
      setTextAlign(value as 'left' | 'center' | 'right');
      updateNodeData({ textAlign: value as 'left' | 'center' | 'right' });
    } else if (key === 'fontWeight') {
      const v = value as 'normal' | 'bold';
      setFontWeight(v);
      updateNodeData({ fontWeight: v });
    } else if (key === 'fontStyle') {
      const v = value as 'normal' | 'italic';
      setFontStyle(v);
      updateNodeData({ fontStyle: v });
    } else if (key === 'fontFamily') {
      setFontFamily(value);
      updateNodeData({ fontFamily: value });
    }
  }, [updateNodeData]);

  // 合并所有样式到一个对象中
  const nodeStyle = useMemo(() => {
    const baseStyle: React.CSSProperties = {
      width: size.w,
      height: size.h,
      minWidth: '280px',
      minHeight: '160px',
      userSelect: isResizing ? 'none' : 'auto',
      willChange: isResizing ? 'width, height' : 'auto',
      backfaceVisibility: isResizing ? 'hidden' : 'visible',
      transition: isResizing ? 'none' : 'background-color 0.2s, border-color 0.2s',
    };

    if (isEditing && !isDarkMode) {
      baseStyle.background = 'linear-gradient(#FFF8E7, #FFF8E7) padding-box, linear-gradient(135deg, #10b981, #34d399, #6ee7b7) border-box';
      baseStyle.border = '2px solid transparent';
    }

    return baseStyle;
  }, [size.w, size.h, isResizing, isEditing, isDarkMode, selected]);

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
    const nodeRight = xPos + size.w;
    const nodeBottom = yPos + size.h;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    if (intersects) return false;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    return distX > viewportWidth * 2 || distY > viewportHeight * 2;
  }, [performanceMode, selected, dragging, isResizing, vx, vy, zoom, xPos, yPos, size.w, size.h]);
  const showPlaceholder = isResizing || isHardFrozen;

  return (
    <div
      ref={nodeRef}
      style={nodeStyle}
        className={`custom-node-container group relative rounded-2xl p-4 overflow-visible flex flex-col ${
        isDarkMode 
          ? 'bg-[#1C1C1E]'
          : (isEditing ? 'bg-emerald-100/90' : 'apple-panel-light') /* 使用磨砂材质浅灰半透明背板 */
      } ${
        selected && !isResizing
          ? isDarkMode
            ? 'border-[1.5px] border-green-500 ring-2 ring-green-400/80 border-green-400/70'
            : 'border-[1.5px] border-green-500'
          : isDarkMode
            ? 'border border-gray-600/50'
            : ''
      } ${isResizing ? '!shadow-none !ring-0' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Handle type="source" position={Position.Right} id="output" className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
      {showPlaceholder ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
            {isHardFrozen ? `${title || 'text'}（冻结）` : (title || 'text')}
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
                setTitle(data?.title || 'text');
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
            autoFocus
          />
        ) : (
          <span
            onClick={handleTitleDoubleClick}
            className={`font-bold text-xs cursor-pointer select-none ${
              isDarkMode ? 'text-white/80' : 'text-gray-900'
            } hover:opacity-70 transition-opacity`}
          >
            {title || 'text'}
          </span>
        )}
      </div>

      {/* 模块内右上角复制按钮 */}
      {/* 复制成功后显示勾标记，否则显示复制按钮 */}
      {selected && !isEditing && (
        <button
          onClick={handleCopy}
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

      {/* 复制成功提示 */}
      {showCopySuccess && (
        <div className="absolute top-12 right-2 apple-panel px-2 py-1 rounded text-xs text-white/80 z-20 animate-fade-in">
          已复制
        </div>
      )}

      {/* 文本内容 */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
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
        ) : isEditing ? (
          // 编辑模式：显示 textarea
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            className={`nodrag drag-handle-area custom-scrollbar w-full h-full bg-transparent resize-none outline-none flex-1 overflow-auto ${
              isDarkMode 
                ? 'text-white placeholder:text-white/40' 
                : 'text-gray-900 placeholder:text-gray-400'
            }`}
            placeholder="输入文本..."
            style={{ 
              caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
              ...textContentStyle,
            }}
            onBlur={() => {
              setIsEditing(false);
              if (data?.text !== text) {
                updateNodeData({ text }, true);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIsEditing(false);
                setText(data?.text || '');
              }
            }}
            autoFocus
          />
        ) : (
          <div 
            className={`drag-handle-area custom-scrollbar w-full h-full flex items-center overflow-auto p-2 relative flex-1 ${
              textAlign === 'left' ? 'justify-start' : textAlign === 'right' ? 'justify-end' : 'justify-center'
            }`}
            style={{ cursor: 'default' }}
          >
            {text ? (
              <>
                <p className={`break-words whitespace-pre-wrap ${
                  isDarkMode ? 'text-white/80' : 'text-gray-900'
                }`} style={{ 
                  maxWidth: '100%',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  ...textContentStyle,
                }}>
                  {text}
                </p>
                {/* 左下角编辑按钮（仅在有文本时显示） */}
                <button
                  onClick={handleEditClick}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  className={`nodrag absolute bottom-2 left-2 p-1.5 rounded-lg transition-all z-[100] ${
                    isDarkMode 
                      ? 'apple-panel hover:bg-white/20' 
                      : 'apple-panel-light hover:bg-gray-200/30'
                  }`}
                  title="编辑文本"
                  style={{ pointerEvents: 'all' }}
                  type="button"
                >
                  <Pencil className={`w-4 h-4 ${
                    isDarkMode ? 'text-white/80' : 'text-gray-700'
                  }`} />
                </button>
              </>
            ) : (
              // 没有内容时，显示编辑按钮
              <button
                onClick={handleEditClick}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                className={`nodrag flex flex-col items-center justify-center gap-2 px-6 py-4 rounded-lg transition-all ${
                  isDarkMode
                    ? 'bg-white/10 hover:bg-white/20 border border-white/20 text-white/80'
                    : 'bg-gray-200/80 hover:bg-gray-300/80 border border-gray-300/60 text-gray-700'
                }`}
                type="button"
              >
                <Pencil className={`w-5 h-5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
                <span className="text-sm font-medium">点击编辑</span>
              </button>
            )}
          </div>
        )}

        {/* 下方操作区：对齐、加粗、斜体、字体 */}
        {!errorMessage && (
          <div
            className={`nodrag flex items-center gap-2 flex-wrap pt-2 mt-2 border-t ${
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
      </div>
      </>
      )}
    </div>
  );
};
