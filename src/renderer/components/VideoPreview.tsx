import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { normalizeVideoUrl } from '../utils/normalizeVideoUrl';

export interface VideoPreviewRef {
  pause: () => void;
  play: () => void;
}

interface VideoPreviewProps {
  src: string;
  originalRemoteUrl?: string;
  className?: string;
  style?: React.CSSProperties;
  controls?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  playsInline?: boolean;
  muted?: boolean;
  onClick?: () => void;
  /** 为 true 时暂停播放，避免离屏/缩小时 GPU 压力 */
  isPaused?: boolean;
  /** 视频元数据加载完成时回调（宽高），用于节点按视频比例调整尺寸 */
  onLoadedMetadata?: (videoWidth: number, videoHeight: number) => void;
}

/**
 * VideoPreview 组件
 * - 支持 ref 与 isPaused，用于 LOD：缩小时或离屏时暂停，避免大纹理导致 GPU 崩溃
 */
export const VideoPreview = forwardRef<VideoPreviewRef, VideoPreviewProps>(function VideoPreview({
  src,
  originalRemoteUrl: propOriginalRemoteUrl,
  className = '',
  style = {},
  controls = true,
  preload = 'metadata',
  playsInline = true,
  muted = false,
  onClick,
  isPaused = false,
  onLoadedMetadata,
}, ref) {
  const videoElRef = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => ({
    pause: () => videoElRef.current?.pause(),
    play: () => videoElRef.current?.play().catch(() => {}),
  }), []);

  useEffect(() => {
    if (isPaused) videoElRef.current?.pause();
    else videoElRef.current?.play().catch(() => {});
  }, [isPaused]);
  // 标准化视频 URL
  const safeUrl = normalizeVideoUrl(src);
  
  // 提取原始远程 URL（优先使用 prop，否则从 src 判断）
  const originalRemoteUrl = React.useMemo(() => {
    // 如果通过 prop 传入，直接使用
    if (propOriginalRemoteUrl) {
      return propOriginalRemoteUrl;
    }
    // 如果当前是 local-resource://，但没有 prop，返回 null
    if (safeUrl.startsWith('local-resource://')) {
      return null;
    }
    // 如果已经是远程 URL，直接返回
    if (safeUrl.startsWith('http://') || safeUrl.startsWith('https://')) {
      return safeUrl;
    }
    return null;
  }, [safeUrl, propOriginalRemoteUrl]);
  
  // 使用 state 来管理视频源，支持重试和备用 URL
  const [videoSrc, setVideoSrc] = React.useState(safeUrl);
  const [retryCount, setRetryCount] = React.useState(0);
  const [useFallbackUrl, setUseFallbackUrl] = React.useState(false);
  const maxRetries = 3;
  
  // 使用 ref 来跟踪是否正在重试，避免重复触发错误处理
  const isRetryingRef = React.useRef(false);

  // 当 src 变化时，更新 videoSrc 并重置重试计数
  // 使用 useRef 保存上一次的 URL，避免相同 URL 时重新加载
  const prevUrlRef = React.useRef<string>('');
  React.useEffect(() => {
    // 只有当 URL 真正变化时才更新，避免不必要的重新加载
    if (prevUrlRef.current !== safeUrl) {
      prevUrlRef.current = safeUrl;
      setVideoSrc(safeUrl);
      setRetryCount(0);
      setUseFallbackUrl(false);
      isRetryingRef.current = false;
    }
  }, [safeUrl]);

  // 检查视频格式兼容性
  const checkVideoCompatibility = React.useCallback((url: string): boolean => {
    if (!url) return false;
    const video = document.createElement('video');
    const ext = url.split('.').pop()?.toLowerCase();
    let mimeType = '';
    switch (ext) {
      case 'mp4':
        mimeType = 'video/mp4';
        break;
      case 'webm':
        mimeType = 'video/webm';
        break;
      case 'ogg':
        mimeType = 'video/ogg';
        break;
      case 'mov':
        mimeType = 'video/quicktime';
        break;
      default:
        return true; // 未知格式，让浏览器尝试
    }
    const canPlay = video.canPlayType(mimeType);
    return canPlay === 'probably' || canPlay === 'maybe';
  }, []);

  // 预加载检查：确保 local-resource:// 文件存在且可访问，并检查格式兼容性
  React.useEffect(() => {
    if (safeUrl.startsWith('local-resource://') && !useFallbackUrl && originalRemoteUrl && window.electronAPI) {
      // 先检查格式兼容性
      if (!checkVideoCompatibility(safeUrl)) {
        console.warn(`[VideoPreview] 预加载检查：视频格式可能不兼容，立即切换到备用 URL`);
        setUseFallbackUrl(true);
        setVideoSrc(originalRemoteUrl);
        return;
      }

      // 通过 IPC 检查文件是否存在（避免尝试加载不存在的文件）
      window.electronAPI.checkFileExists(safeUrl).then((result) => {
        if (!result.exists || !result.readable) {
          console.warn(`[VideoPreview] 预加载检查：文件不存在或不可读 (exists: ${result.exists}, readable: ${result.readable})，立即切换到备用 URL`);
          setUseFallbackUrl(true);
          setVideoSrc(originalRemoteUrl);
          return;
        }
        
        // 文件存在，继续使用本地文件
        console.log(`[VideoPreview] 预加载检查：文件存在且可读 (size: ${result.size} bytes)`);
      }).catch((error) => {
        console.warn(`[VideoPreview] 预加载检查：检查文件失败，切换到备用 URL:`, error);
        setUseFallbackUrl(true);
        setVideoSrc(originalRemoteUrl);
      });
    }
  }, [safeUrl, useFallbackUrl, originalRemoteUrl, checkVideoCompatibility]);

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    const error = video.error;

    // 详细的错误信息
    const errorInfo = {
      src: video.currentSrc || src,
      code: error?.code,
      message: error?.message,
      networkState: video.networkState,
      readyState: video.readyState,
    };

    console.error('[VIDEO_LOAD_ERROR]', errorInfo);
    
    // 如果正在重试中，不处理错误（避免重复触发）
    if (isRetryingRef.current) {
      return;
    }
    
    // 如果是 DEMUXER_ERROR、DECODE 错误或 code: 4 (MEDIA_ERR_SRC_NOT_SUPPORTED)，尝试容错处理
    if (
      error?.code === MediaError.MEDIA_ERR_DECODE || 
      error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || // code: 4
      error?.message?.includes('DEMUXER_ERROR') ||
      error?.message?.includes('COULD_NOT_OPEN') ||
      error?.message?.includes('PIPELINE_ERROR_DECODE')
    ) {
      // 如果使用的是 local-resource:// 且还有原始远程 URL，立即切换到远程 URL
      if (video.currentSrc.startsWith('local-resource://') && originalRemoteUrl && !useFallbackUrl) {
        console.log(`[VideoPreview] local-resource:// 加载失败 (code: ${error?.code})，立即切换到原始远程 URL: ${originalRemoteUrl}`);
        setUseFallbackUrl(true);
        setVideoSrc(originalRemoteUrl);
        isRetryingRef.current = true;
        setTimeout(() => {
          isRetryingRef.current = false;
        }, 500);
        return; // 不显示错误提示，等待远程 URL 加载
      }
      
      // 如果重试次数未达到上限，尝试重试
      if (retryCount < maxRetries) {
        const nextRetry = retryCount + 1;
        console.log(`[VideoPreview] 视频加载失败，${1000 * nextRetry}ms 后重试 (${nextRetry}/${maxRetries})...`);
        
        // 标记正在重试
        isRetryingRef.current = true;
        
        // 延迟重试，给文件系统更多时间
        setTimeout(() => {
          setRetryCount(nextRetry);
          // 通过重新设置 src 来触发重试（不设置空字符串，直接设置新值）
          // 使用 key 属性强制重新渲染，而不是清空 src
          setVideoSrc(safeUrl + `?retry=${nextRetry}`); // 添加查询参数强制重新加载
          
          // 重置重试标记（延迟一点，确保视频元素有机会加载）
          setTimeout(() => {
            isRetryingRef.current = false;
          }, 500);
        }, 1000 * nextRetry); // 递增延迟：1s, 2s, 3s
        return; // 不显示错误提示，等待重试
      }
    }

    // 所有重试都失败后，才显示错误提示
    // 根据错误代码提供更具体的错误信息
    let errorMessage = '视频无法播放，原因可能是：\n';
    
    if (error) {
      switch (error.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorMessage += '1. 视频加载被中止\n';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage += '1. 网络错误，无法加载视频\n';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage += '1. 视频编码不被浏览器支持\n';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage += '1. 视频格式不被浏览器支持\n';
          break;
        default:
          errorMessage += '1. 未知错误\n';
      }
    } else {
      errorMessage += '1. 视频编码不被浏览器支持\n';
    }

    errorMessage += '2. OSS Content-Type 配置错误\n';
    errorMessage += '3. 视频尚未完成转码\n\n';
    errorMessage += '建议：请等待片刻或刷新页面';

    // 只有在所有重试都失败后才显示错误提示
    if (retryCount >= maxRetries) {
      // 延迟显示，避免在重试过程中弹出
      setTimeout(() => {
        alert(errorMessage);
      }, 100);
    }
  };

  const handleLoadedData = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    console.log('[VIDEO_LOAD_SUCCESS]', {
      src: safeUrl,
      duration: video.duration,
    });
    // 视频加载成功，重置重试计数和标记
    setRetryCount(0);
    isRetryingRef.current = false;
  };

  // 移除查询参数（retry参数仅用于强制重新加载）
  const cleanSrc = videoSrc.split('?')[0];

  // Electron 下 <video> 对 local-resource:// 可能无法正确加载（协议流式响应），改为使用 file:// 以可靠播放
  const displaySrc = React.useMemo(() => {
    if (!cleanSrc?.startsWith('local-resource://')) return cleanSrc;
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      const pathPart = cleanSrc.replace(/^local-resource:\/\/+/, '');
      const fileUrl = pathPart ? `file:///${pathPart.replace(/\\/g, '/')}` : cleanSrc;
      return fileUrl;
    }
    return cleanSrc;
  }, [cleanSrc]);
  
  // 判断是否为远程 URL，需要添加 crossOrigin
  const isRemoteUrl = cleanSrc.startsWith('http://') || cleanSrc.startsWith('https://');
  
  // 根据文件扩展名判断 MIME 类型
  const getMimeType = (url: string): string | undefined => {
    const ext = url.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'mp4':
        return 'video/mp4';
      case 'webm':
        return 'video/webm';
      case 'ogg':
        return 'video/ogg';
      case 'mov':
        return 'video/quicktime';
      default:
        return undefined;
    }
  };
  
  const mimeType = getMimeType(cleanSrc);

  // 在加载前检查格式兼容性（如果 local-resource 失败，立即切换到远程 URL）
  React.useEffect(() => {
    if (cleanSrc.startsWith('local-resource://') && originalRemoteUrl && !useFallbackUrl) {
      // 检查格式兼容性
      if (!checkVideoCompatibility(cleanSrc)) {
        console.warn(`[VideoPreview] 视频格式不兼容，立即切换到远程 URL`);
        setUseFallbackUrl(true);
        setVideoSrc(originalRemoteUrl);
      }
    }
  }, [cleanSrc, originalRemoteUrl, useFallbackUrl, checkVideoCompatibility]);
  
  // 只在真正需要重试时才改变 key，避免不必要的重新加载
  const videoKey = retryCount > 0 || useFallbackUrl 
    ? `${cleanSrc}-${retryCount}-${useFallbackUrl}` 
    : cleanSrc; // 正常情况下使用稳定的 key
  
  return (
    <video
      ref={videoElRef}
      key={videoKey}
      src={displaySrc}
      controls={controls}
      preload={preload}
      playsInline={playsInline}
      muted={muted}
      className={className}
      style={{ width: '100%', borderRadius: 8, ...style }}
      crossOrigin={isRemoteUrl ? 'anonymous' : undefined}
      onError={handleError}
      onLoadedData={handleLoadedData}
      onLoadedMetadata={onLoadedMetadata ? (e) => {
        const v = e.currentTarget;
        if (v.videoWidth > 0 && v.videoHeight > 0) {
          onLoadedMetadata(v.videoWidth, v.videoHeight);
        }
      } : undefined}
      onClick={onClick}
    >
      {mimeType && <source src={displaySrc} type={mimeType} />}
    </video>
  );
});
