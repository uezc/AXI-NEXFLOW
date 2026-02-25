import React, { useState, useRef, useEffect } from 'react';

interface OSSImageProps {
  src: string;
  alt?: string;
  className?: string;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * OSS 图片组件，带自动重试机制
 * 处理 OSS 上传延迟导致的 404 错误
 */
export const OSSImage: React.FC<OSSImageProps> = ({
  src,
  alt = '',
  className = '',
  onLoad,
  onError,
  maxRetries = 1,
  retryDelay = 1500,
}) => {
  const [imageSrc, setImageSrc] = useState(src);
  const [retryCount, setRetryCount] = useState(0);
  const [hasError, setHasError] = useState(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRetryingRef = useRef(false);

  // 当 src 变化时，重置状态
  useEffect(() => {
    setImageSrc(src);
    setRetryCount(0);
    setHasError(false);
    isRetryingRef.current = false;
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, [src]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    // 如果正在重试中，不处理错误（避免重复触发）
    if (isRetryingRef.current) {
      return;
    }

    // 如果是 OSS URL 且重试次数未达到上限，进行重试
    if (
      imageSrc.includes('oss-cn-hongkong.aliyuncs.com') ||
      imageSrc.includes('oss-us-west-1.aliyuncs.com') ||
      imageSrc.includes('aliyuncs.com')
    ) {
      if (retryCount < maxRetries) {
        isRetryingRef.current = true;
        const nextRetry = retryCount + 1;
        
        console.log(`[OSSImage] 图片加载失败，${retryDelay}ms 后重试 (${nextRetry}/${maxRetries}):`, imageSrc);
        
        retryTimeoutRef.current = setTimeout(() => {
          setRetryCount(nextRetry);
          // 添加时间戳参数强制重新加载
          const separator = imageSrc.includes('?') ? '&' : '?';
          setImageSrc(`${imageSrc}${separator}_retry=${Date.now()}`);
          isRetryingRef.current = false;
        }, retryDelay);
        
        return; // 不触发 onError 回调，等待重试
      }
    }

    // 所有重试都失败或不是 OSS URL，标记为错误
    setHasError(true);
    if (onError) {
      onError(e);
    }
  };

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    // 加载成功，重置重试计数
    setRetryCount(0);
    setHasError(false);
    isRetryingRef.current = false;
    if (onLoad) {
      onLoad(e);
    }
  };

  // 如果最终失败，显示占位符
  if (hasError) {
    return (
      <div className={`flex items-center justify-center bg-gray-200 dark:bg-gray-800 ${className}`}>
        <svg
          className="w-8 h-8 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
};
