import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStoreApi, useStore } from 'reactflow';
import { Upload, Loader2, Scissors, Eraser, Pencil, RotateCcw } from 'lucide-react';
import { ModuleProgressBar } from './ModuleProgressBar';
import { mapProjectPath } from '../../utils/pathMapper';

interface ImageNodeData {
  width?: number;
  height?: number;
  outputImage?: string;
  localPath?: string; // 本地文件路径（用于 fallback）
  originalImageUrl?: string; // 原始远程 URL（用于 fallback）
  title?: string;
  prompt?: string;
  resolution?: string;
  aspectRatio?: string;
  inputImages?: string[]; // 输入的参考图数组（最多10张）
  progress?: number; // 图片生成进度 0-100
  progressMessage?: string; // 进度状态文案
  errorMessage?: string; // 错误信息
  /** 参考图标记笔画（图生图时便于模型理解意图），归一化坐标 0-1 */
  imageDrawStrokes?: { color: string; points: { x: number; y: number }[] }[];
}

interface ImageNodeProps extends NodeProps<ImageNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
  projectId?: string; // 项目ID，用于路径映射
  /** 抠图/去水印完成后回调，用于将结果加入任务列表 */
  onAuxImageTaskComplete?: (params: { nodeId: string; type: 'matting' | 'watermark'; imageUrl: string }) => void;
}

// 格式化图片路径：统一转换为 local-resource:// 协议
const formatImagePath = (path: string): string => {
  if (!path) return '';
  // 如果是 HTTP/HTTPS URL，直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  // 如果是 data: URL，直接返回
  if (path.startsWith('data:')) {
    return path;
  }
  // 如果已经是 local-resource:// 格式，直接返回（协议处理器会自己处理解码）
  if (path.startsWith('local-resource://')) {
    return path;
  }
  // 移除可能存在的协议头，统一转换
  const cleanPath = path.replace(/^(file:\/\/|local-resource:\/\/)/, '');
  // 转换为 local-resource:// 协议，并将反斜杠替换为正斜杠
  // 注意：不要对整个路径编码，只对中文和空格部分编码，盘符的冒号必须保持原样
  let normalizedPath = cleanPath.replace(/\\/g, '/');
  
  // 修复盘符格式：如果路径是 "c/Users" 格式（缺少冒号），修正为 "C:/Users"
  // 这是关键修复：确保盘符格式正确
  if (normalizedPath.match(/^([a-zA-Z])\//)) {
    normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.substring(1);
  }
  
  // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
    normalizedPath = normalizedPath.substring(1); // 移除开头的 /
  }
  
  // 只对路径中的中文和空格部分进行编码，保留盘符的冒号
  // 分段处理，但不对盘符部分（如 C:）编码
  const pathParts = normalizedPath.split('/');
  const encodedParts = pathParts.map((part, index) => {
    // 如果是第一段且是 Windows 盘符（如 C:），不编码
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) {
      return part;
    }
    // 其他部分：只对包含中文或空格的部分进行编码
    if (/[\u4e00-\u9fa5\s]/.test(part)) {
      // 包含中文或空格，需要编码
      return encodeURIComponent(part);
    }
    // 不包含中文或空格，保持原样
    return part;
  });
  const encodedPath = encodedParts.join('/');
  
  return `local-resource://${encodedPath}`;
};

/** Electron 下 <img> 对 local-resource:// 流式响应可能加载失败，改为 file:// 提升可靠性（与 VideoPreview 一致） */
function getImageDisplaySrc(formattedUrl: string): string {
  if (!formattedUrl?.startsWith('local-resource://') || !(typeof window !== 'undefined' && (window as any).electronAPI)) {
    return formattedUrl;
  }
  try {
    const pathPart = formattedUrl.replace(/^local-resource:\/\/+/, '');
    const decoded = decodeURIComponent(pathPart);
    const normalized = decoded.replace(/\\/g, '/');
    return normalized ? `file:///${normalized}` : formattedUrl;
  } catch {
    return formattedUrl;
  }
}

const VIEWPORT_PADDING = 280;

const ImageNodeComponent: React.FC<ImageNodeProps> = (props) => {
  // 解构出 React Flow 专有属性，避免透传给 DOM
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode = false,
    onDataChange,
    onAuxImageTaskComplete,
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
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const store = useStoreApi();
  // 最小/最大尺寸约束（拉得过大易触发 Chromium 崩溃 -2147483645，必须封顶）
  const MIN_WIDTH = 369.46;
  const MIN_HEIGHT = 211.12;
  const MAX_WIDTH = 2048;
  const MAX_HEIGHT = 2048;
  const clampW = (v: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
  const clampH = (v: number) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, v));

  const [size, setSize] = useState({
    w: clampW(data?.width ?? MIN_WIDTH),
    h: clampH(data?.height ?? MIN_HEIGHT),
  });
  const [isResizing, setIsResizing] = useState(false);
  const [outputImage, setOutputImage] = useState(data?.outputImage || '');
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(data?.originalImageUrl || null); // 用于 fallback 的远程 URL
  const [title, setTitle] = useState(data?.title || 'image');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [progress, setProgress] = useState(data?.progress || 0);
  const [progressMessage, setProgressMessage] = useState(data?.progressMessage || '');
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  const [isMattingLoading, setIsMattingLoading] = useState(false);
  const [isWatermarkRemovalLoading, setIsWatermarkRemovalLoading] = useState(false);
  /** 参考图标记：笔画列表（归一化 0-1），与 data.imageDrawStrokes 同步 */
  const [drawStrokes, setDrawStrokes] = useState<{ color: string; points: { x: number; y: number }[] }[]>(data?.imageDrawStrokes ?? []);
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [imgDisplayRect, setImgDisplayRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  /** 原图 URL，用于「复原」始终还原到加载/设定时的原图 */
  const [originalImageForRestore, setOriginalImageForRestore] = useState<string | null>(null);
  const [showColorDropdown, setShowColorDropdown] = useState(false);
  const colorDropdownRef = useRef<HTMLDivElement>(null);
  const colorDropdownPanelRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; bottom: number } | null>(null);
  /** 画笔是否激活：未激活为灰色，点击后点亮才能绘制 */
  const [brushActive, setBrushActive] = useState(false);

  const nodeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** 避免 onLoad 触发的 updateNodeData/updateNodeInternals 导致重复调整尺寸、形成死循环 */
  const lastOnLoadSrcRef = useRef<string | null>(null);
  /** 尺寸对比锁：已对该 src 应用过的 (w,h)，避免重渲染后再次 onLoad 时重复调用 updateNodeData */
  const lastAppliedSizeRef = useRef<{ srcKey: string; w: number; h: number } | null>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // 双层 Canvas：base 仅存历史笔画，active 仅做当前笔画实时预览
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);
  const drawFrameRafRef = useRef<number | null>(null);
  const pendingPointsRef = useRef<{ x: number; y: number }[]>([]);
  const currentStrokeColorRef = useRef(drawColor);
  const drawColorRef = useRef(drawColor);
  const drawStrokesRef = useRef(drawStrokes);
  const transform = useStore((s) => s.transform);

  // 更新节点数据（需在下方 useEffect 之前定义，避免 TDZ）
  const updateNodeData = useCallback((updates: Partial<ImageNodeData>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...updates,
              },
            }
          : node
      )
    );
    if (updates.outputImage !== undefined && onDataChange) {
      onDataChange(id, { outputImage: updates.outputImage });
    }
  }, [id, setNodes, onDataChange]);

  // 同步外部数据变化
  useEffect(() => {
    if (data?.width !== undefined && data.width > 0) {
      const w = clampW(data.width);
      setSize((prev) => {
        if (prev.w !== w) return { ...prev, w };
        return prev;
      });
      if (nodeRef.current) nodeRef.current.style.width = `${w}px`;
    }
    if (data?.height !== undefined && data.height > 0) {
      const h = clampH(data.height);
      setSize((prev) => {
        if (prev.h !== h) return { ...prev, h };
        return prev;
      });
      if (nodeRef.current) nodeRef.current.style.height = `${h}px`;
    }
    if (data?.outputImage !== undefined) {
      const formattedPath = formatImagePath(data.outputImage);
      if (outputImage !== formattedPath) {
        lastOnLoadSrcRef.current = null;
        lastAppliedSizeRef.current = null;
        setOutputImage(formattedPath);
        setOriginalImageForRestore(formattedPath);
        if (data?.imageDrawStrokes !== undefined) {
          setDrawStrokes(data.imageDrawStrokes);
        } else {
          setDrawStrokes([]);
          updateNodeData({ imageDrawStrokes: [] });
        }
      } else if (formattedPath && originalImageForRestore === null) {
        setOriginalImageForRestore(formattedPath);
      }
    }
    if (data?.title !== undefined) {
      setTitle(data.title);
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
    if (data?.imageDrawStrokes !== undefined) {
      setDrawStrokes(data.imageDrawStrokes);
    }
  }, [data?.width, data?.height, data?.outputImage, data?.title, data?.progress, data?.progressMessage, data?.errorMessage, data?.imageDrawStrokes, outputImage, updateNodeData, originalImageForRestore]);

  // 测量图片在容器内的显示区域（用于画布叠层定位）
  const measureImgRect = useCallback(() => {
    const wrapper = imgContainerRef.current;
    const img = imgRef.current;
    if (!wrapper || !img || !outputImage) return;
    const wr = wrapper.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    setImgDisplayRect({
      left: ir.left - wr.left + wrapper.scrollLeft,
      top: ir.top - wr.top + wrapper.scrollTop,
      width: ir.width,
      height: ir.height,
    });
  }, [outputImage]);

  useEffect(() => {
    drawStrokesRef.current = drawStrokes;
  }, [drawStrokes]);

  useEffect(() => {
    drawColorRef.current = drawColor;
  }, [drawColor]);

  // 平滑绘制：使用二次贝塞尔曲线连接中点
  const drawSmoothStroke = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      points: { x: number; y: number }[],
      color: string,
      w: number,
      h: number
    ) => {
      if (points.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, w * 0.008);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(points[0].x * w, points[0].y * h);
      if (points.length === 2) {
        ctx.lineTo(points[1].x * w, points[1].y * h);
      } else {
        for (let i = 1; i < points.length - 1; i += 1) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const midX = ((p1.x + p2.x) * 0.5) * w;
          const midY = ((p1.y + p2.y) * 0.5) * h;
          ctx.quadraticCurveTo(p1.x * w, p1.y * h, midX, midY);
        }
        const last = points[points.length - 1];
        ctx.lineTo(last.x * w, last.y * h);
      }
      ctx.stroke();
    },
    []
  );

  // 仅重绘历史层（base canvas）
  const redrawCanvas = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    if (!baseCanvas || !imgDisplayRect || imgDisplayRect.width <= 0 || imgDisplayRect.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const setupCanvas = (canvas: HTMLCanvasElement) => {
      canvas.width = imgDisplayRect.width * dpr;
      canvas.height = imgDisplayRect.height * dpr;
      canvas.style.width = `${imgDisplayRect.width}px`;
      canvas.style.height = `${imgDisplayRect.height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      return ctx;
    };
    const baseCtx = setupCanvas(baseCanvas);
    if (!baseCtx) return;
    baseCtx.clearRect(0, 0, imgDisplayRect.width, imgDisplayRect.height);
    const w = imgDisplayRect.width;
    const h = imgDisplayRect.height;
    drawStrokesRef.current.forEach((stroke) => {
      drawSmoothStroke(baseCtx, stroke.points, stroke.color, w, h);
    });
  }, [imgDisplayRect, drawSmoothStroke]);

  // 仅重绘当前实时预览层（active canvas）
  const redrawActiveCanvas = useCallback(() => {
    const activeCanvas = activeCanvasRef.current;
    if (!activeCanvas || !imgDisplayRect || imgDisplayRect.width <= 0 || imgDisplayRect.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    activeCanvas.width = imgDisplayRect.width * dpr;
    activeCanvas.height = imgDisplayRect.height * dpr;
    activeCanvas.style.width = `${imgDisplayRect.width}px`;
    activeCanvas.style.height = `${imgDisplayRect.height}px`;
    const ctx = activeCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, imgDisplayRect.width, imgDisplayRect.height);
    if (currentStrokeRef.current.length >= 2) {
      drawSmoothStroke(ctx, currentStrokeRef.current, currentStrokeColorRef.current, imgDisplayRect.width, imgDisplayRect.height);
    }
  }, [imgDisplayRect, drawSmoothStroke]);

  useEffect(() => {
    return () => {
      if (drawFrameRafRef.current !== null) {
        cancelAnimationFrame(drawFrameRafRef.current);
        drawFrameRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!imgDisplayRect) return;
    redrawCanvas();
  }, [imgDisplayRect, redrawCanvas]);

  useEffect(() => {
    redrawCanvas();
  }, [drawStrokes, redrawCanvas]);

  // 激活画笔后强制刷新叠层定位与重绘，避免依赖 onLoad 时机导致无法绘制
  useEffect(() => {
    if (!brushActive || !selected || !outputImage || isResizing) return;
    const rafId = requestAnimationFrame(() => {
      measureImgRect();
      redrawCanvas();
    });
    return () => cancelAnimationFrame(rafId);
  }, [brushActive, selected, outputImage, isResizing, size.w, size.h, measureImgRect, redrawCanvas]);

  // 某些场景图片已缓存完成但不再触发 onLoad，需要主动测量一次显示区域
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !outputImage) return;
    if (img.complete && img.naturalWidth > 0 && !isResizing) {
      measureImgRect();
    }
  }, [outputImage, size.w, size.h, isResizing, measureImgRect]);

  // 将笔画持久化到节点 data
  const persistStrokes = useCallback((strokes: { color: string; points: { x: number; y: number }[] }[]) => {
    drawStrokesRef.current = strokes;
    setDrawStrokes(strokes);
    updateNodeData({ imageDrawStrokes: strokes });
  }, [updateNodeData]);

  // 原生指针事件监听：绘制过程完全脱离 React state，避免 move 时组件重渲染
  useEffect(() => {
    const canvas = activeCanvasRef.current;
    if (!canvas || !selected || !brushActive || isResizing || !imgDisplayRect) return;

    const toNormalized = (evt: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (evt.clientX - rect.left) / rect.width;
      const y = (evt.clientY - rect.top) / rect.height;
      return { x, y };
    };

    const flushFrame = () => {
      if (drawFrameRafRef.current !== null) return;
      drawFrameRafRef.current = requestAnimationFrame(() => {
        drawFrameRafRef.current = null;
        if (!isDrawingRef.current) return;
        if (pendingPointsRef.current.length > 0) {
          currentStrokeRef.current.push(...pendingPointsRef.current);
          pendingPointsRef.current = [];
        }
        redrawActiveCanvas();
      });
    };

    const finishStroke = () => {
      if (!isDrawingRef.current) return;
      if (drawFrameRafRef.current !== null) {
        cancelAnimationFrame(drawFrameRafRef.current);
        drawFrameRafRef.current = null;
      }
      if (pendingPointsRef.current.length > 0) {
        currentStrokeRef.current.push(...pendingPointsRef.current);
        pendingPointsRef.current = [];
      }
      isDrawingRef.current = false;
      if (currentStrokeRef.current.length >= 2) {
        const stroke = { color: currentStrokeColorRef.current, points: [...currentStrokeRef.current] };
        const next = [...drawStrokesRef.current, stroke];
        persistStrokes(next);
        redrawCanvas();
      }
      currentStrokeRef.current = [];
      pendingPointsRef.current = [];
      redrawActiveCanvas();
    };

    const onPointerDown = (evt: PointerEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      canvas.setPointerCapture?.(evt.pointerId);
      const p = toNormalized(evt);
      isDrawingRef.current = true;
      currentStrokeRef.current = [p];
      currentStrokeColorRef.current = drawColorRef.current;
      pendingPointsRef.current = [];
      redrawActiveCanvas();
    };

    const onPointerMove = (evt: PointerEvent) => {
      if (!isDrawingRef.current) return;
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      pendingPointsRef.current.push(toNormalized(evt));
      flushFrame();
    };

    const onPointerUp = (evt: PointerEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      finishStroke();
    };

    const onPointerLeave = () => {
      finishStroke();
    };

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onPointerUp, { passive: false });
    canvas.addEventListener('pointerleave', onPointerLeave, { passive: false });

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [selected, brushActive, isResizing, imgDisplayRect, redrawActiveCanvas, redrawCanvas, persistStrokes]);

  // 容器尺寸变化时重新测量图片位置
  useEffect(() => {
    const el = imgContainerRef.current;
    if (!el || !outputImage) return;
    const ro = new ResizeObserver(() => measureImgRect());
    ro.observe(el);
    return () => ro.disconnect();
  }, [outputImage, measureImgRect]);

  // 打开下拉时测量触发按钮位置，用于 Portal 定位
  useEffect(() => {
    if (!showColorDropdown || !colorDropdownRef.current) return;
    const rect = colorDropdownRef.current.getBoundingClientRect();
    setDropdownPosition({ left: rect.left, bottom: window.innerHeight - rect.top });
  }, [showColorDropdown]);

  // 点击外部关闭颜色下拉（Portal 面板在 body，需同时排除触发按钮与下拉面板）
  useEffect(() => {
    if (!showColorDropdown) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = colorDropdownRef.current?.contains(target);
      const inPanel = colorDropdownPanelRef.current?.contains(target);
      if (!inTrigger && !inPanel) setShowColorDropdown(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showColorDropdown]);

  const DRAW_COLOR_OPTIONS = [
    { label: '红色', value: '#ef4444' },
    { label: '橙色', value: '#f97316' },
    { label: '黄色', value: '#eab308' },
    { label: '绿色', value: '#22c55e' },
    { label: '蓝色', value: '#3b82f6' },
    { label: '紫色', value: '#a855f7' },
    { label: '白色', value: '#ffffff' },
    { label: '黑色', value: '#000000' },
  ];

  // 应用：将当前图 + 笔画融合为新图并覆盖；保存当前图为复原用
  const handleApplyMerge = useCallback(() => {
    const img = imgRef.current;
    if (!img || !outputImage || img.naturalWidth === 0) return;
    const strokes = drawStrokes;
    if (strokes.length === 0) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const lineW = Math.max(2, w * 0.008);
    strokes.forEach((stroke) => {
      if (stroke.points.length < 2) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = lineW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);
      stroke.points.slice(1).forEach((p) => ctx.lineTo(p.x * w, p.y * h));
      ctx.stroke();
    });
    try {
      const dataUrl = canvas.toDataURL('image/png');
      setOutputImage(dataUrl);
      setDrawStrokes([]);
      updateNodeData({ outputImage: dataUrl, imageDrawStrokes: [] });
    } catch (e) {
      console.error('[ImageNode] 融合导出失败', e);
    }
  }, [outputImage, drawStrokes, updateNodeData]);

  // 复原：还原到原图（加载/设定时的图片）；无原图时仅清空笔画
  const handleRestore = useCallback(() => {
    if (originalImageForRestore != null) {
      setOutputImage(originalImageForRestore);
      setDrawStrokes([]);
      updateNodeData({ outputImage: originalImageForRestore, imageDrawStrokes: [] });
    } else {
      setDrawStrokes([]);
      updateNodeData({ imageDrawStrokes: [] });
    }
  }, [originalImageForRestore, updateNodeData]);

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, []);

  // 处理尺寸变化（强制夹在 MIN/MAX 之间，防止极端尺寸导致崩溃）
  const handleSizeChange = useCallback((newSize: { w: number; h: number }) => {
    const clamped = { w: clampW(newSize.w), h: clampH(newSize.h) };
    setSize(clamped);
    updateNodeData({ width: clamped.w, height: clamped.h });
  }, [updateNodeData]);

  // 图片上传处理
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleUploadImage = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    console.log('[ImageNode] 点击上传按钮，fileInputRef.current:', fileInputRef.current);
    if (fileInputRef.current) {
      fileInputRef.current.click();
      console.log('[ImageNode] 已触发文件选择对话框');
    } else {
      console.error('[ImageNode] fileInputRef.current 为 null');
    }
  }, []);
  
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log('[ImageNode] 文件选择事件触发，文件:', file);
    
    if (!file) {
      console.warn('[ImageNode] 未选择文件');
      return;
    }
    
    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      console.error('[ImageNode] 只能上传图片文件，当前文件类型:', file.type);
      return;
    }
    
    console.log('[ImageNode] 开始读取文件:', file.name, '类型:', file.type, '大小:', file.size);
    
    // 读取文件并转换为 data URL
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      console.log('[ImageNode] 文件读取成功，data URL 长度:', dataUrl?.length);
      
      if (dataUrl) {
        // 更新本地状态，立即显示图片
        setOutputImage(dataUrl);
        console.log('[ImageNode] 已更新本地状态 outputImage');
        
        // 更新节点数据，显示上传的图片
        updateNodeData({ outputImage: dataUrl });
        console.log('[ImageNode] 已调用 updateNodeData');
        
        // 保持最小尺寸，同时按图像比例匹配模块外形
        const img = new Image();
        img.onload = () => {
          const iw = img.naturalWidth || 1;
          const ih = img.naturalHeight || 1;
          const scale = Math.max(MIN_WIDTH / iw, MIN_HEIGHT / ih);
          const w = Math.round(iw * scale);
          const h = Math.round(ih * scale);
          setSize({ w, h });
          updateNodeData({ width: w, height: h });
        };
        img.onerror = (error) => {
          console.error('[ImageNode] 图片加载失败:', error);
        };
        img.src = dataUrl;
      } else {
        console.error('[ImageNode] data URL 为空');
      }
    };
    reader.onerror = (error) => {
      console.error('[ImageNode] 读取文件失败:', error);
    };
    reader.readAsDataURL(file);
    
    // 清空 input，允许重复上传同一文件
    e.target.value = '';
  }, [updateNodeData]);

  // 防御性 style 合并：baseStyle + 可选 filter，确保无 undefined 等非法值导致渲染引擎异常
  const baseStyle: React.CSSProperties = {
    width: size.w,
    height: size.h,
    minWidth: '369.46px',
    minHeight: '211.12px',
    userSelect: isResizing ? 'none' : 'auto',
    willChange: isResizing ? 'width, height' : 'auto',
    backfaceVisibility: isResizing ? 'hidden' : 'visible',
    transition: isResizing ? 'none' : 'background-color 0.2s, border-color 0.2s',
  };
  const combinedStyle: React.CSSProperties = baseStyle;

  const zoom = transform?.[2] ?? 1;
  const vx = transform?.[0] ?? 0;
  const vy = transform?.[1] ?? 0;
  const isInViewport = useMemo(() => {
    const left = -vx / zoom - VIEWPORT_PADDING / zoom;
    const top = -vy / zoom - VIEWPORT_PADDING / zoom;
    const right = -vx / zoom + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom + VIEWPORT_PADDING / zoom;
    const bottom = -vy / zoom + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom + VIEWPORT_PADDING / zoom;
    return !((xPos + size.w) < left || xPos > right || (yPos + size.h) < top || yPos > bottom);
  }, [vx, vy, zoom, xPos, yPos, size.w, size.h]);
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
  const shouldRenderImage = !isHardFrozen && (selected || dragging || isResizing || isInViewport);
  const showPlaceholder = isResizing || isHardFrozen;

  return (
    <>
      <div
        ref={nodeRef}
        style={combinedStyle}
        className={`custom-node-container group relative rounded-2xl p-4 overflow-visible ${
          isDarkMode
            ? 'bg-[#1C1C1E]'
            : 'apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
        } ${selected && isDarkMode && !isResizing ? 'ring-2 ring-green-400/80 border-green-400/70' : ''} ${isResizing ? '!shadow-none !ring-0' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Handle 必须始终渲染，否则连线会断；有图片时输出 Handle 始终可见便于连接 */}
        <Handle type="target" position={Position.Left} id="image-input" className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
        <Handle type="source" position={Position.Right} id="output" style={{ top: '50%', right: 0, transform: 'translateY(-50%)' }} className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered || outputImage) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
        {showPlaceholder ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
              {isHardFrozen ? `${title || 'image'}（冻结）` : (title || 'image')}
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
                  setTitle(data?.title || 'image');
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
              {title || 'image'}
            </span>
          )}
        </div>

        {/* 全模块覆盖进度条（生成中时覆盖整个节点顶层） */}
        <ModuleProgressBar
          visible={progress > 0}
          progress={progress}
          borderRadius={16}
          onFadeComplete={() => updateNodeData({ progress: 0 })}
        />

        {/* 模块内右上角图片上传按钮 */}
        {selected && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="上传图片"
              onChange={handleFileChange}
              onClick={(e) => {
                // 确保点击事件不会冒泡到 React Flow
                e.stopPropagation();
              }}
              className="hidden"
              style={{ display: 'none' }}
            />
            <button
              onClick={handleUploadImage}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              className={`nodrag absolute top-2 right-2 p-1.5 rounded-lg transition-all z-10 ${
                isDarkMode 
                  ? 'apple-panel hover:bg-white/20' 
                  : 'apple-panel-light hover:bg-gray-200/30'
              }`}
              title="上传图片"
              style={{ pointerEvents: 'all' }}
              type="button"
            >
              <Upload className={`w-3.5 h-3.5 ${
                isDarkMode ? 'text-white/80' : 'text-gray-700'
              }`} />
            </button>
          </>
        )}

        {/* 颜色/画笔/应用/复原：整个图片模块框外、上方居中 */}
        {selected && (
          <div
            className="nodrag nopan absolute -top-14 left-0 right-0 flex justify-center gap-1.5 z-10"
            style={{ pointerEvents: 'all' }}
          >
            <div className="relative" ref={colorDropdownRef}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowColorDropdown((v) => !v); }}
                className={`flex items-center gap-1.5 min-w-[72px] px-2 py-1.5 rounded-lg text-xs font-medium border ${isDarkMode ? 'bg-white/15 border-white/20 text-white' : 'bg-black/10 border-black/20 text-gray-800'}`}
                title="画笔颜色"
                aria-label="画笔颜色"
                aria-haspopup="listbox"
              >
                <span
                  className="w-4 h-4 rounded border border-white/40 shrink-0"
                  style={{ backgroundColor: drawColor }}
                />
                <span>{DRAW_COLOR_OPTIONS.find((o) => o.value === drawColor)?.label ?? '红'}</span>
                <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${showColorDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showColorDropdown && dropdownPosition && createPortal(
                <div
                  ref={colorDropdownPanelRef}
                  role="listbox"
                  aria-label="画笔颜色"
                  className="fixed p-2 rounded-xl shadow-xl border bg-[#1C1C1E] border-white/15"
                  style={{ left: dropdownPosition.left, bottom: dropdownPosition.bottom + 4 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex flex-nowrap gap-1.5">
                    {DRAW_COLOR_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        role="option"
                        type="button"
                        onClick={() => { setDrawColor(opt.value); setShowColorDropdown(false); }}
                        className={`w-7 h-7 rounded-lg border-2 shrink-0 transition-transform hover:scale-105 ${drawColor === opt.value ? 'border-white ring-2 ring-offset-1 ring-offset-black/50 ring-white/60' : 'border-transparent'}`}
                        style={{ backgroundColor: opt.value }}
                        title={opt.label}
                        aria-label={opt.label}
                      />
                    ))}
                  </div>
                </div>,
                document.body
              )}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setBrushActive((v) => !v); }}
              title={brushActive ? '点击关闭画笔' : '点击激活画笔后可绘制'}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${brushActive ? (isDarkMode ? 'bg-green-500/30 ring-2 ring-green-400/60 text-green-300' : 'bg-green-500/40 ring-2 ring-green-600/70 text-green-700') : (isDarkMode ? 'bg-white/10 text-white/40' : 'bg-black/10 text-gray-400')}`}
              aria-label={brushActive ? '画笔已激活' : '激活画笔'}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleApplyMerge(); }}
              disabled={drawStrokes.length === 0}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-black/15 hover:bg-black/25 text-gray-800'}`}
              title="将当前标记融合到图片并覆盖"
            >
              应用
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleRestore(); }}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium ${isDarkMode ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-black/15 hover:bg-black/25 text-gray-800'}`}
              title={originalImageForRestore != null ? '还原到原图' : '清空标记'}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              复原
            </button>
          </div>
        )}

        {/* 图片内容显示区域：运行中由全模块进度条遮罩覆盖，再显示结果/错误/占位；缩放时隐藏高清图仅显示轮廓以提升性能 */}
        <div className="custom-scrollbar relative w-full h-full flex flex-col items-center overflow-auto p-2 min-h-0">
          {outputImage ? (
            <>
              <div ref={imgContainerRef} className="relative flex items-center justify-center min-w-0 min-h-0 flex-1">
              {isResizing ? (
                <div className={`w-full h-full min-h-[80px] rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-white/10' : 'bg-black/10'}`} />
              ) : (
              <>
              {shouldRenderImage ? (
              <img
                ref={imgRef}
                key={outputImage}
                src={getImageDisplaySrc(formatImagePath(outputImage))}
                alt="Generated"
                draggable={false}
                className="max-w-full max-h-full object-contain rounded-lg select-none"
                style={performanceMode ? { imageRendering: 'crisp-edges' } : undefined}
              onLoad={(e) => {
                const img = e.currentTarget;
                const srcKey = outputImage || img.src || '';
                // 同一张图只做一次尺寸调整，避免 updateNodeData/updateNodeInternals 导致重渲染再次触发 onLoad 形成死循环
                if (lastOnLoadSrcRef.current === srcKey) return;
                lastOnLoadSrcRef.current = srcKey;

                console.log('[ImageNode] 图片加载成功:', {
                  originalUrl: outputImage,
                  formattedUrl: formatImagePath(outputImage),
                  actualSrc: img.src,
                });
                if (fallbackUrl) setFallbackUrl(null);
                // 根据图片实际尺寸调整节点大小：保持最小尺寸，同时按图像比例匹配模块外形
                const imgWidth = img.naturalWidth;
                const imgHeight = img.naturalHeight;
                if (imgWidth > 0 && imgHeight > 0) {
                  const scale = Math.max(MIN_WIDTH / imgWidth, MIN_HEIGHT / imgHeight);
                  const newWidth = Math.round(imgWidth * scale);
                  const newHeight = Math.round(imgHeight * scale);
                  const currentW = data?.width ?? size.w;
                  const currentH = data?.height ?? size.h;
                  const eps = 1;
                  const sizeUnchanged = Math.abs(newWidth - currentW) < eps && Math.abs(newHeight - currentH) < eps;
                  const alreadyApplied = lastAppliedSizeRef.current?.srcKey === srcKey &&
                    Math.abs(lastAppliedSizeRef.current.w - newWidth) < eps &&
                    Math.abs(lastAppliedSizeRef.current.h - newHeight) < eps;
                  if (sizeUnchanged || alreadyApplied) return;
                  lastAppliedSizeRef.current = { srcKey, w: newWidth, h: newHeight };
                  setSize({ w: newWidth, h: newHeight });
                  updateNodeData({ width: newWidth, height: newHeight });
                  if (nodeRef.current) {
                    nodeRef.current.style.width = `${newWidth}px`;
                    nodeRef.current.style.height = `${newHeight}px`;
                  }
                  updateNodeInternals(id);
                }
                measureImgRect();
              }}
              onError={async (e) => {
                // 图片加载失败时，检查是否有本地文件路径可以回退
                const img = e.currentTarget;
                const src = img.src;
                const originalUrl = outputImage;
                
                console.error('[ImageNode] 图片加载失败:', {
                  originalUrl,
                  formattedUrl: formatImagePath(outputImage),
                  actualSrc: src,
                  isLocalResource: originalUrl.startsWith('local-resource://'),
                });
                
                // 如果当前使用的是 local-resource://，尝试检查文件是否存在
                if (originalUrl.startsWith('local-resource://') && window.electronAPI) {
                  try {
                    const checkResult = await window.electronAPI.checkFileExists(originalUrl);
                    console.error('[ImageNode] 文件系统检查结果（通过 fs.stat）:', {
                      url: originalUrl,
                      exists: checkResult.exists,
                      readable: checkResult.readable,
                      size: checkResult.size,
                      path: checkResult.path,
                      error: checkResult.error,
                    });
                    
                    if (!checkResult.exists || !checkResult.readable) {
                      console.error('[ImageNode] 本地文件不存在或不可读，详细信息:', {
                        url: originalUrl,
                        decodedPath: checkResult.path,
                        exists: checkResult.exists,
                        readable: checkResult.readable,
                        size: checkResult.size,
                        error: checkResult.error,
                      });
                      // 如果有 fallback URL，尝试使用它
                      if (fallbackUrl) {
                        console.log('[ImageNode] 使用 fallback URL:', fallbackUrl);
                        img.src = fallbackUrl;
                        return;
                      }
                      // 显示错误占位符
                      img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ccc" width="100" height="100"/%3E%3Ctext x="50" y="50" text-anchor="middle" dy=".3em" fill="%23999"%3E图片加载失败%3C/text%3E%3C/svg%3E';
                      return;
                    }
                  } catch (error) {
                    console.error('[ImageNode] 检查文件失败，异常信息:', error);
                    // 如果有 fallback URL，尝试使用它
                    if (fallbackUrl) {
                      console.log('[ImageNode] 检查失败，使用 fallback URL:', fallbackUrl);
                      img.src = fallbackUrl;
                      return;
                    }
                  }
                }
                
                // 如果当前使用的是远程URL（OSS），尝试检查是否有本地文件
                if (
                  (src.includes('oss-cn-hongkong.aliyuncs.com') ||
                   src.includes('oss-us-west-1.aliyuncs.com') ||
                   src.includes('aliyuncs.com') ||
                   src.startsWith('http://') ||
                   src.startsWith('https://')) &&
                  !src.includes('_retry=')
                ) {
                  console.log(`[ImageNode] 图片加载失败，1.5秒后重试:`, src);
                  setTimeout(() => {
                    const separator = src.includes('?') ? '&' : '?';
                    img.src = `${src}${separator}_retry=${Date.now()}`;
                  }, 1500);
                } else {
                  // 显示错误占位符
                  img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ccc" width="100" height="100"/%3E%3Ctext x="50" y="50" text-anchor="middle" dy=".3em" fill="%23999"%3E图片加载失败%3C/text%3E%3C/svg%3E';
                }
              }}
            />
              ) : (
                <div className={`w-full h-full min-h-[80px] rounded-lg flex items-center justify-center text-xs ${isDarkMode ? 'bg-white/10 text-white/50' : 'bg-black/10 text-gray-500'}`}>
                  视口外暂停加载
                </div>
              )}
              {/* 参考图标记画布叠层（与图片同位置同尺寸）；缩放时不渲染 */}
              {selected && !isResizing && imgDisplayRect && imgDisplayRect.width > 0 && imgDisplayRect.height > 0 && (
                <>
                  <canvas
                    ref={baseCanvasRef}
                    className="absolute rounded-lg nodrag nopan z-20"
                    style={{
                      left: imgDisplayRect.left,
                      top: imgDisplayRect.top,
                      width: imgDisplayRect.width,
                      height: imgDisplayRect.height,
                      pointerEvents: 'none',
                      touchAction: 'none',
                    }}
                  />
                  <canvas
                    ref={activeCanvasRef}
                    className={`absolute rounded-lg nodrag nopan z-30 ${brushActive ? 'cursor-crosshair' : ''}`}
                    style={{
                      left: imgDisplayRect.left,
                      top: imgDisplayRect.top,
                      width: imgDisplayRect.width,
                      height: imgDisplayRect.height,
                      pointerEvents: brushActive ? 'all' : 'none',
                      touchAction: 'none',
                    }}
                  />
                </>
              )}
              </>
              )}
              </div>
              {/* 抠图/去水印执行中：在模块内显示运行动画 */}
              {(isMattingLoading || isWatermarkRemovalLoading) && (
                <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg ${isDarkMode ? 'bg-black/50' : 'bg-black/40'}`}>
                  <Loader2 className={`w-8 h-8 animate-spin ${isDarkMode ? 'text-orange-400' : 'text-orange-500'}`} />
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-white/90' : 'text-gray-100'}`}>
                    {isMattingLoading ? '抠图中...' : '去水印中...'}
                  </span>
                </div>
              )}
            </>
          ) : errorMessage ? (
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
          ) : (
            <p className={isDarkMode ? 'text-white/60' : 'text-gray-500'}>
              等待生成图片...
            </p>
          )}
        </div>

        {/* 抠图/去水印：在 image 框外（下方），单独选中模块时才显示；抠图蓝、去水印橙 */}
        {outputImage && selected && (
          <div className="nodrag nopan absolute -bottom-9 left-0 right-0 flex justify-center gap-2 z-10" style={{ pointerEvents: 'all' }}>
            <button
              type="button"
              disabled={isMattingLoading || isWatermarkRemovalLoading}
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (isMattingLoading || isWatermarkRemovalLoading) return;
                if (!outputImage) {
                  setErrorMessage('请先生成或上传图片');
                  return;
                }
                if (!window.electronAPI?.imageMatting) {
                  setErrorMessage('当前环境不支持抠图');
                  return;
                }
                setIsMattingLoading(true);
                setErrorMessage('');
                try {
                  const result = await window.electronAPI.imageMatting(outputImage);
                  if (result?.success && result.imageUrl) {
                    const newUrl = result.imageUrl;
                    setOutputImage(newUrl);
                    updateNodeData({ outputImage: newUrl, errorMessage: undefined });
                    onAuxImageTaskComplete?.({ nodeId: id, type: 'matting', imageUrl: newUrl });
                  }
                } catch (err: any) {
                  const msg = err?.message || '抠图失败';
                  setErrorMessage(msg);
                  updateNodeData({ errorMessage: msg });
                } finally {
                  setIsMattingLoading(false);
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white ${
                isMattingLoading
                  ? 'bg-blue-500/70 cursor-not-allowed opacity-80'
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
              title="抠图（去除背景）"
            >
              {isMattingLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Scissors className="w-3.5 h-3.5" />
              )}
              抠图
            </button>
            <button
              type="button"
              disabled={isMattingLoading || isWatermarkRemovalLoading}
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (isMattingLoading || isWatermarkRemovalLoading) return;
                if (!outputImage) {
                  setErrorMessage('请先生成或上传图片');
                  return;
                }
                if (!window.electronAPI?.imageWatermarkRemoval) {
                  setErrorMessage('当前环境不支持去水印');
                  return;
                }
                setIsWatermarkRemovalLoading(true);
                setErrorMessage('');
                try {
                  const result = await window.electronAPI.imageWatermarkRemoval(outputImage);
                  if (result?.success && result.imageUrl) {
                    const newUrl = result.imageUrl;
                    setOutputImage(newUrl);
                    updateNodeData({ outputImage: newUrl, errorMessage: undefined });
                    onAuxImageTaskComplete?.({ nodeId: id, type: 'watermark', imageUrl: newUrl });
                  }
                } catch (err: any) {
                  const msg = err?.message || '去水印失败';
                  setErrorMessage(msg);
                  updateNodeData({ errorMessage: msg });
                } finally {
                  setIsWatermarkRemovalLoading(false);
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white ${
                isMattingLoading || isWatermarkRemovalLoading
                  ? 'bg-orange-500/70 cursor-not-allowed opacity-80'
                  : 'bg-orange-500 hover:bg-orange-600'
              }`}
              title="去水印"
            >
              {isWatermarkRemovalLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eraser className="w-3.5 h-3.5" />
              )}
              去水印
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
            
            // 在 body 上设置 cursor 样式
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
                  updateNodeInternals(id);
                  rafId = null;
                });
              }
            };

            const onMouseMove = (moveEvent: MouseEvent) => {
              moveEvent.preventDefault();
              moveEvent.stopPropagation();
              
              // 获取当前缩放比例
              const currentZoom = store.getState().transform[2] || 1;
              
              // 将鼠标移动距离除以缩放比例，转换为画布坐标
              const deltaX = (moveEvent.clientX - startX) / currentZoom;
              const deltaY = (moveEvent.clientY - startY) / currentZoom;
              
              // 计算新尺寸（最小/最大约束，防止拉得过大导致 Chromium 崩溃）
              const newW = clampW(startW + deltaX);
              const newH = clampH(startH + deltaY);

              if (nodeRef.current) {
                nodeRef.current.style.transition = 'none';
                nodeRef.current.style.width = `${newW}px`;
                nodeRef.current.style.height = `${newH}px`;
              }
              
              scheduleUpdate();
            };
            
            const onMouseUp = (upEvent: MouseEvent) => {
              setIsResizing(false);
              
              // 恢复 body cursor
              document.body.style.cursor = originalCursor;
              
              // 恢复 transition
              if (nodeRef.current) {
                nodeRef.current.style.transition = '';
              }
              
              // 取消待处理的 requestAnimationFrame
              if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
              }
              
              // 获取最终尺寸（从 DOM 读取并再次夹在安全范围内）
              const rawW = nodeRef.current ? parseFloat(nodeRef.current.style.width) || size.w : size.w;
              const rawH = nodeRef.current ? parseFloat(nodeRef.current.style.height) || size.h : size.h;
              handleSizeChange({ w: rawW, h: rawH });
              
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

export const ImageNode = memo(ImageNodeComponent);
ImageNode.displayName = 'ImageNode';
