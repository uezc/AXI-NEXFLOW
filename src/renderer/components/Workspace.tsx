import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  NodeTypes,
  ReactFlowProvider,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { ArrowLeft, User, Image, Film, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Circle, Sun, Moon, Copy, Download, Maximize2, X, Trash2, FolderOpen, Play, Pause, Volume2, Power } from 'lucide-react';
import { TextNode } from './Canvas/TextNode';
import { MinimalistTextNode } from './Canvas/MinimalistTextNode';
import { LLMNode } from './Canvas/LLMNode';
import { ImageNode } from './Canvas/ImageNode';
import { VideoNode } from './Canvas/VideoNode';
import { AudioNode } from './Canvas/AudioNode';
import { CameraControlNode } from './Canvas/CameraControlNode';
import FlowContent from './Canvas/FlowContent';
import LLMInputPanel from './Canvas/LLMInputPanel';
import ImageInputPanel from './Canvas/ImageInputPanel';
import VideoInputPanel from './Canvas/VideoInputPanel';
import AudioInputPanel from './Canvas/AudioInputPanel';
import { VideoPreview } from './VideoPreview';
import { normalizeVideoUrl } from '../utils/normalizeVideoUrl';
import { CharacterNode } from './Canvas/CharacterNode';
import { TextSplitNode } from './Canvas/TextSplitNode';
import CharacterInputPanel from './Canvas/CharacterInputPanel';
import CharacterList from './CharacterList';
import { mapProjectPath } from '../utils/pathMapper';

const CARD_BG_STORAGE_KEY = 'nexflow-project-card-bg';
const getCardBgKey = (projectId: string) => `${CARD_BG_STORAGE_KEY}-${projectId}`;

// 任务列表图片显示组件（支持路径映射）
const TaskImageDisplay: React.FC<{
  task: any;
  projectId?: string;
  formatImagePath: (path: string) => string;
  mapProjectPath: (url: string, projectId?: string) => Promise<string>;
  onPreview: (imageUrl: string) => void;
  isDarkMode: boolean;
}> = ({ task, projectId, formatImagePath, mapProjectPath, onPreview, isDarkMode }) => {
  const [mappedImageUrl, setMappedImageUrl] = React.useState<string | null>(null);
  
  React.useEffect(() => {
    // 获取要显示的图片 URL（使用同步版本格式化）
    const imageUrl = task.localFilePath 
      ? formatImagePath(task.localFilePath)
      : formatImagePath(task.imageUrl);
    
    // 如果是 local-resource:// 路径且有项目ID，尝试映射
    if (projectId && imageUrl.startsWith('local-resource://')) {
      mapProjectPath(imageUrl, projectId).then((mapped) => {
        if (mapped !== imageUrl) {
          setMappedImageUrl(mapped);
        } else {
          setMappedImageUrl(imageUrl);
        }
      }).catch(() => {
        setMappedImageUrl(imageUrl);
      });
    } else {
      setMappedImageUrl(imageUrl);
    }
  }, [task.localFilePath, task.imageUrl, projectId, formatImagePath, mapProjectPath]);
  
  if (!mappedImageUrl) {
    return (
      <div className={`w-full h-32 flex items-center justify-center text-xs ${
        isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
      }`}>
        加载中...
      </div>
    );
  }
  
  const handlePreview = () => {
    const imageToPreview = task.localFilePath 
      ? formatImagePath(task.localFilePath)
      : formatImagePath(task.imageUrl);
    // 预览时也尝试映射
    if (projectId && imageToPreview.startsWith('local-resource://')) {
      mapProjectPath(imageToPreview, projectId).then((mapped) => {
        onPreview(mapped);
      }).catch(() => {
        onPreview(imageToPreview);
      });
    } else {
      onPreview(imageToPreview);
    }
  };
  
  return (
    <>
      <img
        src={mappedImageUrl}
        alt={task.nodeTitle}
        className="w-full h-32 object-cover cursor-pointer"
        onClick={handlePreview}
        onError={async (e) => {
          const img = e.target as HTMLImageElement;
          // 如果当前使用的是映射路径，尝试回退到原始路径
          const localUrl = task.localFilePath ? formatImagePath(task.localFilePath) : null;
          if (localUrl && img.src !== localUrl) {
            console.log('[任务列表] 图片加载失败，尝试使用本地路径:', task.localFilePath);
            if (projectId && localUrl.startsWith('local-resource://')) {
              mapProjectPath(localUrl, projectId).then((mapped) => {
                img.src = mapped;
              }).catch(() => {
                img.src = localUrl;
              });
            } else {
              img.src = localUrl;
            }
          } else {
            // 如果本地路径也失败，显示错误占位符
            img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ccc" width="100" height="100"/%3E%3Ctext x="50" y="50" text-anchor="middle" dy=".3em" fill="%23999"%3E图片加载失败%3C/text%3E%3C/svg%3E';
          }
        }}
      />
      {/* 图片预览按钮 */}
      <button
        onClick={handlePreview}
        className={`absolute top-2 right-2 p-1.5 rounded-lg ${
          isDarkMode
            ? 'bg-black/50 hover:bg-black/70 text-white'
            : 'bg-white/80 hover:bg-white text-gray-700'
        } transition-colors`}
        title="预览"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>
    </>
  );
};

/** 视频帧 canvas 最大纹理边长，超过会按比例缩小，避免 GPU 崩溃 */
const MAX_TEXTURE_SIZE = 2048;

// 截取视频第一帧的工具函数
async function extractVideoFirstFrame(videoUrl: string): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      
      // 设置视频源
      video.src = videoUrl;
      
      // 当视频可以播放时，截取第一帧
      video.addEventListener('loadeddata', () => {
        try {
          video.currentTime = 0.1; // 设置到 0.1 秒，确保能获取到帧
        } catch (error) {
          console.error('[截取视频帧] 设置 currentTime 失败:', error);
        }
      });
      
      // 当视频帧可以渲染时，截取（限制 canvas 最大尺寸，避免超大纹理导致 GPU 崩溃）
      video.addEventListener('seeked', () => {
        try {
          let w = video.videoWidth || 1920;
          let h = video.videoHeight || 1080;
          if (w > MAX_TEXTURE_SIZE || h > MAX_TEXTURE_SIZE) {
            const r = Math.min(MAX_TEXTURE_SIZE / w, MAX_TEXTURE_SIZE / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ success: false, error: '无法获取 canvas 上下文' });
            return;
          }

          ctx.drawImage(video, 0, 0, w, h);
          
          // 转换为 base64 图片
          const imageUrl = canvas.toDataURL('image/png');
          
          // 清理
          video.src = '';
          video.load();
          
          resolve({ success: true, imageUrl });
        } catch (error: any) {
          console.error('[截取视频帧] 截取失败:', error);
          resolve({ success: false, error: error.message || '截取视频帧失败' });
        }
      });
      
      // 错误处理
      video.addEventListener('error', (e) => {
        console.error('[截取视频帧] 视频加载失败:', e);
        resolve({ success: false, error: '视频加载失败' });
      });
      
      // 超时处理（10秒）
      setTimeout(() => {
        if (video.readyState < 2) {
          video.src = '';
          video.load();
          resolve({ success: false, error: '视频加载超时' });
        }
      }, 10000);
      
      // 开始加载视频
      video.load();
    } catch (error: any) {
      console.error('[截取视频帧] 创建视频元素失败:', error);
      resolve({ success: false, error: error.message || '创建视频元素失败' });
    }
  });
}

interface WorkspaceProps {
  projectId?: string;
}

// 自定义节点组件
const CustomNode: React.FC<{ data: { label: string; preview?: string } }> = ({ data }) => {
  return (
    <div className="apple-panel rounded-lg p-4 min-w-[200px]">
      {data.preview && (
        <div className="w-full h-32 bg-white/5 rounded mb-2 mb-3 flex items-center justify-center">
          <Image className="w-8 h-8 text-white/60" />
        </div>
      )}
      <div className="text-white font-medium text-sm">{data.label}</div>
    </div>
  );
};


// API 状态类型
type ApiStatus = 'unknown' | 'success' | 'error';

// 任务类型
interface Task {
  id: string;
  nodeId: string;
  nodeTitle: string;
  imageUrl?: string;
  videoUrl?: string; // 视频 URL
  audioUrl?: string; // 音频 URL
  prompt: string;
  createdAt: number; // 时间戳
  status?: 'success' | 'error' | 'processing'; // 任务状态
  errorMessage?: string; // 错误信息
  taskType?: 'image' | 'video' | 'text' | 'audio'; // 任务类型
  localFilePath?: string; // 本地文件路径
}

// 音乐播放器组件（用于任务列表）
const MusicPlayer: React.FC<{
  audioUrl: string;
  isDarkMode: boolean;
  onPreview?: () => void;
}> = ({ audioUrl, isDarkMode, onPreview }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  // 标准化音频 URL
  const normalizedUrl = useMemo(() => {
    if (!audioUrl) return '';
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://') || audioUrl.startsWith('data:')) {
      return audioUrl;
    }
    if (audioUrl.startsWith('local-resource://')) {
      return audioUrl;
    }
    const cleanPath = audioUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
    return `local-resource://${cleanPath.replace(/\\/g, '/')}`;
  }, [audioUrl]);

  // 格式化时间
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 播放/暂停
  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  // 更新进度
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleCanPlay = () => {
      if (audio.currentTime > 0) {
        audio.currentTime = 0;
      }
    };
    const handlePlay = () => {
      if (audio.currentTime > 0.1) {
        audio.currentTime = 0;
      }
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('play', handlePlay);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('play', handlePlay);
    };
  }, []);

  // 进度条点击
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  // 音量控制
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  }, []);

  return (
    <div className={`relative w-full ${isDarkMode ? 'bg-[#1C1C1E]' : 'bg-gray-200'} rounded-lg p-3`}>
      <audio
        ref={audioRef}
        src={normalizedUrl}
        preload="none"
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          audio.currentTime = 0;
          setDuration(audio.duration);
        }}
        onCanPlay={(e) => {
          const audio = e.currentTarget;
          if (audio.currentTime > 0) {
            audio.currentTime = 0;
          }
        }}
        onPlay={(e) => {
          setIsPlaying(true);
          const audio = e.currentTarget;
          if (audio.currentTime > 0.1) {
            audio.currentTime = 0;
          }
        }}
        onPause={() => setIsPlaying(false)}
        onError={(e) => {
          console.error('[音乐播放器] 加载失败:', e);
        }}
      />
      
      <div className="flex flex-col gap-2">
        {/* 第一行：播放按钮、进度条、音量控制、放大按钮 */}
        <div className="flex items-center gap-2">
          {/* 播放/暂停按钮 */}
          <button
            onClick={togglePlay}
            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              isDarkMode
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-gray-300 hover:bg-gray-400 text-gray-700'
            }`}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>

          {/* 进度条 */}
          <div
            className="flex-1 h-1.5 rounded-full cursor-pointer relative"
            onClick={handleProgressClick}
            style={{
              background: isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
            }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
                background: isDarkMode ? '#22c55e' : '#3b82f6',
              }}
            />
          </div>

          {/* 音量控制 */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Volume2 className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`} />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={handleVolumeChange}
              className="w-16 h-1"
              aria-label="音量"
              title="音量"
              style={{
                accentColor: isDarkMode ? '#22c55e' : '#3b82f6',
              }}
            />
          </div>

          {/* 放大预览按钮 */}
          {onPreview && (
            <button
              onClick={onPreview}
              className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center transition-colors ${
                isDarkMode
                  ? 'bg-white/10 hover:bg-white/20 text-white/70'
                  : 'bg-gray-300/50 hover:bg-gray-400/50 text-gray-600'
              }`}
              title="放大播放"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* 第二行：时间显示 - 放在进度条下方 */}
        <div className="flex items-center justify-center gap-1">
          <span className={`text-xs font-mono ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>
            {formatTime(currentTime)}
          </span>
          <span className={`text-xs font-mono ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
            / {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
};

// 格式化图片路径：统一转换为 local-resource:// 协议（同步版本）
// 注意：不要对整个路径编码，只对中文和空格部分编码，盘符的冒号必须保持原样
const formatImagePathSync = (path: string): string => {
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

// 格式化图片路径：统一转换为 local-resource:// 协议（异步版本，支持路径映射）
// 增强版：自动检测中文路径并转换为映射路径
const formatImagePath = async (path: string, projectId?: string): Promise<string> => {
  // 先使用同步版本格式化路径
  const formattedPath = formatImagePathSync(path);
  
  // 如果需要路径映射且路径是 local-resource://，尝试映射
  if (projectId && formattedPath.startsWith('local-resource://')) {
    try {
      const mappedPath = await mapProjectPath(formattedPath, projectId);
      return mappedPath;
    } catch (error) {
      console.warn('[formatImagePath] 路径映射失败，使用原始路径:', error);
      return formattedPath;
    }
  }
  
  return formattedPath;
};

const Workspace: React.FC<WorkspaceProps> = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const flowContentApiRef = useRef<{
    screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
    getLastMousePosition: () => { x: number; y: number };
  } | null>(null);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState([]);
  const latestNodesRef = useRef<Node[]>([]);
  const latestEdgesRef = useRef<Edge[]>([]);
  
  type HistorySnapshotReason = 'position' | 'general';
  type HistorySnapshot = { nodes: Node[]; edges: Edge[]; reason: HistorySnapshotReason };

  // 撤销/重做历史记录
  const historyRef = useRef<HistorySnapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const isUndoRedoRef = useRef<boolean>(false);
  const saveHistoryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const positionChangeRafRef = useRef<number | null>(null);
  const pendingPositionChangesRef = useRef<any[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewAudio, setPreviewAudio] = useState<string | null>(null); // 音频预览
  const [batchRunInProgress, setBatchRunInProgress] = useState(false); // 批量运行中，用于禁用按钮并显示绿色
  const [isPerformanceMode, setIsPerformanceMode] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const cardThumbnailCacheRef = useRef<string | null>(null);
  const cardThumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestNodesRef.current = nodes as Node[];
  }, [nodes]);

  useEffect(() => {
    latestEdgesRef.current = edges as Edge[];
  }, [edges]);

  const normalizeNodesForSave = useCallback((inputNodes: Node[]) => {
    return inputNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        width: node.data?.width || node.style?.width || (node.type === 'minimalistText' ? 369.46 : node.type === 'llm' ? 280 : undefined),
        height: node.data?.height || node.style?.height || (node.type === 'minimalistText' ? 211.12 : node.type === 'llm' ? 160 : undefined),
      },
      position: node.position,
    }));
  }, []);

  const saveProjectNow = useCallback(async () => {
    if (!projectId || !window.electronAPI) return;
    const nodesToSave = normalizeNodesForSave(latestNodesRef.current);
    await window.electronAPI.saveProjectData(projectId, nodesToSave, latestEdgesRef.current);
  }, [projectId, normalizeNodesForSave]);

  // 保存历史记录
  const saveHistory = useCallback((reason: HistorySnapshotReason = 'general') => {
    if (isUndoRedoRef.current) return;

    const currentNodes = latestNodesRef.current;
    const currentEdges = latestEdgesRef.current;
    const snapshot: HistorySnapshot = {
      nodes: JSON.parse(JSON.stringify(currentNodes)),
      edges: JSON.parse(JSON.stringify(currentEdges)),
      reason,
    };

    // 移除当前位置之后的历史记录（如果有新的操作）
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }

    const lastSnapshot = historyRef.current[historyRef.current.length - 1];
    // 仅 position 连续变化时覆盖上一条，避免历史栈膨胀
    if (reason === 'position' && lastSnapshot?.reason === 'position') {
      historyRef.current[historyRef.current.length - 1] = snapshot;
      historyIndexRef.current = historyRef.current.length - 1;
      return;
    }

    historyRef.current.push(snapshot);

    // 限制历史记录数量（最多保存50条）
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
    }
    historyIndexRef.current = historyRef.current.length - 1;
  }, []);

  // 撤销操作
  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      isUndoRedoRef.current = true;
      historyIndexRef.current -= 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      
      if (snapshot) {
        setNodes(snapshot.nodes);
        setEdges(snapshot.edges);
      }
      
      setTimeout(() => {
        isUndoRedoRef.current = false;
      }, 100);
    }
  }, [setNodes, setEdges]);

  // 重做操作
  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isUndoRedoRef.current = true;
      historyIndexRef.current += 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      
      if (snapshot) {
        setNodes(snapshot.nodes);
        setEdges(snapshot.edges);
      }
      
      setTimeout(() => {
        isUndoRedoRef.current = false;
      }, 100);
    }
  }, [setNodes, setEdges]);

  const handleQuitApp = useCallback(async () => {
    if (!window.electronAPI?.quitApp) return;
    try {
      await window.electronAPI.quitApp();
    } catch (error) {
      console.error('退出软件失败:', error);
    }
  }, []);

  // 监听键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框或文本区域，不处理撤销
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      
      // Ctrl+Z 或 Cmd+Z (Mac) - 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl+Shift+Z 或 Cmd+Shift+Z (Mac) - 重做
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
      // Ctrl+Y (Windows/Linux) - 重做
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
      // ESC：弹出退出确认窗口（画布界面）
      else if (e.key === 'Escape') {
        e.preventDefault();
        setShowExitConfirm(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleUndo, handleRedo]);

  // 画布上删除节点时，仅从任务列表中移除该节点下的任务；不删除项目文件夹内的图片/视频文件
  const removeTasksForNodeIds = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    setTasks((prevTasks) => prevTasks.filter((task) => !nodeIds.includes(task.nodeId)));
  }, []);

  // 画布删除节点时仅同步任务列表，不删除项目文件夹内的图片/视频文件
  const onNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      const ids = (deletedNodes || []).map((n) => n.id);
      removeTasksForNodeIds(ids);
    },
    [removeTasksForNodeIds]
  );

  useEffect(() => {
    return () => {
      if (positionChangeRafRef.current !== null) {
        cancelAnimationFrame(positionChangeRafRef.current);
        positionChangeRafRef.current = null;
      }
      pendingPositionChangesRef.current = [];
    };
  }, []);

  // 包装 onNodesChange，捕获 dimensions 和 position 变化，并在删除节点时同步删除任务列表中该节点的任务
  const onNodesChange = useCallback((changes: any[]) => {
    const removedNodeIds = changes.filter((c: any) => c.type === 'remove' && c.id).map((c: any) => c.id);
    removeTasksForNodeIds(removedNodeIds);

    const positionChanges = changes.filter((c: any) => c.type === 'position');
    const immediateChanges = changes.filter((c: any) => c.type !== 'position');

    // 立即应用非位置变化（例如选中、尺寸、删除等）
    if (immediateChanges.length > 0) {
      onNodesChangeBase(immediateChanges);
    }

    // 高频 position 变化合并到每帧一次，降低主线程压力
    if (positionChanges.length > 0) {
      pendingPositionChangesRef.current = positionChanges;
      if (positionChangeRafRef.current === null) {
        positionChangeRafRef.current = requestAnimationFrame(() => {
          positionChangeRafRef.current = null;
          const latestPositionChanges = pendingPositionChangesRef.current;
          pendingPositionChangesRef.current = [];
          if (latestPositionChanges.length > 0) {
            onNodesChangeBase(latestPositionChanges);
          }
        });
      }
    }
    
    const hasOnlyPositionChanges = changes.length > 0 && changes.every((change) => change.type === 'position');

    // 如果不是撤销/重做操作，保存历史记录
    if (!isUndoRedoRef.current) {
      // 清除之前的定时器
      if (saveHistoryTimeoutRef.current) {
        clearTimeout(saveHistoryTimeoutRef.current);
      }
      
      // 延迟保存历史记录，避免频繁操作（300ms 防抖）
      const historyReason: HistorySnapshotReason = hasOnlyPositionChanges ? 'position' : 'general';
      saveHistoryTimeoutRef.current = setTimeout(() => {
        saveHistory(historyReason);
      }, 300);
    }
    
    // 检查是否有 dimensions 或 position 变化
    const hasDimensionOrPositionChange = changes.some((change) => {
      return (
        change.type === 'dimensions' ||
        change.type === 'position'
      );
    });

    if (hasDimensionOrPositionChange && projectId && window.electronAPI) {
      // 清除之前的定时器
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // 设置新的定时器（300ms 防抖，减少交互期主线程压力）
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          const currentNodes = latestNodesRef.current;
          const currentEdges = latestEdgesRef.current;
          const nodesToSave = currentNodes.map((node: Node) => {
            let width = node.data?.width;
            let height = node.data?.height;

            if (node.style?.width) {
              const styleWidth = parseFloat(String(node.style.width).replace('px', ''));
              if (!isNaN(styleWidth) && styleWidth > 0) width = styleWidth;
            }
            if (node.style?.height) {
              const styleHeight = parseFloat(String(node.style.height).replace('px', ''));
              if (!isNaN(styleHeight) && styleHeight > 0) height = styleHeight;
            }

            return {
              ...node,
              position: node.position,
              data: {
                ...node.data,
                width,
                height,
                isUserResized: node.data?.isUserResized ?? false,
              },
              style: {
                ...(node.style || {}),
                width: width ? `${width}px` : node.style?.width,
                height: height ? `${height}px` : node.style?.height,
              },
            };
          });

          window.electronAPI.saveProjectData(projectId, nodesToSave, currentEdges).catch((error) => {
            console.error('保存节点变化失败:', error);
          });
        } catch (error) {
          console.error('保存节点变化失败:', error);
        }
      }, 300);
    }
  }, [onNodesChangeBase, projectId, saveHistory, removeTasksForNodeIds]);

  // 包装 onEdgesChange，实时保存连线变化，并更新 Image 节点的输入图片列表
  const onEdgesChange = useCallback((changes: any[]) => {
    // 先应用变化
    onEdgesChangeBase(changes);
    
    // 如果不是撤销/重做操作，保存历史记录
    if (!isUndoRedoRef.current) {
      // 清除之前的定时器
      if (saveHistoryTimeoutRef.current) {
        clearTimeout(saveHistoryTimeoutRef.current);
      }
      
      // 延迟保存历史记录，避免频繁操作（300ms 防抖）
      saveHistoryTimeoutRef.current = setTimeout(() => {
        saveHistory('general');
      }, 300);
    }
    
    // 当连接变化时，更新所有 Image 节点的输入图片列表
    // 使用 setEdges 的回调形式获取最新的边列表
    setEdges((eds) => {
      // 更新所有 Image 节点的输入图片列表
      // 使用 latestNodesRef 获取最新节点数据，避免刚上传/刚生成的图片因 state 滞后而未同步到 cameraControl
      setNodes((nds) => {
        const freshNodes = latestNodesRef.current.length > 0 ? latestNodesRef.current : nds;
        const nodeById = new Map(freshNodes.map((n) => [n.id, n]));
        return nds.map((node) => {
          if (node.type === 'image') {
            // Image 输入图：来自 image 节点 + cameraControl 节点（cameraControl 透传其 inputImage）
            const incomingImageEdges = eds.filter((e) => {
              if (e.target !== node.id) return false;
              const src = nodeById.get(e.source);
              return src?.type === 'image';
            });
            const incomingCameraEdges = eds.filter((e) => {
              if (e.target !== node.id) return false;
              const src = nodeById.get(e.source);
              return src?.type === 'cameraControl';
            });
            const collectedImages: string[] = [];
            incomingImageEdges.forEach((edge) => {
              const sourceNode = nodeById.get(edge.source);
              if (sourceNode && sourceNode.type === 'image') {
                const imgUrl = (sourceNode.data?.outputImage as string) || (sourceNode.data?.inputImages as string[])?.[0];
                if (imgUrl && !collectedImages.includes(imgUrl)) collectedImages.push(imgUrl);
              }
            });
            incomingCameraEdges.forEach((edge) => {
              const cc = nodeById.get(edge.source);
              const imgUrl = cc?.type === 'cameraControl' ? (cc.data?.inputImage as string) : '';
              if (imgUrl && !collectedImages.includes(imgUrl)) collectedImages.push(imgUrl);
            });
            const newInputImages = collectedImages.slice(0, 10);
            
            const incomingTextEdges = eds.filter((e) => {
              if (e.target !== node.id) return false;
              const src = nodeById.get(e.source);
              return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'cameraControl');
            });
            
            let promptText = node.data?.prompt || '';
            if (incomingTextEdges.length > 0) {
              const parts: string[] = [];
              for (const edge of incomingTextEdges) {
                const sourceNode = nodeById.get(edge.source);
                if (!sourceNode) continue;
                if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                  if (sourceNode.data?.text) parts.push(String(sourceNode.data.text).trim());
                } else if (sourceNode.type === 'llm' && sourceNode.data?.outputText) {
                  parts.push(String(sourceNode.data.outputText).trim());
                } else if (sourceNode.type === 'textSplit' && sourceNode.data?.segments) {
                  const sh = edge.sourceHandle || '';
                  const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
                  const seg = sourceNode.data.segments as (string | number | boolean)[];
                  if (Number.isInteger(idx) && seg[idx] !== undefined) parts.push(String(seg[idx]).trim());
                } else if (sourceNode.type === 'cameraControl') {
                  const pp = sourceNode.data?.prompt_payload as { qwen_instruction?: string; prompt_metadata?: { formatted_output?: string }; full_camera_prompt?: string; camera_tags?: string } | undefined;
                  const cameraPrompt = pp?.qwen_instruction || pp?.prompt_metadata?.formatted_output || pp?.full_camera_prompt || pp?.camera_tags || '';
                  if (cameraPrompt) parts.push(String(cameraPrompt).trim());
                }
              }
              if (parts.length > 0) promptText = parts.join(',');
            }
            
            // 如果输入图片列表或 prompt 发生变化，更新节点数据
            const currentInputImages = node.data?.inputImages || [];
            const currentPrompt = node.data?.prompt || '';
            const inputImagesChanged =
              JSON.stringify([...currentInputImages].sort()) !== JSON.stringify([...newInputImages].sort());
            const promptChanged = currentPrompt !== promptText;
            
            if (inputImagesChanged || promptChanged) {
              // 如果当前选中的是这个节点，更新输入面板数据
              if (selectedNode && selectedNode.id === node.id) {
                setImageInputPanelData((prev) => {
                  if (prev && prev.nodeId === node.id) {
                    return {
                      ...prev,
                      inputImages: newInputImages,
                      prompt: promptText,
                    };
                  }
                  return prev;
                });
              }
              
              return {
                ...node,
                data: {
                  ...node.data,
                  inputImages: newInputImages,
                  prompt: promptText,
                },
              };
            }
          } else if (node.type === 'cameraControl') {
            const incomingImageEdges = eds.filter((e) => {
              if (e.target !== node.id) return false;
              const src = nodeById.get(e.source);
              return src?.type === 'image';
            });
            const srcNode = incomingImageEdges
              .map((edge) => nodeById.get(edge.source))
              .find((n) => n?.type === 'image');
            // 优先 outputImage（生成结果），无则用 inputImages[0]（图生图参考图）
            const rawUrl =
              (srcNode?.data?.outputImage as string) ||
              ((srcNode?.data?.inputImages as string[])?.[0] ?? '') ||
              '';
            const nextInputImage = rawUrl ? formatImagePathSync(rawUrl) : '';
            const currentInputImage = (node.data?.inputImage as string) || '';
            if (nextInputImage !== currentInputImage) {
              return {
                ...node,
                data: {
                  ...node.data,
                  inputImage: nextInputImage,
                },
              };
            }
          }
          return node;
        });
      });

      return eds; // 返回原边列表，不修改
    });
    
    if (projectId && window.electronAPI) {
      // 清除之前的定时器
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // 设置新的定时器（300ms 防抖）
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          const currentNodes = latestNodesRef.current;
          const currentEdges = latestEdgesRef.current;
          const edgesToSave = currentEdges.map((edge: Edge) => ({
            ...edge,
            sourceHandle: edge.sourceHandle || 'output',
            targetHandle: edge.targetHandle || 'input',
          }));

          window.electronAPI.saveProjectData(projectId, currentNodes, edgesToSave).catch((error) => {
            console.error('保存连线变化失败:', error);
          });
        } catch (error) {
          console.error('保存连线变化失败:', error);
        }
      }, 300);
    }
  }, [onEdgesChangeBase, projectId, setEdges, setNodes, selectedNode, saveHistory]);
  
  const dedupedSortedTasks = useMemo(() => {
    const uniqueTasksMap = new Map<string, Task>();
    tasks.forEach((task) => {
      const url = task.imageUrl || task.videoUrl || task.audioUrl || '';
      const key = `${task.nodeId}_${url}_${task.prompt}`;
      const existingTask = uniqueTasksMap.get(key);
      if (!existingTask || task.createdAt > existingTask.createdAt) {
        uniqueTasksMap.set(key, task);
      }
    });
    return Array.from(uniqueTasksMap.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [tasks]);

  // LLM 输入面板状态（用于底部弹窗）
  const [llmInputPanelData, setLlmInputPanelData] = useState<{
    nodeId: string;
    inputText: string;
    userInput: string;
    prompt: string;
    savedPrompts: Array<{ id: string; name: string; content: string }>;
    isInputLocked?: boolean;
    isImageReverseMode?: boolean;
    imageUrlForReverse?: string;
    /** 图像反推使用的模型：gpt-4o | joy-caption-two */
    reverseCaptionModel?: 'gpt-4o' | 'joy-caption-two';
  } | null>(null);

  // Image 输入面板状态（用于底部弹窗）
  const [imageInputPanelData, setImageInputPanelData] = useState<{
    nodeId: string;
    prompt: string;
    resolution: string;
    aspectRatio: string;
    model: string;
    seedreamWidth?: number; // seedream-v4.5 宽 1024-4096
    seedreamHeight?: number; // seedream-v4.5 高 1024-4096
    inputImages?: string[]; // 输入的参考图数组（最多10张）
  } | null>(null);

  // Video 输入面板状态（用于底部弹窗）
  const [videoInputPanelData, setVideoInputPanelData] = useState<{
    nodeId: string;
    prompt: string;
    aspectRatio: '16:9' | '9:16' | '1:1' | '2:3' | '3:2';
    model: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'wan-2.6' | 'wan-2.6-flash' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'rhart-video-g' | 'rhart-video-s-i2v-pro' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard';
    hd: boolean;
    duration: '5' | '10' | '15' | '25';
    inputImages?: string[];
    resolutionRhartV31?: '720p' | '1080p' | '4k';
    durationRhartVideoG?: '6s' | '10s';
    durationHailuo02?: '6' | '10';
    durationKlingO1?: '5' | '10';
    modeKlingO1?: 'std' | 'pro';
    referenceVideoUrl?: string;
    keepOriginalSound?: boolean;
    isConnected?: boolean;
    guidanceScale?: number;
    sound?: 'true' | 'false';
    shotType?: 'single' | 'multi';
    negativePrompt?: string;
    resolutionWan26?: '720p' | '1080p';
    durationWan26Flash?: '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15';
    enableAudio?: boolean;
  } | null>(null);

  const [characterInputPanelData, setCharacterInputPanelData] = useState<{
    nodeId: string;
    videoUrl: string;
    nickname: string;
    timestamp: string;
    isConnected?: boolean;
    isUploading?: boolean;
    needsUpload?: boolean; // 是否需要上传（检测到本地视频但未上传）
    localVideoPath?: string; // 本地视频路径（用于上传）
    uploadPromise?: Promise<{ success: boolean; url?: string; error?: string }>; // 视频上传到 OSS 的 Promise
  } | null>(null);

  // Audio 输入面板状态（用于底部弹窗）
  const [audioInputPanelData, setAudioInputPanelData] = useState<{
    nodeId: string;
    text: string;
    model?: string;
    voiceId: string;
    speed: number;
    volume: number;
    pitch: number;
    emotion?: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
    referenceAudioUrl?: string;
    songName?: string;
    styleDesc?: string;
    lyrics?: string;
  } | null>(null);
  
  // 侧边栏展开/收起状态
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false); // 默认收起任务列表
  const [characterListCollapsed, setCharacterListCollapsed] = useState(true); // 默认收起角色列表
  const [characterListRefreshTrigger, setCharacterListRefreshTrigger] = useState(0);
  
  // API 状态和余额
  const [bltcyStatus, setBltcyStatus] = useState<ApiStatus>('unknown');
  const [rhStatus, setRhStatus] = useState<ApiStatus>('unknown');
  const [bltcyBalance, setBltcyBalance] = useState<number | null>(null);
  const [rhBalance, setRhBalance] = useState<number | null>(null);
  const [isCheckingApi, setIsCheckingApi] = useState(false);

  // 右键菜单状态（含拖线到空白处时的 connectFrom，用于创建节点后自动连边）
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    flowX?: number;
    flowY?: number;
    connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null };
  } | null>(null);
  
  // 明暗模式状态
  const [isDarkMode, setIsDarkMode] = useState(true);

  // 自动刷新余额定时器引用
  const autoRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // 防止重复初始化的标志
  const hasInitializedRef = useRef(false);
  // 存储 checkAllApiStatus 的引用，避免 useEffect 重复执行
  const checkAllApiStatusRef = useRef<(() => Promise<void>) | null>(null);

  // 监听余额更新事件（从主进程发送）
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleBalanceUpdate = (data: { type: 'bltcy' | 'rh'; balance: number | null }) => {
      if (data.type === 'bltcy') {
        setBltcyBalance(data.balance);
        setBltcyStatus(data.balance !== null ? 'success' : 'error');
      } else if (data.type === 'rh') {
        setRhBalance(data.balance);
        setRhStatus(data.balance !== null ? 'success' : 'error');
      }
    };

    // 监听余额更新事件
    window.electronAPI.onBalanceUpdated(handleBalanceUpdate);

    return () => {
      // 清理监听器
      window.electronAPI.removeBalanceUpdatedListener();
    };
  }, []);

  // 全局人设列表状态
  const [globalPersonas, setGlobalPersonas] = useState<Array<{ id: string; name: string; content: string }>>([]);

  // 加载全局人设列表
  useEffect(() => {
    if (!window.electronAPI) return;

    const loadGlobalPersonas = async () => {
      try {
        const personas = await window.electronAPI.getGlobalLLMPersonas();
        setGlobalPersonas(personas || []);
      } catch (error) {
        console.error('加载全局人设失败:', error);
      }
    };

    loadGlobalPersonas();
  }, []);

  // 加载任务列表
  useEffect(() => {
    if (!window.electronAPI) return;

    const loadTasks = async () => {
      try {
        const result = await window.electronAPI.loadTasks();
        if (result.success && result.tasks) {
          setTasks(result.tasks);
          console.log('[任务列表] 已加载', result.tasks.length, '个任务');
        }
      } catch (error) {
        console.error('加载任务列表失败:', error);
      }
    };

    loadTasks();
  }, []);

  // 自动保存任务列表（使用防抖，避免频繁保存）
  const saveTasksTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoadRef = useRef(true); // 标记是否是初始加载
  useEffect(() => {
    if (!window.electronAPI) return;

    // 跳过初始加载时的保存（因为初始加载时 tasks 会从空数组变为加载的数据）
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    // 清除之前的定时器
    if (saveTasksTimeoutRef.current) {
      clearTimeout(saveTasksTimeoutRef.current);
    }

    // 设置新的定时器，延迟 1 秒保存（防抖）
    saveTasksTimeoutRef.current = setTimeout(async () => {
      try {
        const result = await window.electronAPI.saveTasks(tasks);
        if (result.success && result.tasks && result.tasks.length !== tasks.length) {
          setTasks(result.tasks);
          console.log('[任务列表] 已保存并清理无效任务:', result.tasks.length, '个');
        } else {
          console.log('[任务列表] 已保存', tasks.length, '个任务');
        }
      } catch (error) {
        console.error('保存任务列表失败:', error);
      }
    }, 1000);

    // 清理函数
    return () => {
      if (saveTasksTimeoutRef.current) {
        clearTimeout(saveTasksTimeoutRef.current);
      }
    };
  }, [tasks]);

  // 加载项目数据
  useEffect(() => {
    if (!projectId || !window.electronAPI) return;

    const loadProjectData = async () => {
      try {
        const projectData = await window.electronAPI.loadProjectData(projectId);
        if (projectData.nodes && projectData.nodes.length > 0) {
          // 确保节点数据包含 width、height 和 position，正确恢复所有状态
          const nodesWithSize = projectData.nodes.map((node: Node) => {
            // 根据节点类型设置不同的最小尺寸
            let MIN_WIDTH = 369.46;
            let MIN_HEIGHT = 211.12;
            
            if (node.type === 'text' || node.type === 'minimalistText') {
              MIN_WIDTH = 280;
              MIN_HEIGHT = 160;
            } else if (node.type === 'llm') {
              MIN_WIDTH = 369.46;
              MIN_HEIGHT = 211.12;
            }
            
            // 从 data 或 style 中恢复尺寸
            let width = node.data?.width;
            let height = node.data?.height;
            
            // 如果 data 中没有，尝试从 style 中解析
            if (!width && (node as any).style?.width) {
              width = parseFloat((node as any).style.width.replace('px', ''));
            }
            if (!height && (node as any).style?.height) {
              height = parseFloat((node as any).style.height.replace('px', ''));
            }
            
            // 如果仍然没有尺寸，使用节点类型的默认值
            if (!width) {
              width = node.type === 'text' || node.type === 'minimalistText' ? 280 : MIN_WIDTH;
            }
            if (!height) {
              height = node.type === 'text' || node.type === 'minimalistText' ? 160 : MIN_HEIGHT;
            }
            
            // 确保不小于最小尺寸
            width = Math.max(MIN_WIDTH, width);
            height = Math.max(MIN_HEIGHT, height);
            
            return {
              ...node,
              position: node.position || { x: 0, y: 0 },
              data: {
                ...node.data,
                width,
                height,
              },
              style: {
                ...(node.style || {}),
                width: `${width}px`,
                height: `${height}px`,
                minWidth: `${MIN_WIDTH}px`,
                minHeight: `${MIN_HEIGHT}px`,
              },
            };
          });
          setNodes(nodesWithSize);
          
          // 延迟恢复连线，确保节点 Handle 已完全渲染
          if (projectData.edges && projectData.edges.length > 0) {
            setTimeout(() => {
              // 确保 edges 中的 sourceHandle 和 targetHandle 与节点 Handle id 一致
              const edgesWithHandles = projectData.edges.map((edge: Edge) => {
                const targetNode = projectData.nodes.find((n: Node) => n.id === edge.target);
                const sourceNode = projectData.nodes.find((n: Node) => n.id === edge.source);
                let targetHandle = edge.targetHandle || 'input';
                if (targetNode && targetNode.type === 'image') {
                  targetHandle = edge.targetHandle ?? (sourceNode?.type === 'image' ? 'image-input' : 'input');
                }
                return {
                  ...edge,
                  sourceHandle: edge.sourceHandle || 'output',
                  targetHandle,
                };
              });
              setEdges(edgesWithHandles);
              // 项目加载后，根据连线同步 cameraControl 的 inputImage（兼容旧项目或未持久化的状态）
              setNodes((nds) => {
                const nodeById = new Map(nds.map((n) => [n.id, n]));
                return nds.map((node) => {
                  if (node.type !== 'cameraControl') return node;
                  const incomingImageEdges = edgesWithHandles.filter((e) => {
                    if (e.target !== node.id) return false;
                    const src = nodeById.get(e.source);
                    return src?.type === 'image';
                  });
                  const srcNode = incomingImageEdges
                    .map((e) => nodeById.get(e.source))
                    .find((n) => n?.type === 'image');
                  const rawUrl =
                    (srcNode?.data?.outputImage as string) ||
                    ((srcNode?.data?.inputImages as string[])?.[0] ?? '') ||
                    '';
                  const nextInputImage = rawUrl ? formatImagePathSync(rawUrl) : '';
                  const currentInputImage = (node.data?.inputImage as string) || '';
                  if (nextInputImage !== currentInputImage) {
                    return { ...node, data: { ...node.data, inputImage: nextInputImage } };
                  }
                  return node;
                });
              });
            }, 100);
          }
        } else if (projectData.edges && projectData.edges.length > 0) {
          // 如果没有节点但有连线，也延迟加载
          setTimeout(() => {
            const edgesWithHandles = projectData.edges.map((edge: Edge) => {
              const targetNode = projectData.nodes?.find((n: Node) => n.id === edge.target);
              const sourceNode = projectData.nodes?.find((n: Node) => n.id === edge.source);
              let targetHandle = edge.targetHandle || 'input';
              if (targetNode && targetNode.type === 'image') {
                targetHandle = edge.targetHandle ?? (sourceNode?.type === 'image' ? 'image-input' : 'input');
              }
              return {
                ...edge,
                sourceHandle: edge.sourceHandle || 'output',
                targetHandle,
              };
            });
            setEdges(edgesWithHandles);
            
            // 初始化历史记录（项目加载完成后）
            setTimeout(() => {
              setNodes((currentNodes) => {
                setEdges((currentEdges) => {
                  const initialSnapshot = {
                    nodes: JSON.parse(JSON.stringify(currentNodes)),
                    edges: JSON.parse(JSON.stringify(currentEdges)),
                    reason: 'general' as const,
                  };
                  historyRef.current = [initialSnapshot];
                  historyIndexRef.current = 0;
                  return currentEdges;
                });
                return currentNodes;
              });
            }, 200);
          }, 100);
        } else {
          // 如果项目为空，也初始化历史记录
          setTimeout(() => {
            setNodes((currentNodes) => {
              setEdges((currentEdges) => {
                const initialSnapshot = {
                  nodes: JSON.parse(JSON.stringify(currentNodes)),
                  edges: JSON.parse(JSON.stringify(currentEdges)),
                  reason: 'general' as const,
                };
                historyRef.current = [initialSnapshot];
                historyIndexRef.current = 0;
                return currentEdges;
              });
              return currentNodes;
            });
          }, 200);
        }
      } catch (error) {
        console.error('加载项目数据失败:', error);
      }
    };

    loadProjectData();
    
    // 加载项目时，确保路径映射已创建
    const ensureMapping = async () => {
      if (!projectId || !window.electronAPI) return;
      
      try {
        const mappedPath = await window.electronAPI.ensureProjectMapping(projectId);
        if (mappedPath) {
          console.log(`[Workspace] 项目路径映射已确保: ${projectId} -> ${mappedPath}`);
        } else {
          console.warn(`[Workspace] 项目路径映射创建失败: ${projectId}`);
        }
      } catch (error) {
        console.error(`[Workspace] 确保项目路径映射失败: ${projectId}`, error);
      }
    };
    
    ensureMapping();
  }, [projectId, setNodes, setEdges]);

  // 实时保存项目数据（防抖，监听 nodes 和 edges 变化）
  useEffect(() => {
    if (!projectId || !window.electronAPI) return;

    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // 设置新的定时器（300ms 防抖，更快响应）
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const nodesToSave = normalizeNodesForSave(nodes as Node[]);
        await window.electronAPI.saveProjectData(projectId, nodesToSave, edges);
      } catch (error) {
        console.error('保存项目数据失败:', error);
      }
    }, 300);

    // 清理函数
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [projectId, nodes, edges, normalizeNodesForSave]);

  // 离开画布前强制落盘一次，避免“刚拖入就退出”导致防抖保存未触发而丢失
  useEffect(() => {
    return () => {
      saveProjectNow().catch((error) => {
        console.error('离开画布时保存项目失败:', error);
      });
    };
  }, [saveProjectNow]);

  // 用于 TextNode 更新数据的回调
  const handleTextNodeDataChange = useCallback((nodeId: string, updates: { text?: string; width?: number; height?: number }) => {
    setNodes((nds) => {
      const updatedNodes = nds.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                ...updates,
              },
            }
          : node
      );

      // 如果更新的是文本节点的文本，检查是否有连接到 LLM 或 Image 节点的边
      if (updates.text !== undefined) {
        const connectedEdges = edges.filter((e) => e.source === nodeId && e.target);
        connectedEdges.forEach((edge) => {
          const targetNode = updatedNodes.find((n) => n.id === edge.target);
          if (targetNode?.type === 'llm') {
            // 更新 LLM 节点的 inputText
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              updatedNodes[targetIndex] = {
                ...updatedNodes[targetIndex],
                data: {
                  ...updatedNodes[targetIndex].data,
                  inputText: updates.text,
                },
              };
            }
          } else if (targetNode?.type === 'image') {
            // 更新 Image 节点的 prompt（文生图模式）
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              updatedNodes[targetIndex] = {
                ...updatedNodes[targetIndex],
                data: {
                  ...updatedNodes[targetIndex].data,
                  prompt: updates.text,
                },
              };
              
              // 如果目标 Image 节点当前被选中，更新输入面板数据
              if (selectedNode && selectedNode.id === edge.target) {
                setImageInputPanelData((prev) => {
                  if (prev && prev.nodeId === edge.target) {
                    return {
                      ...prev,
                      prompt: updates.text,
                    };
                  }
                  return prev;
                });
              }
            }
          }
        });
      }

      return updatedNodes;
    });
  }, [setNodes, edges]);

  // 用于 VideoNode 更新数据的回调（处理视频输出变化，同步到连接的 Character 节点）
  const handleVideoNodeDataChange = useCallback((nodeId: string, updates: { outputVideo?: string; originalVideoUrl?: string; width?: number; height?: number; title?: string; progress?: number; progressMessage?: string; errorMessage?: string }) => {
    const applyUpdate = () => {
      // 通过对象解构生成新引用，保证 React 能正确检测 state 变更
      setNodes((nds) => {
        const updatedNodes = nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...updates,
                },
              }
            : node
        );

      // 如果 video 节点的 outputVideo 或 originalVideoUrl 更新了，自动更新连接到它的 character 节点
      // 优先使用网络 URL（originalVideoUrl），如果没有则使用 outputVideo（如果是网络 URL）
      // 如果是本地路径，自动上传到 OSS
      if (updates.outputVideo || updates.originalVideoUrl) {
        // 优先使用 originalVideoUrl（网络 URL）
        let videoUrlToPass = '';
        let needsUpload = false;
        let localVideoPath = '';
        
        if (updates.originalVideoUrl) {
          videoUrlToPass = updates.originalVideoUrl;
        } else if (updates.outputVideo) {
          const outputVideo = updates.outputVideo;
          // 如果是网络 URL（http/https），直接使用
          if (outputVideo.startsWith('http://') || outputVideo.startsWith('https://')) {
            videoUrlToPass = outputVideo;
          } else if (outputVideo.startsWith('local-resource://') || outputVideo.startsWith('file://')) {
            // 如果是本地路径，需要上传到 OSS
            needsUpload = true;
            localVideoPath = outputVideo;
            console.log('[Workspace] 检测到本地视频路径更新，准备上传到 OSS:', localVideoPath);
          } else {
            // 如果是本地路径，尝试从节点数据中获取 originalVideoUrl
            const currentNode = updatedNodes.find((n) => n.id === nodeId);
            if (currentNode && currentNode.data?.originalVideoUrl) {
              videoUrlToPass = currentNode.data.originalVideoUrl as string;
            } else {
              // 如果没有网络 URL，使用本地路径（但应该优先使用网络 URL）
              console.warn('[Workspace] Video 节点没有保存网络 URL，使用本地路径:', outputVideo);
              videoUrlToPass = outputVideo;
            }
          }
        }
        
        // 查找所有从本 video 连到 character 的边（角色仅 input 把手，兼容旧数据 video-input）
        const connectedCharacterNodes = edges
          .filter((edge) => {
            if (edge.source !== nodeId) return false;
            if (edge.targetHandle === 'video-input') return true;
            if (edge.targetHandle === 'input') {
              const targetNode = nodes.find((n) => n.id === edge.target);
              return targetNode?.type === 'character';
            }
            return false;
          })
          .map((edge) => edge.target);
        
        // 如果需要上传，显示"确认上传视频"按钮（不自动上传）
        if (needsUpload && localVideoPath && window.electronAPI && connectedCharacterNodes.length > 0) {
          // 如果当前选中的 character 节点连接到这个 video 节点，显示"确认上传视频"状态
          if (selectedNode && selectedNode.type === 'character' && connectedCharacterNodes.includes(selectedNode.id)) {
            setCharacterInputPanelData((prev) => {
              if (prev && prev.nodeId === selectedNode.id) {
                return {
                  ...prev,
                  videoUrl: localVideoPath, // 显示本地路径（用于提示）
                  needsUpload: true, // 标记需要上传
                  localVideoPath: localVideoPath, // 保存本地路径
                  isUploading: false, // 未开始上传
                };
              }
              return prev;
            });
          }
          
          // 不自动上传，等待用户点击"确认上传视频"按钮
          return updatedNodes;
        }
        
        // 如果需要上传，异步执行上传操作（已废弃，改为手动确认上传）
        if (false && needsUpload && localVideoPath && window.electronAPI && connectedCharacterNodes.length > 0) {
          // 创建上传 Promise（使用 upload-video-to-oss IPC）
          const uploadPromise = window.electronAPI.uploadVideoToOSS(localVideoPath);
          
          // 如果当前选中的 character 节点连接到这个 video 节点，显示上传状态（不填入本地路径），并保存 uploadPromise
          if (selectedNode && selectedNode.type === 'character' && connectedCharacterNodes.includes(selectedNode.id)) {
            setCharacterInputPanelData((prev) => {
              if (prev && prev.nodeId === selectedNode.id) {
                return {
                  ...prev,
                  videoUrl: '', // 不填入本地路径，留空
                  isUploading: true, // 显示上传状态
                  uploadPromise: uploadPromise, // 保存上传 Promise
                };
              }
              return prev;
            });
          }
          
          // 异步上传到 OSS
          uploadPromise
            .then((result) => {
              if (result.success && result.url) {
                console.log('[Workspace] 视频上传到 OSS 成功，OSS URL:', result.url);
                // 更新所有连接的 character 节点
                setNodes((nds) => {
                  return nds.map((node) => {
                    if (connectedCharacterNodes.includes(node.id) && node.type === 'character') {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          videoUrl: result.url!, // 使用 OSS URL
                        },
                      };
                    }
                    return node;
                  });
                });
                
                // 更新输入面板数据
                if (selectedNode && selectedNode.type === 'character' && connectedCharacterNodes.includes(selectedNode.id)) {
                  setCharacterInputPanelData((prev) => {
                    if (prev && prev.nodeId === selectedNode.id) {
                      return {
                        ...prev,
                        videoUrl: result.url!, // 使用 OSS URL
                        isUploading: false, // 清除上传状态
                        uploadPromise: undefined, // 清除 uploadPromise
                      };
                    }
                    return prev;
                  });
                }
              } else {
                console.error('[Workspace] 视频上传到 OSS 失败:', result.error);
                // 上传失败，清除上传状态
                if (selectedNode && selectedNode.type === 'character' && connectedCharacterNodes.includes(selectedNode.id)) {
                  setCharacterInputPanelData((prev) => {
                    if (prev && prev.nodeId === selectedNode.id) {
                      return {
                        ...prev,
                        videoUrl: '', // 上传失败，清空URL
                        isUploading: false,
                        uploadPromise: undefined, // 清除 uploadPromise
                      };
                    }
                    return prev;
                  });
                }
              }
            })
            .catch((error) => {
              console.error('[Workspace] 视频上传到 OSS 时出错:', error);
              // 上传失败，清除上传状态
              if (selectedNode && selectedNode.type === 'character' && connectedCharacterNodes.includes(selectedNode.id)) {
                setCharacterInputPanelData((prev) => {
                  if (prev && prev.nodeId === selectedNode.id) {
                    return {
                      ...prev,
                      videoUrl: '', // 上传失败，清空URL
                      isUploading: false,
                      uploadPromise: undefined, // 清除 uploadPromise
                    };
                  }
                  return prev;
                });
              }
            });
          
          // 不更新节点数据，等待上传完成后再更新
          return updatedNodes;
        }
        
        if (videoUrlToPass) {
          // 更新所有连接的 character 节点
          return updatedNodes.map((node) => {
            if (connectedCharacterNodes.includes(node.id) && node.type === 'character') {
              return {
                ...node,
                data: {
                  ...node.data,
                  videoUrl: videoUrlToPass, // 传递网络 URL
                  timestamp: node.data?.timestamp || '1,3', // 如果时间戳为空，设置默认值 "1,3"
                },
              };
            }
            return node;
          });
        }
      }

      return updatedNodes;
    });
    };
    if (updates.outputVideo !== undefined) {
      flushSync(applyUpdate);
    } else {
      applyUpdate();
    }
    // 如果当前选中的是 character 节点，且它连接到这个 video 节点，更新输入面板数据
    // 优先使用网络 URL（originalVideoUrl），如果是本地路径则自动上传
    if ((updates.outputVideo || updates.originalVideoUrl) && selectedNode && selectedNode.type === 'character') {
      const isConnectedToThisVideo = edges.some(
        (edge) =>
          edge.source === nodeId &&
          edge.target === selectedNode.id &&
          (edge.targetHandle === 'video-input' || edge.targetHandle === 'input')
      );
      if (isConnectedToThisVideo) {
        // 优先使用 originalVideoUrl（网络 URL）
        let videoUrlToPass = '';
        let needsUpload = false;
        let localVideoPath = '';
        
        if (updates.originalVideoUrl) {
          videoUrlToPass = updates.originalVideoUrl;
        } else if (updates.outputVideo) {
          const outputVideo = updates.outputVideo;
          // 如果是网络 URL（http/https），直接使用
          if (outputVideo.startsWith('http://') || outputVideo.startsWith('https://')) {
            videoUrlToPass = outputVideo;
          } else if (outputVideo.startsWith('local-resource://') || outputVideo.startsWith('file://')) {
            // 如果是本地路径，需要上传到 OSS
            needsUpload = true;
            localVideoPath = outputVideo;
            console.log('[Workspace] 检测到本地视频路径更新，准备上传到 OSS:', localVideoPath);
          } else {
            // 如果是本地路径，尝试从节点数据中获取 originalVideoUrl
            const currentNode = nodes.find((n) => n.id === nodeId);
            if (currentNode && currentNode.data?.originalVideoUrl) {
              videoUrlToPass = currentNode.data.originalVideoUrl as string;
            } else {
              videoUrlToPass = outputVideo;
            }
          }
        }
        
        // 如果需要上传，显示"确认上传视频"按钮（不自动上传）
        if (needsUpload && localVideoPath && window.electronAPI) {
          // 显示"确认上传视频"状态
          setCharacterInputPanelData((prev) => {
            if (prev && prev.nodeId === selectedNode.id) {
              return {
                ...prev,
                videoUrl: localVideoPath, // 显示本地路径（用于提示）
                isConnected: true,
                needsUpload: true, // 标记需要上传
                localVideoPath: localVideoPath, // 保存本地路径
                isUploading: false, // 未开始上传
                timestamp: prev.timestamp || '1,3',
              };
            }
            return prev;
          });
          
          // 不自动上传，等待用户点击"确认上传视频"按钮
          return;
        }
        
        // 如果需要上传，异步执行上传操作（已废弃，改为手动确认上传）
        if (false && needsUpload && localVideoPath && window.electronAPI) {
          // 创建上传 Promise（使用 upload-video-to-oss IPC）
          const uploadPromise = window.electronAPI.uploadVideoToOSS(localVideoPath);
          
          // 显示上传状态（不填入本地路径），并保存 uploadPromise
          setCharacterInputPanelData((prev) => {
            if (prev && prev.nodeId === selectedNode.id) {
              return {
                ...prev,
                videoUrl: '', // 不填入本地路径，留空
                isConnected: true,
                isUploading: true, // 显示上传状态
                timestamp: prev.timestamp || '1,3',
                uploadPromise: uploadPromise, // 保存上传 Promise
              };
            }
            return prev;
          });
          
          // 异步上传到 OSS
          uploadPromise
            .then((result) => {
              if (result.success && result.url) {
                console.log('[Workspace] 视频上传到 OSS 成功，OSS URL:', result.url);
                // 更新输入面板数据
                setCharacterInputPanelData((prev) => {
                  if (prev && prev.nodeId === selectedNode.id) {
                    return {
                      ...prev,
                      videoUrl: result.url!, // 使用 OSS URL
                      isUploading: false, // 清除上传状态
                      uploadPromise: undefined, // 清除 uploadPromise
                    };
                  }
                  return prev;
                });
              } else {
                console.error('[Workspace] 视频上传到 OSS 失败:', result.error);
                // 上传失败，清除上传状态，不填入任何URL
                setCharacterInputPanelData((prev) => {
                  if (prev && prev.nodeId === selectedNode.id) {
                    return {
                      ...prev,
                      videoUrl: '', // 上传失败，清空URL
                      isUploading: false,
                      uploadPromise: undefined, // 清除 uploadPromise
                    };
                  }
                  return prev;
                });
              }
            })
            .catch((error) => {
              console.error('[Workspace] 视频上传到 OSS 时出错:', error);
              // 上传失败，清除上传状态，不填入任何URL
              setCharacterInputPanelData((prev) => {
                if (prev && prev.nodeId === selectedNode.id) {
                  return {
                    ...prev,
                    videoUrl: '', // 上传失败，清空URL
                    isUploading: false,
                    uploadPromise: undefined, // 清除 uploadPromise
                  };
                }
                return prev;
              });
            });
        } else if (videoUrlToPass) {
          // 如果有网络 URL，直接使用
          setCharacterInputPanelData((prev) => {
            if (prev && prev.nodeId === selectedNode.id) {
              return {
                ...prev,
                videoUrl: videoUrlToPass,
                isConnected: true,
                isUploading: false, // 确保不是上传状态
                timestamp: prev.timestamp || '1,3', // 如果时间戳为空，设置默认值 "1,3"
              };
            }
            return prev;
          });
        }
      }
    }
  }, [setNodes, edges, selectedNode]);

  // 监听任务列表变化，同步失败状态到 VideoNode（需要在 handleVideoNodeDataChange 定义之后）
  useEffect(() => {
    // 查找所有失败的视频任务
    const failedVideoTasks = tasks.filter(
      (task) => task.taskType === 'video' && task.status === 'error' && task.nodeId
    );

    failedVideoTasks.forEach((task) => {
      // 更新对应的 VideoNode：停止进度条并显示错误信息
      setNodes((nds) =>
        nds.map((node) =>
          node.id === task.nodeId
            ? { ...node, data: { ...node.data, progress: 0, errorMessage: task.errorMessage || '视频生成失败' } }
            : node
        )
      );
      handleVideoNodeDataChange(task.nodeId, { progress: 0, errorMessage: task.errorMessage || '视频生成失败' });
    });
  }, [tasks, setNodes, handleVideoNodeDataChange]);

  // 监听 LLM 节点的 outputText 变化，实时更新连接到它的其他 LLM 节点的 inputText（按所有入边顺序逗号拼接）
  useEffect(() => {
    const llmOutputTexts = nodes
      .filter((n) => n.type === 'llm')
      .map((n) => ({ id: n.id, outputText: n.data?.outputText || '' }));
    const affectedTargetIds = new Set<string>();
    llmOutputTexts.forEach(({ id: sourceNodeId }) => {
      edges
        .filter((e) => e.source === sourceNodeId && e.target)
        .forEach((edge) => {
          const targetNode = nodes.find((n) => n.id === edge.target);
          if (targetNode?.type === 'llm') affectedTargetIds.add(edge.target!);
        });
    });
    affectedTargetIds.forEach((llmId) => {
      const incoming = edges.filter((e) => e.target === llmId);
      const textSourceEdges = incoming.filter((e) => {
        const src = nodes.find((n) => n.id === e.source);
        return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
      });
      const parts: string[] = [];
      for (const e of textSourceEdges) {
        const src = nodes.find((n) => n.id === e.source);
        if (!src) continue;
        if (src.type === 'minimalistText' || src.type === 'text') {
          if (src.data?.text) parts.push(String(src.data.text).trim());
        } else if (src.type === 'llm' && src.data?.outputText) {
          parts.push(String(src.data.outputText).trim());
        } else if (src.type === 'textSplit' && src.data?.segments) {
          const sh = e.sourceHandle || '';
          const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
          const seg = src.data.segments as (string | number | boolean)[];
          if (Number.isInteger(idx) && seg[idx] !== undefined) parts.push(String(seg[idx]).trim());
        }
      }
      const resolvedInputText = parts.join(',');
      const targetNode = nodes.find((n) => n.id === llmId);
      if (targetNode?.data?.inputText === resolvedInputText) return;
      setNodes((nds) =>
        nds.map((node) =>
          node.id === llmId ? { ...node, data: { ...node.data, inputText: resolvedInputText } } : node
        )
      );
      if (selectedNode?.id === llmId) {
        setLlmInputPanelData((prev) =>
          prev && prev.nodeId === llmId ? { ...prev, inputText: resolvedInputText } : prev
        );
      }
    });
  }, [nodes.map((n) => (n.type === 'llm' ? n.data?.outputText : '')).join('|'), edges, selectedNode?.id, setNodes]);

  // 当 text/LLM 节点内容变化时，同步到下游 Image 节点的 prompt（按入边顺序逗号拼接）
  const textSourceContentKey = nodes
    .filter((n) => n.type === 'minimalistText' || n.type === 'text' || n.type === 'llm' || n.type === 'cameraControl')
    .map((n) =>
      n.type === 'cameraControl'
        ? `${n.id}:${(n.data?.prompt_payload as any)?.qwen_instruction ?? (n.data?.prompt_payload as any)?.prompt_metadata?.formatted_output ?? (n.data?.prompt_payload as any)?.full_camera_prompt ?? (n.data?.prompt_payload as any)?.camera_tags ?? ''}`
        : `${n.id}:${(n.data?.text ?? n.data?.outputText ?? '')}`
    )
    .join('|');
  useEffect(() => {
    const imageIdsWithTextInput = new Set<string>();
    edges.forEach((e) => {
      const src = nodes.find((n) => n.id === e.source);
      const target = nodes.find((n) => n.id === e.target);
      if (target?.type === 'image' && src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'cameraControl')) {
        imageIdsWithTextInput.add(e.target);
      }
    });
    imageIdsWithTextInput.forEach((imageId) => {
      const incoming = edges.filter((e) => {
        if (e.target !== imageId) return false;
        const src = nodes.find((n) => n.id === e.source);
        return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'cameraControl');
      });
      const textSourceEdges = incoming.filter((e) => {
        const src = nodes.find((n) => n.id === e.source);
        return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'cameraControl');
      });
      const parts: string[] = [];
      for (const e of textSourceEdges) {
        const src = nodes.find((n) => n.id === e.source);
        if (!src) continue;
        if (src.type === 'minimalistText' || src.type === 'text') {
          if (src.data?.text) parts.push(String(src.data.text).trim());
        } else if (src.type === 'llm' && src.data?.outputText) {
          parts.push(String(src.data.outputText).trim());
        } else if (src.type === 'textSplit' && src.data?.segments) {
          const sh = e.sourceHandle || '';
          const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
          const seg = src.data.segments as (string | number | boolean)[];
          if (Number.isInteger(idx) && seg[idx] !== undefined) parts.push(String(seg[idx]).trim());
        } else if (src.type === 'cameraControl') {
          const pp = src.data?.prompt_payload as { qwen_instruction?: string; prompt_metadata?: { formatted_output?: string }; full_camera_prompt?: string; camera_tags?: string } | undefined;
          const cameraPrompt = pp?.qwen_instruction || pp?.prompt_metadata?.formatted_output || pp?.full_camera_prompt || pp?.camera_tags || '';
          if (cameraPrompt) parts.push(String(cameraPrompt).trim());
        }
      }
      const resolvedPrompt = parts.join(',');
      const imageNode = nodes.find((n) => n.id === imageId);
      const incomingImage = edges.filter((e) => e.target === imageId && nodes.find((n) => n.id === e.source)?.type === 'image');
      const incomingCamera = edges.filter((e) => e.target === imageId && nodes.find((n) => n.id === e.source)?.type === 'cameraControl');
      const imgs: string[] = [];
      incomingImage.forEach((e) => {
        const s = nodes.find((n) => n.id === e.source);
        const u = (s?.data?.outputImage as string) || (s?.data?.inputImages as string[])?.[0];
        if (u && !imgs.includes(u)) imgs.push(u);
      });
      incomingCamera.forEach((e) => {
        const c = nodes.find((n) => n.id === e.source);
        const u = c?.type === 'cameraControl' ? (c.data?.inputImage as string) : '';
        if (u && !imgs.includes(u)) imgs.push(u);
      });
      const newInputImages = imgs.slice(0, 10);
      const promptOk = imageNode?.data?.prompt === resolvedPrompt;
      const imgsOk = JSON.stringify([...(imageNode?.data?.inputImages || [])].sort()) === JSON.stringify([...newInputImages].sort());
      if (promptOk && imgsOk) return;
      setNodes((nds) =>
        nds.map((node) => (node.id === imageId ? { ...node, data: { ...node.data, prompt: resolvedPrompt, inputImages: newInputImages } } : node))
      );
      if (selectedNode?.id === imageId) {
        setImageInputPanelData((prev) => (prev && prev.nodeId === imageId ? { ...prev, prompt: resolvedPrompt, inputImages: newInputImages } : prev));
      }
    });
  }, [textSourceContentKey, edges, selectedNode?.id, setNodes]);

  // 文本拆分节点 segments 变化时，同步到下游（文本、LLM、图片、视频、音频等）
  const textSplitSegmentsKey = nodes
    .filter((n) => n.type === 'textSplit')
    .map((n) => `${n.id}:${JSON.stringify(n.data?.segments ?? [])}`)
    .join('|');
  useEffect(() => {
    const splitNodes = nodes.filter((n) => n.type === 'textSplit' && n.data?.segments);
    splitNodes.forEach((sourceNode) => {
      const seg = sourceNode.data!.segments as (string | number | boolean)[];
      const outEdges = edges.filter((e) => e.source === sourceNode.id && e.target);
      outEdges.forEach((edge) => {
        const sh = edge.sourceHandle || '';
        const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
        if (!Number.isInteger(idx) || seg[idx] === undefined) return;
        const textVal = String(seg[idx]);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!targetNode) return;
        if (targetNode.type === 'minimalistText') {
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target ? { ...node, data: { ...node.data, text: textVal } } : node
            )
          );
        } else if (targetNode.type === 'llm') {
          // 按该 LLM 所有入边顺序拼接文本，与 onConnect/onNodeClick 一致
          const incoming = edges.filter((e) => e.target === edge.target);
          const textSourceEdges = incoming.filter((e) => {
            const src = nodes.find((n) => n.id === e.source);
            return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
          });
          const parts: string[] = [];
          for (const e of textSourceEdges) {
            const src = nodes.find((n) => n.id === e.source);
            if (!src) continue;
            if (src.type === 'minimalistText' || src.type === 'text') {
              if (src.data?.text) parts.push(String(src.data.text).trim());
            } else if (src.type === 'llm' && src.data?.outputText) {
              parts.push(String(src.data.outputText).trim());
            } else if (src.type === 'textSplit' && src.data?.segments) {
              const sh = e.sourceHandle || '';
              const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
              const seg = src.data.segments as (string | number | boolean)[];
              if (Number.isInteger(idx) && seg[idx] !== undefined) parts.push(String(seg[idx]).trim());
            }
          }
          const resolvedInputText = parts.join(',');
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target ? { ...node, data: { ...node.data, inputText: resolvedInputText } } : node
            )
          );
          if (selectedNode?.id === edge.target) {
            setLlmInputPanelData((prev) => (prev && prev.nodeId === edge.target ? { ...prev, inputText: resolvedInputText } : prev));
          }
        } else if (targetNode.type === 'image') {
          const incoming = edges.filter((e) => {
            if (e.target !== edge.target) return false;
            const src = nodes.find((n) => n.id === e.source);
            return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
          });
          const textSourceEdges = incoming.filter((e) => {
            const src = nodes.find((n) => n.id === e.source);
            return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
          });
          const parts: string[] = [];
          for (const e of textSourceEdges) {
            const src = nodes.find((n) => n.id === e.source);
            if (!src) continue;
            if (src.type === 'minimalistText' || src.type === 'text') {
              if (src.data?.text) parts.push(String(src.data.text).trim());
            } else if (src.type === 'llm' && src.data?.outputText) {
              parts.push(String(src.data.outputText).trim());
            } else if (src.type === 'textSplit' && src.data?.segments) {
              const sh = e.sourceHandle || '';
              const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
              const seg = src.data.segments as (string | number | boolean)[];
              if (Number.isInteger(idx) && seg[idx] !== undefined) parts.push(String(seg[idx]).trim());
            }
          }
          const resolvedPrompt = parts.join(',');
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target ? { ...node, data: { ...node.data, prompt: resolvedPrompt } } : node
            )
          );
          if (selectedNode?.id === edge.target) {
            setImageInputPanelData((prev) => (prev && prev.nodeId === edge.target ? { ...prev, prompt: resolvedPrompt } : prev));
          }
        } else if (targetNode.type === 'video') {
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target ? { ...node, data: { ...node.data, prompt: textVal } } : node
            )
          );
          if (selectedNode?.id === edge.target) {
            setVideoInputPanelData((prev) => (prev && prev.nodeId === edge.target ? { ...prev, prompt: textVal } : prev));
          }
        } else if (targetNode.type === 'audio') {
          const isRhartSong = targetNode.data?.model === 'rhart-song';
          setNodes((nds) =>
            nds.map((node) =>
              node.id === edge.target
                ? { ...node, data: { ...node.data, ...(isRhartSong ? { lyrics: textVal } : { text: textVal }) } }
                : node
            )
          );
          if (selectedNode?.id === edge.target) {
            setAudioInputPanelData((prev) => {
              if (prev && prev.nodeId === edge.target) return isRhartSong ? { ...prev, lyrics: textVal } : { ...prev, text: textVal };
              return prev;
            });
          }
        }
      });
    });
  }, [textSplitSegmentsKey, edges, selectedNode?.id, setNodes]);

  // 用于 CharacterNode 更新数据的回调
  const handleCharacterNodeDataChange = useCallback((nodeId: string, updates: { nickname?: string; name?: string; avatar?: string; videoUrl?: string; timestamp?: string; roleId?: string; width?: number; height?: number }) => {
    setNodes((nds) => {
      return nds.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                ...updates,
              },
            }
          : node
      );
    });
  }, [setNodes]);

  // 用于 AudioNode 更新数据的回调
  const handleAudioNodeDataChange = useCallback((nodeId: string, updates: { outputAudio?: string; originalAudioUrl?: string; referenceAudioUrl?: string; width?: number; height?: number; title?: string; errorMessage?: string; aiStatus?: 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR' }) => {
    const applyUpdate = () => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, ...updates } } : node
        )
      );
    };
    if (updates.referenceAudioUrl !== undefined || updates.outputAudio !== undefined) {
      flushSync(applyUpdate);
    } else {
      applyUpdate();
    }
  }, [setNodes]);

  // 使用 ref 存储回调函数，避免闭包问题
  const handleImageNodeDataChangeRef = useRef<typeof handleImageNodeDataChange | null>(null);
  const handleVideoNodeDataChangeRef = useRef<typeof handleVideoNodeDataChange | null>(null);
  const handleAudioNodeDataChangeRef = useRef<typeof handleAudioNodeDataChange | null>(null);
  const handleAddTaskRef = useRef<typeof handleAddTask | null>(null);
  const handleCleanupSplitEdgesRef = useRef<((nodeId: string, keepSourceHandles: string[]) => void) | null>(null);
  const handleAuxImageTaskCompleteRef = useRef<((params: { nodeId: string; type: 'matting' | 'watermark'; imageUrl: string }) => void) | null>(null);
  const handleAIStatusUpdateRef = useRef<(packet: { nodeId: string; status: string; payload?: any }) => void>(() => {});

  const handleImageNodeDataChange = useCallback((nodeId: string, updates: { outputImage?: string; inputImages?: string[]; localPath?: string; originalImageUrl?: string; width?: number; height?: number; progress?: number; progressMessage?: string; errorMessage?: string }) => {
    setNodes((nds) => {
      const updatedNodes = nds.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                ...updates,
              },
            }
          : node
      );

      // 图片节点 outputImage 或 inputImages 变化时，同步到下游 Image / CameraControl
      if (updates.outputImage !== undefined || updates.inputImages !== undefined) {
        const connectedEdges = edges.filter((e) => e.source === nodeId && e.target);
        connectedEdges.forEach((edge) => {
          const targetNode = updatedNodes.find((n) => n.id === edge.target);
          if (targetNode?.type === 'image') {
            // 更新目标 Image 节点的输入图片列表
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              // 从连接的源节点收集所有输入图片
              // 使用 'image-input' 作为 targetHandle ID
              const incomingEdges = edges.filter((e) => {
                if (e.target !== edge.target) return false;
                const src = nodes.find((n) => n.id === e.source);
                return src?.type === 'image';
              });
              const collectedImages: string[] = [];
              incomingEdges.forEach((incomingEdge) => {
                const sourceNode = updatedNodes.find((n) => n.id === incomingEdge.source);
                if (sourceNode && sourceNode.type === 'image' && sourceNode.data?.outputImage) {
                  const imgUrl = sourceNode.data.outputImage;
                  if (!collectedImages.includes(imgUrl)) {
                    collectedImages.push(imgUrl);
                  }
                }
              });
              
              // 限制最多10张
              const newInputImages = collectedImages.slice(0, 10);
              
              updatedNodes[targetIndex] = {
                ...updatedNodes[targetIndex],
                data: {
                  ...updatedNodes[targetIndex].data,
                  inputImages: newInputImages,
                },
              };
              
              // 如果当前选中的是这个目标节点，更新输入面板数据
              if (selectedNode && selectedNode.id === edge.target) {
                setImageInputPanelData((prev) => {
                  if (prev && prev.nodeId === edge.target) {
                    return {
                      ...prev,
                      inputImages: newInputImages,
                    };
                  }
                  return prev;
                });
              }
            }
          }
          if (targetNode?.type === 'cameraControl') {
            const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
            if (targetIndex !== -1) {
              const rawUrl =
                updates.outputImage ||
                (updates.inputImages as string[])?.[0] ||
                (() => {
                  const fallbackEdge = edges.find((e) => {
                    if (e.target !== edge.target) return false;
                    const source = updatedNodes.find((n) => n.id === e.source);
                    return source?.type === 'image';
                  });
                  const src = fallbackEdge ? updatedNodes.find((n) => n.id === fallbackEdge.source) : undefined;
                  return (src?.data?.outputImage as string) || (src?.data?.inputImages as string[])?.[0] || '';
                })();
              if (rawUrl) {
                const imgUrl = formatImagePathSync(rawUrl);
                updatedNodes[targetIndex] = {
                  ...updatedNodes[targetIndex],
                  data: {
                    ...updatedNodes[targetIndex].data,
                    inputImage: imgUrl,
                  },
                };
              }
            }
          }
        });
      }

      return updatedNodes;
    });
  }, [setNodes, edges, selectedNode]);


  // TextNode 包装器（用于 React Flow）- 移到组件内部以访问 setNodes
  const TextNodeWrapper = useCallback<React.FC<{
    id: string;
    data: any;
    selected: boolean;
    position: { x: number; y: number };
  }>>(({ id, data, selected, position }) => {
    const handleLinkStart = useCallback((nodeId: string, startPos: { x: number; y: number }) => {
      // 这里可以触发连接开始逻辑
      console.log('Link start from node:', nodeId, 'at position:', startPos);
    }, []);

    const handleTextChange = useCallback((nodeId: string, text: string) => {
      handleTextNodeDataChange(nodeId, { text });
    }, [handleTextNodeDataChange]);

    const handleSizeChange = useCallback((nodeId: string, size: { w: number; h: number }) => {
      handleTextNodeDataChange(nodeId, { width: size.w, height: size.h });
    }, [handleTextNodeDataChange]);

    return (
      <>
        <TextNode
          id={id}
          initialPos={position}
          onLinkStart={handleLinkStart}
          isSelected={selected}
          isDarkMode={isDarkMode}
          performanceMode={isPerformanceMode}
          data={data}
          onTextChange={handleTextChange}
          onSizeChange={handleSizeChange}
        />
        {/* React Flow Handle for connections */}
        <Handle type="source" position={Position.Right} id="output" className="!w-2 !h-2 !bg-green-500 !border-0" />
      </>
    );
  }, [handleTextNodeDataChange, isPerformanceMode]);

  const handleCleanupSplitEdges = useCallback((nodeId: string, keepSourceHandles: string[]) => {
    setEdges((eds) =>
      eds.filter(
        (e) => e.source !== nodeId || (e.sourceHandle != null && keepSourceHandles.includes(e.sourceHandle))
      )
    );
  }, [setEdges]);

  // 图片生成完成时，创建任务记录并自动保存到本地（需在 nodeTypes 之前定义，供 handleAuxImageTaskComplete 使用）
  const handleAddTask = useCallback((nodeId: string, imageUrl: string, prompt: string) => {
    setTasks((prevTasks) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return prevTasks;

      const nodeTitle = node.data?.title || 'image';
      
      const isLocalPath = imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://');
      let localFilePath: string | undefined;
      if (isLocalPath) {
        localFilePath = imageUrl.replace(/^(local-resource:\/\/|file:\/\/\/?)/, '').replace(/\//g, '\\');
        if (localFilePath.match(/^\/[a-zA-Z]:/)) {
          localFilePath = localFilePath.substring(1);
        }
      }
      
      const newTask: Task = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nodeId,
        nodeTitle,
        imageUrl: isLocalPath ? imageUrl : imageUrl,
        localFilePath,
        prompt: prompt || '无提示词',
        createdAt: Date.now(),
        status: 'success',
        taskType: 'image',
      };

      if (window.electronAPI && imageUrl && !isLocalPath) {
        window.electronAPI.autoSaveImage(imageUrl, nodeTitle, projectId || undefined)
          .then((result) => {
            if (result.success && result.filePath) {
              const localResourceUrl = formatImagePathSync(result.filePath);
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId
                    ? { ...n, data: { ...n.data, outputImage: localResourceUrl } }
                    : n
                )
              );
              handleImageNodeDataChange(nodeId, { outputImage: localResourceUrl });
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === newTask.id
                    ? { ...t, localFilePath: result.filePath, imageUrl: localResourceUrl }
                    : t
                )
              );
            }
          })
          .catch((error) => {
            console.error('自动保存图片失败:', error);
          });
      }

      return [newTask, ...prevTasks];
    });
  }, [nodes, projectId, handleImageNodeDataChange, selectedNode, imageInputPanelData]);

  // 抠图/去水印完成时，将结果加入任务列表（需在 nodeTypes 之前定义，供 ImageNodeWrapper 使用）
  const handleAuxImageTaskComplete = useCallback((params: { nodeId: string; type: 'matting' | 'watermark'; imageUrl: string }) => {
    const promptLabel = params.type === 'matting' ? '抠图' : '去水印';
    handleAddTask(params.nodeId, params.imageUrl, promptLabel);
  }, [handleAddTask]);

  // 稳定 invoker：通过 ref 调用最新回调，避免 nodeTypes 因回调引用变化而重建，从而消除各模块闪动
  const invokeImageNodeDataChange = useCallback((nodeId: string, updates: any) => {
    handleImageNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const invokeVideoNodeDataChange = useCallback((nodeId: string, updates: any) => {
    handleVideoNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const invokeAudioNodeDataChange = useCallback((nodeId: string, updates: any) => {
    handleAudioNodeDataChangeRef.current?.(nodeId, updates);
  }, []);
  const invokeCleanupSplitEdges = useCallback((nodeId: string, keepSourceHandles: string[]) => {
    handleCleanupSplitEdgesRef.current?.(nodeId, keepSourceHandles);
  }, []);
  const invokeAuxImageTaskComplete = useCallback((params: { nodeId: string; type: 'matting' | 'watermark'; imageUrl: string }) => {
    handleAuxImageTaskCompleteRef.current?.(params);
  }, []);

  // 节点类型定义（仅依赖 isDarkMode、projectId 与稳定 invoker，避免 nodes/edges 变化导致整画布重渲染、模块闪动）
  const nodeTypes: NodeTypes = useMemo(() => {
    const MinimalistTextNodeWrapper: React.FC<any> = React.memo((props) => (
      <MinimalistTextNode {...props} isDarkMode={isDarkMode} performanceMode={isPerformanceMode} />
    ));
    MinimalistTextNodeWrapper.displayName = 'MinimalistTextNodeWrapper';

    const LLMNodeWrapper: React.FC<any> = React.memo((props) => (
      <LLMNode {...props} isDarkMode={isDarkMode} performanceMode={isPerformanceMode} />
    ));
    LLMNodeWrapper.displayName = 'LLMNodeWrapper';

    const ImageNodeWrapper: React.FC<any> = React.memo((props) => (
      <ImageNode
        {...props}
        isDarkMode={isDarkMode}
        performanceMode={isPerformanceMode}
        onDataChange={invokeImageNodeDataChange}
        projectId={projectId}
        onAuxImageTaskComplete={invokeAuxImageTaskComplete}
      />
    ));
    ImageNodeWrapper.displayName = 'ImageNodeWrapper';

    const VideoNodeWrapper: React.FC<any> = React.memo((props) => (
      <VideoNode {...props} isDarkMode={isDarkMode} performanceMode={isPerformanceMode} onDataChange={invokeVideoNodeDataChange} />
    ));
    VideoNodeWrapper.displayName = 'VideoNodeWrapper';

    const CharacterNodeWrapper: React.FC<any> = React.memo((props) => (
      <CharacterNode {...props} isDarkMode={isDarkMode} performanceMode={isPerformanceMode} />
    ));
    CharacterNodeWrapper.displayName = 'CharacterNodeWrapper';

    const AudioNodeWrapper: React.FC<any> = React.memo((props) => (
      <AudioNode {...props} isDarkMode={isDarkMode} performanceMode={isPerformanceMode} onDataChange={invokeAudioNodeDataChange} />
    ));
    AudioNodeWrapper.displayName = 'AudioNodeWrapper';

    const CameraControlNodeWrapper: React.FC<any> = React.memo((props) => (
      <CameraControlNode {...props} isDarkMode={isDarkMode} performanceMode={isPerformanceMode} />
    ));
    CameraControlNodeWrapper.displayName = 'CameraControlNodeWrapper';

    const TextSplitNodeWrapper: React.FC<any> = React.memo((props) => (
      <TextSplitNode {...props} isDarkMode={isDarkMode} performanceMode={isPerformanceMode} onCleanupEdgesForHandles={invokeCleanupSplitEdges} />
    ));
    TextSplitNodeWrapper.displayName = 'TextSplitNodeWrapper';

    return {
      custom: CustomNode,
      textNode: TextNodeWrapper as React.ComponentType<any>,
      minimalistText: MinimalistTextNodeWrapper,
      llm: LLMNodeWrapper,
      image: ImageNodeWrapper,
      video: VideoNodeWrapper,
      character: CharacterNodeWrapper,
      audio: AudioNodeWrapper,
      textSplit: TextSplitNodeWrapper,
      cameraControl: CameraControlNodeWrapper,
    };
  }, [isDarkMode, projectId, isPerformanceMode, invokeImageNodeDataChange, invokeVideoNodeDataChange, invokeAudioNodeDataChange, invokeCleanupSplitEdges, invokeAuxImageTaskComplete]);

  // 连接节点（拖拽中的临时线为虚线，连接完成后的线为实线）
  const onConnect = useCallback(
    (params: Connection) => {
      // 确定 targetHandle：
      // - Image 节点：image -> image 使用 'image-input'（图生图），其他使用 'input'（文生图）
      // - Video 节点：统一使用 'input'（可以接收文本、LLM输出或图像）
      // - Character 节点：仅支持 video 输入，使用 'input' 把手
      // - 其他情况使用 'input'
      let targetHandle = params.targetHandle;
      if (!targetHandle && params.target && params.source) {
        const targetNode = nodes.find((n) => n.id === params.target);
        const sourceNode = nodes.find((n) => n.id === params.source);
        if (targetNode && targetNode.type === 'image') {
          if (sourceNode && sourceNode.type === 'image') {
            targetHandle = 'image-input';
          } else {
            targetHandle = 'input';
          }
        } else if (targetNode && targetNode.type === 'video') {
          // Video 节点：若用户连接到「参考视频」把手则保留 reference-video，否则为 input
          if (sourceNode?.type === 'video' && params.targetHandle === 'reference-video') {
            targetHandle = 'reference-video';
          } else {
            targetHandle = 'input';
          }
        } else if (targetNode && targetNode.type === 'character') {
          // Character 节点：仅支持 video 输入，使用统一 'input' 把手
          targetHandle = 'input';
        } else if (targetNode && targetNode.type === 'audio') {
          // Audio 节点：text/llm -> audio 使用 'audio-input'
          targetHandle = 'audio-input';
        } else {
          targetHandle = 'input';
        }
      }
      
      const newEdge = {
        ...params,
        // 确保 sourceHandle 和 targetHandle 有默认值
        sourceHandle: params.sourceHandle || 'output',
        targetHandle: targetHandle || 'input',
        // 不设置 strokeDasharray，使用全局样式：
        //  - 拖拽中的临时连线：虚线（通过 CSS .react-flow__edge-connecting 控制）
        //  - 连接完成后的连线：实线
        animated: false,
      };
      
      // 添加新边
      setEdges((eds) => {
        const updatedEdges = addEdge(newEdge, eds);
        
        // 如果连接的是 Image / Video 节点，根据源节点类型处理
        if (params.target) {
          setNodes((nds) => {
            // 使用 latestNodesRef 获取最新节点数据，避免刚上传/生成的图片因 state 滞后而未同步到 cameraControl
            const freshNodes = latestNodesRef.current.length > 0 ? latestNodesRef.current : nds;
            const targetNode = nds.find((n) => n.id === params.target);
            const sourceNode = freshNodes.find((n) => n.id === params.source);
            
            if (targetNode && targetNode.type === 'textSplit' && sourceNode) {
              let textToSplit = '';
              if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                textToSplit = sourceNode.data?.text || '';
              } else if (sourceNode.type === 'llm') {
                textToSplit = sourceNode.data?.outputText || '';
              }
              return nds.map((node) =>
                node.id === params.target
                  ? { ...node, data: { ...node.data, inputText: textToSplit } }
                  : node
              );
            }

            if (targetNode && targetNode.type === 'image') {
              // Text/LLM/文本拆分/CameraControl 连接到 Image：收集 prompt + inputImages（cameraControl 透传其 inputImage）
              if (sourceNode && (sourceNode.type === 'minimalistText' || sourceNode.type === 'text' || sourceNode.type === 'llm' || sourceNode.type === 'textSplit' || sourceNode.type === 'cameraControl')) {
                const textSourceEdges = updatedEdges.filter((e) => {
                  if (e.target !== params.target) return false;
                  const src = freshNodes.find((n) => n.id === e.source);
                  return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'cameraControl');
                });
                const imageSourceEdges = updatedEdges.filter((e) => {
                  if (e.target !== params.target) return false;
                  const src = freshNodes.find((n) => n.id === e.source);
                  return src?.type === 'image';
                });
                const cameraSourceEdges = updatedEdges.filter((e) => {
                  if (e.target !== params.target) return false;
                  const src = freshNodes.find((n) => n.id === e.source);
                  return src?.type === 'cameraControl';
                });
                const parts: string[] = [];
                for (const edge of textSourceEdges) {
                  const src = freshNodes.find((n) => n.id === edge.source);
                  if (!src) continue;
                  if (src.type === 'minimalistText' || src.type === 'text') {
                    if (src.data?.text) parts.push(String(src.data.text).trim());
                  } else if (src.type === 'llm' && src.data?.outputText) {
                    parts.push(String(src.data.outputText).trim());
                  } else if (src.type === 'textSplit' && src.data?.segments) {
                    const sh = edge.sourceHandle || '';
                    const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
                    const seg = src.data.segments as (string | number | boolean)[];
                    if (Number.isInteger(idx) && seg[idx] !== undefined) parts.push(String(seg[idx]).trim());
                  } else if (src.type === 'cameraControl') {
                    const pp = src.data?.prompt_payload as { qwen_instruction?: string; prompt_metadata?: { formatted_output?: string }; full_camera_prompt?: string; camera_tags?: string } | undefined;
                    const cameraPrompt = pp?.qwen_instruction || pp?.prompt_metadata?.formatted_output || pp?.full_camera_prompt || pp?.camera_tags || '';
                    if (cameraPrompt) parts.push(String(cameraPrompt).trim());
                  }
                }
                const promptText = parts.join(',');
                const collectedImages: string[] = [];
                imageSourceEdges.forEach((edge) => {
                  const src = freshNodes.find((n) => n.id === edge.source);
                  if (src?.type === 'image') {
                    const u = (src.data?.outputImage as string) || (src.data?.inputImages as string[])?.[0];
                    if (u && !collectedImages.includes(u)) collectedImages.push(u);
                  }
                });
                cameraSourceEdges.forEach((edge) => {
                  const cc = freshNodes.find((n) => n.id === edge.source);
                  const u = cc?.type === 'cameraControl' ? (cc.data?.inputImage as string) : '';
                  if (u && !collectedImages.includes(u)) collectedImages.push(u);
                });
                const newInputImages = collectedImages.slice(0, 10);
                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        prompt: promptText,
                        inputImages: newInputImages,
                      },
                    };
                  }
                  return node;
                });
                if (selectedNode && selectedNode.id === params.target) {
                  setTimeout(() => {
                    setImageInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return { ...prev, prompt: promptText, inputImages: newInputImages };
                      }
                      return prev;
                    });
                  }, 0);
                }
                return updatedNodes;
              } else if (sourceNode && sourceNode.type === 'image') {
                // Image 连接到 Image：收集输入图片，切换到图生图模式（按源类型为 image 的入边）
                const incomingEdges = updatedEdges.filter((e) => {
                  if (e.target !== params.target) return false;
                  const src = nds.find((n) => n.id === e.source);
                  return src?.type === 'image';
                });
                const collectedImages: string[] = [];
                incomingEdges.forEach((edge) => {
                  const edgeSourceNode = nds.find((n) => n.id === edge.source);
                  if (edgeSourceNode && edgeSourceNode.type === 'image' && edgeSourceNode.data?.outputImage) {
                    const imgUrl = edgeSourceNode.data.outputImage;
                    if (!collectedImages.includes(imgUrl)) {
                      collectedImages.push(imgUrl);
                    }
                  }
                });
                
                // 限制最多10张
                const newInputImages = collectedImages.slice(0, 10);
                
                // 更新目标节点的输入图片列表
                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        inputImages: newInputImages,
                      },
                    };
                  }
                  return node;
                });
                
                // 如果目标节点当前被选中，更新输入面板数据
                setTimeout(() => {
                  if (selectedNode && selectedNode.id === params.target) {
                    setImageInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return {
                          ...prev,
                          inputImages: newInputImages,
                        };
                      }
                      return prev;
                    });
                  }
                }, 0);
                
                return updatedNodes;
              }
            }

            if (targetNode && targetNode.type === 'cameraControl') {
              if (sourceNode?.type === 'image') {
                const rawUrl =
                  (sourceNode.data?.outputImage as string) ||
                  (sourceNode.data?.inputImages as string[])?.[0] ||
                  '';
                if (rawUrl) {
                  // 使用 formatImagePathSync 确保 local-resource 等格式正确，便于 3D 纹理加载
                  const imgUrl = formatImagePathSync(rawUrl);
                  return nds.map((node) =>
                    node.id === params.target
                      ? { ...node, data: { ...node.data, inputImage: imgUrl } }
                      : node
                  );
                }
              }
            }

            // Video 节点：image -> video 作为参考图，text/LLM -> video 传递文本提示词
            if (targetNode && targetNode.type === 'video') {
              if (sourceNode && sourceNode.type === 'image' && sourceNode.data?.outputImage) {
                const imageUrl = sourceNode.data.outputImage as string;
                
                // 检查图片 URL 是否需要上传到 runninghub
                // 如果是本地文件（local-resource:// 或 file://），需要上传获取 view URL
                // 如果已经是 runninghub view URL，直接使用
                const isLocalFile = imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://');
                const isRunningHubViewUrl = imageUrl.includes('www.runninghub.cn/view');
                
                // 异步处理图片上传（如果是本地文件）
                if (isLocalFile && !isRunningHubViewUrl && window.electronAPI) {
                  // 显示上传状态（可选）
                  console.log('[Workspace] 检测到本地图片，开始上传到 runninghub...');
                  
                  // 异步上传图片
                  window.electronAPI.uploadImageToRunningHub(imageUrl)
                    .then((result) => {
                      if (result.success && result.url) {
                        const viewUrl = result.url;
                        console.log('[Workspace] 图片上传成功，view URL:', viewUrl);
                        
                        // 更新节点数据，使用上传后的 view URL
                        setNodes((nds) => {
                          return nds.map((node) => {
                            if (node.id === params.target) {
                              const existingImages = (node.data?.inputImages || []) as string[];
                              // 替换原来的本地 URL 为 view URL
                              const updatedImages = existingImages.map((img) => 
                                img === imageUrl ? viewUrl : img
                              );
                              // 如果 view URL 不在列表中，添加它
                              const nextImages = updatedImages.includes(viewUrl)
                                ? updatedImages
                                : [...updatedImages, viewUrl].slice(0, 10);
                              
                              return {
                                ...node,
                                data: {
                                  ...node.data,
                                  inputImages: nextImages,
                                },
                              };
                            }
                            return node;
                          });
                        });
                        
                        // 如果目标节点当前被选中，更新输入面板数据
                        if (selectedNode && selectedNode.id === params.target) {
                          setVideoInputPanelData((prev) => {
                            if (prev && prev.nodeId === params.target) {
                              const existingImages = prev.inputImages || [];
                              const updatedImages = existingImages.map((img) => 
                                img === imageUrl ? viewUrl : img
                              );
                              const nextImages = updatedImages.includes(viewUrl)
                                ? updatedImages
                                : [...updatedImages, viewUrl].slice(0, 10);
                              return {
                                ...prev,
                                inputImages: nextImages,
                              };
                            }
                            return prev;
                          });
                        }
                      }
                    })
                    .catch((error) => {
                      console.error('[Workspace] 图片上传失败:', error);
                      // 即使上传失败，也使用原始 URL（让 VideoProvider 处理）
                    });
                }
                
                // 立即更新节点数据（使用原始 URL，上传成功后会替换）
                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    const existingImages = (node.data?.inputImages || []) as string[];
                    const nextImages = existingImages.includes(imageUrl)
                      ? existingImages
                      : [...existingImages, imageUrl].slice(0, 10);
                    
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        inputImages: nextImages,
                      },
                    };
                  }
                  return node;
                });
                
                // 如果目标节点当前被选中，更新输入面板数据
                setTimeout(() => {
                  if (selectedNode && selectedNode.id === params.target) {
                    setVideoInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        const existingImages = prev.inputImages || [];
                        const nextImages = existingImages.includes(imageUrl)
                          ? existingImages
                          : [...existingImages, imageUrl].slice(0, 10);
                        return {
                          ...prev,
                          inputImages: nextImages,
                        };
                      }
                      return prev;
                    });
                  }
                }, 0);
                
                return updatedNodes;
              }

              if (
                sourceNode &&
                (sourceNode.type === 'minimalistText' ||
                  sourceNode.type === 'text' ||
                  sourceNode.type === 'llm' ||
                  sourceNode.type === 'textSplit')
              ) {
                let textToPass = '';
                if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                  textToPass = sourceNode.data?.text || '';
                } else if (sourceNode.type === 'llm') {
                  textToPass = sourceNode.data?.outputText || '';
                } else if (sourceNode.type === 'textSplit' && sourceNode.data?.segments) {
                  const sh = params.sourceHandle || '';
                  const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : 0;
                  const seg = sourceNode.data.segments as (string | number | boolean)[];
                  if (Number.isInteger(idx) && seg[idx] !== undefined) textToPass = String(seg[idx]);
                }

                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        prompt: textToPass,
                      },
                    };
                  }
                  return node;
                });
                return updatedNodes;
              }
            }

            // 文本节点：接受文本拆分模块的输出，写入 data.text
            if (targetNode && targetNode.type === 'minimalistText' && sourceNode && sourceNode.type === 'textSplit' && sourceNode.data?.segments) {
              const sh = params.sourceHandle || '';
              const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : 0;
              const seg = sourceNode.data.segments as (string | number | boolean)[];
              const textToPass = Number.isInteger(idx) && seg[idx] !== undefined ? String(seg[idx]) : '';
              return nds.map((node) =>
                node.id === params.target ? { ...node, data: { ...node.data, text: textToPass } } : node
              );
            }

            // LLM 节点：按连线顺序收集所有文本来源（Text/LLM/文本拆分），用逗号拼接后写入 inputText
            if (targetNode && targetNode.type === 'llm' && (sourceNode?.type === 'minimalistText' || sourceNode?.type === 'text' || sourceNode?.type === 'llm' || sourceNode?.type === 'textSplit')) {
              const incoming = updatedEdges.filter((e) => e.target === params.target);
              const textSourceEdges = incoming.filter((e) => {
                const src = nds.find((n) => n.id === e.source);
                return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
              });
              const parts: string[] = [];
              for (const edge of textSourceEdges) {
                const src = nds.find((n) => n.id === edge.source);
                if (!src) continue;
                if (src.type === 'minimalistText' || src.type === 'text') {
                  if (src.data?.text) parts.push(String(src.data.text).trim());
                } else if (src.type === 'llm' && src.data?.outputText) {
                  parts.push(String(src.data.outputText).trim());
                } else if (src.type === 'textSplit' && src.data?.segments) {
                  const sh = edge.sourceHandle || '';
                  const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
                  const seg = src.data.segments as (string | number | boolean)[];
                  if (Number.isInteger(idx) && seg[idx] !== undefined) parts.push(String(seg[idx]).trim());
                }
              }
              const resolvedInputText = parts.join(',');
              const updatedNodes = nds.map((node) =>
                node.id === params.target ? { ...node, data: { ...node.data, inputText: resolvedInputText } } : node
              );
              if (selectedNode && selectedNode.id === params.target) {
                setLlmInputPanelData((prev) =>
                  prev && prev.nodeId === params.target ? { ...prev, inputText: resolvedInputText } : prev
                );
              }
              return updatedNodes;
            }

            // Audio 节点：处理 text/llm/文本拆分 -> audio 传递文本，或 audio -> audio 传递参考音
            if (targetNode && targetNode.type === 'audio') {
              if (
                sourceNode &&
                (sourceNode.type === 'minimalistText' ||
                  sourceNode.type === 'text' ||
                  sourceNode.type === 'llm' ||
                  sourceNode.type === 'textSplit')
              ) {
                let textToPass = '';
                if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
                  textToPass = sourceNode.data?.text || '';
                } else if (sourceNode.type === 'llm') {
                  textToPass = sourceNode.data?.outputText || '';
                } else if (sourceNode.type === 'textSplit' && sourceNode.data?.segments) {
                  const sh = params.sourceHandle || '';
                  const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : 0;
                  const seg = sourceNode.data.segments as (string | number | boolean)[];
                  if (Number.isInteger(idx) && seg[idx] !== undefined) textToPass = String(seg[idx]);
                }
                const isRhartSong = targetNode.data?.model === 'rhart-song';
                const updatedNodes = nds.map((node) => {
                  if (node.id === params.target) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        ...(isRhartSong ? { lyrics: textToPass } : { text: textToPass }),
                      },
                    };
                  }
                  return node;
                });
                if (selectedNode && selectedNode.id === params.target) {
                  setAudioInputPanelData((prev) => {
                    if (prev && prev.nodeId === params.target) {
                      return isRhartSong ? { ...prev, lyrics: textToPass } : { ...prev, text: textToPass };
                    }
                    return prev;
                  });
                }
                return updatedNodes;
              }
              // audio -> audio：将源音频作为目标节点的参考音；若为本地路径则先上传 OSS，再回传 URL 到参考音
              if (sourceNode && sourceNode.type === 'audio') {
                const refUrl = (sourceNode.data?.originalAudioUrl && (sourceNode.data.originalAudioUrl as string).startsWith('http'))
                  ? (sourceNode.data.originalAudioUrl as string)
                  : (sourceNode.data?.outputAudio as string) || '';
                if (refUrl) {
                  const isLocalRef = refUrl.startsWith('local-resource://') || refUrl.startsWith('file://');
                  const updatedNodes = nds.map((node) => {
                    if (node.id === params.target) {
                      return {
                        ...node,
                        data: { ...node.data, referenceAudioUrl: refUrl },
                      };
                    }
                    return node;
                  });
                  if (selectedNode && selectedNode.id === params.target) {
                    setAudioInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return { ...prev, referenceAudioUrl: refUrl };
                      }
                      return prev;
                    });
                  }
                  if (isLocalRef && window.electronAPI?.uploadLocalAudioToOSS) {
                    window.electronAPI.uploadLocalAudioToOSS(refUrl).then((res) => {
                      if (res.success && res.url) {
                        setNodes((n) => n.map((node) => (node.id === params.target ? { ...node, data: { ...node.data, referenceAudioUrl: res.url } } : node)));
                        setAudioInputPanelData((prev) => (prev && prev.nodeId === params.target ? { ...prev, referenceAudioUrl: res.url } : prev));
                      }
                    });
                  }
                  return updatedNodes;
                }
              }
            }

            // Character 节点：处理 Video -> Character 连接，将源 Video 的网络 URL 传递到目标 Character 的 videoUrl
            if (targetNode && targetNode.type === 'character') {
              if (sourceNode && sourceNode.type === 'video') {
                // 优先使用 originalVideoUrl（网络 URL），如果没有则使用 outputVideo
                // 如果 outputVideo 是本地路径，自动上传到 OSS
                let videoUrlToPass = '';
                let needsUpload = false;
                let localVideoPath = '';
                
                if (sourceNode.data?.originalVideoUrl) {
                  // 优先使用原始网络 URL
                  videoUrlToPass = sourceNode.data.originalVideoUrl as string;
                } else if (sourceNode.data?.outputVideo) {
                  const outputVideo = sourceNode.data.outputVideo as string;
                  // 如果是网络 URL（http/https），直接使用
                  if (outputVideo.startsWith('http://') || outputVideo.startsWith('https://')) {
                    videoUrlToPass = outputVideo;
                  } else if (outputVideo.startsWith('local-resource://') || outputVideo.startsWith('file://')) {
                    // 如果是本地路径，需要上传到 OSS
                    needsUpload = true;
                    localVideoPath = outputVideo;
                    console.log('[Workspace] 检测到本地视频路径，准备上传到 OSS:', localVideoPath);
                  } else {
                    // 其他格式，直接使用
                    videoUrlToPass = outputVideo;
                  }
                }
                
                // 如果已经有网络 URL（OSS 公网 URL），直接使用
                if (videoUrlToPass && (videoUrlToPass.startsWith('http://') || videoUrlToPass.startsWith('https://'))) {
                  // 更新节点数据，使用网络 URL
                  const updatedNodes = nds.map((node) => {
                    if (node.id === params.target) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          videoUrl: videoUrlToPass, // 使用 OSS 公网 URL
                          needsUpload: false, // 不需要上传
                          localVideoPath: undefined, // 清除本地路径
                          timestamp: node.data?.timestamp || '1,3',
                        },
                      };
                    }
                    return node;
                  });
                  
                  // 如果目标节点当前被选中，更新输入面板数据
                  if (selectedNode && selectedNode.id === params.target) {
                    setCharacterInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return {
                          ...prev,
                          videoUrl: videoUrlToPass, // 使用 OSS 公网 URL
                          isConnected: true,
                          needsUpload: false, // 不需要上传
                          localVideoPath: undefined, // 清除本地路径
                          isUploading: false,
                          timestamp: prev.timestamp || '1,3',
                        };
                      }
                      return prev;
                    });
                  }
                  
                  return updatedNodes;
                }
                
                // 如果需要上传，显示"确认上传视频"按钮（不自动上传）
                if (needsUpload && localVideoPath && window.electronAPI) {
                  // 更新节点数据，保存本地路径和需要上传标志
                  const updatedNodes = nds.map((node) => {
                    if (node.id === params.target) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          videoUrl: localVideoPath, // 显示本地路径（用于提示）
                          needsUpload: true, // 标记需要上传
                          localVideoPath: localVideoPath, // 保存本地路径
                          timestamp: node.data?.timestamp || '1,3',
                        },
                      };
                    }
                    return node;
                  });
                  
                  // 如果目标节点当前被选中，更新输入面板数据
                  if (selectedNode && selectedNode.id === params.target) {
                    setCharacterInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return {
                          ...prev,
                          videoUrl: localVideoPath, // 显示本地路径（用于提示）
                          isConnected: true,
                          needsUpload: true, // 标记需要上传
                          localVideoPath: localVideoPath, // 保存本地路径
                          isUploading: false, // 未开始上传
                          timestamp: prev.timestamp || '1,3',
                        };
                      }
                      return prev;
                    });
                  }
                  
                  // 不自动上传，等待用户点击"确认上传视频"按钮
                  return updatedNodes;
                }
                
                // 如果已经有其他格式的 URL，直接使用
                if (videoUrlToPass) {
                  const updatedNodes = nds.map((node) => {
                    if (node.id === params.target) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          videoUrl: videoUrlToPass, // 传递网络 URL
                          timestamp: node.data?.timestamp || '1,3', // 如果时间戳为空，设置默认值 "1,3"
                        },
                      };
                    }
                    return node;
                  });
                  
                  // 如果目标节点当前被选中，立即更新输入面板数据
                  if (selectedNode && selectedNode.id === params.target) {
                    setCharacterInputPanelData((prev) => {
                      if (prev && prev.nodeId === params.target) {
                        return {
                          ...prev,
                          videoUrl: videoUrlToPass,
                          isConnected: true,
                          isUploading: false, // 确保不是上传状态
                          timestamp: prev.timestamp || '1,3', // 如果时间戳为空，设置默认值 "1,3"
                        };
                      }
                      return prev;
                    });
                  }
                  
                  return updatedNodes;
                }
              }
            }
            return nds;
          });
        }
        
        return updatedEdges;
      });
    },
    [setEdges, setNodes, selectedNode, nodes]
  );

  // 选择节点
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!node || !node.id) return;
      setSelectedNode(node);
      const nodeType = node.type ?? (node.data as any)?.nodeType;

      try {
      // 如果选中的是 LLM 节点，显示输入面板弹窗
      if (nodeType === 'llm') {
        // 查找所有指向该 LLM 节点的连线
        const incomingEdges = edges.filter((e) => e.target === node.id);

        // 区分来自文本节点、LLM节点和来自图片节点的连接
        const textEdges = incomingEdges.filter((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode && (sourceNode.type === 'minimalistText' || sourceNode.type === 'text');
        });
        const llmEdges = incomingEdges.filter((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode && sourceNode.type === 'llm' && sourceNode.data?.outputText;
        });
        const splitEdges = incomingEdges.filter((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode && sourceNode.type === 'textSplit' && sourceNode.data?.segments;
        });
        const imageEdges = incomingEdges.filter((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode && sourceNode.type === 'image' && sourceNode.data?.outputImage;
        });

        const hasTextConnection = textEdges.length > 0;
        const hasLLMConnection = llmEdges.length > 0;
        const hasSplitConnection = splitEdges.length > 0;
        const hasImageConnection = imageEdges.length > 0;

        // 按连线顺序收集所有文本来源（Text / LLM / 文本拆分），用逗号拼接
        const textSourceEdges = incomingEdges.filter((e) => {
          const src = nodes.find((n) => n.id === e.source);
          return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit');
        });
        const parts: string[] = [];
        for (const edge of textSourceEdges) {
          const src = nodes.find((n) => n.id === edge.source);
          if (!src) continue;
          if (src.type === 'minimalistText' || src.type === 'text') {
            if (src.data?.text) parts.push(String(src.data.text).trim());
          } else if (src.type === 'llm' && src.data?.outputText) {
            parts.push(String(src.data.outputText).trim());
          } else if (src.type === 'textSplit' && src.data?.segments) {
            const sh = edge.sourceHandle || '';
            const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
            const seg = src.data.segments as (string | number | boolean)[];
            if (Number.isInteger(idx) && seg[idx] !== undefined) parts.push(String(seg[idx]).trim());
          }
        }
        const resolvedInputText = parts.length > 0 ? parts.join(',') : (node.data?.inputText || '');

        if (parts.length > 0) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id ? { ...n, data: { ...n.data, inputText: resolvedInputText } } : n
            )
          );
        }

        // 如果存在来自 Image 节点的连线，取第一张图片作为反推对象
        let imageUrlForReverse: string | undefined;
        if (hasImageConnection) {
          const firstImageEdge = imageEdges[0];
          const sourceNode = nodes.find((n) => n.id === firstImageEdge.source);
          if (sourceNode?.data?.outputImage) {
            imageUrlForReverse = sourceNode.data.outputImage as string;
          }
        }

        setLlmInputPanelData({
          nodeId: node.id,
          inputText: resolvedInputText,
          userInput:
            node.data?.userInput ||
            (hasImageConnection ? '这张图片有什么？' : ''),
          prompt: node.data?.prompt || node.data?.systemPrompt || '',
          savedPrompts: globalPersonas,
          isInputLocked: (hasTextConnection || hasLLMConnection || hasSplitConnection) && !!resolvedInputText,
          isImageReverseMode: hasImageConnection && !!imageUrlForReverse,
          imageUrlForReverse,
          reverseCaptionModel: (node.data?.reverseCaptionModel as 'gpt-4o' | 'joy-caption-two') || 'gpt-4o',
        });
        setImageInputPanelData(null);
      } else if (nodeType === 'image') {
        // 如果选中的是 Image 节点，显示输入面板弹窗
        // 检查是否有输入连接（区分图生图和文生图模式）
        // Image 只有一个 target Handle，按源节点类型区分：image→图生图，text/LLM→文生图
        const incomingImageEdges = edges.filter((e) => {
          if (e.target !== node.id) return false;
          const src = nodes.find((n) => n.id === e.source);
          return src?.type === 'image';
        });
        const incomingCameraEdges = edges.filter((e) => {
          if (e.target !== node.id) return false;
          const src = nodes.find((n) => n.id === e.source);
          return src?.type === 'cameraControl';
        });
        const incomingTextEdges = edges.filter((e) => {
          if (e.target !== node.id) return false;
          const src = nodes.find((n) => n.id === e.source);
          return src && (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit' || src.type === 'cameraControl');
        });
        
        // 收集输入图片：来自 image 节点 + cameraControl 节点（透传其 inputImage）
        let inputImages: string[] = [];
        incomingImageEdges.forEach((edge) => {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          if (sourceNode?.type === 'image') {
            const imageUrl = (sourceNode.data?.outputImage as string) || (sourceNode.data?.inputImages as string[])?.[0];
            if (imageUrl && !inputImages.includes(imageUrl)) inputImages.push(imageUrl);
          }
        });
        incomingCameraEdges.forEach((edge) => {
          const cc = nodes.find((n) => n.id === edge.source);
          const imgUrl = cc?.type === 'cameraControl' ? (cc.data?.inputImage as string) : '';
          if (imgUrl && !inputImages.includes(imgUrl)) inputImages.push(imgUrl);
        });
        
        if (inputImages.length === 0 && node.data?.inputImages) {
          inputImages = node.data.inputImages;
        }
        
        // 限制最多10张
        inputImages = inputImages.slice(0, 10);
        
        // 按入边顺序收集 text/LLM/文本拆分/cameraControl 的 prompt
        const textSourceEdges = incomingTextEdges;
        const promptParts: string[] = [];
        for (const edge of textSourceEdges) {
          const src = nodes.find((n) => n.id === edge.source);
          if (!src) continue;
          if (src.type === 'minimalistText' || src.type === 'text') {
            if (src.data?.text) promptParts.push(String(src.data.text).trim());
          } else if (src.type === 'llm' && src.data?.outputText) {
            promptParts.push(String(src.data.outputText).trim());
          } else if (src.type === 'textSplit' && src.data?.segments) {
            const sh = edge.sourceHandle || '';
            const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : -1;
            const seg = src.data.segments as (string | number | boolean)[];
            if (Number.isInteger(idx) && seg[idx] !== undefined) promptParts.push(String(seg[idx]).trim());
          } else if (src.type === 'cameraControl') {
            const pp = src.data?.prompt_payload as { qwen_instruction?: string; formatted_output?: string; full_camera_prompt?: string; camera_tags?: string } | undefined;
            const t = pp?.qwen_instruction || pp?.formatted_output || pp?.full_camera_prompt || pp?.camera_tags || '';
            if (t) promptParts.push(String(t).trim());
          }
        }
        const promptText = promptParts.length > 0 ? promptParts.join(',') : (node.data?.prompt || '');
        if (promptParts.length > 0 || inputImages.length > 0) {
          setNodes((nds) =>
            nds.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, prompt: promptText, inputImages } } : n))
          );
        }
        
        const imageModel = node.data?.model || 'nano-banana-2';
        const aspectRatioForImage = node.data?.aspectRatio || '1:1';
        const seedreamRatioToSize: Record<string, { width: number; height: number }> = {
          '1:1': { width: 2048, height: 2048 },
          '2:3': { width: 1664, height: 2496 },
          '3:2': { width: 2496, height: 1664 },
          '3:4': { width: 1728, height: 2304 },
          '4:3': { width: 2304, height: 1728 },
          '9:16': { width: 1440, height: 2560 },
          '16:9': { width: 2560, height: 1440 },
          '21:9': { width: 3024, height: 1296 },
        };
        let seedreamW = node.data?.seedreamWidth ?? 2048;
        let seedreamH = node.data?.seedreamHeight ?? 2048;
        if (imageModel === 'seedream-v4.5' && seedreamRatioToSize[aspectRatioForImage]) {
          seedreamW = seedreamRatioToSize[aspectRatioForImage].width;
          seedreamH = seedreamRatioToSize[aspectRatioForImage].height;
        }
        setImageInputPanelData({
          nodeId: node.id,
          prompt: promptText,
          resolution: node.data?.resolution || '1024x1024',
          aspectRatio: aspectRatioForImage,
          model: imageModel,
          seedreamWidth: seedreamW,
          seedreamHeight: seedreamH,
          inputImages, // 传递输入的参考图数组（仅来自 image 节点）
        });
        setLlmInputPanelData(null);
      } else if (nodeType === 'video') {
        // Video 节点：构建输入面板数据
        const incomingEdges = edges.filter((e) => e.target === node.id);

        let inputImages: string[] = [];
        let resolvedPrompt = node.data?.prompt || '';

        incomingEdges.forEach((edge) => {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          if (!sourceNode) return;

          // 统一输入点：可以接收图像或文本（targetHandle 为 'input'，handleMenuSelect 创建的边也为 'input'）
          if (edge.targetHandle === 'input' || edge.targetHandle === 'video-input') {
            // 处理图像输入（图生视频模式）
            if (sourceNode.type === 'image') {
              const imageUrl = (sourceNode.data?.outputImage as string) || (sourceNode.data?.inputImages as string[])?.[0];
              if (imageUrl && !inputImages.includes(imageUrl)) {
                inputImages.push(imageUrl);
              }
            }
            
            // 处理文本输入（文生视频模式，或图生视频模式的提示词）
            if (
              (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') &&
              sourceNode.data?.text
            ) {
              resolvedPrompt = sourceNode.data.text as string;
            } else if (sourceNode.type === 'llm' && sourceNode.data?.outputText) {
              resolvedPrompt = sourceNode.data.outputText as string;
            } else if (sourceNode.type === 'textSplit' && sourceNode.data?.segments) {
              const sh = edge.sourceHandle || '';
              const idx = sh.startsWith('output-') && sh !== 'output-null' ? parseInt(sh.replace('output-', ''), 10) : 0;
              const seg = sourceNode.data.segments as (string | number | boolean)[];
              if (Number.isInteger(idx) && seg[idx] !== undefined) resolvedPrompt = String(seg[idx]);
            }
          }
        });

        // 若从连线未解析到图片，但节点已有 inputImages（如从 Image 拖线创建时预填），则保留
        if (inputImages.length === 0 && (node.data?.inputImages as string[] | undefined)?.length) {
          inputImages = (node.data.inputImages as string[]).slice(0, 10);
        } else {
          inputImages = inputImages.slice(0, 10);
        }

        // 可灵参考生视频o1：从连线解析参考视频 URL
        let referenceVideoUrl = '';
        const refEdge = incomingEdges.find((e) => e.targetHandle === 'reference-video');
        const refSource = refEdge ? nodes.find((n) => n.id === refEdge.source) : null;
        if (refSource?.type === 'video') {
          const url = (refSource.data?.originalVideoUrl || refSource.data?.outputVideo) as string | undefined;
          if (url && (url.startsWith('http://') || url.startsWith('https://'))) referenceVideoUrl = url;
        }

        setVideoInputPanelData({
          nodeId: node.id,
          prompt: resolvedPrompt,
          aspectRatio: (node.data?.aspectRatio as '16:9' | '9:16' | '1:1' | '2:3' | '3:2') || '16:9',
          model: (node.data?.model as 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'rhart-video-g' | 'rhart-video-s-i2v-pro' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard') || 'sora-2',
          hd: !!node.data?.hd,
          duration: (node.data?.duration as '5' | '10' | '15' | '25') || '10',
          inputImages,
          resolutionRhartV31: (node.data?.resolutionRhartV31 as '720p' | '1080p' | '4k') || '1080p',
          durationRhartVideoG: (node.data?.durationRhartVideoG as '6s' | '10s') || '6s',
          durationHailuo02: (node.data?.durationHailuo02 as '6' | '10') || '6',
          durationKlingO1: (node.data?.durationKlingO1 as '5' | '10') || '5',
          modeKlingO1: (node.data?.modeKlingO1 as 'std' | 'pro') || 'std',
          guidanceScale: node.data?.guidanceScale ?? 0.5,
          sound: (node.data?.sound as 'true' | 'false') || 'false',
          shotType: (node.data?.shotType as 'single' | 'multi') || 'single',
          negativePrompt: (node.data?.negativePrompt as string) || '',
          resolutionWan26: (node.data?.resolutionWan26 as '720p' | '1080p') || '1080p',
          durationWan26Flash: (node.data?.durationWan26Flash as '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15') || '5',
          enableAudio: node.data?.enableAudio !== false,
          referenceVideoUrl: referenceVideoUrl || undefined,
          keepOriginalSound: !!node.data?.keepOriginalSound,
          isConnected:
            inputImages.length > 0 ||
            incomingEdges.some((e) => {
              const src = nodes.find((n) => n.id === e.source);
              return (
                src &&
                (src.type === 'minimalistText' || src.type === 'text' || src.type === 'llm' || src.type === 'textSplit') &&
                e.targetHandle === 'input'
              );
            }),
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
      } else if (nodeType === 'character') {
        // Character 节点：构建输入面板数据
        const incomingEdges = edges.filter((e) => e.target === node.id);
        
        let resolvedVideoUrl = node.data?.videoUrl || '';
        let isConnected = false;

        // 检查是否有来自 video 节点的连接
        incomingEdges.forEach((edge) => {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          if (sourceNode && sourceNode.type === 'video') {
            // 优先使用 originalVideoUrl（网络 URL）
            if (sourceNode.data?.originalVideoUrl) {
              resolvedVideoUrl = sourceNode.data.originalVideoUrl as string;
              isConnected = true;
            } else if (sourceNode.data?.outputVideo) {
              const outputVideo = sourceNode.data.outputVideo as string;
              // 如果是网络 URL，直接使用
              if (outputVideo.startsWith('http://') || outputVideo.startsWith('https://')) {
                resolvedVideoUrl = outputVideo;
                isConnected = true;
              } else if (outputVideo.startsWith('local-resource://') || outputVideo.startsWith('file://')) {
                // 如果是本地路径，使用节点数据中的值（可能已经设置了 needsUpload）
                resolvedVideoUrl = node.data?.videoUrl || outputVideo;
                isConnected = true;
              }
            }
          }
        });

        // 检查是否需要上传（从节点数据读取，或根据 videoUrl 判断）
        // 如果 resolvedVideoUrl 是网络 URL，不需要上传
        const needsUpload = node.data?.needsUpload || 
          (resolvedVideoUrl && 
           !(resolvedVideoUrl.startsWith('http://') || resolvedVideoUrl.startsWith('https://')) &&
           (resolvedVideoUrl.startsWith('local-resource://') || resolvedVideoUrl.startsWith('file://')));
        const localVideoPath = node.data?.localVideoPath || (needsUpload ? resolvedVideoUrl : undefined);
        
        // 如果 resolvedVideoUrl 是网络 URL，确保不需要上传
        const finalNeedsUpload = resolvedVideoUrl && (resolvedVideoUrl.startsWith('http://') || resolvedVideoUrl.startsWith('https://')) 
          ? false 
          : needsUpload;

        setCharacterInputPanelData({
          nodeId: node.id,
          videoUrl: resolvedVideoUrl,
          nickname: node.data?.nickname || '',
          timestamp: node.data?.timestamp || '1,3', // 默认时间戳为 "1,3"
          isConnected,
          needsUpload: finalNeedsUpload || false, // 从节点数据中读取或根据 URL 判断
          localVideoPath: finalNeedsUpload ? localVideoPath : undefined, // 只有需要上传时才保存本地路径
          isUploading: false, // 默认未开始上传
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setVideoInputPanelData(null);
      } else if (nodeType === 'audio') {
        // Audio 节点：构建输入面板数据
        const incomingEdges = edges.filter((e) => e.target === node.id);
        
        let resolvedText = node.data?.text || '';
        let isConnected = false;

        let resolvedReferenceAudioUrl = node.data?.referenceAudioUrl || '';
        incomingEdges.forEach((edge) => {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          if (sourceNode) {
            if (sourceNode.type === 'minimalistText' || sourceNode.type === 'text') {
              resolvedText = sourceNode.data?.text || resolvedText;
              isConnected = true;
            } else if (sourceNode.type === 'llm') {
              resolvedText = sourceNode.data?.outputText || resolvedText;
              isConnected = true;
            } else if (sourceNode.type === 'audio') {
              const ref = (sourceNode.data?.originalAudioUrl && String(sourceNode.data.originalAudioUrl).startsWith('http'))
                ? String(sourceNode.data.originalAudioUrl)
                : (sourceNode.data?.outputAudio && String(sourceNode.data.outputAudio)) || '';
              if (ref) resolvedReferenceAudioUrl = ref;
            }
          }
        });

        const audioModel = node.data?.model || 'speech-2.8-hd';
        const isRhartSong = audioModel === 'rhart-song';
        const resolvedLyrics = (node.data?.lyrics ?? '').trim() || (isRhartSong ? resolvedText : '');
        if (isRhartSong && resolvedLyrics && !(node.data?.lyrics ?? '').trim()) {
          setNodes((nds) =>
            nds.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, lyrics: resolvedLyrics } } : n))
          );
        }
        setAudioInputPanelData({
          nodeId: node.id,
          text: resolvedText,
          model: audioModel,
          voiceId: node.data?.voiceId || 'Wise_Woman',
          speed: node.data?.speed ?? 1,
          volume: node.data?.volume ?? 1,
          pitch: node.data?.pitch ?? 0,
          emotion: node.data?.emotion,
          referenceAudioUrl: resolvedReferenceAudioUrl,
          songName: node.data?.songName ?? '',
          styleDesc: node.data?.styleDesc ?? '',
          lyrics: resolvedLyrics,
        });
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
      } else {
        // 文本、拆分等无底部操作框的节点：仅选中，关闭所有面板
        setLlmInputPanelData(null);
        setImageInputPanelData(null);
        setVideoInputPanelData(null);
        setCharacterInputPanelData(null);
        setAudioInputPanelData(null);
      }
      } catch (err) {
        console.error('[Workspace] onNodeClick 设置面板时出错:', err);
      }
    },
    [edges, nodes, setNodes, globalPersonas]
  );

  // 用 ref 包装 onNodeClick，保证传给 React Flow 的始终是“调用最新逻辑”的稳定引用，避免子组件拿到旧闭包导致点击无反应
  const onNodeClickRef = useRef(onNodeClick);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);
  const onNodeClickStable = useCallback((e: React.MouseEvent, node: Node) => {
    const fn = onNodeClickRef.current;
    if (typeof fn === 'function') {
      try {
        fn(e, node);
      } catch (err) {
        console.error('[Workspace] onNodeClick 执行出错:', err);
      }
    }
  }, []);

  // 选中变化时：若仅选中一个节点，同步打开该节点的底部操作框（弥补部分场景下 onNodeClick 未触发的问题）
  const onSelectionChange = useCallback(
    (params: { nodes: Node[]; edges: Edge[] }) => {
      if (params.nodes.length === 1) {
        const node = params.nodes[0];
        if (node?.id) {
          onNodeClickRef.current(null as any, node);
        }
      }
    },
    []
  );

  // 阻止在调整大小时拖动节点
  const onNodeDragStart = useCallback((_event: React.MouseEvent, node: Node) => {
    // 检查是否正在调整大小（通过检查节点数据中的标记）
    if (node.data?._isResizing) {
      return false;
    }
  }, []);

  // 节点拖拽停止事件（实时保存位置）
  const onNodeDragStop = useCallback(async (_event: React.MouseEvent, node: Node) => {
    if (!projectId || !window.electronAPI) return;
    
    // 立即保存节点位置变化
    try {
      const nodesToSave = nodes.map((n) =>
        n.id === node.id
          ? {
              ...n,
              position: node.position,
              data: {
                ...n.data,
                width: n.data?.width,
                height: n.data?.height,
              },
            }
          : {
              ...n,
              data: {
                ...n.data,
                width: n.data?.width,
                height: n.data?.height,
              },
            }
      );
      await window.electronAPI.saveProjectData(projectId, nodesToSave, edges);
    } catch (error) {
      console.error('保存节点位置失败:', error);
    }
  }, [projectId, nodes, edges]);


  // 点击连接线选中
  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge);
    setSelectedNode(null); // 选中边时取消节点选择
  }, []);

  // 下载图片
  const handleDownloadImage = useCallback(async (taskId: string, imageUrl: string, nodeTitle: string) => {
    if (!window.electronAPI) {
      console.error('electronAPI 不可用');
      return;
    }

    try {
      // 如果是 local-resource:// URL，提取本地路径并直接打开
      if (imageUrl.startsWith('local-resource://')) {
        const localPath = imageUrl.replace('local-resource://', '');
        const result = await window.electronAPI.openFile(localPath);
        if (result.success) {
          console.log('图片已打开:', localPath);
        } else {
          console.error('打开图片失败:', result.error);
        }
        return;
      }

      // 如果是 file:// URL，提取本地路径并直接打开
      if (imageUrl.startsWith('file://')) {
        const localPath = imageUrl.replace(/^file:\/\/\/?/, '').replace(/\//g, '\\');
        const result = await window.electronAPI.openFile(localPath);
        if (result.success) {
          console.log('图片已打开:', localPath);
        } else {
          console.error('打开图片失败:', result.error);
        }
        return;
      }

      // 对于远程 URL，通过主进程下载图片
      const result = await window.electronAPI.downloadImage(imageUrl, nodeTitle);
      if (result.success && result.filePath) {
        console.log('图片下载成功:', result.filePath);
        // 更新任务的本地文件路径
        setTasks((prevTasks) =>
          prevTasks.map((task) =>
            task.id === taskId
              ? { ...task, localFilePath: result.filePath }
              : task
          )
        );
      } else {
        console.error('图片下载失败:', result.error);
      }
    } catch (error) {
      console.error('下载图片时出错:', error);
    }
  }, []);

  // 打开文件所在的文件夹
  const handleOpenImage = useCallback(async (filePath: string) => {
    if (!window.electronAPI) {
      console.error('electronAPI 不可用');
      return;
    }

    try {
      await window.electronAPI.showItemInFolder(filePath);
    } catch (error) {
      console.error('打开文件夹时出错:', error);
    }
  }, []);


  // 处理粘贴图片：在画布中自动创建 Image 节点并展示图片，节点出现在鼠标位置
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items || !reactFlowWrapper.current) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;

          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const api = flowContentApiRef.current;
            let position = { x: 100, y: 100 };
            if (api) {
              const last = api.getLastMousePosition();
              if (last && (last.x !== 0 || last.y !== 0)) {
                position = api.screenToFlowPosition(last);
              } else {
                const pane = reactFlowWrapper.current?.querySelector('.react-flow') as HTMLElement;
                const rect = pane?.getBoundingClientRect();
                if (rect) {
                  position = api.screenToFlowPosition({
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                  });
                }
              }
            }

            const newNode: Node = {
              id: `image-${Date.now()}`,
              type: 'image',
              position,
              data: {
                label: '图片节点',
                width: 369.46,
                height: 211.12,
                title: 'image',
                resolution: '1024x1024',
                aspectRatio: '1:1',
                model: 'nano-banana-2',
                outputImage: dataUrl,
              },
            };

            setNodes((nds) => nds.concat(newNode));
          };
          reader.readAsDataURL(file);

          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste as any);
    return () => {
      window.removeEventListener('paste', handlePaste as any);
    };
  }, [setNodes]);

  // 删除任务
  const handleDeleteTask = useCallback((taskId: string) => {
    setTasks((prevTasks) => prevTasks.filter((task) => task.id !== taskId));
  }, []);

  // 批量运行节点
  const handleBatchRun = useCallback(async (nodeIds: string[]) => {
    if (!window.electronAPI || nodeIds.length === 0) {
      return;
    }
    if (batchRunInProgress) {
      return; // 避免重复点击
    }
    setBatchRunInProgress(true);
    const runPromises: Promise<void>[] = [];

    console.log('[Workspace] 开始批量运行节点:', nodeIds);

    // 遍历所有节点，构建 payload 并执行
    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      const node = nodes.find((n) => n.id === nodeId);
      
      if (!node) {
        console.warn(`[Workspace] 节点 ${nodeId} 不存在，跳过`);
        continue;
      }

      // 根据节点类型构建不同的 payload
      let modelId: string;
      let payload: any;

      if (node.type === 'video') {
        modelId = 'video';
        const nodeData = node.data || {};
        
        // 检查是否有必要的参数
        if (!nodeData.prompt?.trim()) {
          console.warn(`[Workspace] 视频节点 ${nodeId} 缺少提示词，跳过`);
          continue;
        }

        // 图生视频需要至少一张参考图
        const inputImages = nodeData.inputImages || [];
        const isImageToVideoMode = inputImages.length > 0;
        if (isImageToVideoMode && inputImages.length === 0) {
          console.warn(`[Workspace] 视频节点 ${nodeId} 图生视频模式但缺少参考图，跳过`);
          continue;
        }

        payload = {
          prompt: nodeData.prompt,
          model: nodeData.model || 'sora-2',
          aspect_ratio: nodeData.aspectRatio || '16:9',
        };

        // sora-2 系列参数
        if (payload.model === 'sora-2' || payload.model === 'sora-2-pro') {
          payload.hd = nodeData.hd ?? false;
          payload.duration = nodeData.duration || '5';
        }

        // kling-v2.6-pro 系列参数
        const isKlingModel = payload.model === 'kling-v2.6-pro';
        if (isKlingModel) {
          payload.duration = nodeData.duration || '5';
          if (nodeData.guidanceScale !== undefined) {
            payload.guidanceScale = nodeData.guidanceScale;
          }
          if (nodeData.sound) {
            payload.sound = nodeData.sound;
          }
        }

        // 万相2.6 / 全能V3.1 / 全能视频G 等参数（主进程从 input 读取）
        if (nodeData.resolutionRhartV31) payload.resolutionRhartV31 = nodeData.resolutionRhartV31;
        if (nodeData.durationWan26Flash) payload.durationWan26Flash = nodeData.durationWan26Flash;
        if (nodeData.shotType) payload.shotType = nodeData.shotType;
        if (nodeData.negativePrompt !== undefined) payload.negativePrompt = nodeData.negativePrompt;
        if (nodeData.enableAudio !== undefined) payload.enableAudio = nodeData.enableAudio;
        if (nodeData.resolutionWan26) payload.resolutionWan26 = nodeData.resolutionWan26;
        if (nodeData.durationRhartVideoG) payload.durationRhartVideoG = nodeData.durationRhartVideoG;
        if (nodeData.durationHailuo02) payload.durationHailuo02 = nodeData.durationHailuo02;
        if (nodeData.durationKlingO1) payload.durationKlingO1 = nodeData.durationKlingO1;
        if (nodeData.modeKlingO1) payload.modeKlingO1 = nodeData.modeKlingO1;

        // 可灵参考生视频o1：从连线解析参考视频 URL
        if (payload.model === 'kling-video-o1-ref') {
          const refEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'reference-video');
          const refSource = refEdge ? nodes.find((n) => n.id === refEdge.source) : null;
          const refUrl = refSource?.type === 'video'
            ? (refSource.data?.originalVideoUrl || refSource.data?.outputVideo) as string | undefined
            : undefined;
          if (refUrl && (refUrl.startsWith('http://') || refUrl.startsWith('https://'))) {
            payload.referenceVideoUrl = refUrl;
          } else if (!refUrl || refUrl.trim() === '') {
            console.warn(`[Workspace] 视频节点 ${nodeId} 可灵参考生视频o1 未连接参考视频或参考视频非公网链接，跳过`);
            continue;
          } else {
            console.warn(`[Workspace] 视频节点 ${nodeId} 可灵参考生视频o1 的参考视频须为 http(s) 链接，跳过`);
            continue;
          }
          if (nodeData.keepOriginalSound === true) payload.keepOriginalSound = true;
        }

        // 图生视频模式：添加图片
        if (isImageToVideoMode && inputImages.length > 0) {
          payload.images = inputImages.slice(0, 10);
        }

        // 添加项目ID
        if (projectId) {
          payload.projectId = projectId;
        }
      } else if (node.type === 'image') {
        modelId = 'image';
        const nodeData = node.data || {};
        
        // 检查是否有必要的参数
        if (!nodeData.prompt?.trim()) {
          console.warn(`[Workspace] 图片节点 ${nodeId} 缺少提示词，跳过`);
          continue;
        }

        const inputImages = nodeData.inputImages || [];
        const isImageToImageMode = inputImages.length > 0;

        // 判断是否支持 image_size（仅 nano-banana-2-2k 和 nano-banana-2-4k 支持）
        const model = nodeData.model || 'nano-banana-2';
        const supportsImageSize = model === 'nano-banana-2-2k' || model === 'nano-banana-2-4k';
        
        // 从 resolution 解析 image_size（如果支持）
        let imageSize: '1K' | '2K' | '4K' | undefined;
        const resolution = nodeData.resolution || '1024x1024';
        if (supportsImageSize) {
          if (resolution.includes('512') || resolution.includes('768')) {
            imageSize = '1K';
          } else if (resolution.includes('1024')) {
            imageSize = '2K';
          } else if (resolution.includes('1792') || model === 'nano-banana-2-4k') {
            imageSize = '4K';
          }
        }

        let payloadAspectRatio = nodeData.aspectRatio || '1:1';
        if (model === 'rhart-image-g-1.5') {
          const validG15 = ['auto', '1:1', '3:2', '2:3'];
          if (!validG15.includes(payloadAspectRatio)) payloadAspectRatio = '2:3';
        }
        payload = {
          model,
          prompt: nodeData.prompt,
          response_format: 'url',
          aspect_ratio: payloadAspectRatio,
          image_size: imageSize,
          resolution: nodeData.resolution || '1024x1024',
        };
        if (model === 'seedream-v4.5') {
          const minS = 1024;
          const maxS = 4096;
          payload.seedreamWidth = Math.max(minS, Math.min(maxS, Number(nodeData.seedreamWidth) || 2048));
          payload.seedreamHeight = Math.max(minS, Math.min(maxS, Number(nodeData.seedreamHeight) || 2048));
        }

        // 文悠船文生图-v7 可选 negativePrompt
        if (model === 'youchuan-text-to-image-v7' && nodeData.negativePrompt !== undefined) {
          payload.negativePrompt = nodeData.negativePrompt;
        }

        // 图生图模式：如果有输入图片，添加 image 参数
        if (isImageToImageMode && inputImages.length > 0) {
          payload.image = inputImages.slice(0, 10);
        }

        // 添加项目ID
        if (projectId) {
          payload.projectId = projectId;
        }
      } else if (node.type === 'llm') {
        modelId = 'chat';
        const nodeData = node.data || {};
        
        // 批量运行时从连线解析「图片反推」：存在来自 Image 节点的连线则取源节点 outputImage
        const incomingToLlm = edges.filter((e) => e.target === nodeId);
        const imageEdge = incomingToLlm.find((e) => {
          const src = nodes.find((n) => n.id === e.source);
          return src?.type === 'image' && src?.data?.outputImage;
        });
        const resolvedImageUrlForReverse = imageEdge
          ? (nodes.find((n) => n.id === imageEdge.source)?.data?.outputImage as string | undefined)
          : undefined;
        const isImageReverseMode = !!resolvedImageUrlForReverse;

        const userInput = nodeData.userInput?.trim() || '';
        const inputText = nodeData.inputText?.trim() || '';
        
        if (!isImageReverseMode && !userInput && !inputText) {
          console.warn(`[Workspace] LLM 节点 ${nodeId} 缺少输入内容，跳过`);
          continue;
        }

        // 图像反推模式
        if (isImageReverseMode && resolvedImageUrlForReverse) {
          const question = inputText.trim() || '这张图片有什么？';
          const reverseModel = (nodeData.reverseCaptionModel as 'gpt-4o' | 'joy-caption-two') || 'gpt-4o';
          payload = {
            model: reverseModel,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: question },
                  {
                    type: 'image_url',
                    image_url: {
                      url: resolvedImageUrlForReverse,
                    },
                  },
                ],
              },
            ],
            max_tokens: 400,
            stream: false,
          };
        } else {
          // 普通文本对话模式
          const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
          
          if (userInput) {
            messages.push({
              role: 'system',
              content: userInput,
            });
          }
          
          if (inputText) {
            messages.push({
              role: 'user',
              content: inputText,
            });
          }
          
          if (messages.length === 0) {
            console.warn(`[Workspace] LLM 节点 ${nodeId} 消息为空，跳过`);
            continue;
          }
          
          payload = {
            model: 'gpt-3.5-turbo',
            messages,
            temperature: 0.7,
            max_tokens: 2000,
            stream: false,
          };
        }

        // 添加项目ID和节点标题
        if (projectId) {
          payload.projectId = projectId;
        }
        const nodeTitle = node.data?.title || 'llm';
        payload.nodeTitle = nodeTitle;
      } else if (node.type === 'audio') {
        modelId = 'audio';
        const nodeData = node.data || {};
        const audioModel = nodeData.model || 'speech-2.8-hd';
        const isIndexTts2 = audioModel === 'index-tts2';
        const isRhartSong = audioModel === 'rhart-song';

        if (isRhartSong) {
          if (!(nodeData.songName ?? '').trim() || !(nodeData.styleDesc ?? '').trim() || !(nodeData.lyrics ?? '').trim()) {
            console.warn(`[Workspace] 音频节点 ${nodeId} 全能写歌 缺少歌曲名/风格描述/歌词，跳过`);
            continue;
          }
        } else {
          if (!nodeData.text?.trim()) {
            console.warn(`[Workspace] 音频节点 ${nodeId} 缺少文本，跳过`);
            continue;
          }
          if (!isIndexTts2 && !nodeData.voiceId) {
            console.warn(`[Workspace] 音频节点 ${nodeId} 缺少音色，跳过`);
            continue;
          }
        }
        // 参考音：优先来自连接的声音节点，否则用节点自身的 referenceAudioUrl
        let referenceAudioUrl = (nodeData.referenceAudioUrl || '').trim();
        const audioIncomingEdges = edges.filter((e) => e.target === nodeId);
        for (const e of audioIncomingEdges) {
          const srcNode = nodes.find((n) => n.id === e.source);
          if (srcNode?.type === 'audio') {
            const ref = (srcNode.data?.originalAudioUrl && String(srcNode.data.originalAudioUrl).startsWith('http'))
              ? String(srcNode.data.originalAudioUrl)
              : (srcNode.data?.outputAudio && String(srcNode.data.outputAudio)) || '';
            if (ref) {
              referenceAudioUrl = ref;
              break;
            }
          }
        }
        if (isIndexTts2 && !referenceAudioUrl) {
          console.warn(`[Workspace] 音频节点 ${nodeId} Index-TTS2.0 缺少参考音，跳过`);
          continue;
        }
        if (referenceAudioUrl.startsWith('local-resource://') || referenceAudioUrl.startsWith('file://')) {
          referenceAudioUrl = referenceAudioUrl.replace(/%5C/gi, '/').replace(/^local-resource:\/\/+/, 'local-resource://').replace(/^file:\/\/+/, 'file://');
        }

        payload = {
          model: audioModel,
          text: (nodeData.text || '').trim(),
          enable_base64_output: false,
          english_normalization: false,
        };
        if (isRhartSong) {
          payload.songName = (nodeData.songName ?? '').trim();
          payload.styleDesc = (nodeData.styleDesc ?? '').trim();
          payload.lyrics = (nodeData.lyrics ?? '').trim();
        } else if (isIndexTts2) {
          payload.referenceAudioUrl = referenceAudioUrl;
        } else {
          payload.voice_id = nodeData.voiceId || 'Wise_Woman';
          payload.speed = nodeData.speed ?? 1;
          payload.volume = nodeData.volume ?? 1;
          payload.pitch = nodeData.pitch ?? 0;
          if (nodeData.emotion) payload.emotion = nodeData.emotion;
        }
        if (projectId) payload.projectId = projectId;
      } else {
        console.warn(`[Workspace] 不支持的节点类型: ${node.type}，跳过`);
        continue;
      }

      // 批量运行时，立即初始化进度条（确保所有节点都能显示进度）
      if (node.type === 'video') {
        // 设置初始进度（1%），确保显示进度条
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    progress: 1, // 设置为 1% 以显示进度条
                    progressMessage: '正在初始化...',
                    errorMessage: undefined, // 清除之前的错误信息
                  },
                }
              : n
          )
        );
        // 同步更新到 handleVideoNodeDataChange
        handleVideoNodeDataChange(nodeId, {
          progress: 1,
          progressMessage: '正在初始化...',
          errorMessage: undefined,
        });
      } else if (node.type === 'image') {
        // 图片节点也初始化进度条
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    progress: 1,
                    progressMessage: '正在初始化...',
                    errorMessage: undefined,
                  },
                }
              : n
          )
        );
        handleImageNodeDataChange(nodeId, {
          progress: 1,
          progressMessage: '正在初始化...',
          errorMessage: undefined,
        });
      } else if (node.type === 'llm') {
        // LLM 节点也初始化进度条
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    progress: 1, // 设置为 1% 以显示进度条
                    progressMessage: '正在初始化模型...',
                    errorMessage: undefined, // 清除之前的错误信息
                  },
                }
              : n
          )
        );
      } else if (node.type === 'audio') {
        // Audio 节点也初始化状态
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    aiStatus: 'START', // 设置为 START 状态以显示加载动画
                    errorMessage: undefined, // 清除之前的错误信息
                  },
                }
              : n
          )
        );
        // 同步更新到 handleAudioNodeDataChange
        handleAudioNodeDataChange(nodeId, {
          errorMessage: undefined,
        });
      }

      // 异步执行，使用 50ms 间隔错开请求，并收集 Promise 以便全部完成后解除“运行中”状态
      runPromises.push(
        new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              console.log(`[Workspace] 执行节点 ${nodeId} (${node.type}):`, payload);
              await window.electronAPI.invokeAI({
                modelId,
                nodeId,
                input: payload,
              });
            } catch (error) {
              console.error(`[Workspace] 节点 ${nodeId} 执行失败:`, error);
              // 执行失败时，清除进度条并显示错误
              if (node.type === 'video') {
                handleVideoNodeDataChange(nodeId, {
                  progress: 0,
                  errorMessage: error instanceof Error ? error.message : '执行失败',
                });
              } else if (node.type === 'image') {
                handleImageNodeDataChange(nodeId, {
                  progress: 0,
                  errorMessage: error instanceof Error ? error.message : '执行失败',
                });
              } else if (node.type === 'llm') {
                // LLM 节点执行失败时，清除进度条并显示错误
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            progress: 0,
                            errorMessage: error instanceof Error ? error.message : '执行失败',
                          },
                        }
                      : n
                  )
                );
              } else if (node.type === 'audio') {
                // Audio 节点执行失败时，清除状态并显示错误
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            aiStatus: 'ERROR', // 设置为 ERROR 状态
                            errorMessage: error instanceof Error ? error.message : '执行失败',
                          },
                        }
                      : n
                  )
                );
                handleAudioNodeDataChange(nodeId, {
                  errorMessage: error instanceof Error ? error.message : '执行失败',
                });
              }
            } finally {
              resolve();
            }
          }, i * 50); // 每个请求间隔 50ms
        })
      );
    }

    try {
      await Promise.all(runPromises);
    } finally {
      setBatchRunInProgress(false);
    }
  }, [nodes, projectId, setNodes, handleVideoNodeDataChange, handleImageNodeDataChange, handleAudioNodeDataChange, batchRunInProgress]);

  // 视频生成完成时，创建任务记录并自动保存到本地
  const handleAddVideoTask = useCallback((nodeId: string, videoUrl: string, prompt: string, originalVideoUrl?: string) => {
    setTasks((prevTasks) => {
      // 检查是否已存在相同的任务（避免重复添加）
      const existingTask = prevTasks.find(
        (task) => task.nodeId === nodeId && task.videoUrl === videoUrl && task.status === 'success'
      );
      if (existingTask) {
        console.log('[Workspace] 视频任务已存在，跳过添加');
        return prevTasks;
      }

      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return prevTasks;

      const nodeTitle = node.data?.title || 'video';
      const newTask: Task = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nodeId,
        nodeTitle,
        videoUrl,
        prompt: prompt || '无提示词',
        createdAt: Date.now(),
        status: 'success',
        taskType: 'video',
      };

      // 自动保存视频到本地
      if (window.electronAPI && projectId) {
        window.electronAPI
          .autoSaveVideo(videoUrl, nodeTitle, projectId)
          .then((result: any) => {
            if (result.success && result.filePath) {
              // 更新任务的本地文件路径
              setTasks((prev) =>
                prev.map((task) =>
                  task.id === newTask.id ? { ...task, localFilePath: result.filePath } : task
                )
              );
              
              // 延迟更新 VideoNode，确保文件完全写入并可用
              // 使用 setTimeout 给文件系统一些时间来完全刷新
              // 使用闭包保存 nodeId，确保更新到正确的节点
              const targetNodeId = nodeId;
              setTimeout(() => {
                console.log('[Workspace] 自动保存视频完成，更新节点:', targetNodeId, 'filePath:', result.filePath);
                // 构建 local-resource URL，确保 Windows 路径格式正确
                let filePath = result.filePath.replace(/\\/g, '/');
                // 确保路径以 / 开头（Windows 路径 C:/Users -> /C:/Users）
                if (!filePath.startsWith('/') && filePath.match(/^[a-zA-Z]:/)) {
                  filePath = '/' + filePath;
                }
                const localResourceUrl = `local-resource://${filePath}`;
                
                // 更新 VideoNode：显示下载的视频并停止进度条
                // 使用函数式更新，确保基于最新状态
                setNodes((nds) => {
                  const updatedNodes = nds.map((n) =>
                    n.id === targetNodeId
                      ? { ...n, data: { ...n.data, outputVideo: localResourceUrl, progress: 0, errorMessage: undefined } }
                      : n
                  );
                  console.log('[Workspace] 节点更新完成，目标节点ID:', targetNodeId, '找到节点:', updatedNodes.find(n => n.id === targetNodeId) !== undefined);
                  return updatedNodes;
                });
                handleVideoNodeDataChange(targetNodeId, { outputVideo: localResourceUrl, progress: 0, errorMessage: undefined });
              }, 500); // 延迟 500ms，确保文件完全写入
            }
          })
          .catch((error) => {
            console.error('自动保存视频失败:', error);
          });
      }

      return [newTask, ...prevTasks];
    });
  }, [nodes, projectId, handleVideoNodeDataChange]);

  // 音频生成完成时，创建任务记录并自动保存到本地
  const handleAddAudioTask = useCallback((nodeId: string, audioUrl: string, prompt: string, originalAudioUrl?: string) => {
    setTasks((prevTasks) => {
      // 检查是否已存在相同的任务（避免重复添加）
      const existingTask = prevTasks.find(
        (task) => task.nodeId === nodeId && task.audioUrl === audioUrl && task.status === 'success'
      );
      if (existingTask) {
        console.log('[Workspace] 音频任务已存在，跳过添加');
        return prevTasks;
      }

      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return prevTasks;

      const nodeTitle = node.data?.title || 'audio';
      // 生成的歌曲保存时文件名使用歌曲名字（全能写歌 rhart-song）
      const isSong = node.data?.model === 'rhart-song';
      const songName = (node.data?.songName as string)?.trim();
      const saveFileName = isSong && songName ? songName : nodeTitle;
      const newTask: Task = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        nodeId,
        nodeTitle,
        audioUrl,
        prompt: prompt || '无提示词',
        createdAt: Date.now(),
        status: 'success',
        taskType: 'audio',
      };

      // 自动保存音频到本地（歌曲使用歌曲名作为文件名）
      if (window.electronAPI && projectId) {
        window.electronAPI
          .autoSaveAudio(audioUrl, saveFileName, projectId)
          .then((result: any) => {
            if (result.success && result.filePath) {
              // 更新任务的本地文件路径
              setTasks((prev) =>
                prev.map((task) =>
                  task.id === newTask.id ? { ...task, localFilePath: result.filePath } : task
                )
              );
              
              // 延迟更新 AudioNode，确保文件完全写入并可用
              const targetNodeId = nodeId;
              setTimeout(() => {
                console.log('[Workspace] 自动保存音频完成，更新节点:', targetNodeId, 'filePath:', result.filePath);
                // 构建 local-resource URL，确保 Windows 路径格式正确
                let filePath = result.filePath.replace(/\\/g, '/');
                // 确保路径以 / 开头（Windows 路径 C:/Users -> /C:/Users）
                if (!filePath.startsWith('/') && filePath.match(/^[a-zA-Z]:/)) {
                  filePath = '/' + filePath;
                }
                const localResourceUrl = `local-resource://${filePath}`;
                
                // 更新 AudioNode：显示下载的音频并停止进度条
                setNodes((nds) => {
                  const updatedNodes = nds.map((n) =>
                    n.id === targetNodeId
                      ? { ...n, data: { ...n.data, outputAudio: localResourceUrl, errorMessage: undefined } }
                      : n
                  );
                  console.log('[Workspace] 音频节点更新完成，目标节点ID:', targetNodeId, '找到节点:', updatedNodes.find(n => n.id === targetNodeId) !== undefined);
                  return updatedNodes;
                });
                if (handleAudioNodeDataChangeRef.current) {
                  handleAudioNodeDataChangeRef.current(targetNodeId, { outputAudio: localResourceUrl, errorMessage: undefined });
                }
              }, 500); // 延迟 500ms，确保文件完全写入
            }
          })
          .catch((error) => {
            console.error('自动保存音频失败:', error);
          });
      }

      return [newTask, ...prevTasks];
    });
  }, [nodes, projectId, handleAudioNodeDataChangeRef]);

  // 点击画布空白区域取消选择
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setContextMenu(null);
    setLlmInputPanelData(null); // 点击画布时关闭 LLM 输入面板
    setImageInputPanelData(null); // 点击画布时关闭 Image 输入面板
    setVideoInputPanelData(null); // 点击画布时关闭 Video 输入面板
    setCharacterInputPanelData(null); // 点击画布时关闭 Character 输入面板
    setAudioInputPanelData(null); // 点击画布时关闭 Audio 输入面板
  }, []);


  // 处理菜单项选择（connectFrom 存在时表示从连线拖到空白处弹出，创建节点后自动连边）
  const handleMenuSelect = useCallback((type: string, position: { x: number; y: number }, connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null }) => {
    console.log('[Workspace] handleMenuSelect 收到位置:', { type, position, connectFrom });
    
    // 根据节点类型确定默认尺寸（LLM 与 Text 模块相同）
    const defaultWidth =
      type === 'text'
        ? 369.46
        : type === 'llm'
          ? 280  // 与 Text 模块相同的初始尺寸
          : type === 'textSplit'
            ? 240
            : type === 'image'
              ? 369.46
              : type === 'video'
                ? 738.91
                : type === 'character'
                  ? 200
                  : type === 'audio'
                    ? 280  // 与 Text 模块相同的初始尺寸
                    : type === 'cameraControl'
                      ? 340
                    : 200;
    const defaultHeight =
      type === 'text'
        ? 211.12
        : type === 'llm'
          ? 160  // 与 Text 模块相同的初始尺寸
          : type === 'textSplit'
            ? 200
            : type === 'image'
              ? 211.12
              : type === 'video'
                ? 422.22
                : type === 'character'
                  ? 200
                  : type === 'audio'
                    ? 160  // 与 Text 模块相同的初始尺寸
                    : type === 'cameraControl'
                      ? 355
                    : 200;
    
    // 调整节点位置，使节点中心在鼠标点击处
    const adjustedPosition = {
      x: position.x - defaultWidth / 2,
      y: position.y - defaultHeight / 2,
    };
    
    console.log('[Workspace] 计算后的节点位置:', { 
      original: position, 
      adjusted: adjustedPosition, 
      size: { width: defaultWidth, height: defaultHeight } 
    });

    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type:
        type === 'text'
          ? 'minimalistText'
          : type === 'llm'
            ? 'llm'
            : type === 'textSplit'
              ? 'textSplit'
              : type === 'image'
                ? 'image'
                : type === 'video'
                  ? 'video'
                  : type === 'character'
                    ? 'character'
                    : type === 'audio'
                      ? 'audio'
                      : type === 'cameraControl'
                        ? 'cameraControl'
                      : 'custom',
      position: adjustedPosition,
      data: {
        label: type === 'text' ? '文本节点' : type === 'llm' ? '大语言模型' : type === 'textSplit' ? '文本拆分' : type === 'image' ? '图片节点' : type === 'video' ? '视频节点' : type === 'character' ? '角色节点' : type === 'audio' ? '声音节点' : type === 'cameraControl' ? '3D视角控制器' : '声音节点',
        text: type === 'text' ? '' : type === 'audio' ? '' : undefined,
        width: defaultWidth,
        height: defaultHeight,
        isUserResized: false, // 新创建的节点，用户尚未手动调整尺寸
        prompt: type === 'llm' || type === 'image' || type === 'video' ? '' : undefined,
        title: type === 'llm' ? 'llm' : type === 'image' ? 'image' : type === 'video' ? 'video' : type === 'character' ? 'character' : type === 'audio' ? 'audio' : type === 'textSplit' ? 'textSplit' : type === 'cameraControl' ? '3D视角控制器' : undefined,
        inputText: type === 'textSplit' ? '' : undefined,
        separator: type === 'textSplit' ? '&&&' : undefined,
        trimAndFilterEmpty: type === 'textSplit' ? true : undefined,
        convertType: type === 'textSplit' ? 'string' : undefined,
        resolution: type === 'image' ? '1024x1024' : undefined,
        aspectRatio: type === 'image' ? '1:1' : type === 'video' ? '16:9' : undefined,
        seedreamWidth: type === 'image' ? 2048 : undefined,
        seedreamHeight: type === 'image' ? 2048 : undefined,
        model: type === 'image' ? 'nano-banana' : type === 'video' ? 'sora-2' : type === 'audio' ? 'speech-2.8-hd' : undefined, // 兜底为 undefined，避免非法值
        hd: type === 'video' ? false : undefined,
        duration: type === 'video' ? '10' : undefined,
        videoUrl: type === 'character' ? '' : undefined,
        nickname: type === 'character' ? '' : undefined,
        timestamp: type === 'character' ? '1,3' : undefined, // 默认时间戳为 "1,3"
        voiceId: type === 'audio' ? 'Wise_Woman' : undefined,
        speed: type === 'audio' ? 1 : undefined,
        volume: type === 'audio' ? 1 : undefined,
        pitch: type === 'audio' ? 0 : undefined,
        referenceAudioUrl: type === 'audio' ? '' : undefined,
        aiStatus: type === 'audio' ? 'idle' : undefined,
        rotationX: type === 'cameraControl' ? 15 : undefined,
        rotationY: type === 'cameraControl' ? 35 : undefined,
        scale: type === 'cameraControl' ? 3.2 : undefined,
        fov: type === 'cameraControl' ? 45 : undefined,
        cameraControl: type === 'cameraControl' ? { rotationX: 15, rotationY: 35, scale: 3.2, fov: 45 } : undefined,
        inputImage: type === 'cameraControl' ? '' : undefined,
      },
    };

    const newNodeId = newNode.id;

    // 从 Image 拖线创建 Video 时，预填 inputImages 进入图生视频模式
    if (type === 'video' && connectFrom?.sourceNodeId) {
      setNodes((nds) => {
        const sourceNode = nds.find((n) => n.id === connectFrom.sourceNodeId);
        const imageUrl = sourceNode?.type === 'image'
          ? ((sourceNode.data?.outputImage as string) || (sourceNode.data?.inputImages as string[])?.[0])
          : null;
        if (imageUrl) {
          const nodeWithInput = {
            ...newNode,
            data: { ...newNode.data, inputImages: [imageUrl] },
          };
          return nds.concat(nodeWithInput);
        }
        return nds.concat(newNode);
      });
    } else {
      setNodes((nds) => nds.concat(newNode));
    }

    if (connectFrom?.sourceNodeId) {
      const targetHandle =
        type === 'image' ? 'image-input'
        : type === 'video' ? 'input'  // Video 节点 Handle id 为 'input'
        : type === 'audio' ? 'audio-input'
        : 'input';
      setEdges((eds) =>
        eds.concat({
          id: `e-${connectFrom.sourceNodeId}-${newNodeId}-${Date.now()}`,
          source: connectFrom.sourceNodeId,
          sourceHandle: connectFrom.sourceHandleId ?? undefined,
          target: newNodeId,
          targetHandle,
        })
      );
    }
    setContextMenu(null);
  }, [contextMenu, setNodes, setEdges]);

  // 从左侧边栏拖拽节点到画布
  const onDragStart = (event: React.DragEvent, nodeType: string, label: string) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify({ type: nodeType, label }));
    event.dataTransfer.effectAllowed = 'move';
  };

  // 根据文件推断节点类型与初始 data
  const getFileNodeTypeAndData = useCallback((file: File & { path?: string }): { type: string; nodeType: string; extraData: Record<string, unknown> } | null => {
    const path = (file as File & { path?: string }).path;
    const name = (file.name || '').toLowerCase();
    const mime = (file.type || '').toLowerCase();
    const isImage = /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(name) || mime.startsWith('image/');
    const isVideo = /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(name) || mime.startsWith('video/');
    const isAudio = /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(name) || mime.startsWith('audio/');
    const isText = /\.(txt|md|json|xml|html|css|js|ts|log)$/i.test(name) || mime.startsWith('text/');
    const normalizedPath = path ? `local-resource://${path.replace(/\\/g, '/')}` : '';

    if (isImage) {
      return {
        type: 'image',
        nodeType: 'image',
        extraData: {
          outputImage: normalizedPath,
          title: 'image',
          width: 369.46,
          height: 211.12,
          resolution: '1024x1024',
          aspectRatio: '1:1',
          model: 'nano-banana',
          seedreamWidth: 2048,
          seedreamHeight: 2048,
        },
      };
    }
    if (isVideo) {
      return {
        type: 'video',
        nodeType: 'video',
        extraData: {
          outputVideo: normalizedPath,
          title: 'video',
          width: 738.91,
          height: 422.22,
          prompt: '',
          aspectRatio: '16:9',
          model: 'sora-2',
          hd: false,
          duration: '10',
        },
      };
    }
    if (isAudio) {
      return {
        type: 'audio',
        nodeType: 'audio',
        extraData: {
          outputAudio: normalizedPath,
          title: 'audio',
          width: 280,
          height: 160,
          text: '',
          voiceId: 'Wise_Woman',
          speed: 1,
          volume: 1,
          pitch: 0,
          referenceAudioUrl: '',
          aiStatus: 'idle' as const,
        },
      };
    }
    if (isText) {
      return {
        type: 'text',
        nodeType: 'minimalistText',
        extraData: {
          title: 'text',
          text: '', // 稍后异步填充
          width: 369.46,
          height: 211.12,
        },
      };
    }
    return null;
  }, []);

  // 在画布上放置节点（支持从左侧拖拽节点 或 从系统拖入文件，flowPosition 由 FlowContent 传入）
  // 本地拖入的图片/视频/音频会先复制到项目 assets，画布从项目路径读取，避免 OSS 次日删除或原路径失效导致“图片加载失败”
  const onDrop = useCallback(
    async (event: React.DragEvent, flowPosition: { x: number; y: number }) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      const position = flowPosition ?? (reactFlowBounds
        ? { x: event.clientX - reactFlowBounds.left, y: event.clientY - reactFlowBounds.top }
        : { x: 0, y: 0 });

      // 优先处理：从系统拖入的文件（先保存到项目文件夹，再从项目路径读取到画布）
      const files = event.dataTransfer?.files;
      if (files?.length > 0) {
        const transferData = event.dataTransfer.getData('application/reactflow');
        if (transferData?.trim()) return; // 若是从侧栏拖出的节点，走下方逻辑

        const file = files[0] as File & { path?: string };
        const fileInfo = getFileNodeTypeAndData(file);
        if (!fileInfo) return;

        let extraData = { ...fileInfo.extraData };
        const api = window.electronAPI;
        const pid = projectId ?? undefined;

        // 图片/视频/音频：必须先保存到项目 assets，再使用项目内路径
        if (fileInfo.type === 'image' || fileInfo.type === 'video' || fileInfo.type === 'audio') {
          let savedPath: string | null = null;
          if (file.path && api?.copyFileToProjectAssets) {
            try {
              const res = await api.copyFileToProjectAssets(pid, file.path);
              savedPath = res.savedPath;
            } catch (e) {
              console.warn('[onDrop] 复制到项目 assets 失败，不使用原路径', e);
            }
          } else if (api?.saveDroppedFileBufferToProjectAssets) {
            try {
              const buffer = await file.arrayBuffer();
              const res = await api.saveDroppedFileBufferToProjectAssets(pid, file.name || 'file', buffer);
              savedPath = res.savedPath;
            } catch (e) {
              console.warn('[onDrop] 写入项目 assets 失败', e);
            }
          }
          if (savedPath) {
            const localResourceUrl = `local-resource://${savedPath}`;
            if (fileInfo.type === 'image') extraData = { ...extraData, outputImage: localResourceUrl };
            else if (fileInfo.type === 'video') extraData = { ...extraData, outputVideo: localResourceUrl };
            else extraData = { ...extraData, outputAudio: localResourceUrl };
          } else {
            if (fileInfo.type === 'image') extraData = { ...extraData, outputImage: '' };
            else if (fileInfo.type === 'video') extraData = { ...extraData, outputVideo: '' };
            else extraData = { ...extraData, outputAudio: '' };
          }
        }

        const nodeId = `${fileInfo.type}-${Date.now()}`;
        const newNode: Node = {
          id: nodeId,
          type: fileInfo.nodeType as any,
          position,
          data: {
            label: fileInfo.type,
            ...extraData,
          },
        };

        setNodes((nds) => nds.concat(newNode));

        // 文本文件：先保存到项目，再读取内容到节点
        if (fileInfo.type === 'text') {
          const setTextToNode = (text: string) => {
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, text } } : n
              )
            );
          };
          if (file.path && api?.copyFileToProjectAssets) {
            try {
              const { savedPath } = await api.copyFileToProjectAssets(pid, file.path);
              const url = `local-resource://${savedPath}`;
              const res = await fetch(url);
              if (res.ok) {
                const text = await res.text();
                setTextToNode(text);
              } else {
                file.text().then(setTextToNode).catch(() => {});
              }
            } catch {
              file.text().then(setTextToNode).catch(() => {});
            }
          } else {
            file.text()
              .then(async (text) => {
                if (api?.saveDroppedFileBufferToProjectAssets) {
                  try {
                    await api.saveDroppedFileBufferToProjectAssets(pid, file.name || 'dropped.txt', new TextEncoder().encode(text).buffer);
                  } catch (_) {}
                }
                setTextToNode(text);
              })
              .catch(() => {});
          }
        }
        return;
      }

      // 从左侧边栏拖拽的节点数据
      const transferData = event.dataTransfer.getData('application/reactflow');
      if (!transferData || transferData.trim() === '') return;

      let data: { type?: string; label?: string };
      try {
        data = JSON.parse(transferData);
      } catch (error) {
        console.error('解析拖放数据失败:', error);
        return;
      }
      if (!data?.type) return;

      const nodeType: string =
        data.type === 'text' ? 'minimalistText'
          : data.type === 'llm' ? 'llm'
          : data.type === 'image' ? 'image'
          : data.type === 'video' ? 'video'
          : data.type === 'character' ? 'character'
          : data.type === 'audio' ? 'audio'
          : data.type === 'cameraControl' ? 'cameraControl'
          : 'custom';

      const newNode: Node = {
        id: `${data.type}-${Date.now()}`,
        type: nodeType,
        position,
        data: {
          label: data.label,
          width: data.type === 'text' ? 369.46 : data.type === 'llm' ? 280 : data.type === 'image' ? 369.46 : data.type === 'video' ? 738.91 : data.type === 'character' ? 200 : data.type === 'audio' ? 280 : data.type === 'cameraControl' ? 340 : undefined,
          height: data.type === 'text' ? 211.12 : data.type === 'llm' ? 160 : data.type === 'image' ? 211.12 : data.type === 'video' ? 422.22 : data.type === 'character' ? 200 : data.type === 'audio' ? 160 : data.type === 'cameraControl' ? 355 : undefined,
          prompt: data.type === 'llm' || data.type === 'image' || data.type === 'video' ? '' : undefined,
          title: data.type === 'llm' ? 'llm' : data.type === 'image' ? 'image' : data.type === 'video' ? 'video' : data.type === 'character' ? 'character' : data.type === 'audio' ? 'audio' : data.type === 'cameraControl' ? '3D视角控制器' : undefined,
          resolution: data.type === 'image' ? '1024x1024' : undefined,
          aspectRatio: data.type === 'image' ? '1:1' : data.type === 'video' ? '16:9' : undefined,
          seedreamWidth: data.type === 'image' ? 2048 : undefined,
          seedreamHeight: data.type === 'image' ? 2048 : undefined,
          model: data.type === 'image' ? 'nano-banana' : data.type === 'video' ? 'sora-2' : data.type === 'audio' ? 'speech-2.8-hd' : undefined,
          hd: data.type === 'video' ? false : undefined,
          duration: data.type === 'video' ? '10' : undefined,
          videoUrl: data.type === 'character' ? '' : undefined,
          nickname: data.type === 'character' ? '' : undefined,
          timestamp: data.type === 'character' ? '1,3' : undefined,
          text: data.type === 'audio' ? '' : undefined,
          voiceId: data.type === 'audio' ? 'Wise_Woman' : undefined,
          speed: data.type === 'audio' ? 1 : undefined,
          volume: data.type === 'audio' ? 1 : undefined,
          pitch: data.type === 'audio' ? 0 : undefined,
          referenceAudioUrl: data.type === 'audio' ? '' : undefined,
          aiStatus: data.type === 'audio' ? 'idle' : undefined,
          rotationX: data.type === 'cameraControl' ? 15 : undefined,
          rotationY: data.type === 'cameraControl' ? 35 : undefined,
          scale: data.type === 'cameraControl' ? 3.2 : undefined,
          fov: data.type === 'cameraControl' ? 45 : undefined,
          cameraControl: data.type === 'cameraControl' ? { rotationX: 15, rotationY: 35, scale: 3.2, fov: 45 } : undefined,
          inputImage: data.type === 'cameraControl' ? '' : undefined,
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes, getFileNodeTypeAndData, projectId]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    // 从系统拖入文件时使用 copy，从侧栏拖节点时使用 move
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'move';
  }, []);

  // 防抖引用：记录上次查询时间，防止频繁点击
  const lastQueryTimeRef = useRef<{ bltcy: number; rh: number }>({ bltcy: 0, rh: 0 });
  const minQueryInterval = 2000; // 最小查询间隔：2秒

  // 验证 API 状态（仅在用户手动点击时触发，使用 force=true 绕过限流）
  const checkApiStatus = useCallback(async (type: 'bltcy' | 'rh') => {
    if (!window.electronAPI || isCheckingApi) return;

    // 防抖检查：如果距离上次查询时间太短，忽略本次请求
    const now = Date.now();
    const lastQueryTime = lastQueryTimeRef.current[type];
    if (now - lastQueryTime < minQueryInterval) {
      console.log(`[防抖] ${type.toUpperCase()} 查询过于频繁，忽略本次请求`);
      return;
    }

    setIsCheckingApi(true);
    lastQueryTimeRef.current[type] = now; // 更新最后查询时间

    try {
      // 用户手动点击时，使用 force=true 绕过限流（这是用户主动操作）
      const balance = type === 'bltcy' 
        ? await window.electronAPI.queryBLTCYBalance(true)
        : await window.electronAPI.queryRHBalance(true);
      
      if (balance !== null) {
        if (type === 'bltcy') {
          setBltcyStatus('success');
          setBltcyBalance(balance);
        } else {
          setRhStatus('success');
          setRhBalance(balance);
        }
      } else {
        if (type === 'bltcy') {
          setBltcyStatus('error');
          setBltcyBalance(null);
        } else {
          setRhStatus('error');
          setRhBalance(null);
        }
      }
    } catch (error) {
      console.error(`验证 ${type} API 失败:`, error);
      if (type === 'bltcy') {
        setBltcyStatus('error');
        setBltcyBalance(null);
      } else {
        setRhStatus('error');
        setRhBalance(null);
      }
    } finally {
      setIsCheckingApi(false);
    }
  }, [isCheckingApi]);

  // 验证所有 API 状态（顺序执行，确保每次只查询一次）
  const checkAllApiStatus = useCallback(async () => {
    // 如果正在查询，跳过本次请求（避免重复查询）
    if (isCheckingApi) {
      console.log('[防重复] 已有查询正在进行，跳过本次请求');
      return;
    }
    // 顺序执行，确保每次只查询一次，不会同时触发多个请求
    await checkApiStatus('bltcy');
    // 等待一小段时间，避免连续查询
    await new Promise(resolve => setTimeout(resolve, 500));
    await checkApiStatus('rh');
  }, [checkApiStatus, isCheckingApi]);

  // 更新 ref，确保 useEffect 中始终使用最新版本
  useEffect(() => {
    checkAllApiStatusRef.current = checkAllApiStatus;
  }, [checkAllApiStatus]);

  // 方式1：点击 API 状态指示灯时验证（手动点击刷新）
  const handleApiStatusClick = useCallback((type: 'bltcy' | 'rh') => {
    checkApiStatus(type);
  }, [checkApiStatus]);

  // 方式3：每5分钟自动刷新一次余额（只初始化一次）
  useEffect(() => {
    if (!window.electronAPI || hasInitializedRef.current) return;
    
    // 标记已初始化，防止重复执行
    hasInitializedRef.current = true;

    // 初始化时延迟查询一次（避免与 AI 调用时的查询冲突）
    const initTimer = setTimeout(() => {
      if (checkAllApiStatusRef.current) {
        checkAllApiStatusRef.current();
      }
    }, 2000); // 延迟2秒，确保应用完全加载

    // 设置定时器，每5分钟自动刷新
    autoRefreshIntervalRef.current = setInterval(() => {
      console.log('[自动刷新] 5分钟定时刷新余额');
      if (checkAllApiStatusRef.current) {
        checkAllApiStatusRef.current();
      }
    }, 5 * 60 * 1000); // 5分钟 = 300000毫秒

    // 清理定时器
    return () => {
      clearTimeout(initTimer);
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
        autoRefreshIntervalRef.current = null;
      }
      hasInitializedRef.current = false; // 允许重新初始化（如果需要）
    };
  }, []); // 空依赖数组，确保只执行一次

  // 方式2：监听 AI 状态更新，在调用模型时触发余额刷新（通过 ref 只注册一次监听，避免依赖变化导致多监听器泄漏）
  useEffect(() => {
    handleAIStatusUpdateRef.current = (packet: { nodeId: string; status: string; payload?: any }) => {
      if (!packet || !packet.nodeId) return;
      // 当 AI 调用开始时（START 状态），触发余额查询
      // 注意：实际的余额刷新在主进程的 AICore 中完成，这里只是作为备用
      if (packet.status === 'START') {
        console.log('[AI调用触发] 检测到 AI 调用，余额刷新由主进程处理');
        // 主进程的 AICore 已经处理了余额刷新，这里不需要重复操作
        
        // 初始化 Text 节点的进度条（如果存在）
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === packet.nodeId);
          if (targetNode && targetNode.type === 'minimalistText') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      progress: 1,
                      progressMessage: packet.payload?.text || '正在初始化模型...',
                      errorMessage: undefined,
                    },
                  }
                : node
            );
          }
          // 初始化 Audio 节点的状态
          if (targetNode && targetNode.type === 'audio') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      aiStatus: 'START',
                      errorMessage: undefined,
                    },
                  }
                : node
            );
          }
          return nds;
        });
      }
      
      // 处理 Text 节点的 PROCESSING 状态（更新进度）
      if (packet.status === 'PROCESSING') {
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === packet.nodeId);
          if (targetNode && targetNode.type === 'minimalistText') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      progress: Math.max(1, packet.payload?.progress || 1),
                      progressMessage: packet.payload?.text || node.data?.progressMessage,
                    },
                  }
                : node
            );
          }
          // 更新 Audio 节点的状态为 PROCESSING
          if (targetNode && targetNode.type === 'audio') {
            return nds.map((node) =>
              node.id === packet.nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      aiStatus: 'PROCESSING',
                    },
                  }
                : node
            );
          }
          return nds;
        });
      }
      
      // 处理视频节点的 ERROR 状态（API 返回失败时，停止进度条并显示错误信息）
      if (packet.status === 'ERROR' && packet.payload?.error) {
        const nodeId = packet.nodeId;
        const errorMessage = packet.payload.error;
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'video') {
            return nds; // 不是视频节点，不处理
          }
          
          console.log(`[Workspace] 视频节点 ${nodeId} 生成失败，停止进度条并显示错误:`, errorMessage);
          
          // 更新节点数据：停止进度条并设置错误信息
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    progress: 0, // 停止进度条
                    progressMessage: undefined,
                    errorMessage: errorMessage, // 显示错误信息
                  },
                }
              : node
          );
          
          // 触发 handleVideoNodeDataChange 以同步状态（使用 ref 避免闭包问题）
          setTimeout(() => {
            if (handleVideoNodeDataChangeRef.current) {
              handleVideoNodeDataChangeRef.current(nodeId, { 
                progress: 0, 
                progressMessage: undefined,
                errorMessage: errorMessage 
              });
            }
          }, 0);
          
          return updatedNodes;
        });
      }
      
      // 处理音频节点的 ERROR 状态（API 返回失败时，显示错误信息）
      if (packet.status === 'ERROR' && packet.payload?.error) {
        const nodeId = packet.nodeId;
        const errorMessage = packet.payload.error;
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'audio') {
            return nds; // 不是音频节点，不处理
          }
          
          console.log(`[Workspace] 音频节点 ${nodeId} 生成失败，停止动画并显示错误:`, errorMessage);
          
          // 更新节点数据：停止动画并设置错误信息
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    aiStatus: 'ERROR', // 更新状态为错误，停止加载动画
                    errorMessage: errorMessage, // 显示错误信息
                  },
                }
              : node
          );
          
          // 触发 handleAudioNodeDataChange 以同步状态（使用 ref 避免闭包问题）
          setTimeout(() => {
            if (handleAudioNodeDataChangeRef.current) {
              handleAudioNodeDataChangeRef.current(nodeId, { 
                aiStatus: 'ERROR',
                errorMessage: errorMessage 
              });
            }
          }, 0);
          
          return updatedNodes;
        });
      }
      
      // 处理图片节点的 ERROR 状态（API 返回失败时，停止进度条并显示错误信息）
      if (packet.status === 'ERROR' && packet.payload?.error) {
        const nodeId = packet.nodeId;
        const errorMessage = packet.payload.error;
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'image') {
            return nds; // 不是图片节点，不处理
          }
          
          console.log(`[Workspace] 图片节点 ${nodeId} 生成失败，停止进度条并显示错误:`, errorMessage);
          
          // 更新节点数据：停止进度条并设置错误信息
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    progress: 0, // 停止进度条，中断加载动画
                    progressMessage: undefined,
                    errorMessage: errorMessage, // 显示错误信息
                  },
                }
              : node
          );
          
          // 触发 handleImageNodeDataChange 以同步状态（使用 ref 避免闭包问题）
          setTimeout(() => {
            if (handleImageNodeDataChangeRef.current) {
              handleImageNodeDataChangeRef.current(nodeId, { 
                progress: 0, 
                progressMessage: undefined,
                errorMessage: errorMessage 
              });
            }
          }, 0);
          
          return updatedNodes;
        });
      }
      
      // 处理 LLM 节点的 ERROR 状态（API 返回失败时，停止处理状态并显示错误信息）
      if (packet.status === 'ERROR' && packet.payload?.error) {
        const nodeId = packet.nodeId;
        const errorMessage = packet.payload.error;
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'llm') {
            return nds; // 不是 LLM 节点，不处理
          }
          
          console.log(`[Workspace] LLM 节点 ${nodeId} 生成失败，停止处理状态并显示错误:`, errorMessage);
          
          // 更新节点数据：设置错误信息（LLM 节点通过 useAI hook 管理状态，这里只设置错误信息）
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    errorMessage: errorMessage, // 显示错误信息
                  },
                }
              : node
          );
          
          return updatedNodes;
        });
      }
      
      // 处理视频节点的 SUCCESS 状态（批量运行时，未选中的节点没有 VideoInputPanel，需要在这里更新）
      if (packet.status === 'SUCCESS' && (packet.payload?.videoUrl || packet.payload?.url || packet.payload?.data?.results?.[0]?.url)) {
        const nodeId = packet.nodeId;
        const videoUrl = packet.payload.videoUrl || packet.payload.url || packet.payload?.data?.results?.[0]?.url;
        const localPath = packet.payload.localPath;
        const originalVideoUrl = packet.payload.originalVideoUrl;
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'video') {
            return nds; // 不是视频节点，不处理
          }
          
          // 打通双链路：始终执行全局更新，即使子组件也在处理，确保 props 强制更新
          console.log(`[Workspace] 批量运行：视频节点 ${nodeId} 生成成功，执行全局更新（双链路保障）`);
          
          // 格式化视频路径
          let formattedVideoUrl = videoUrl;
          if (localPath) {
            // 如果有本地路径，使用本地路径
            let filePath = localPath.replace(/\\/g, '/');
            // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
            if (filePath.match(/^\/[a-zA-Z]:/)) {
              filePath = filePath.substring(1); // 移除开头的 / 
            }
            formattedVideoUrl = `local-resource://${filePath}`;
          } else {
            // 格式化远程 URL
            if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
              formattedVideoUrl = videoUrl;
            } else if (videoUrl.startsWith('data:')) {
              formattedVideoUrl = videoUrl;
            } else {
              const cleanPath = videoUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
              let filePath = cleanPath.replace(/\\/g, '/');
              // 确保 Windows 路径格式正确
              if (filePath.match(/^\/[a-zA-Z]:/)) {
                filePath = filePath.substring(1); // 移除开头的 /
              }
              formattedVideoUrl = `local-resource://${filePath}`;
            }
          }
          
          // 确定网络 URL：优先使用 originalVideoUrl，如果没有则检查 formattedVideoUrl 是否是网络 URL
          let networkUrl = originalVideoUrl;
          if (!networkUrl && (formattedVideoUrl.startsWith('http://') || formattedVideoUrl.startsWith('https://'))) {
            networkUrl = formattedVideoUrl; // formattedVideoUrl 本身就是网络 URL
          }
          
          // 更新节点数据
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    outputVideo: formattedVideoUrl, // 本地路径（local-resource://）用于显示
                    originalVideoUrl: networkUrl, // 网络 URL 用于传递给 character 节点
                    progress: 0, // 清除进度条
                    progressMessage: undefined,
                    errorMessage: undefined, // 清除错误信息
                  },
                }
              : node
          );
          
          // 触发 handleVideoNodeDataChange 以同步到连接的节点（使用 ref 避免闭包问题）
          // 注意：这里需要在 setNodes 外部调用，避免在 setNodes 回调中调用 setState
          setTimeout(() => {
            if (handleVideoNodeDataChangeRef.current) {
              handleVideoNodeDataChangeRef.current(nodeId, { 
                outputVideo: formattedVideoUrl,
                originalVideoUrl: networkUrl,
                progress: 0,
                progressMessage: undefined,
                errorMessage: undefined
              });
            }
            
            // 添加任务到任务列表
            const currentNode = updatedNodes.find((n) => n.id === nodeId);
            if (currentNode && formattedVideoUrl) {
              // 如果 formattedVideoUrl 是 local-resource://，使用原始远程 URL 作为任务 URL
              const taskUrl = networkUrl || (formattedVideoUrl.startsWith('local-resource://') ? undefined : formattedVideoUrl) || formattedVideoUrl;
              handleAddVideoTask(
                nodeId,
                taskUrl,
                currentNode.data?.prompt || '',
                networkUrl || (formattedVideoUrl.startsWith('local-resource://') ? undefined : formattedVideoUrl)
              );
            }
          }, 0);
          
          return updatedNodes;
        });
      }
      
      // 处理 LLM 和 Text 节点的 SUCCESS 状态（批量运行时，未选中的节点没有 InputPanel，需要在这里更新）
      if (packet.status === 'SUCCESS' && packet.payload?.text && !packet.payload?.imageUrl && !packet.payload?.videoUrl) {
        const nodeId = packet.nodeId;
        const outputText = packet.payload.text;
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          
          // 处理 LLM 节点
          // 打通双链路：始终执行全局更新，即使子组件也在处理，确保 props 强制更新
          if (targetNode && targetNode.type === 'llm') {
            console.log(`[Workspace] 批量运行：LLM 节点 ${nodeId} 生成成功，执行全局更新（双链路保障）`);
            
            // 更新节点数据（清除进度条并更新文本）
            const updatedNodes = nds.map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      outputText: outputText,
                      progress: 0, // 清除进度条
                      progressMessage: undefined,
                      errorMessage: undefined, // 清除错误信息
                    },
                  }
                : node
            );
            
            return updatedNodes;
          }
          
          // 处理 Text 节点（minimalistText）
          // 双重保障：优先使用 text，而不是等待 localPath 读取
          if (targetNode && targetNode.type === 'minimalistText') {
            try {
              console.log(`[Workspace] 批量运行：Text 节点 ${nodeId} 生成成功，更新节点数据，text 长度: ${outputText.length}`);
              
              // 更新节点数据（清除进度条并更新文本）
              // 优先使用 text 字段，避免因为 localPath 读取失败（如乱码路径）而导致内容无法显示
              const updatedNodes = nds.map((node) =>
                node.id === nodeId
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        text: outputText, // 优先使用 text
                        progress: 0, // 清除进度条
                        progressMessage: undefined,
                        errorMessage: undefined, // 清除错误信息
                      },
                    }
                  : node
              );
              
              return updatedNodes;
            } catch (error) {
              // 解决乱码中断：即使处理失败，也不阻塞界面
              console.warn(`[Workspace] 更新 Text 节点 ${nodeId} 时出错（可能是乱码路径导致）:`, error);
              // 返回原节点，不更新
              return nds;
            }
          }
          
          return nds; // 不是 LLM 或 Text 节点，不处理
        });
      }
      
      // 处理图片节点的 SUCCESS 状态（批量运行时，未选中的节点没有 ImageInputPanel，需要在这里更新）
      if (packet.status === 'SUCCESS' && packet.payload?.imageUrl) {
        const nodeId = packet.nodeId;
        const imageUrl = packet.payload.imageUrl;
        const localPath = packet.payload.localPath;
        
        // 使用函数式更新，确保基于最新状态
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'image') {
            return nds; // 不是图片节点，不处理
          }
          
          // 打通双链路：始终执行全局更新，即使子组件也在处理，确保 props 强制更新
          console.log(`[Workspace] 批量运行：图片节点 ${nodeId} 生成成功，执行全局更新（双链路保障）`);
          
          // 格式化图片路径
          let formattedImageUrl = imageUrl;
          if (localPath) {
            // 如果有本地路径，使用本地路径
            let filePath = localPath.replace(/\\/g, '/');
            
            // 修复盘符格式：如果路径是 "c/Users" 格式（缺少冒号），修正为 "C:/Users"
            // 这是关键修复：确保盘符格式正确
            if (filePath.match(/^([a-zA-Z])\//)) {
              filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            }
            
            // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
            if (filePath.match(/^\/[a-zA-Z]:/)) {
              filePath = filePath.substring(1); // 移除开头的 /
            }
            
            // 只对路径中的中文和空格部分进行编码，保留盘符的冒号
            // 分段处理，但不对盘符部分（如 C:）编码
            const pathParts = filePath.split('/');
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
            
            formattedImageUrl = `local-resource://${encodedPath}`;
            console.log('[Workspace] 批量运行：格式化图片路径:', localPath, '->', formattedImageUrl);
          } else {
            // 格式化远程 URL（与 ImageNode 中的 formatImagePath 逻辑一致）
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              formattedImageUrl = imageUrl;
            } else if (imageUrl.startsWith('data:')) {
              formattedImageUrl = imageUrl;
            } else {
              const cleanPath = imageUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
              let filePath = cleanPath.replace(/\\/g, '/');
              // 确保 Windows 路径格式正确
              if (filePath.match(/^\/[a-zA-Z]:/)) {
                filePath = filePath.substring(1); // 移除开头的 /
              }
              formattedImageUrl = `local-resource://${filePath}`;
            }
          }
          
          // 确定原始远程 URL（用于 fallback）
          const originalImageUrl = imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) 
            ? imageUrl 
            : undefined;
          
          // 将中文路径转换为映射路径（如果项目ID存在且路径是 local-resource://）
          // 注意：这里在 setNodes 回调中异步处理映射，避免阻塞更新
          if (projectId && formattedImageUrl.startsWith('local-resource://')) {
            mapProjectPath(formattedImageUrl, projectId).then((mappedUrl) => {
              if (mappedUrl !== formattedImageUrl) {
                console.log('[Workspace] 图片路径已映射:', formattedImageUrl, '->', mappedUrl);
                // 更新节点数据为映射路径
                setNodes((currentNodes) => {
                  return currentNodes.map((node) => {
                    if (node.id === nodeId) {
                      return {
                        ...node,
                        data: {
                          ...node.data,
                          outputImage: mappedUrl,
                        },
                      };
                    }
                    return node;
                  });
                });
              }
            }).catch((error) => {
              console.error('[Workspace] 路径映射失败:', error);
            });
          }
          
          // 更新节点数据（清除进度条并更新图片）
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    outputImage: formattedImageUrl, // 先使用原始路径，映射后会更新
                    localPath: localPath || node.data?.localPath, // 保存本地路径
                    originalImageUrl: originalImageUrl || node.data?.originalImageUrl, // 保存原始远程 URL（用于 fallback）
                    progress: 0, // 清除进度条
                    progressMessage: undefined,
                    errorMessage: undefined, // 清除错误信息
                  },
                }
              : node
          );
          
          // 触发 handleImageNodeDataChange 以同步到连接的节点（使用 ref 避免闭包问题）
          // 注意：这里需要在 setNodes 外部调用，避免在 setNodes 回调中调用 setState
          setTimeout(() => {
            handleImageNodeDataChangeRef.current(nodeId, { 
              outputImage: formattedImageUrl,
              localPath: localPath,
              originalImageUrl: originalImageUrl,
              progress: 0,
              progressMessage: undefined,
              errorMessage: undefined
            });
            
            // 添加任务到任务列表
            const currentNode = updatedNodes.find((n) => n.id === nodeId);
            if (currentNode && formattedImageUrl) {
              handleAddTaskRef.current(
                nodeId,
                formattedImageUrl,
                currentNode.data?.prompt || ''
              );
            }
          }, 0);
          
          return updatedNodes;
        });
      }
      
      // 处理音频节点的 SUCCESS 状态（批量运行时，未选中的节点没有 AudioInputPanel，需要在这里更新）
      if (packet.status === 'SUCCESS' && (packet.payload?.audioUrl || packet.payload?.url) && !packet.payload?.imageUrl && !packet.payload?.videoUrl) {
        const nodeId = packet.nodeId;
        const audioUrl = packet.payload.audioUrl || packet.payload.url;
        const localPath = packet.payload.localPath;
        const originalAudioUrl = packet.payload.originalAudioUrl;
        console.log('[Workspace] 音频 SUCCESS:', { nodeId, hasOriginalAudioUrl: !!originalAudioUrl, audioUrlPrefix: (audioUrl || '').slice(0, 50) });
        
        setNodes((nds) => {
          const targetNode = nds.find((n) => n.id === nodeId);
          if (!targetNode || targetNode.type !== 'audio') {
            return nds;
          }
          
          // 格式化音频路径
          let formattedAudioUrl = audioUrl;
          if (localPath) {
            // 如果有本地路径，使用本地路径
            let filePath = localPath.replace(/\\/g, '/');
            // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
            if (filePath.match(/^\/[a-zA-Z]:/)) {
              filePath = filePath.substring(1); // 移除开头的 /
            }
            formattedAudioUrl = `local-resource://${filePath}`;
          } else {
            // 格式化远程 URL
            if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
              formattedAudioUrl = audioUrl;
            } else if (audioUrl.startsWith('data:')) {
              formattedAudioUrl = audioUrl;
            } else {
              const cleanPath = audioUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
              let filePath = cleanPath.replace(/\\/g, '/');
              // 确保 Windows 路径格式正确
              if (filePath.match(/^\/[a-zA-Z]:/)) {
                filePath = filePath.substring(1); // 移除开头的 /
              }
              formattedAudioUrl = `local-resource://${filePath}`;
            }
          }
          
          // 确定网络 URL：优先使用 originalAudioUrl，如果没有则检查 formattedAudioUrl 是否是网络 URL
          let networkUrl = originalAudioUrl;
          if (!networkUrl && (formattedAudioUrl.startsWith('http://') || formattedAudioUrl.startsWith('https://'))) {
            networkUrl = formattedAudioUrl; // formattedAudioUrl 本身就是网络 URL
          }
          // 有远程 URL 时，节点播放与任务列表一致：直接使用远程 URL 作为 outputAudio，避免 local-resource 在中文路径下无法播放
          const outputAudioForNode = networkUrl || formattedAudioUrl;
          
          // 更新节点数据
          const updatedNodes = nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    outputAudio: outputAudioForNode,
                    originalAudioUrl: networkUrl || undefined,
                    aiStatus: 'SUCCESS', // 更新状态为成功
                    progress: 0, // 清除进度条
                    progressMessage: undefined,
                    errorMessage: undefined, // 清除错误信息
                  },
                }
              : node
          );
          
          // 触发 handleAudioNodeDataChange 以同步到连接的节点（使用 ref 避免闭包问题）
          // 注意：这里需要在 setNodes 外部调用，避免在 setNodes 回调中调用 setState
          setTimeout(() => {
            if (handleAudioNodeDataChangeRef.current) {
              handleAudioNodeDataChangeRef.current(nodeId, { 
                outputAudio: outputAudioForNode,
                originalAudioUrl: networkUrl || undefined,
                aiStatus: 'SUCCESS',
                errorMessage: undefined
              });
            }
            
            // 添加任务到任务列表
            const currentNode = updatedNodes.find((n) => n.id === nodeId);
            if (currentNode && outputAudioForNode) {
              const taskUrl = networkUrl || outputAudioForNode;
              handleAddAudioTask(
                nodeId,
                taskUrl,
                currentNode.data?.text || '',
                networkUrl || undefined
              );
            }
          }, 0);
          
          return updatedNodes;
        });
      }
    };
  }, [setNodes, selectedNode, imageInputPanelData, videoInputPanelData, llmInputPanelData, handleVideoNodeDataChangeRef, handleAudioNodeDataChangeRef, handleAddVideoTask, handleAddAudioTask]);

  // 单例注册 AI 状态监听器，卸载时必定移除，防止监听器数量累积导致内存泄漏
  useEffect(() => {
    if (!window.electronAPI) return () => {};
    const removeAIListener = window.electronAPI.onAIStatusUpdate((packet) => handleAIStatusUpdateRef.current?.(packet));
    return () => {
      if (removeAIListener && typeof removeAIListener === 'function') removeAIListener();
    };
  }, []);

  // 同步 ref，确保回调函数的最新版本被使用
  useEffect(() => {
    handleImageNodeDataChangeRef.current = handleImageNodeDataChange;
    handleVideoNodeDataChangeRef.current = handleVideoNodeDataChange;
    handleAudioNodeDataChangeRef.current = handleAudioNodeDataChange;
    handleAddTaskRef.current = handleAddTask;
    handleCleanupSplitEdgesRef.current = handleCleanupSplitEdges;
    handleAuxImageTaskCompleteRef.current = handleAuxImageTaskComplete;
  }, [handleImageNodeDataChange, handleVideoNodeDataChange, handleAudioNodeDataChange, handleAddTask, handleCleanupSplitEdges, handleAuxImageTaskComplete]);

  // 获取 API 状态图标
  const getApiStatusIcon = (status: ApiStatus) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-3 h-3 text-green-500" />;
      case 'error':
        return <XCircle className="w-3 h-3 text-red-500" />;
      default:
        return <Circle className="w-3 h-3 text-white/40" />;
    }
  };

  // 采集当前画布缩略图（仅负责生成，不负责落盘）
  const captureProjectCardThumbnail = useCallback(async () => {
    if (!projectId || !reactFlowWrapper.current) return;
    if (typeof localStorage === 'undefined') return;
    const target = reactFlowWrapper.current.querySelector('.react-flow') as HTMLElement | null;
    if (!target) return;
    try {
      const captured = await html2canvas(target, {
        backgroundColor: isDarkMode ? '#000000' : '#ffffff',
        useCORS: true,
        allowTaint: true,
        // 降低截图分辨率，避免返回项目列表时卡顿
        scale: Math.min(window.devicePixelRatio || 1, 1),
        logging: false,
      });
      const outW = 640;
      const outH = 360;
      const out = document.createElement('canvas');
      out.width = outW;
      out.height = outH;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      const srcW = captured.width;
      const srcH = captured.height;
      const srcRatio = srcW / srcH;
      const outRatio = outW / outH;
      let sx = 0;
      let sy = 0;
      let sw = srcW;
      let sh = srcH;
      if (srcRatio > outRatio) {
        sw = Math.round(srcH * outRatio);
        sx = Math.round((srcW - sw) / 2);
      } else if (srcRatio < outRatio) {
        sh = Math.round(srcW / outRatio);
        sy = Math.round((srcH - sh) / 2);
      }
      ctx.drawImage(captured, sx, sy, sw, sh, 0, 0, outW, outH);
      const dataUrl = out.toDataURL('image/jpeg', 0.78);
      cardThumbnailCacheRef.current = dataUrl;
      return dataUrl;
    } catch (error) {
      console.error('保存项目卡缩略图失败:', error);
      return null;
    }
  }, [projectId, reactFlowWrapper, isDarkMode]);

  // 将缩略图写入项目卡（优先写缓存，必要时异步补拍）
  const persistProjectCardThumbnail = useCallback(async (forceCapture = false) => {
    if (!projectId || typeof localStorage === 'undefined') return;
    const key = getCardBgKey(projectId);
    if (!forceCapture && cardThumbnailCacheRef.current) {
      localStorage.setItem(key, cardThumbnailCacheRef.current);
      return;
    }
    const captured = await captureProjectCardThumbnail();
    if (captured) {
      localStorage.setItem(key, captured);
    }
  }, [projectId, captureProjectCardThumbnail]);

  useEffect(() => {
    if (cardThumbnailTimerRef.current) {
      clearTimeout(cardThumbnailTimerRef.current);
    }
    cardThumbnailTimerRef.current = setTimeout(() => {
      captureProjectCardThumbnail().catch((error) => {
        console.error('后台预生成项目卡缩略图失败:', error);
      });
    }, 900);
    return () => {
      if (cardThumbnailTimerRef.current) {
        clearTimeout(cardThumbnailTimerRef.current);
        cardThumbnailTimerRef.current = null;
      }
      // 卸载时仅写入缓存，避免再触发一次重截图造成退出卡顿
      if (projectId && typeof localStorage !== 'undefined' && cardThumbnailCacheRef.current) {
        localStorage.setItem(getCardBgKey(projectId), cardThumbnailCacheRef.current);
      }
    };
  }, [nodes, edges, isDarkMode, projectId, captureProjectCardThumbnail]);

  return (
    <div className={`fixed inset-0 w-full h-full ${isDarkMode ? 'bg-black dark-mode' : 'bg-white light-mode'} flex flex-col overflow-hidden`} style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* 顶部工具栏 */}
      <div className="h-14 apple-panel border-b flex items-center justify-between px-4 flex-shrink-0">
        {/* 左侧：返回按钮和打开项目文件夹按钮 */}
        <div className="flex items-center gap-4">
          <button
            onClick={async () => {
              await saveProjectNow();
              // 立即跳转，缩略图异步落盘，避免等待截图导致卡顿
              void persistProjectCardThumbnail(true);
              navigate('/projects');
            }}
            className="flex items-center gap-2 px-3 py-1.5 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回项目列表</span>
          </button>
          {projectId && (
            <button
              onClick={async () => {
                if (!window.electronAPI || !projectId) return;
                try {
                  const projectDir = await window.electronAPI.getProjectMappedPath(projectId);
                  if (projectDir) {
                    await window.electronAPI.openPath(projectDir);
                  } else {
                    console.warn('项目未找到，无法打开文件夹:', projectId);
                  }
                } catch (error) {
                  console.error('打开项目文件夹失败:', error);
                }
              }}
              className="flex items-center gap-2 px-3 py-1.5 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all text-sm"
              title="打开项目文件夹"
            >
              <FolderOpen className="w-4 h-4" />
              <span>打开项目文件夹</span>
            </button>
          )}
        </div>

        {/* 右侧：API 状态指示灯 */}
        <div className="flex items-center gap-6">
          {/* 明暗模式切换开关 */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="flex items-center gap-2 px-3 py-1.5 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all text-sm"
            title={isDarkMode ? '切换到光明模式' : '切换到暗黑模式'}
          >
            {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          {/* 窗口全屏切换（F11 快捷键也可切换） */}
          <button
            onClick={() => window.electronAPI?.toggleFullscreen?.().catch((err: unknown) => console.error('切换全屏失败:', err))}
            className="flex items-center gap-2 px-3 py-1.5 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all text-sm"
            title="窗口全屏切换（F11 快捷键可快捷切换）"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleApiStatusClick('bltcy')}
            className="flex items-center gap-2 px-3 py-1.5 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all text-sm"
            disabled={isCheckingApi}
          >
            <span>核心算力</span>
            {getApiStatusIcon(bltcyStatus)}
            {bltcyBalance !== null && (
              <span className="text-white/60 text-xs ml-1">
                {bltcyBalance} 点
              </span>
            )}
          </button>
          <button
            onClick={() => handleApiStatusClick('rh')}
            className="flex items-center gap-2 px-3 py-1.5 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all text-sm"
            disabled={isCheckingApi}
          >
            <span>插件算力</span>
            {getApiStatusIcon(rhStatus)}
            {rhBalance !== null && (
              <span className="text-white/60 text-xs ml-1">
                {rhBalance} 币
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 主内容区域（画布） */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 左侧角色列表 - 使用绝对定位覆盖在画布上 */}
        <div 
          className="absolute left-0 top-0 bottom-0 z-20 transition-all duration-300 ease-in-out"
          style={{
            width: characterListCollapsed ? '48px' : '280px',
          }}
        >
          <CharacterList
            isDarkMode={isDarkMode}
            isCollapsed={characterListCollapsed}
            onToggleCollapse={() => setCharacterListCollapsed(!characterListCollapsed)}
            refreshTrigger={characterListRefreshTrigger}
            onSelectCharacter={(character) => {
              // 点击角色卡片时，将 roleId 填充到当前选中的 Sora-2 节点的 prompt 中
              if (selectedNode && selectedNode.type === 'video' && character.roleId) {
                const roleIdText = `@${character.roleId}`;
                const currentPrompt = selectedNode.data?.prompt || '';
                
                // 检查 prompt 中是否已经包含该 roleId
                if (!currentPrompt.includes(roleIdText)) {
                  // 如果 prompt 为空，直接设置 roleId；否则追加到 prompt 末尾
                  const newPrompt = currentPrompt.trim() 
                    ? `${currentPrompt} ${roleIdText}`
                    : roleIdText;
                  
                  // 更新节点数据
                  setNodes((nds) =>
                    nds.map((node) =>
                      node.id === selectedNode.id
                        ? { ...node, data: { ...node.data, prompt: newPrompt } }
                        : node
                    )
                  );
                  
                  // 如果当前节点正在显示输入面板，也更新面板数据
                  if (videoInputPanelData && videoInputPanelData.nodeId === selectedNode.id) {
                    setVideoInputPanelData((prev) => {
                      if (prev) {
                        return { ...prev, prompt: newPrompt };
                      }
                      return prev;
                    });
                  }
                  
                  console.log(`[Workspace] 已将角色 ID ${roleIdText} 填充到视频节点 ${selectedNode.id} 的 prompt 中`);
                } else {
                  console.log(`[Workspace] prompt 中已包含角色 ID ${roleIdText}，跳过填充`);
                }
              } else if (!selectedNode) {
                console.log('[Workspace] 未选中任何节点，无法填充角色 ID');
              } else if (selectedNode.type !== 'video') {
                console.log('[Workspace] 当前选中的节点不是视频节点，无法填充角色 ID');
              } else if (!character.roleId) {
                console.log('[Workspace] 角色没有 roleId，无法填充');
              }
            }}
          />
        </div>
        
        {/* 中间画布区域 - 覆盖整个区域，左侧边栏覆盖在上面 */}
        <div 
          className="flex-1 relative transition-all duration-300 ease-in-out"
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <ReactFlowProvider>
            <FlowContent
              nodes={nodes}
              edges={edges.map((edge) => ({
                ...edge,
                selected: selectedEdge?.id === edge.id, // 设置边的选中状态
              }))}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodesDelete={onNodesDelete}
              onConnect={onConnect}
              onNodeClick={onNodeClickStable}
              onSelectionChange={onSelectionChange}
              onNodeDragStart={onNodeDragStart}
              onPaneClick={onPaneClick}
              onEdgeClick={onEdgeClick}
              onDrop={onDrop}
              onDragOver={onDragOver}
              nodeTypes={nodeTypes}
              contextMenu={contextMenu}
              setContextMenu={setContextMenu}
              handleMenuSelect={handleMenuSelect}
              reactFlowWrapper={reactFlowWrapper}
              isDarkMode={isDarkMode}
              characterListCollapsed={characterListCollapsed}
              selectedNode={selectedNode}
              onBatchRun={handleBatchRun}
              batchRunInProgress={batchRunInProgress}
              setNodes={setNodes}
              setEdges={setEdges}
              flowContentApiRef={flowContentApiRef}
              onPerformanceModeChange={setIsPerformanceMode}
            />
          </ReactFlowProvider>
        </div>

        {/* 任务预览全屏查看（支持图片和视频） */}
        {previewImage && (
          <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
            <button
              onClick={() => {
                setPreviewImage(null);
                setSelectedNode(null); // 取消选择任何节点，避免显示操作面板
                setImageInputPanelData(null);
                setLlmInputPanelData(null);
                setVideoInputPanelData(null);
              }}
              className="absolute top-6 right-8 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
            >
              <ChevronLeft className="w-3 h-3" />
              返回
            </button>
            {previewImage.match(/\.(mp4|webm|ogg|mov)$/i) || previewImage.includes('video') ? (
              <VideoPreview
                src={previewImage}
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                preload="auto"
                playsInline
              />
            ) : (
              <img
                src={previewImage}
                alt="预览"
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
              />
            )}
          </div>
        )}

        {/* 音频预览弹窗 */}
        {previewAudio && (
          <div className={`fixed inset-0 z-50 ${isDarkMode ? 'bg-black/90' : 'bg-gray-900/90'} flex items-center justify-center`}>
            <button
              onClick={() => {
                setPreviewAudio(null);
                setSelectedNode(null);
                setImageInputPanelData(null);
                setLlmInputPanelData(null);
                setVideoInputPanelData(null);
                setAudioInputPanelData(null);
              }}
              className="absolute top-6 right-8 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
            >
              <ChevronLeft className="w-3 h-3" />
              返回
            </button>
            <div className="w-full max-w-2xl px-8">
              <audio
                key={previewAudio}
                src={previewAudio}
                controls
                className={`w-full ${isDarkMode ? 'audio-dark' : ''}`}
                preload="none"
                onCanPlay={(e) => {
                  const audio = e.currentTarget;
                  if (audio.currentTime > 0) {
                    audio.currentTime = 0;
                  }
                }}
                onLoadedMetadata={(e) => {
                  const audio = e.currentTarget;
                  audio.currentTime = 0;
                }}
                onPlay={(e) => {
                  const audio = e.currentTarget;
                  if (audio.currentTime > 0.1) {
                    audio.currentTime = 0;
                  }
                }}
                onError={(e) => {
                  const audio = e.currentTarget;
                  console.error('[音频预览] 加载失败:', {
                    src: audio.currentSrc || previewAudio,
                    error: audio.error?.code,
                    message: audio.error?.message,
                  });
                }}
              />
            </div>
          </div>
        )}

        {/* 右侧任务列表（始终可见，便于查看任务运行情况） */}
        <div
            className={`absolute right-0 top-0 bottom-0 border-l flex flex-col transition-all duration-300 ease-in-out z-10 ${
              isDarkMode ? 'apple-panel' : 'apple-panel-light'
            } ${
              rightSidebarOpen ? 'w-[260px] translate-x-0' : 'w-0 translate-x-full'
            }`}
          >
            <div className={`p-4 border-b flex items-center justify-between flex-shrink-0 ${
              isDarkMode ? 'border-white/10' : 'border-gray-300/30'
            }`}>
              <h3 className={`text-sm font-bold ${
                isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>任务列表</h3>
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              {!rightSidebarOpen ? (
                /* 收起时不渲染任务卡片（VideoPreview/MusicPlayer/TaskImageDisplay 等重型组件），减轻画布卡顿 */
                <div className={`text-sm ${
                  isDarkMode ? 'text-white/40' : 'text-gray-500'
                }`}>
                  {tasks.length > 0 ? `共 ${tasks.length} 个任务` : '暂无任务'}
                </div>
              ) : tasks.length === 0 ? (
                <div className={`text-sm ${
                  isDarkMode ? 'text-white/60' : 'text-gray-600'
                }`}>暂无任务</div>
              ) : (
                <div className="space-y-3">
                  {dedupedSortedTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`rounded-lg border p-3 ${
                        isDarkMode
                          ? 'bg-white/5 border-white/10 hover:bg-white/10'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      } transition-colors`}
                    >
                      {/* 缩略图/视频/音频预览（生成过程中只显示占位，完成后才显示真实内容） */}
                      <div className="relative mb-2 rounded overflow-hidden bg-gray-200">
                        {task.status === 'success' && (task.imageUrl || task.videoUrl || task.audioUrl) ? (
                          <>
                            {task.taskType === 'video' && task.videoUrl ? (
                              <>
                                <VideoPreview
                                  src={task.videoUrl}
                                  className="w-full h-32 object-cover cursor-pointer"
                                  muted
                                  preload="metadata"
                                  playsInline
                                  onClick={() => {
                                    setPreviewImage(task.videoUrl!);
                                    setSelectedNode(null);
                                    setImageInputPanelData(null);
                                    setLlmInputPanelData(null);
                                    setVideoInputPanelData(null);
                                  }}
                                />
                                {/* 视频预览按钮 */}
                                <button
                                  onClick={() => {
                                    setPreviewImage(task.videoUrl!);
                                    setSelectedNode(null);
                                    setImageInputPanelData(null);
                                    setLlmInputPanelData(null);
                                    setVideoInputPanelData(null);
                                  }}
                                  className={`absolute top-2 right-2 p-1.5 rounded-lg ${
                                    isDarkMode
                                      ? 'bg-black/50 hover:bg-black/70 text-white'
                                      : 'bg-white/80 hover:bg-white text-gray-700'
                                  } transition-colors`}
                                  title="预览"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : task.taskType === 'audio' && task.audioUrl ? (
                              // 音频任务：显示音乐播放器
                              <div className="relative w-full">
                                <MusicPlayer
                                  audioUrl={task.audioUrl}
                                  isDarkMode={isDarkMode}
                                  onPreview={() => {
                                    const audioUrl = task.audioUrl!;
                                    // 标准化音频 URL
                                    let normalizedUrl = audioUrl;
                                    if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://') && !audioUrl.startsWith('data:') && !audioUrl.startsWith('local-resource://')) {
                                      const cleanPath = audioUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
                                      normalizedUrl = `local-resource://${cleanPath.replace(/\\/g, '/')}`;
                                    }
                                    setPreviewAudio(normalizedUrl);
                                    setSelectedNode(null);
                                    setImageInputPanelData(null);
                                    setLlmInputPanelData(null);
                                    setVideoInputPanelData(null);
                                    setAudioInputPanelData(null);
                                  }}
                                />
                              </div>
                            ) : task.imageUrl ? (
                              <TaskImageDisplay
                                task={task}
                                projectId={projectId}
                                formatImagePath={formatImagePathSync}
                                mapProjectPath={mapProjectPath}
                                onPreview={(imageUrl) => {
                                  setPreviewImage(imageUrl);
                                  setSelectedNode(null);
                                  setImageInputPanelData(null);
                                  setLlmInputPanelData(null);
                                  setVideoInputPanelData(null);
                                  setAudioInputPanelData(null);
                                }}
                                isDarkMode={isDarkMode}
                              />
                            ) : null}
                          </>
                        ) : (
                          <div
                            className={`w-full h-32 flex items-center justify-center text-xs ${
                              isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
                            }`}
                          >
                            生成中...
                          </div>
                        )}
                      </div>
                      
                      {/* 任务信息 */}
                      <div className="space-y-1.5">
                        <div className={`text-xs font-semibold ${
                          isDarkMode ? 'text-white/90' : 'text-gray-900'
                        }`}>
                          {task.nodeTitle}
                        </div>
                        <div className={`text-xs line-clamp-2 ${
                          isDarkMode ? 'text-white/60' : 'text-gray-600'
                        }`}>
                          {task.status === 'error'
                            ? task.errorMessage || '生成失败，请检查提示词或稍后重试'
                            : task.prompt || '无提示词'}
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className={isDarkMode ? 'text-white/50' : 'text-gray-500'}>
                            {new Date(task.createdAt).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span
                            className={
                              task.status === 'success'
                                ? isDarkMode
                                  ? 'text-emerald-300/80'
                                  : 'text-emerald-600'
                                : isDarkMode
                                  ? 'text-red-300/80'
                                  : 'text-red-600'
                            }
                          >
                            {task.status === 'success' ? '已完成' : '生成失败'}
                          </span>
                        </div>
                      </div>
                      
                      {/* 操作按钮（仅在任务完成后显示，音频任务不显示下载按钮） */}
                      {task.status === 'success' && task.taskType !== 'audio' && (
                        <div className="flex gap-2 mt-2">
                          {task.localFilePath ? (
                            <button
                              onClick={() => handleOpenImage(task.localFilePath!)}
                              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                                isDarkMode
                                  ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-200'
                                  : 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                              }`}
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              打开文件夹
                            </button>
                          ) : (
                            <button
                              onClick={async () => {
                                if (task.taskType === 'video' && task.videoUrl && window.electronAPI) {
                                  // 视频下载或打开
                                  if (task.videoUrl.startsWith('local-resource://') || task.videoUrl.startsWith('file://')) {
                                    // 本地文件，直接打开
                                    const localPath = task.videoUrl.startsWith('local-resource://')
                                      ? task.videoUrl.replace('local-resource://', '')
                                      : task.videoUrl.replace(/^file:\/\/\/?/, '').replace(/\//g, '\\');
                                    await window.electronAPI.openFile(localPath);
                                  } else {
                                    // 远程 URL，下载
                                    try {
                                      const result = await window.electronAPI.downloadVideo(task.videoUrl, task.nodeTitle);
                                      if (result.success && result.filePath) {
                                        // 更新任务的本地文件路径
                                        setTasks((prevTasks) =>
                                          prevTasks.map((t) =>
                                            t.id === task.id ? { ...t, localFilePath: result.filePath } : t
                                          )
                                        );
                                        
                                        // 更新 VideoNode：显示下载的视频并停止进度条，同时保存原始远程 URL
                                        const localResourceUrl = `local-resource://${result.filePath.replace(/\\/g, '/')}`;
                                        setNodes((nds) =>
                                          nds.map((node) =>
                                            node.id === task.nodeId
                                              ? { 
                                                  ...node, 
                                                  data: { 
                                                    ...node.data, 
                                                    outputVideo: localResourceUrl, 
                                                    originalVideoUrl: task.videoUrl, // 保存原始远程 URL
                                                    progress: 0, 
                                                    errorMessage: undefined 
                                                  } 
                                                }
                                              : node
                                          )
                                        );
                                        handleVideoNodeDataChange(task.nodeId, { 
                                          outputVideo: localResourceUrl, 
                                          originalVideoUrl: task.videoUrl, // 保存原始远程 URL
                                          progress: 0, 
                                          errorMessage: undefined 
                                        });
                                      }
                                    } catch (error) {
                                      console.error('下载视频失败:', error);
                                    }
                                  }
                                } else if (task.imageUrl) {
                                  handleDownloadImage(task.id, task.imageUrl, task.nodeTitle);
                                }
                              }}
                              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                                isDarkMode
                                  ? 'bg-white/10 hover:bg-white/20 text-white'
                                  : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                              }`}
                            >
                              <Download className="w-3.5 h-3.5" />
                              下载
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                              isDarkMode
                                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-200'
                                : 'bg-red-100 hover:bg-red-200 text-red-700'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            删除
                          </button>
                        </div>
                      )}
                      {/* 音频任务显示打开文件夹和删除按钮 */}
                      {task.status === 'success' && task.taskType === 'audio' && (
                        <div className="flex gap-2 mt-2">
                          {task.localFilePath ? (
                            <button
                              onClick={() => handleOpenImage(task.localFilePath!)}
                              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                                isDarkMode
                                  ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-200'
                                  : 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                              }`}
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              打开文件夹
                            </button>
                          ) : null}
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                              isDarkMode
                                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-200'
                                : 'bg-red-100 hover:bg-red-200 text-red-700'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        
        {/* 右侧收起/展开按钮 */}
          <button
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            className={`absolute right-0 top-1/2 -translate-y-1/2 w-6 h-12 border-l rounded-l-lg flex items-center justify-center transition-all duration-300 ease-in-out z-20 ${
              isDarkMode ? 'apple-panel hover:bg-white/15' : 'apple-panel-light hover:bg-gray-200/30'
            } ${
              rightSidebarOpen ? '-translate-x-[260px]' : 'translate-x-0'
            }`}
          >
            {rightSidebarOpen ? (
              <ChevronRight className={`w-4 h-4 ${isDarkMode ? 'text-white/60' : 'text-gray-700'}`} />
            ) : (
              <ChevronLeft className={`w-4 h-4 ${isDarkMode ? 'text-white/60' : 'text-gray-700'}`} />
            )}
          </button>

        {/* LLM 输入面板弹窗（底部显示，向上滑出动画） */}
        {llmInputPanelData && selectedNode && selectedNode.type === 'llm' && (
          <div className="absolute left-1/2 -translate-x-1/2 z-50 animate-slide-up" style={{ width: '840px', height: '242px', bottom: '21.25px', pointerEvents: 'auto' }}>
            <LLMInputPanel
              nodeId={llmInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              inputText={llmInputPanelData.inputText}
              userInput={llmInputPanelData.userInput}
              isImageReverseMode={llmInputPanelData.isImageReverseMode}
              imageUrlForReverse={llmInputPanelData.imageUrlForReverse}
              reverseCaptionModel={llmInputPanelData.reverseCaptionModel ?? 'gpt-4o'}
              onReverseCaptionModelChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === llmInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, reverseCaptionModel: value } }
                      : node
                  )
                );
                setLlmInputPanelData({ ...llmInputPanelData, reverseCaptionModel: value });
              }}
              isInputLocked={llmInputPanelData.isInputLocked}
              savedPrompts={llmInputPanelData.savedPrompts}
              projectId={projectId}
              nodeTitle={selectedNode.data?.title || 'llm'}
              onUserInputChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === llmInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, userInput: value } }
                      : node
                  )
                );
                setLlmInputPanelData({ ...llmInputPanelData, userInput: value });
              }}
              onInputTextChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === llmInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, inputText: value } }
                      : node
                  )
                );
                setLlmInputPanelData({ ...llmInputPanelData, inputText: value });
              }}
              onSavedPromptsChange={async (prompts) => {
                // 更新全局人设列表
                if (window.electronAPI) {
                  try {
                    await window.electronAPI.updateGlobalLLMPersonas(prompts);
                    setGlobalPersonas(prompts);
                  } catch (error) {
                    console.error('保存全局人设失败:', error);
                  }
                }
                setLlmInputPanelData({ ...llmInputPanelData, savedPrompts: prompts });
              }}
              onPersonaChange={(personaName) => {
                // 当选择不同人设时，同步更新 LLM 节点的小标题
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === llmInputPanelData.nodeId
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            title: personaName || 'llm',
                          },
                        }
                      : node
                  )
                );
              }}
              onOutputTextChange={(text) => {
                setNodes((nds) => {
                  const updatedNodes = nds.map((node) =>
                    node.id === llmInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, outputText: text } }
                      : node
                  );
                  
                  // 如果 LLM 节点连接到 Image 节点，同步更新 Image 节点的 prompt
                  const connectedEdges = edges.filter((e) => e.source === llmInputPanelData.nodeId && e.target);
                  connectedEdges.forEach((edge) => {
                    const targetNode = updatedNodes.find((n) => n.id === edge.target);
                    if (targetNode?.type === 'image') {
                      const targetIndex = updatedNodes.findIndex((n) => n.id === edge.target);
                      if (targetIndex !== -1) {
                        updatedNodes[targetIndex] = {
                          ...updatedNodes[targetIndex],
                          data: {
                            ...updatedNodes[targetIndex].data,
                            prompt: text, // 传递 LLM 输出文本到 Image 节点的 prompt
                            // 不设置 inputImages，保持文生图模式
                          },
                        };
                        
                        // 如果目标 Image 节点当前被选中，更新输入面板数据
                        if (selectedNode && selectedNode.id === edge.target) {
                          setImageInputPanelData((prev) => {
                            if (prev && prev.nodeId === edge.target) {
                              return {
                                ...prev,
                                prompt: text,
                                inputImages: [], // 确保是文生图模式
                              };
                            }
                            return prev;
                          });
                        }
                      }
                    }
                  });
                  
                  return updatedNodes;
                });
              }}
            />
          </div>
        )}

        {/* Image 输入面板弹窗（底部显示，向上滑出动画） */}
        {imageInputPanelData && selectedNode && selectedNode.type === 'image' && (
          <div className="absolute left-1/2 -translate-x-1/2 z-50 animate-slide-up" style={{ width: '840px', height: '242px', bottom: '21.25px', pointerEvents: 'auto' }}>
            <ImageInputPanel
              nodeId={imageInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              prompt={imageInputPanelData.prompt}
              resolution={imageInputPanelData.resolution}
              aspectRatio={imageInputPanelData.aspectRatio}
              model={imageInputPanelData.model}
              seedreamWidth={Math.max(1024, Math.min(4096, imageInputPanelData.seedreamWidth ?? 2048))}
              seedreamHeight={Math.max(1024, Math.min(4096, imageInputPanelData.seedreamHeight ?? 2048))}
              isConnected={edges.some((e) => e.target === imageInputPanelData.nodeId && nodes.find((n) => n.id === e.source)?.type === 'image')}
              inputImages={imageInputPanelData.inputImages || []}
              projectId={projectId}
              onSeedreamWidthChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId ? { ...node, data: { ...node.data, seedreamWidth: value } } : node
                  )
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, seedreamWidth: value } : prev));
              }}
              onSeedreamHeightChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId ? { ...node, data: { ...node.data, seedreamHeight: value } } : node
                  )
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, seedreamHeight: value } : prev));
              }}
              onPromptChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, prompt: value } }
                      : node
                  )
                );
                setImageInputPanelData({ ...imageInputPanelData, prompt: value });
              }}
              onResolutionChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolution: value } }
                      : node
                  )
                );
                setImageInputPanelData({ ...imageInputPanelData, resolution: value });
              }}
              onAspectRatioChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, aspectRatio: value } }
                      : node
                  )
                );
                setImageInputPanelData((prev) => (prev ? { ...prev, aspectRatio: value } : prev));
              }}
              onModelChange={(value) => {
                const validG15Aspect = ['auto', '1:1', '3:2', '2:3'];
                const needFixAspect = value === 'rhart-image-g-1.5' && !validG15Aspect.includes(imageInputPanelData.aspectRatio);
                const newAspect = needFixAspect ? '2:3' : imageInputPanelData.aspectRatio;
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === imageInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, model: value, ...(needFixAspect ? { aspectRatio: newAspect } : {}) } }
                      : node
                  )
                );
                setImageInputPanelData({ ...imageInputPanelData, model: value, ...(needFixAspect ? { aspectRatio: newAspect } : {}) });
              }}
              onOutputImageChange={(imageUrl) => {
                // 使用闭包保存 nodeId，确保更新到正确的节点（并发任务时很重要）
                const targetNodeId = imageInputPanelData.nodeId;
                console.log('[Workspace] onOutputImageChange 被调用:', { targetNodeId, imageUrl });
                
                // 格式化图片路径（使用同步版本）
                const formattedImageUrl = formatImagePathSync(imageUrl);
                setNodes((nds) => {
                  const updatedNodes = nds.map((node) =>
                    node.id === targetNodeId
                      ? { ...node, data: { ...node.data, outputImage: formattedImageUrl } }
                      : node
                  );
                  
                  // 验证节点是否被正确更新
                  const updatedNode = updatedNodes.find(n => n.id === targetNodeId);
                  console.log('[Workspace] 图片节点更新结果:', { 
                    targetNodeId, 
                    found: !!updatedNode, 
                    hasOutputImage: !!updatedNode?.data?.outputImage 
                  });
                  
                  // 触发 handleImageNodeDataChange 以同步到连接的节点
                  handleImageNodeDataChange(targetNodeId, { outputImage: formattedImageUrl });
                  
                  // 添加任务到任务列表
                  const currentNode = updatedNodes.find((n) => n.id === targetNodeId);
                  if (currentNode && formattedImageUrl) {
                    handleAddTask(
                      targetNodeId,
                      formattedImageUrl,
                      imageInputPanelData.prompt || currentNode.data?.prompt || ''
                    );
                  }
                  
                  return updatedNodes;
                });
              }}
              onProgressChange={(progress) => {
                const targetNodeId = imageInputPanelData.nodeId;
                handleImageNodeDataChange(targetNodeId, { progress });
              }}
              onProgressMessageChange={(message) => {
                const targetNodeId = imageInputPanelData.nodeId;
                handleImageNodeDataChange(targetNodeId, { progressMessage: message });
              }}
              onErrorTask={(message) => {
                // 创建失败任务记录（不更新图片，只记录错误信息）
                const node = nodes.find((n) => n.id === imageInputPanelData.nodeId);
                const nodeTitle = node?.data?.title || 'image';
                const errorTask: Task = {
                  id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  nodeId: imageInputPanelData.nodeId,
                  nodeTitle,
                  imageUrl: undefined,
                  prompt: imageInputPanelData.prompt || '',
                  createdAt: Date.now(),
                  status: 'error',
                  errorMessage: message || '生成失败，请检查提示词或稍后重试',
                };
                setTasks((prev) => [errorTask, ...prev]);
              }}
            />
          </div>
        )}

        {/* Video 输入面板弹窗（底部显示，向上滑出动画） */}
        {videoInputPanelData && selectedNode && selectedNode.type === 'video' && (
          <div className="absolute left-1/2 -translate-x-1/2 z-50 animate-slide-up" style={{ width: '840px', height: '242px', bottom: '21.25px', pointerEvents: 'auto' }}>
            <VideoInputPanel
              nodeId={videoInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              prompt={videoInputPanelData.prompt}
              aspectRatio={videoInputPanelData.aspectRatio}
              model={videoInputPanelData.model}
              hd={videoInputPanelData.hd}
              duration={videoInputPanelData.duration}
              inputImages={videoInputPanelData.inputImages || []}
              isConnected={videoInputPanelData.isConnected}
              projectId={projectId}
              guidanceScale={videoInputPanelData.guidanceScale}
              sound={videoInputPanelData.sound}
              shotType={videoInputPanelData.shotType ?? 'single'}
              negativePrompt={videoInputPanelData.negativePrompt ?? ''}
              resolutionWan26={videoInputPanelData.resolutionWan26 ?? '1080p'}
              durationWan26Flash={videoInputPanelData.durationWan26Flash ?? '5'}
              enableAudio={videoInputPanelData.enableAudio !== false}
              resolutionRhartV31={videoInputPanelData.resolutionRhartV31 ?? '1080p'}
              durationRhartVideoG={videoInputPanelData.durationRhartVideoG ?? '6s'}
              durationHailuo02={videoInputPanelData.durationHailuo02 ?? '6'}
              durationKlingO1={videoInputPanelData.durationKlingO1 ?? '5'}
              modeKlingO1={videoInputPanelData.modeKlingO1 ?? 'std'}
              referenceVideoUrl={videoInputPanelData.referenceVideoUrl}
              keepOriginalSound={videoInputPanelData.keepOriginalSound === true}
              onKeepOriginalSoundChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, keepOriginalSound: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, keepOriginalSound: value });
              }}
              onDurationRhartVideoGChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationRhartVideoG: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationRhartVideoG: value });
              }}
              onDurationHailuo02Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationHailuo02: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationHailuo02: value });
              }}
              onDurationKlingO1Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationKlingO1: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationKlingO1: value });
              }}
              onModeKlingO1Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, modeKlingO1: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, modeKlingO1: value });
              }}
              onResolutionRhartV31Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionRhartV31: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionRhartV31: value });
              }}
              onGuidanceScaleChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, guidanceScale: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, guidanceScale: value });
              }}
              onSoundChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, sound: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, sound: value });
              }}
              onShotTypeChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, shotType: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, shotType: value });
              }}
              onNegativePromptChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, negativePrompt: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, negativePrompt: value });
              }}
              onResolutionWan26Change={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, resolutionWan26: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, resolutionWan26: value });
              }}
              onDurationWan26FlashChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, durationWan26Flash: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, durationWan26Flash: value });
              }}
              onEnableAudioChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, enableAudio: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, enableAudio: value });
              }}
              onPromptChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, prompt: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, prompt: value });
              }}
              onAspectRatioChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, aspectRatio: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, aspectRatio: value });
              }}
              onModelChange={(value) => {
                console.log('[Workspace] 模型变更:', value, 'nodeId:', videoInputPanelData.nodeId);
                // 立即同步更新节点数据和面板数据，确保 UI 立即反映变化
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, model: value } }
                      : node
                  )
                );
                // 使用函数式更新，确保基于最新状态更新
                setVideoInputPanelData((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    model: value,
                  };
                });
              }}
              onHdChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, hd: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, hd: value });
              }}
              onDurationChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, duration: value } }
                      : node
                  )
                );
                setVideoInputPanelData({ ...videoInputPanelData, duration: value });
              }}
              onProgressChange={(progress) => {
                // 更新节点的进度数据
                // 当 progress > 0 时，强制清除 errorMessage，确保进度条能够显示
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { 
                          ...node, 
                          data: { 
                            ...node.data, 
                            progress,
                            // 如果 progress > 0，清除错误信息，确保进度条能够显示
                            ...(progress > 0 ? { errorMessage: undefined } : {})
                          } 
                        }
                      : node
                  )
                );
                // 同步更新到 handleVideoNodeDataChange
                if (progress > 0) {
                  handleVideoNodeDataChange(videoInputPanelData.nodeId, { 
                    progress,
                    errorMessage: undefined // 清除错误信息
                  });
                } else {
                  handleVideoNodeDataChange(videoInputPanelData.nodeId, { progress });
                }
              }}
              onProgressMessageChange={(message) => {
                // 更新节点的进度文案
                handleVideoNodeDataChange(videoInputPanelData.nodeId, { progressMessage: message });
              }}
              onOutputVideoChange={(url, originalUrl) => {
                if (!url) return;
                
                // 使用闭包保存 nodeId，确保更新到正确的节点（并发任务时很重要）
                const targetNodeId = videoInputPanelData.nodeId;
                console.log('[Workspace] onOutputVideoChange 被调用:', { targetNodeId, url, originalUrl });
                
                setNodes((nds) => {
                  // 确定网络 URL：优先使用 originalUrl，如果没有则检查 url 是否是网络 URL
                  let networkUrl = originalUrl;
                  if (!networkUrl && (url.startsWith('http://') || url.startsWith('https://'))) {
                    networkUrl = url; // url 本身就是网络 URL
                  }
                  
                  const updatedNodes = nds.map((node) =>
                    node.id === targetNodeId
                      ? { 
                          ...node, 
                          data: { 
                            ...node.data, 
                            outputVideo: url, // 本地路径（local-resource://）用于显示
                            originalVideoUrl: networkUrl, // 网络 URL 用于传递给 character 节点
                            progress: 0, 
                            errorMessage: undefined 
                          } 
                        }
                      : node
                  );
                  
                  // 验证节点是否被正确更新
                  const updatedNode = updatedNodes.find(n => n.id === targetNodeId);
                  console.log('[Workspace] 节点更新结果:', { 
                    targetNodeId, 
                    found: !!updatedNode, 
                    hasOutputVideo: !!updatedNode?.data?.outputVideo 
                  });
                  
                  return updatedNodes;
                });
                  
                // 触发 handleVideoNodeDataChange 以同步到连接的节点
                // 确定网络 URL：优先使用 originalUrl，如果没有则检查 url 是否是网络 URL
                let networkUrlForUpdate = originalUrl;
                if (!networkUrlForUpdate && (url.startsWith('http://') || url.startsWith('https://'))) {
                  networkUrlForUpdate = url; // url 本身就是网络 URL
                }
                  
                handleVideoNodeDataChange(targetNodeId, { 
                  outputVideo: url, // 本地路径（local-resource://）用于显示
                  originalVideoUrl: networkUrlForUpdate, // 网络 URL 用于传递给 character 节点
                  progress: 0, 
                  errorMessage: undefined 
                });
                  
                // 添加任务到任务列表（需要在 setNodes 外部获取节点数据）
                setNodes((nds) => {
                  const currentNode = nds.find((n) => n.id === targetNodeId);
                  if (currentNode && url) {
                    // 如果 url 是 local-resource://，使用原始远程 URL 作为任务 URL
                    const taskUrl = originalUrl || (url.startsWith('local-resource://') ? undefined : url) || url;
                    handleAddVideoTask(
                      targetNodeId,
                      taskUrl,
                      videoInputPanelData.prompt || currentNode.data?.prompt || '',
                      originalUrl || (url.startsWith('local-resource://') ? undefined : url)
                    );
                  }
                  return nds; // 不修改节点，只是获取数据
                });
              }}
              onErrorTask={(message) => {
                // 创建失败任务记录并更新 VideoNode
                const node = nodes.find((n) => n.id === videoInputPanelData.nodeId);
                const nodeTitle = node?.data?.title || 'video';
                const errorTask: Task = {
                  id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  nodeId: videoInputPanelData.nodeId,
                  nodeTitle,
                  videoUrl: undefined,
                  prompt: videoInputPanelData.prompt || '',
                  createdAt: Date.now(),
                  status: 'error',
                  taskType: 'video',
                  errorMessage: message || '视频生成失败，请检查提示词或稍后重试',
                };
                setTasks((prev) => [errorTask, ...prev]);
                
                // 更新 VideoNode：停止进度条并显示错误信息
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === videoInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, progress: 0, errorMessage: message || '视频生成失败' } }
                      : node
                  )
                );
                handleVideoNodeDataChange(videoInputPanelData.nodeId, { progress: 0, errorMessage: message || '视频生成失败' });
              }}
            />
          </div>
        )}

        {/* Character 输入面板弹窗（底部显示，向上滑出动画） */}
        {characterInputPanelData && selectedNode && selectedNode.type === 'character' && (
          <div className="absolute left-1/2 -translate-x-1/2 z-50 animate-slide-up" style={{ width: '840px', height: '242px', bottom: '21.25px', pointerEvents: 'auto' }}>
            <CharacterInputPanel
              nodeId={characterInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              videoUrl={characterInputPanelData.videoUrl}
              nickname={characterInputPanelData.nickname}
              timestamp={characterInputPanelData.timestamp}
              isConnected={characterInputPanelData.isConnected}
              projectId={projectId}
              isUploading={characterInputPanelData.isUploading}
              needsUpload={characterInputPanelData.needsUpload}
              localVideoPath={characterInputPanelData.localVideoPath}
              onConfirmUpload={() => {
                // 确认上传视频
                if (characterInputPanelData.localVideoPath && window.electronAPI) {
                  // 设置上传状态
                  setCharacterInputPanelData((prev) => {
                    if (prev) {
                      return {
                        ...prev,
                        isUploading: true,
                        needsUpload: false, // 清除需要上传标志
                      };
                    }
                    return prev;
                  });
                  
                  // 创建上传 Promise
                  const uploadPromise = window.electronAPI.uploadVideoToOSS(characterInputPanelData.localVideoPath!);
                  
                  // 保存 uploadPromise
                  setCharacterInputPanelData((prev) => {
                    if (prev) {
                      return {
                        ...prev,
                        uploadPromise: uploadPromise,
                      };
                    }
                    return prev;
                  });
                  
                  // 异步上传到 OSS
                  uploadPromise
                    .then((result) => {
                      if (result.success && result.url) {
                        console.log('[Workspace] 视频上传到 OSS 成功，OSS URL:', result.url);
                        // 更新节点数据（使用 OSS URL）
                        setNodes((nds) => {
                          return nds.map((node) => {
                            if (node.id === characterInputPanelData.nodeId) {
                              return {
                                ...node,
                                data: {
                                  ...node.data,
                                  videoUrl: result.url!, // 使用 OSS URL
                                },
                              };
                            }
                            return node;
                          });
                        });
                        
                        // 更新输入面板数据（使用 OSS URL）
                        setCharacterInputPanelData((prev) => {
                          if (prev && prev.nodeId === characterInputPanelData.nodeId) {
                            return {
                              ...prev,
                              videoUrl: result.url!, // 使用 OSS URL
                              isUploading: false, // 清除上传状态
                              uploadPromise: undefined, // 清除 uploadPromise
                              localVideoPath: undefined, // 清除本地路径
                            };
                          }
                          return prev;
                        });
                      } else {
                        console.error('[Workspace] 视频上传到 OSS 失败:', result.error);
                        // 上传失败，清除上传状态
                        setCharacterInputPanelData((prev) => {
                          if (prev && prev.nodeId === characterInputPanelData.nodeId) {
                            return {
                              ...prev,
                              isUploading: false,
                              needsUpload: true, // 恢复需要上传标志
                              uploadPromise: undefined,
                            };
                          }
                          return prev;
                        });
                      }
                    })
                    .catch((error) => {
                      console.error('[Workspace] 视频上传到 OSS 时出错:', error);
                      // 上传失败，清除上传状态
                      setCharacterInputPanelData((prev) => {
                        if (prev && prev.nodeId === characterInputPanelData.nodeId) {
                          return {
                            ...prev,
                            isUploading: false,
                            needsUpload: true, // 恢复需要上传标志
                            uploadPromise: undefined,
                          };
                        }
                        return prev;
                      });
                    });
                }
              }}
              onVideoUrlChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === characterInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, videoUrl: value } }
                      : node
                  )
                );
                setCharacterInputPanelData({ ...characterInputPanelData, videoUrl: value });
              }}
              onNicknameChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === characterInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, nickname: value } }
                      : node
                  )
                );
                setCharacterInputPanelData({ ...characterInputPanelData, nickname: value });
              }}
              onTimestampChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === characterInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, timestamp: value } }
                      : node
                  )
                );
                setCharacterInputPanelData({ ...characterInputPanelData, timestamp: value });
              }}
              onCreateCharacter={async () => {
                let finalVideoUrl = characterInputPanelData.videoUrl;
                
                // 如果正在上传视频到 OSS，等待上传完成
                if (characterInputPanelData.isUploading && characterInputPanelData.uploadPromise) {
                  console.log('[Workspace] 等待视频上传到 OSS 完成...');
                  try {
                    const uploadResult = await characterInputPanelData.uploadPromise;
                    // 严格验证 uploadResult 是否存在且格式正确
                    if (uploadResult && typeof uploadResult === 'object' && uploadResult.success === true && uploadResult.url && typeof uploadResult.url === 'string') {
                      // 上传完成，使用返回的 OSS URL
                      finalVideoUrl = uploadResult.url;
                      // 更新状态
                      setCharacterInputPanelData((prev) => {
                        if (prev) {
                          return {
                            ...prev,
                            videoUrl: uploadResult.url!,
                            isUploading: false,
                            uploadPromise: undefined,
                          };
                        }
                        return prev;
                      });
                    } else {
                      const errorMessage = (uploadResult && typeof uploadResult === 'object' && uploadResult.error) ? uploadResult.error : '视频上传失败';
                      throw new Error(errorMessage);
                    }
                  } catch (error: any) {
                    console.error('[Workspace] 等待视频上传失败:', error);
                    alert(error.message || '视频上传失败，请稍后重试');
                    setCharacterInputPanelData((prev) => prev ? { ...prev, isUploading: false, uploadPromise: undefined } : null);
                    return;
                  }
                }

                // 检查 videoUrl 是否有效
                if (!finalVideoUrl.trim()) {
                  alert('视频 URL 为空，请等待视频上传完成或手动输入视频 URL');
                  return;
                }

                // 本地视频必须先上传到 OSS 获取链接后再生成，禁止使用本地路径
                if (finalVideoUrl.startsWith('local-resource://') || finalVideoUrl.startsWith('file://')) {
                  alert('检测到本地视频，请先点击「确认上传视频」上传到云端获取链接后再创建角色。');
                  return;
                }

                // 设置上传状态（用于 uploadCharacterVideo）
                setCharacterInputPanelData((prev) => prev ? { ...prev, isUploading: true } : null);

                // 更新进度函数
                const updateProgress = (progress: number, message: string) => {
                  setNodes((nds) =>
                    nds.map((node) =>
                      node.id === characterInputPanelData.nodeId
                        ? { ...node, data: { ...node.data, progress, progressMessage: message } }
                        : node
                    )
                  );
                };
                
                // 启动进度更新循环（模拟进度）
                const startTime = Date.now();
                // 文字轮播消息列表
                const progressMessages = [
                  '正在生成...',
                  '处理中...',
                  '思考中...',
                  '解析中...',
                  '正在创作...',
                  '生成内容中...',
                  '正在组织语言...',
                ];
                
                // 获取轮播消息的函数（每 1.5 秒切换一次）
                const getRotatingMessage = () => {
                  const elapsed = Date.now() - startTime;
                  const interval = 1500; // 每 1.5 秒切换一次
                  const index = Math.floor(elapsed / interval) % progressMessages.length;
                  return progressMessages[index];
                };
                
                const progressInterval = setInterval(() => {
                  const elapsed = Date.now() - startTime;
                  let progress = 0;
                  
                  // 第一阶段：快速冲到 70%（5秒内）
                  if (elapsed < 5000) {
                    progress = Math.min(70, (elapsed / 5000) * 70);
                  }
                  // 第二阶段：缓慢增长到 99%（10秒内）
                  else if (elapsed < 15000) {
                    const phase2Elapsed = elapsed - 5000;
                    progress = 70 + (phase2Elapsed / 10000) * 29;
                  }
                  // 到达 99%
                  else {
                    progress = 99;
                  }
                  
                  updateProgress(Math.floor(progress), getRotatingMessage());
                }, 200);

                try {
                  if (!window.electronAPI) {
                    throw new Error('electronAPI 未就绪');
                  }

                  // 更新进度：开始上传角色视频
                  updateProgress(20, '正在上传角色视频...');
                  
                  // 上传角色视频（使用等待后的 OSS URL）
                  console.log('[Workspace] 开始上传角色视频，URL:', finalVideoUrl);
                  const timestamp = characterInputPanelData.timestamp || '1,3';
                  const uploadResult = await window.electronAPI.uploadCharacterVideo(finalVideoUrl, timestamp);
                  
                  // 严格验证 uploadResult 是否存在且格式正确
                  if (!uploadResult || typeof uploadResult !== 'object') {
                    throw new Error('上传角色视频失败：返回结果无效');
                  }
                  
                  // 从上传结果中提取 roleId
                  const roleId = uploadResult.roleId;
                  
                  // 更新进度：开始截取视频第一帧
                  updateProgress(50, '正在截取视频第一帧...');
                  
                  // 截取视频第一帧作为头像
                  let characterAvatar = '';
                  try {
                    console.log('[Workspace] 开始截取视频第一帧，URL:', finalVideoUrl);
                    const frameResult = await extractVideoFirstFrame(finalVideoUrl);
                    if (frameResult && frameResult.success && frameResult.imageUrl) {
                      // 更新进度：开始上传头像
                      updateProgress(70, '正在上传头像...');
                      
                      // 上传截取的帧到 OSS
                      const avatarUploadResult = await window.electronAPI.uploadImageToOSS(frameResult.imageUrl);
                      // 严格验证 avatarUploadResult 是否存在且格式正确
                      if (avatarUploadResult && typeof avatarUploadResult === 'object' && avatarUploadResult.success && avatarUploadResult.url) {
                        characterAvatar = avatarUploadResult.url;
                        console.log('[Workspace] 视频第一帧上传到 OSS 成功，头像 URL:', characterAvatar);
                      } else {
                        console.warn('[Workspace] 视频第一帧上传到 OSS 失败，使用默认头像。返回结果:', avatarUploadResult);
                      }
                    } else {
                      console.warn('[Workspace] 截取视频第一帧失败，使用默认头像。返回结果:', frameResult);
                    }
                  } catch (error) {
                    console.error('[Workspace] 截取视频第一帧时出错:', error);
                  }
                  
                  // 如果没有截取到头像，使用返回的 URL 作为头像
                  if (!characterAvatar) {
                    characterAvatar = uploadResult.url || '';
                  }
                  
                  const characterName = characterInputPanelData.nickname || '未命名角色';

                  // 更新进度：开始创建角色
                  updateProgress(90, '正在创建角色...');

                  // 创建角色（包含 roleId）
                  const newCharacter = await window.electronAPI.createCharacter(
                    characterInputPanelData.nickname || characterName,
                    characterName,
                    characterAvatar,
                    roleId // 传递 roleId
                  );

                  // 更新进度：完成
                  clearInterval(progressInterval);
                  updateProgress(100, '角色创建完成！');
                  
                  // 更新节点数据（包含 roleId）
                  handleCharacterNodeDataChange(characterInputPanelData.nodeId, {
                    nickname: newCharacter.nickname,
                    name: newCharacter.name,
                    avatar: newCharacter.avatar,
                    roleId: newCharacter.roleId, // 保存 roleId
                    progress: 0, // 清除进度
                    progressMessage: undefined,
                  });
                  
                  // 触发角色列表刷新
                  setCharacterListRefreshTrigger((prev) => prev + 1);
                  
                  // 延迟清除进度显示
                  setTimeout(() => {
                    setNodes((nds) =>
                      nds.map((node) =>
                        node.id === characterInputPanelData.nodeId
                          ? { ...node, data: { ...node.data, progress: 0, progressMessage: undefined } }
                          : node
                      )
                    );
                  }, 500);
                } catch (err: any) {
                  console.error('创建角色失败:', err);
                  clearInterval(progressInterval);
                  // 显示错误信息
                  setNodes((nds) =>
                    nds.map((node) =>
                      node.id === characterInputPanelData.nodeId
                        ? { 
                            ...node, 
                            data: { 
                              ...node.data, 
                              progress: 0, 
                              progressMessage: undefined,
                              errorMessage: err.message || '创建角色失败，请稍后重试'
                            } 
                          }
                        : node
                    )
                  );
                  alert(err.message || '创建角色失败，请稍后重试');
                } finally {
                  // 清除上传状态
                  setCharacterInputPanelData((prev) => prev ? { ...prev, isUploading: false } : null);
                }
              }}
            />
          </div>
        )}

        {/* Audio 输入面板弹窗（底部显示，向上滑出动画） */}
        {audioInputPanelData && selectedNode && selectedNode.type === 'audio' && (
          <div className="absolute left-1/2 -translate-x-1/2 z-50 animate-slide-up" style={{ width: '840px', height: '242px', bottom: '21.25px', pointerEvents: 'auto' }}>
            <AudioInputPanel
              nodeId={audioInputPanelData.nodeId}
              isDarkMode={isDarkMode}
              text={audioInputPanelData.text}
              model={audioInputPanelData.model || 'speech-2.8-hd'}
              voiceId={audioInputPanelData.voiceId}
              speed={audioInputPanelData.speed}
              volume={audioInputPanelData.volume}
              pitch={audioInputPanelData.pitch}
              emotion={audioInputPanelData.emotion}
              referenceAudioUrl={audioInputPanelData.referenceAudioUrl || ''}
              songName={audioInputPanelData.songName ?? ''}
              styleDesc={audioInputPanelData.styleDesc ?? ''}
              lyrics={audioInputPanelData.lyrics ?? ''}
              projectId={projectId}
              onSongNameChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, songName: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, songName: value });
              }}
              onStyleDescChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, styleDesc: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, styleDesc: value });
              }}
              onLyricsChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, lyrics: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, lyrics: value });
              }}
              onModelChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, model: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, model: value });
              }}
              onReferenceAudioUrlChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId ? { ...node, data: { ...node.data, referenceAudioUrl: value } } : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, referenceAudioUrl: value });
              }}
              onTextChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, text: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, text: value });
              }}
              onVoiceIdChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, voiceId: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, voiceId: value });
              }}
              onSpeedChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, speed: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, speed: value });
              }}
              onVolumeChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, volume: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, volume: value });
              }}
              onPitchChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, pitch: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, pitch: value });
              }}
              onEmotionChange={(value) => {
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, emotion: value } }
                      : node
                  )
                );
                setAudioInputPanelData({ ...audioInputPanelData, emotion: value });
              }}
              onOutputAudioChange={(audioUrl, originalUrl) => {
                if (!audioUrl) return;
                
                const targetNodeId = audioInputPanelData.nodeId;
                // 格式化本地路径为 local-resource
                let formattedAudioUrl = audioUrl;
                if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://') && !audioUrl.startsWith('data:')) {
                  const cleanPath = audioUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
                  let filePath = cleanPath.replace(/\\/g, '/');
                  if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
                  formattedAudioUrl = `local-resource://${filePath}`;
                }
                // 有远程 URL 时优先用于播放（与任务列表一致，避免节点内无法播放）
                const networkUrl = (originalUrl && (originalUrl.startsWith('http://') || originalUrl.startsWith('https://'))) ? originalUrl : (formattedAudioUrl.startsWith('http') ? formattedAudioUrl : undefined);
                const outputAudioForNode = networkUrl || formattedAudioUrl;
                
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === targetNodeId
                      ? { ...node, data: { ...node.data, outputAudio: outputAudioForNode, originalAudioUrl: networkUrl, errorMessage: undefined } }
                      : node
                  )
                );
                handleAudioNodeDataChange(targetNodeId, { outputAudio: outputAudioForNode, originalAudioUrl: networkUrl, errorMessage: undefined });
              }}
              onErrorTask={(message) => {
                // 创建失败任务记录并更新 AudioNode
                const node = nodes.find((n) => n.id === audioInputPanelData.nodeId);
                const nodeTitle = node?.data?.title || 'audio';
                const errorTask: Task = {
                  id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  nodeId: audioInputPanelData.nodeId,
                  nodeTitle,
                  imageUrl: undefined,
                  prompt: audioInputPanelData.text || '',
                  createdAt: Date.now(),
                  status: 'error',
                  errorMessage: message || '音频生成失败，请检查提示词或稍后重试',
                };
                setTasks((prev) => [errorTask, ...prev]);
                
                // 更新 AudioNode：显示错误信息
                setNodes((nds) =>
                  nds.map((node) =>
                    node.id === audioInputPanelData.nodeId
                      ? { ...node, data: { ...node.data, errorMessage: message || '音频生成失败' } }
                      : node
                  )
                );
                handleAudioNodeDataChange(audioInputPanelData.nodeId, { errorMessage: message || '音频生成失败' });
              }}
            />
          </div>
        )}


        {/* 右下角窗口尺寸调整区域（在小地图下方） */}
        <div
          className="fixed bottom-0 right-0 w-12 h-12 cursor-nwse-resize z-40"
          onMouseDown={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = window.innerWidth;
            const startHeight = window.innerHeight;

            const onMouseMove = async (moveEvent: MouseEvent) => {
              const deltaX = moveEvent.clientX - startX;
              const deltaY = moveEvent.clientY - startY;
              const newWidth = Math.max(800, startWidth + deltaX);
              const newHeight = Math.max(600, startHeight + deltaY);

              if (window.electronAPI) {
                try {
                  await window.electronAPI.resizeWindow(newWidth, newHeight);
                } catch (error) {
                  console.error('调整窗口尺寸失败:', error);
                }
              }
            };

            const onMouseUp = () => {
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          }}
        >
          <div className={`absolute bottom-0 right-0 w-0 h-0 border-r-[16px] border-b-[16px] border-transparent ${
            isDarkMode ? 'border-r-gray-600 border-b-gray-600' : 'border-r-gray-400 border-b-gray-400'
          } opacity-50 hover:opacity-100 transition-opacity`} />
        </div>

        {/* ESC 退出确认弹窗（深色系） */}
        {showExitConfirm && (
          <div className="fixed inset-0 z-[120] bg-black/55 backdrop-blur-sm flex items-center justify-center">
            <div className="w-[340px] rounded-2xl border border-white/10 bg-zinc-900/95 p-5 shadow-2xl">
              <div className="flex items-center gap-2 mb-3">
                <Power className="w-4 h-4 text-red-300" />
                <h3 className="text-white font-semibold text-base">退出程序</h3>
              </div>
              <p className="text-white/75 text-sm mb-5">确认退出 NEXFLOW 吗？</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowExitConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-sm text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleQuitApp}
                  className="px-3 py-1.5 rounded-lg text-sm bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30 transition-colors"
                >
                  退出
                </button>
              </div>
            </div>
          </div>
        )}


      </div>
    </div>
  );
};

export default Workspace;
