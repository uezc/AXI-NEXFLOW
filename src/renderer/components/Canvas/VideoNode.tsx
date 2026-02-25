import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { Handle, Position, NodeProps, useStore } from 'reactflow';
import { Loader2, Upload, Video } from 'lucide-react';
import { ModuleProgressBar } from './ModuleProgressBar';
import { VideoPreview, type VideoPreviewRef } from '../VideoPreview';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';

/** 缩放低于此值时不再渲染 <video>，仅显示占位，避免大纹理导致 GPU 崩溃 */
const ZOOM_THRESHOLD_NO_VIDEO = 0.08;
/** 缩放低于此值时使用占位（约 10% 以下才显示占位图，其余都显示视频画面） */
const ZOOM_THRESHOLD_LOW_RES = 0.1;
/** 视口外扩边距（世界坐标），避免边缘闪烁 */
const VIEWPORT_PADDING = 400;

function VideoPlaceholder({ isDarkMode }: { isDarkMode: boolean }) {
  return (
    <div
      className={`w-full h-full flex items-center justify-center rounded-lg ${
        isDarkMode ? 'bg-black/40 text-white/50' : 'bg-gray-200/60 text-gray-500'
      }`}
      title="缩放过小或不在视口内，不渲染视频以保护 GPU"
    >
      <Video className="w-10 h-10 opacity-60" />
    </div>
  );
}

// 标准化视频 URL：将 file:// 转换为 local-resource://
// 使用统一的 normalizeVideoUrl 函数
const normalizeVideoUrlForNode = (url: string): string => {
  if (!url) return url;
  return normalizeVideoUrl(url);
};

interface VideoNodeData {
  width?: number;
  height?: number;
  outputVideo?: string;
  originalVideoUrl?: string; // 原始远程 URL（备用）
  title?: string;
  prompt?: string;
  aspectRatio?: '16:9' | '9:16';
  model?: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'wan-2.6' | 'wan-2.6-flash' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'rhart-video-g' | 'rhart-video-s-i2v-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref';
  hd?: boolean;
  duration?: '5' | '10' | '15' | '25';
  shotType?: 'single' | 'multi';
  negativePrompt?: string;
  resolutionWan26?: '720p' | '1080p';
  durationWan26Flash?: '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15';
  enableAudio?: boolean;
  resolutionRhartV31?: '720p' | '1080p' | '4k';
  inputImages?: string[]; // 图生视频参考图
  progress?: number; // 视频生成进度 0-100
  progressMessage?: string; // 进度状态文案
  errorMessage?: string; // 错误信息
}

interface VideoNodeProps extends NodeProps<VideoNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
  onDataChange?: (nodeId: string, updates: Partial<VideoNodeData>) => void;
}

const VideoNodeComponent: React.FC<VideoNodeProps> = (props) => {
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode = false,
    onDataChange,
    // 过滤 React Flow 内部属性，避免透传到 DOM
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
    isConnectable: _isConnectable,
    dragHandle: _dragHandle,
    // 确保不会透传任何其他 React Flow 内部属性
  } = props as any;

  // 视频模块初始尺寸：738.91 × 422.22
  const MIN_WIDTH = 738.91;
  const MIN_HEIGHT = 422.22;

  const [size, setSize] = useState({
    w: Math.max(MIN_WIDTH, data?.width || MIN_WIDTH),
    h: Math.max(MIN_HEIGHT, data?.height || MIN_HEIGHT),
  });
  // 验证视频 URL 是否是有效的视频文件，并将 file:// 格式转换为 local-resource://
  const isValidVideoUrl = (url: string): boolean => {
    if (!url) return false;
    // 远程 URL 假设是视频
    if (/^https?:\/\//.test(url)) return true;
    // 本地文件需要检查扩展名
    const isVideoFile = /\.(mp4|webm|mov|avi|mkv)$/i.test(url);
    return isVideoFile;
  };


  const [outputVideo, setOutputVideo] = useState(() => {
    const url = data?.outputVideo || '';
    if (!url) return '';
    // 标准化 URL（将 file:// 转换为 local-resource://）
    const normalizedUrl = normalizeVideoUrlForNode(url);
    return isValidVideoUrl(normalizedUrl) ? normalizedUrl : '';
  });
  const [title, setTitle] = useState(data?.title || 'video');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isVideoAreaHovered, setIsVideoAreaHovered] = useState(false);
  const [progress, setProgress] = useState(data?.progress || 0);
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');

  const nodeRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const videoPreviewRef = useRef<VideoPreviewRef>(null);
  const prevOutputVideoRef = useRef<string>(outputVideo);

  const transform = useStore((s) => s.transform);
  const zoom = transform?.[2] ?? 1;
  const vx = transform?.[0] ?? 0;
  const vy = transform?.[1] ?? 0;

  const isVisible = useMemo(() => {
    const left = -vx / zoom - VIEWPORT_PADDING / zoom;
    const top = -vy / zoom - VIEWPORT_PADDING / zoom;
    const right = -vx / zoom + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom + VIEWPORT_PADDING / zoom;
    const bottom = -vy / zoom + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom + VIEWPORT_PADDING / zoom;
    return !(xPos + size.w < left || xPos > right || yPos + size.h < top || yPos > bottom);
  }, [vx, vy, zoom, xPos, yPos, size.w, size.h]);

  // 仅按缩放决定是否渲染视频；加滞后避免在阈值附近反复切换导致闪动
  const shouldRenderVideoRef = useRef(zoom >= ZOOM_THRESHOLD_LOW_RES);
  const shouldRenderVideo = useMemo(() => {
    if (zoom >= ZOOM_THRESHOLD_LOW_RES) {
      shouldRenderVideoRef.current = true;
      return true;
    }
    if (zoom < ZOOM_THRESHOLD_NO_VIDEO) {
      shouldRenderVideoRef.current = false;
      return false;
    }
    return shouldRenderVideoRef.current;
  }, [zoom]);
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging || data?._isResizing) return false;
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
  }, [performanceMode, selected, dragging, data?._isResizing, vx, vy, zoom, xPos, yPos, size.w, size.h]);
  // 默认不自动播放；仅当鼠标悬停在视频区域时预览（静音），移开即停
  const isPaused = !isVideoAreaHovered;

  // 稳定的视频展示 URL，避免因 data 引用变化导致 src 抖动、视频重载闪动
  const videoDisplayUrl = useMemo(() => {
    const remote = data?.originalVideoUrl;
    if (remote && (remote.startsWith('http://') || remote.startsWith('https://'))) return remote;
    return outputVideo;
  }, [outputVideo, data?.originalVideoUrl]);

  useEffect(() => {
    if (!shouldRenderVideo || isPaused) videoPreviewRef.current?.pause();
    else videoPreviewRef.current?.play();
  }, [shouldRenderVideo, isPaused]);

  useEffect(() => {
    if (data?.width && data.width > 0) {
      setSize((prev) => ({ ...prev, w: data.width! }));
      if (nodeRef.current) nodeRef.current.style.width = `${data.width}px`;
    }
    if (data?.height && data.height > 0) {
      setSize((prev) => ({ ...prev, h: data.height! }));
      if (nodeRef.current) nodeRef.current.style.height = `${data.height}px`;
    }
    if (data?.outputVideo !== undefined) {
      const url = data.outputVideo || '';
      // 标准化 URL（将 file:// 转换为 local-resource://）
      const normalizedUrl = url ? normalizeVideoUrlForNode(url) : '';
      
      // 只有当 URL 真正变化时才更新，避免不必要的重新加载
      if (prevOutputVideoRef.current !== normalizedUrl) {
        prevOutputVideoRef.current = normalizedUrl;
        if (!url) {
          setOutputVideo((prev) => (prev ? '' : prev));
        } else if (isValidVideoUrl(normalizedUrl)) {
          // 同步设置，确保生成完成后立即显示（避免 setTimeout + cleanup 导致状态丢失）
          setOutputVideo(normalizedUrl);
        } else {
          console.warn('[VideoNode] 检测到非视频文件 URL，已忽略:', normalizedUrl);
          setOutputVideo((prev) => (prev ? '' : prev));
        }
      }
    }
    if (data?.title !== undefined) {
      setTitle(data.title || 'video');
    }
    if (data?.progress !== undefined) {
      setProgress(data.progress);
    }
    if (data?.progressMessage !== undefined) {
      // progressMessage 已通过 data 传递，无需单独状态
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage || '');
    }
  }, [data?.width, data?.height, data?.outputVideo, data?.title, data?.progress, data?.progressMessage, data?.errorMessage]);

  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, []);

  // 视频加载完成：保持最小尺寸，同时按视频比例匹配模块外形
  const handleVideoLoadedMetadata = useCallback((videoWidth: number, videoHeight: number) => {
    if (videoWidth <= 0 || videoHeight <= 0) return;
    const scale = Math.max(MIN_WIDTH / videoWidth, MIN_HEIGHT / videoHeight);
    const w = Math.round(videoWidth * scale);
    const h = Math.round(videoHeight * scale);
    setSize({ w, h });
    onDataChange?.(id, { width: w, height: h });
  }, [id, onDataChange]);

  // 视频上传：与 AudioNode 一致的 IPC showOpenVideoDialog 方案（不依赖 file.path）
  const handleUploadVideo = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    if (typeof window.electronAPI?.showOpenVideoDialog !== 'function') {
      console.warn('[VideoNode] showOpenVideoDialog 不可用，请确保运行在 Electron 环境');
      return;
    }
    const res = await window.electronAPI.showOpenVideoDialog();
    if (!res.success || !res.filePath) {
      if (!res.success && !res.filePath) console.log('[VideoNode] 用户取消选择或未选择文件');
      return;
    }
    const rawPath = res.filePath;
    console.log('[VideoNode] 上传视频 - IPC 返回的原始路径:', { rawPath, length: rawPath?.length });
    let normalizedPath = rawPath.replace(/\\/g, '/');
    if (normalizedPath.match(/^[a-zA-Z]:\//)) {
      normalizedPath = normalizedPath[0].toUpperCase() + normalizedPath.slice(1);
    } else if (normalizedPath.match(/^[a-zA-Z]\//)) {
      normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.slice(1);
    }
    const url = normalizeVideoUrlForNode(`local-resource://${normalizedPath}`);
    console.log('[VideoNode] 上传视频 - 转换后的 URL:', { url, normalizedPath });
    prevOutputVideoRef.current = url;
    setOutputVideo(url);
    setProgress(0);
    setErrorMessage('');
    onDataChange?.(id, { outputVideo: url, progress: 0, errorMessage: undefined });
  }, [id, onDataChange]);

  const showPlaceholder = dragging || data?._isResizing || isHardFrozen;

  return (
    <div
      ref={nodeRef}
      style={{
        width: size.w,
        height: size.h,
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
      }}
      className={`custom-node-container group relative rounded-2xl p-4 overflow-visible ${
        isDarkMode 
          ? 'bg-[#1C1C1E]' 
          : 'apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
      } ${selected && isDarkMode && !data?._isResizing ? 'ring-2 ring-green-400/80 border-green-400/70' : ''} ${data?._isResizing ? '!shadow-none !ring-0' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Handle 必须始终渲染，否则连线会断 */}
      <Handle type="target" position={Position.Left} id="input" style={{ top: '50%' }} className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
      {data?.model === 'kling-video-o1-ref' && (
        <Handle type="target" position={Position.Left} id="reference-video" style={{ top: '75%' }} className={`w-3 h-3 bg-amber-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} title="参考视频" />
      )}
      <Handle type="source" position={Position.Right} id="output" className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
      {showPlaceholder ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>{title || 'video'}</span>
        </div>
      ) : (
      <>
      {/* 左上角标题（节点外） */}
      <div className="title-area absolute -top-7 left-0 z-10">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setIsEditingTitle(false);
              if (onDataChange && data?.title !== title) {
                onDataChange(id, { title });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setIsEditingTitle(false);
                if (onDataChange && data?.title !== title) {
                  onDataChange(id, { title });
                }
              }
              if (e.key === 'Escape') {
                setIsEditingTitle(false);
                setTitle(data?.title || 'video');
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
            {title || 'video'}
          </span>
        )}
      </div>

      {/* 右上角上传视频按钮（与 AudioNode 一致，使用 IPC 选择文件） */}
      {selected && (
        <button
          type="button"
          onClick={handleUploadVideo}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          className={`nodrag absolute top-2 right-2 p-1.5 rounded-lg transition-all z-[100] ${
            isDarkMode ? 'apple-panel hover:bg-white/20' : 'apple-panel-light hover:bg-gray-200/30'
          }`}
          title="上传视频"
          aria-label="上传视频"
          style={{ pointerEvents: 'all' }}
        >
          <Upload className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
        </button>
      )}

      {/* 全模块覆盖进度条（生成中时覆盖整个节点顶层） */}
      <ModuleProgressBar
        visible={progress > 0}
        progress={progress}
        borderRadius={16}
        onFadeComplete={() => onDataChange?.(id, { progress: 0 })}
      />

      {/* 视频内容显示区域：运行中由进度条遮罩覆盖，再显示视频/错误/占位；悬停预览（静音），移开停止 */}
      <div
        className="custom-scrollbar w-full h-full flex items-center justify-center overflow-auto p-2 relative"
        onMouseEnter={() => setIsVideoAreaHovered(true)}
        onMouseLeave={() => setIsVideoAreaHovered(false)}
      >
        {outputVideo ? (
          shouldRenderVideo ? (
            <VideoPreview
              key={outputVideo}
              ref={videoPreviewRef}
              src={videoDisplayUrl}
              originalRemoteUrl={data?.originalVideoUrl}
              className="max-w-full max-h-full bg-black"
              preload="auto"
              playsInline
              muted
              isPaused={isPaused}
              onLoadedMetadata={handleVideoLoadedMetadata}
            />
          ) : (
            <VideoPlaceholder isDarkMode={!!isDarkMode} />
          )
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
            等待生成视频...
          </p>
        )}
      </div>
      </>
      )}
    </div>
  );
};

// 自定义比较函数，避免不必要的重新渲染
export const VideoNode = memo(VideoNodeComponent, (prevProps, nextProps) => {
  // 只比较关键属性，避免因其他属性变化导致重新渲染
  return (
    prevProps.id === nextProps.id &&
    prevProps.selected === nextProps.selected &&
    prevProps.isDarkMode === nextProps.isDarkMode &&
    prevProps.data?.outputVideo === nextProps.data?.outputVideo &&
    prevProps.data?.width === nextProps.data?.width &&
    prevProps.data?.height === nextProps.data?.height &&
    prevProps.data?.title === nextProps.data?.title &&
    prevProps.data?.progress === nextProps.data?.progress &&
    prevProps.data?.progressMessage === nextProps.data?.progressMessage &&
    prevProps.data?.errorMessage === nextProps.data?.errorMessage
  );
});
VideoNode.displayName = 'VideoNode';

