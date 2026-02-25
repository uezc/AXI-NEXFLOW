import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStoreApi, useStore } from 'reactflow';
import { Loader2, Mic, Play, Pause, Volume2, Upload } from 'lucide-react';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';
import { ModuleProgressBar } from './ModuleProgressBar';

interface AudioNodeData {
  width?: number;
  height?: number;
  outputAudio?: string;
  originalAudioUrl?: string; // 原始远程 URL（备用）
  title?: string;
  errorMessage?: string;
  text?: string;
  aiStatus?: 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
  progress?: number; // 生成进度 0-100
  referenceAudioUrl?: string; // Index-TTS2 参考音：URL 或 local-resource://
  model?: string; // 如 'rhart-song' 全能写歌
  songName?: string; // 全能写歌时生成的歌曲名，用于在播放器上方显示
}

interface AudioNodeProps extends NodeProps<AudioNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
}

// 与视频一致：统一使用 normalizeVideoUrl，得到 local-resource://C:/path 格式，避免二次编码和 404
const normalizeAudioUrl = (url: string): string => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('data:')) return url;
  return normalizeVideoUrl(url);
};

// 音频播放器组件（用于 AudioNode，暗黑模式使用图二样式）
const AudioPlayerComponent: React.FC<{
  audioRef: React.RefObject<HTMLAudioElement>;
  outputAudio: string;
  data?: AudioNodeData;
  isDarkMode: boolean;
  setOutputAudio: (url: string) => void;
  updateNodeData: (updates: Partial<AudioNodeData>) => void;
}> = ({ audioRef, outputAudio, data, isDarkMode, setOutputAudio, updateNodeData }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [sourceLoadFailed, setSourceLoadFailed] = useState(false);

  // 与视频一致：normalizeAudioUrl 内部用 normalizeVideoUrl，得到 local-resource://C:/path，不进行 encodeURIComponent，避免中文双重编码 404
  const normalizedUrl = useMemo(() => normalizeAudioUrl(outputAudio), [outputAudio]);
  // 播放用 URL：优先远程，否则用规范化后的本地 URL（直接传给 <audio src>，不再编码）
  const playbackUrl = useMemo(() => {
    if (data?.originalAudioUrl && (data.originalAudioUrl.startsWith('http://') || data.originalAudioUrl.startsWith('https://'))) {
      return data.originalAudioUrl;
    }
    return normalizedUrl;
  }, [normalizedUrl, data?.originalAudioUrl]);

  // 调试：首次有 playbackUrl 时打印，便于确认节点是否拿到远程 URL
  useEffect(() => {
    if (!playbackUrl) return;
    console.log('[AudioNode] 播放 URL:', {
      isRemote: playbackUrl.startsWith('http'),
      hasOriginalInData: !!(data?.originalAudioUrl),
      prefix: playbackUrl.slice(0, 60),
    });
  }, [playbackUrl, data?.originalAudioUrl]);

  // 检查音频格式兼容性
  const checkAudioCompatibility = useCallback((url: string): boolean => {
    if (!url) return false;
    const audio = document.createElement('audio');
    const ext = url.split('.').pop()?.toLowerCase();
    let mimeType = '';
    switch (ext) {
      case 'mp3':
        mimeType = 'audio/mpeg';
        break;
      case 'wav':
        mimeType = 'audio/wav';
        break;
      case 'ogg':
        mimeType = 'audio/ogg';
        break;
      case 'm4a':
        mimeType = 'audio/mp4';
        break;
      default:
        return true; // 未知格式，让浏览器尝试
    }
    const canPlay = audio.canPlayType(mimeType);
    return canPlay === 'probably' || canPlay === 'maybe';
  }, []);

  // 格式化时间
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 播放/暂停 - 无有效音源时不调用 play()，避免 NotSupportedError 重复报错
  const togglePlay = useCallback(async () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }
    // 无有效播放地址时不调用 play，避免 "The element has no supported sources"
    if (!playbackUrl || !playbackUrl.trim()) {
      console.warn('[AudioPlayerComponent] 播放跳过：音源地址为空');
      return;
    }
    const el = audioRef.current;
    if (el.readyState === 0 && el.networkState === 3) {
      console.warn('[AudioPlayerComponent] 播放跳过：音源未加载或不可用 (readyState=0, networkState=NO_SOURCE)');
      return;
    }
    try {
      if (!checkAudioCompatibility(playbackUrl)) {
        console.warn('[AudioPlayerComponent] 音频格式可能不兼容，尝试播放:', playbackUrl.slice(0, 60));
      }
      const playPromise = el.play();
      if (playPromise !== undefined) {
        await playPromise;
        setIsPlaying(true);
      } else {
        setIsPlaying(true);
      }
    } catch (error: any) {
      const isNotSupported = error?.name === 'NotSupportedError' || String(error?.message || '').includes('supported sources');
      setIsPlaying(false);
      if (isNotSupported) {
        console.warn('[AudioPlayerComponent] 音源无法播放（NotSupportedError），请检查文件路径或重新选择文件');
        if (playbackUrl.startsWith('local-resource://') && data?.originalAudioUrl) {
          setOutputAudio(data.originalAudioUrl);
          updateNodeData({ outputAudio: data.originalAudioUrl });
        }
      } else {
        console.error('[AudioPlayerComponent] 播放失败:', error?.name, error?.message);
        if (playbackUrl.startsWith('local-resource://') && data?.originalAudioUrl) {
          setOutputAudio(data.originalAudioUrl);
          updateNodeData({ outputAudio: data.originalAudioUrl });
        }
      }
    }
  }, [isPlaying, audioRef, playbackUrl, checkAudioCompatibility, data?.originalAudioUrl, setOutputAudio, updateNodeData]);

  // 注意：所有事件处理都在 audio 元素的 onXxx 属性中处理，不需要额外的 useEffect

  // 进度条点击
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration, audioRef]);

  // 音量控制
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  }, [audioRef]);

  // URL 变化时重新加载并清除“加载失败”状态
  useEffect(() => {
    setSourceLoadFailed(false);
    if (audioRef.current && playbackUrl) {
      const currentSrc = audioRef.current.currentSrc || audioRef.current.src;
      if (currentSrc !== playbackUrl) {
        audioRef.current.load();
      }
    }
  }, [playbackUrl]);

  // 预加载检查：仅当使用 local-resource 时检查文件是否存在
  useEffect(() => {
    if (playbackUrl.startsWith('local-resource://') && data?.originalAudioUrl && window.electronAPI) {
      // 通过 IPC 检查文件是否存在（避免尝试加载不存在的文件）
      window.electronAPI.checkFileExists(normalizedUrl).then((result) => {
        if (!result.exists || !result.readable) {
          console.warn(`[AudioNode] 预加载检查：文件不存在或不可读 (exists: ${result.exists}, readable: ${result.readable})，立即切换到远程 URL`);
          setOutputAudio(data.originalAudioUrl);
          updateNodeData({ outputAudio: data.originalAudioUrl });
          return;
        }
        
        // 文件存在，继续使用本地文件
        console.log(`[AudioNode] 预加载检查：文件存在且可读 (size: ${result.size} bytes)`);
      }).catch((error) => {
        console.warn(`[AudioNode] 预加载检查：检查文件失败，切换到远程 URL:`, error);
        if (data.originalAudioUrl) {
          setOutputAudio(data.originalAudioUrl);
          updateNodeData({ outputAudio: data.originalAudioUrl });
        }
      });
    }
  }, [playbackUrl, data?.originalAudioUrl, setOutputAudio, updateNodeData]);

  return (
    <div className="w-full flex flex-col items-center gap-2">
      {/* 隐藏的 audio 元素，用于所有模式 */}
      <audio
        key={playbackUrl}
        ref={audioRef}
        src={playbackUrl}
        preload="metadata"
        crossOrigin={playbackUrl.startsWith('http') ? 'anonymous' : undefined}
        controls={false}
        className="hidden"
        onError={(e) => {
          const audio = e.currentTarget;
          const error = audio.error;
          const errName = error?.name || '';
          const errMsg = error?.message || '';
          console.error('[AudioNode] 音频加载失败:', {
            src: audio.currentSrc || outputAudio,
            playbackUrl,
            error: error?.code,
            message: errMsg,
            name: errName,
          });
          if (errName === 'NotSupportedError' || errMsg.includes('NotSupportedError')) {
            if (!playbackUrl || !playbackUrl.trim()) console.warn('[AudioNode] NotSupportedError: src 为空');
            else if (!playbackUrl.startsWith('http') && !playbackUrl.startsWith('local-resource://')) {
              console.warn('[AudioNode] NotSupportedError: 可能被系统拦截，URL 格式:', playbackUrl.slice(0, 80));
            }
            setSourceLoadFailed(true);
          }
          // 若为 local-resource 且加载失败，有远程 URL 时切换
          if (
            (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
             error?.code === MediaError.MEDIA_ERR_DECODE ||
             errMsg.includes('DEMUXER_ERROR') ||
             errMsg.includes('COULD_NOT_OPEN') ||
             errName === 'NotSupportedError') &&
            playbackUrl.startsWith('local-resource://') &&
            data?.originalAudioUrl
          ) {
            console.log(`[AudioNode] 加载失败 (${errName || error?.code})，切换到原始远程 URL`);
            setOutputAudio(data.originalAudioUrl);
            updateNodeData({ outputAudio: data.originalAudioUrl });
          }
        }}
        onCanPlay={(e) => {
          const audio = e.currentTarget;
          if (audio.currentTime > 0) {
            audio.currentTime = 0;
          }
        }}
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          audio.currentTime = 0;
          setDuration(audio.duration);
        }}
        onPlay={(e) => {
          setIsPlaying(true);
          const audio = e.currentTarget;
          if (audio.currentTime > 0.1) {
            audio.currentTime = 0;
          }
        }}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />
      
      {/* 自定义播放器 - 卡片式款式，大按钮 + 明确点击区域，避免被 React Flow 吞掉点击 */}
      <div
        className={`w-full rounded-xl p-3 select-none ${
          isDarkMode ? 'bg-white/5' : 'bg-gray-100/80'
        }`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          {/* 大号播放/暂停按钮 - 音源不可用时仅提示，不重复触发 play 报错 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              togglePlay();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-all duration-150 active:scale-95 ${
              sourceLoadFailed ? (isDarkMode ? 'bg-white/10 text-white/50 cursor-not-allowed' : 'bg-gray-300 text-gray-500 cursor-not-allowed') : isPlaying
                ? isDarkMode ? 'bg-emerald-500/90 text-white hover:bg-emerald-500' : 'bg-emerald-500 text-white hover:bg-emerald-600'
                : isDarkMode ? 'bg-emerald-600/80 text-white hover:bg-emerald-500 border border-emerald-400/30' : 'bg-emerald-500 text-white hover:bg-emerald-600 border border-emerald-600/30'
            }`}
            title={sourceLoadFailed ? '音源不可用，请检查路径或重新选择文件' : (isPlaying ? '暂停' : '播放')}
            aria-label={sourceLoadFailed ? '音源不可用' : (isPlaying ? '暂停' : '播放')}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 flex-shrink-0" strokeWidth={2.5} />
            ) : (
              <Play className="w-6 h-6 ml-0.5 flex-shrink-0" strokeWidth={2.5} />
            )}
          </button>

          {/* 进度与时间 */}
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div
              className={`h-2 rounded-full cursor-pointer ${
                isDarkMode ? 'bg-white/15' : 'bg-black/10'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                handleProgressClick(e);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              role="progressbar"
              aria-valuenow={duration > 0 ? (currentTime / duration) * 100 : 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
                  backgroundColor: isDarkMode ? '#22c55e' : '#16a34a',
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-mono tabular-nums ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                <Volume2 className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`} />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="w-14 h-1 cursor-pointer"
                  aria-label="音量"
                  title="音量"
                  style={{ accentColor: isDarkMode ? '#22c55e' : '#16a34a' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AudioNodeComponent: React.FC<AudioNodeProps> = (props) => {
  // 解构出 React Flow 专有属性，避免透传给 DOM
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode = false,
    onDataChange,
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
  
  // 最小尺寸约束（与 Text 模块相同）
  const MIN_WIDTH = 280;
  const MIN_HEIGHT = 160;
  
  const [size, setSize] = useState({
    w: Math.max(MIN_WIDTH, data?.width || MIN_WIDTH),
    h: Math.max(MIN_HEIGHT, data?.height || MIN_HEIGHT),
  });
  const [isResizing, setIsResizing] = useState(false);
  const [outputAudio, setOutputAudio] = useState(data?.outputAudio || '');
  const [title, setTitle] = useState(data?.title || 'audio');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  // 初始化状态：优先使用 data.aiStatus，否则根据 outputAudio 和 errorMessage 判断
  const getInitialStatus = (): 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR' => {
    if (data?.aiStatus) return data.aiStatus;
    if (data?.outputAudio) return 'SUCCESS';
    if (data?.errorMessage) return 'ERROR';
    return 'idle';
  };
  
  const [aiStatus, setAiStatus] = useState<'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>(getInitialStatus());
  const [inputText, setInputText] = useState(data?.text || '');
  
  // 调试日志
  useEffect(() => {
    console.log('[AudioNode] 状态更新:', {
      nodeId: id,
      aiStatus,
      outputAudio: !!outputAudio,
      errorMessage: !!errorMessage,
      inputText: !!inputText,
      dataAiStatus: data?.aiStatus,
    });
  }, [id, aiStatus, outputAudio, errorMessage, inputText, data?.aiStatus]);
  
  const nodeRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const prevOutputAudioRef = useRef<string>(''); // 用于跟踪音频 URL 变化
  const transform = useStore((s) => s.transform);

  // 当音频 URL 变化时，重置播放位置
  useEffect(() => {
    if (outputAudio && outputAudio !== prevOutputAudioRef.current && audioRef.current) {
      prevOutputAudioRef.current = outputAudio;
      // 重置音频播放位置
      const audio = audioRef.current;
      if (audio.readyState >= 2) {
        // 如果音频已经加载了元数据，立即重置
        audio.currentTime = 0;
      } else {
        // 如果还没有加载，等待加载完成后再重置
        const handleLoadedMetadata = () => {
          audio.currentTime = 0;
          audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      }
    }
  }, [outputAudio]);

  // 同步外部数据变化
  useEffect(() => {
    if (data?.width !== undefined && data.width > 0) {
      setSize((prev) => {
        if (prev.w !== data.width) {
          return { ...prev, w: data.width };
        }
        return prev;
      });
      // 强制应用尺寸到 DOM
      if (nodeRef.current) {
        nodeRef.current.style.width = `${data.width}px`;
      }
    }
    if (data?.height !== undefined && data.height > 0) {
      setSize((prev) => {
        if (prev.h !== data.height) {
          return { ...prev, h: data.height };
        }
        return prev;
      });
      // 强制应用尺寸到 DOM
      if (nodeRef.current) {
        nodeRef.current.style.height = `${data.height}px`;
      }
    }
    if (data?.outputAudio !== undefined) {
      // 格式化音频路径
      const formattedPath = normalizeAudioUrl(data.outputAudio);
      // 只有当 URL 真正变化时才更新，避免不必要的重新加载
      if (outputAudio !== formattedPath) {
        setOutputAudio(formattedPath);
      }
    }
    if (data?.title !== undefined) {
      setTitle(data.title);
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage);
    }
    if (data?.aiStatus !== undefined) {
      setAiStatus(data.aiStatus);
    } else if (data?.outputAudio) {
      // 如果有输出音频但没有状态，默认为 SUCCESS
      setAiStatus('SUCCESS');
    } else if (data?.errorMessage) {
      setAiStatus('ERROR');
    } else {
      setAiStatus('idle');
    }
    if (data?.text !== undefined) {
      setInputText(data.text);
    }
  }, [data?.width, data?.height, data?.outputAudio, data?.title, data?.errorMessage, data?.aiStatus, data?.text, outputAudio]);

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, []);

  // 更新节点数据
  const updateNodeData = useCallback((updates: Partial<AudioNodeData>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...updates } } : node
      )
    );
    if (onDataChange && (updates.outputAudio !== undefined || updates.referenceAudioUrl !== undefined)) {
      onDataChange(id, updates as any);
    }
  }, [id, setNodes, onDataChange]);

  const handleUploadReferenceAudio = useCallback(async () => {
    if (typeof window.electronAPI?.showOpenAudioDialog !== 'function') return;
    const res = await window.electronAPI.showOpenAudioDialog();
    if (res.success && res.filePath) {
      let path = res.filePath.replace(/\\/g, '/');
      if (path.match(/^[a-zA-Z]\//)) path = path[0].toUpperCase() + ':' + path.substring(1);
      else if (path.match(/^[a-zA-Z]:\//)) path = path[0].toUpperCase() + path.substring(1);
      const url = normalizeAudioUrl(`local-resource://${path}`);
      updateNodeData({ referenceAudioUrl: url });
    }
  }, [updateNodeData]);

  // 处理尺寸变化
  const handleSizeChange = useCallback((newSize: { w: number; h: number }) => {
    setSize(newSize);
    updateNodeData({ width: newSize.w, height: newSize.h });
  }, [updateNodeData]);

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
    <>
      <div
        ref={nodeRef}
        className={`custom-node-container group relative rounded-2xl overflow-visible flex flex-col ${
          isDarkMode
            ? 'bg-[#1C1C1E]'
            : 'apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
        } ${selected && isDarkMode && !isResizing ? 'ring-2 ring-green-400/80 border-green-400/70' : ''} ${isResizing ? '!shadow-none !ring-0' : ''}`}
        style={{
          width: size.w,
          height: size.h,
          minWidth: `${MIN_WIDTH}px`,
          minHeight: `${MIN_HEIGHT}px`,
          userSelect: isResizing ? 'none' : 'auto',
          willChange: isResizing ? 'width, height' : 'auto',
          backfaceVisibility: isResizing ? 'hidden' : 'visible',
          transition: isResizing ? 'none' : 'background-color 0.2s, border-color 0.2s',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Handle type="target" position={Position.Left} id="audio-input" className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
        <Handle type="source" position={Position.Right} id="output" className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'} ${showPlaceholder ? 'opacity-0 pointer-events-none' : (selected || isHovered) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
        {showPlaceholder ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className={`text-xs font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
              {isHardFrozen ? `${title || 'audio'}（冻结）` : (title || 'audio')}
            </span>
          </div>
        ) : (
        <>
        {/* 左上角标题区域（在模块外部、上方，与 ImageNode 一致） */}
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
                  setTitle(data?.title || 'audio');
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
              {title || '未命名音频'}
            </span>
          )}
        </div>

        {/* 右上角上传参考音按钮（Index-TTS2 等） */}
        {selected && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleUploadReferenceAudio(); }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            className={`nodrag absolute top-2 right-2 p-1.5 rounded-lg transition-all z-[100] ${
              isDarkMode ? 'apple-panel hover:bg-white/20' : 'apple-panel-light hover:bg-gray-200/30'
            }`}
            title="上传参考音（用于 Index-TTS2 配音）"
            aria-label="上传参考音"
            style={{ pointerEvents: 'all' }}
          >
            <Upload className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
          </button>
        )}

        {/* 全模块覆盖进度条（音频合成/生成中时覆盖整个节点顶层） */}
        <ModuleProgressBar
          visible={aiStatus === 'START' || aiStatus === 'PROCESSING' || (typeof data?.progress === 'number' && data.progress > 0)}
          progress={data?.progress ?? 0}
          borderRadius={16}
          onFadeComplete={() => updateNodeData({ progress: 0 })}
        />

        {/* 音频内容显示区域 - 有生成结果或上传的参考音时显示播放器，支持试听 */}
        <div className="w-full flex-1 flex flex-col items-stretch justify-center overflow-hidden p-2 pt-3" style={{ minHeight: '80px' }}>
          {/* 类型标签：区分生成的声音 / 参考音（上传或节点传入） */}
          {(outputAudio || data?.referenceAudioUrl) && (
            <div className="flex-shrink-0 mb-1.5 flex flex-col gap-1">
              {outputAudio && data?.model === 'rhart-song' && (data?.songName ?? '').trim() && (
                <div className={`text-sm font-semibold truncate ${isDarkMode ? 'text-white/90' : 'text-gray-800'}`} title={data.songName}>
                  {data.songName}
                </div>
              )}
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium self-start ${
                  outputAudio
                    ? isDarkMode
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-emerald-100 text-emerald-700'
                    : isDarkMode
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-blue-100 text-blue-700'
                }`}
                title={outputAudio ? '当前为 TTS 生成的声音' : '当前为参考音（上传或从上一节点传入）'}
              >
                {outputAudio ? '生成的声音' : '参考音'}
              </span>
            </div>
          )}
          {/* 有可播放音频时显示播放器：生成结果(outputAudio) 或 上传的参考音(referenceAudioUrl) */}
          {(outputAudio || data?.referenceAudioUrl) ? (
            <AudioPlayerComponent
              audioRef={audioRef}
              outputAudio={outputAudio || data?.referenceAudioUrl || ''}
              data={data}
              isDarkMode={isDarkMode}
              setOutputAudio={setOutputAudio}
              updateNodeData={updateNodeData}
            />
          ) : aiStatus === 'ERROR' || errorMessage ? (
            // 错误状态：显示错误信息
            <div className="flex flex-col items-center justify-center gap-3 p-4">
              <div className={`text-2xl ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                ⚠️
              </div>
              <p className={`text-sm font-semibold text-center ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
                生成失败
              </p>
              <p className={`text-xs text-center line-clamp-3 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
                {errorMessage || '音频生成失败，请稍后重试'}
              </p>
            </div>
          ) : aiStatus === 'START' || aiStatus === 'PROCESSING' ? (
            // 生成中状态：显示 Loading 动画
            <div className="flex flex-col items-center justify-center gap-3 p-4">
              <Loader2 className={`w-6 h-6 animate-spin ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
              <p className={`text-xs text-center ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                请稍候
              </p>
            </div>
          ) : (
            // 初始状态（Idle）：显示提示信息（不显示连线内容）
            <div className="flex flex-col items-center justify-center gap-3 p-4">
              <Mic className={`w-8 h-8 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`} />
              <p className={`text-sm font-medium text-center ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`}>
                {inputText ? '已连接文本' : '请连接文本节点'}
              </p>
              <p className={`text-xs text-center ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                {inputText ? '点击节点配置参数并生成' : '或点击节点输入文本'}
              </p>
            </div>
          )}
        </div>

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
              
              // 计算新尺寸（最小尺寸约束）
              const newW = Math.max(MIN_WIDTH, startW + deltaX);
              const newH = Math.max(MIN_HEIGHT, startH + deltaY);
              
              // 直接操作 DOM，不触发 React 状态更新
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

export const AudioNode = memo(AudioNodeComponent);
AudioNode.displayName = 'AudioNode';
