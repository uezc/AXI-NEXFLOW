import React, { useCallback, useRef, useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { getVideoPrice } from '../../utils/priceCalc';


interface VideoInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '2:3' | '3:2';
  model: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'rhart-video-g' | 'rhart-video-s-i2v-pro' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard';
  hd: boolean;
  duration: '5' | '10' | '15' | '25';
  inputImages?: string[]; // 图生视频参考图
  isConnected?: boolean;
  projectId?: string; // 项目 ID（用于保存到项目文件夹）
  /** 可灵参考生视频o1：参考视频 URL（由画布从连线解析传入） */
  referenceVideoUrl?: string;
  /** 可灵参考生视频o1：是否保留参考视频原声 */
  keepOriginalSound?: boolean;
  // kling-v2.6-pro 参数
  guidanceScale?: number;
  sound?: 'true' | 'false';
  // 万相2.6 参数
  shotType?: 'single' | 'multi';
  negativePrompt?: string;
  resolutionWan26?: '720p' | '1080p';
  durationWan26Flash?: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15';
  enableAudio?: boolean;
  // 全能视频V3.1-fast 文生视频（仅文生，分辨率 720p|1080p|4k）
  resolutionRhartV31?: '720p' | '1080p' | '4k';
  // 全能视频G 图生视频：仅图生，时长 6s/10s
  durationRhartVideoG?: '6s' | '10s';
  // 海螺-02 文生视频标准：仅文生，时长 6|10 秒
  durationHailuo02?: '6' | '10';
  // 可灵文生视频o1：仅文生，时长 5|10 秒，模式 std|pro
  durationKlingO1?: '5' | '10';
  modeKlingO1?: 'std' | 'pro';
  onKeepOriginalSoundChange?: (value: boolean) => void;
  onGuidanceScaleChange?: (value: number) => void;
  onSoundChange?: (value: 'true' | 'false') => void;
  onShotTypeChange?: (value: 'single' | 'multi') => void;
  onNegativePromptChange?: (value: string) => void;
  onResolutionWan26Change?: (value: '720p' | '1080p') => void;
  onDurationWan26FlashChange?: (value: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15') => void;
  onEnableAudioChange?: (value: boolean) => void;
  onResolutionRhartV31Change?: (value: '720p' | '1080p' | '4k') => void;
  onDurationRhartVideoGChange?: (value: '6s' | '10s') => void;
  onDurationHailuo02Change?: (value: '6' | '10') => void;
  onDurationKlingO1Change?: (value: '5' | '10') => void;
  onModeKlingO1Change?: (value: 'std' | 'pro') => void;
  onPromptChange: (value: string) => void;
  onAspectRatioChange: (value: '16:9' | '9:16' | '1:1' | '2:3' | '3:2') => void;
  onModelChange: (value: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'rhart-video-g' | 'rhart-video-s-i2v-pro' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard') => void;
  onHdChange: (value: boolean) => void;
  onDurationChange: (value: '5' | '10' | '15' | '25') => void;
  onOutputVideoChange: (url?: string, originalUrl?: string) => void;
  onProgressChange?: (progress: number) => void;
  onProgressMessageChange?: (message: string) => void; // 进度文案更新回调
  onErrorTask?: (message: string) => void; // 任务失败时的回调（用于任务列表）
}

const VideoInputPanel: React.FC<VideoInputPanelProps> = ({
  nodeId,
  isDarkMode,
  prompt,
  aspectRatio,
  model,
  hd,
  duration,
  inputImages = [],
  isConnected = false,
  projectId,
  onPromptChange,
  onAspectRatioChange,
  onModelChange,
  onHdChange,
  onDurationChange,
  onOutputVideoChange,
  onProgressChange,
  onProgressMessageChange,
  onErrorTask,
  guidanceScale = 0.5,
  sound = 'false',
  shotType = 'single',
  negativePrompt = '',
  resolutionWan26 = '1080p',
  durationWan26Flash = '5',
  enableAudio = true,
  resolutionRhartV31 = '1080p',
  durationRhartVideoG = '6s',
  onGuidanceScaleChange,
  onSoundChange,
  onShotTypeChange,
  onNegativePromptChange,
  onResolutionWan26Change,
  onDurationWan26FlashChange,
  onEnableAudioChange,
  onResolutionRhartV31Change,
  onDurationRhartVideoGChange,
  durationHailuo02 = '6',
  onDurationHailuo02Change,
  durationKlingO1 = '5',
  modeKlingO1 = 'std',
  onDurationKlingO1Change,
  onModeKlingO1Change,
  referenceVideoUrl,
  keepOriginalSound = false,
  onKeepOriginalSoundChange,
}) => {
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const isImageToVideoMode = inputImages && inputImages.length > 0;
  const isKlingModel = model === 'kling-v2.6-pro';
  const isSora2Model = model === 'sora-2';
  const isSora2ProModel = model === 'sora-2-pro';
  const isWan26Model = model === 'wan-2.6';
  const isWan26FlashModel = model === 'wan-2.6-flash';
  const isRhartV31FastModel = model === 'rhart-v3.1-fast';
  const isRhartV31FastSEModel = model === 'rhart-v3.1-fast-se';
  const isRhartV31ProSEModel = model === 'rhart-v3.1-pro-se';
  const isRhartV31ProModel = model === 'rhart-v3.1-pro'; // Veo3.1 Pro 文生视频（仅文生，固定 8s，必填 resolution）
  const isRhartVideoGModel = model === 'rhart-video-g';
  const isHailuo02Model = model === 'hailuo-02-t2v-standard';
  const isHailuo23Model = model === 'hailuo-2.3-t2v-standard';
  const isHailuo02I2vModel = model === 'hailuo-02-i2v-standard';
  const isHailuo23I2vModel = model === 'hailuo-2.3-i2v-standard';
  const isKlingVideoO1Model = model === 'kling-video-o1';
  const isKlingVideoO1I2vModel = model === 'kling-video-o1-i2v';
  const isKlingVideoO1StartEndModel = model === 'kling-video-o1-start-end';
  const isKlingVideoO1RefModel = model === 'kling-video-o1-ref';
  const isRhartVideoSI2vProModel = model === 'rhart-video-s-i2v-pro';

  // 图生视频支持的模型列表（根据 API 文档）
  const supportedImageToVideoModels = [
    'sora-2',
    'kling-v2.6-pro',
    'wan-2.6',
    'wan-2.6-flash',
    'rhart-v3.1-fast', // 全能V3.1-fast 图生视频，支持 1–3 张图
    'rhart-video-g', // 全能视频G 图生视频，仅 1 张图，比例 2:3/3:2/1:1，时长 6s/10s
    'rhart-video-s-i2v-pro', // 全能视频S-图生视频-pro，仅 1 张图，时长 15s/25s，比例 9:16/16:9
    'hailuo-02-i2v-standard', // 海螺-02 图生视频标准，1 或 2 张图（2 张为首尾帧）
    'hailuo-2.3-i2v-standard', // 海螺-2.3 图生视频标准，仅 1 张图
    'kling-video-o1-i2v', // 可灵图生视频o1，仅 1 张图
  ] as const;

  // 2 张图：仅首尾帧模型（≥2 张图时去除 Veo 3.1 fast 图生、Grok 1.5）
  const rhartV31FastTwoImageModels = ['rhart-v3.1-fast-se', 'rhart-v3.1-pro-se', 'hailuo-02-i2v-standard', 'kling-video-o1-start-end'] as const;
  const rhartV31FastThreeImageModels = ['rhart-v3.1-fast'] as const; // Grok 1.5 图生仅支持 1 张

  /** 图生视频模式下，当前模型最大参考图数量（与主进程 VideoProvider 校验一致） */
  const getMaxRefImagesVideo = (m: string): number => {
    if (m === 'rhart-v3.1-fast') return 3;
    if (['rhart-v3.1-fast-se', 'rhart-v3.1-pro-se', 'hailuo-02-i2v-standard', 'kling-video-o1-start-end'].includes(m)) return 2;
    return 1; // sora-2, kling-v2.6-pro, wan-2.6, wan-2.6-flash, rhart-video-g, rhart-video-s-i2v-pro, hailuo-2.3-i2v-standard, kling-video-o1-i2v 等
  };

  const maxRefImagesVideo = getMaxRefImagesVideo(model);

  const videoPrice = getVideoPrice({
    model,
    duration,
    sound,
    durationHailuo02,
    durationKlingO1,
    modeKlingO1,
    durationRhartVideoG,
    resolutionRhartV31,
    resolutionWan26,
    durationWan26Flash,
    enableAudio,
  });

  const imageCount = inputImages?.length || 0;
  const availableModels = isImageToVideoMode
    ? imageCount >= 3
      ? rhartV31FastThreeImageModels // 3 张图：仅全能V3.1-fast 图生视频
      : imageCount >= 2
        ? rhartV31FastTwoImageModels // 2 张图：图生 或 首尾帧生视频
        : supportedImageToVideoModels // 1 张图：显示所有图生视频支持的模型
    : [];

  // 当切换到图生视频模式时，如果当前模型不支持，自动切换到第一个支持的模型
  // 如果模型是 sora-2 或 kling-v2.6-pro 且有图片输入，自动切换到图生视频模式（保持原模型）
  useEffect(() => {
    if (isImageToVideoMode) {
      // sora-2、kling-v2.6-pro、万相2.6、万相2.6 Flash、全能视频S-图生视频-pro、海螺-2.3 图生、可灵图生o1 只支持 1 张图片
      const oneImageOnlyModels = ['sora-2', 'kling-v2.6-pro', 'wan-2.6', 'wan-2.6-flash', 'rhart-video-s-i2v-pro', 'hailuo-2.3-i2v-standard', 'kling-video-o1-i2v'];
      if (oneImageOnlyModels.includes(model) && imageCount > 1) {
        const defaultModel = availableModels.find(m => !oneImageOnlyModels.includes(m)) || 'sora-2';
        console.log(`[VideoInputPanel] ${model} 图生视频只支持 1 张图片，当前有 ${imageCount} 张，自动切换到 ${defaultModel}`);
        onModelChange(defaultModel as any);
        return;
      }
      if (oneImageOnlyModels.includes(model) && imageCount === 1) {
        return;
      }
      
      if (!availableModels.includes(model as any)) {
        const defaultModel = (availableModels[0] as string) || 'sora-2';
        console.log(`[VideoInputPanel] 当前模型 ${model} 不支持当前图片数量(${imageCount})，自动切换到 ${defaultModel}`);
        onModelChange(defaultModel as any);
      }
    } else {
      // 文生视频模式：如果当前模型是 sora-2 或 kling-v2.6-pro，保持原模型（支持文生视频）
      // 不需要特殊处理
    }
  }, [isImageToVideoMode, imageCount, model, availableModels, onModelChange, isSora2Model, isKlingModel]);

  // 模式标签和按钮文案
  const modeLabel = isImageToVideoMode ? '图生视频' : '文生视频';
  const modeTitle = isImageToVideoMode ? '全能图生视频S2' : '全能文生视频S2';

  // 超时定时器引用
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // AI Hook
  const { status: aiStatus, execute: executeAI } = useAI({
    nodeId,
    modelId: 'video',
    onStatusUpdate: async (packet) => {
      const payload = packet.payload || {};
      
      // 处理 START 状态：显示初始进度条（优先处理，确保重新生成时能显示进度条）
      if (packet.status === 'START') {
        console.log('[VideoInputPanel] 视频生成开始（包括从 ERROR 状态重新生成），强制清除错误状态');
        // 强制清除错误信息：通过设置 progress > 0 来触发进度条显示，覆盖错误状态
        // 注意：这里需要通知 Workspace 清除 errorMessage，但由于我们没有直接访问，
        // 我们通过设置 progress 和 progressMessage 来确保进度条显示
        if (onProgressChange) {
          onProgressChange(1); // 设置为 1% 以强制显示进度条
        }
        if (onProgressMessageChange) {
          onProgressMessageChange('正在初始化...'); // 清除之前的错误消息
        }
        // 启动超时定时器（15分钟）
        startTimeRef.current = Date.now();
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          console.warn('[VideoInputPanel] 视频生成超时（15分钟无响应），取消任务');
          // 清除进度条
          if (onProgressChange) {
            onProgressChange(0);
          }
          // 通知错误
          if (onErrorTask) {
            onErrorTask('视频生成超时（15分钟无响应）');
          }
          // 重置超时定时器
          timeoutRef.current = null;
          startTimeRef.current = null;
        }, 15 * 60 * 1000); // 15分钟 = 900000毫秒
      }
      
      // 处理 ERROR 状态：停止进度条并显示错误
      if (packet.status === 'ERROR') {
        const errorMessage = payload.error || '视频生成失败';
        console.error('[VideoInputPanel] 视频生成错误:', errorMessage);
        
        // 清除超时定时器
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        startTimeRef.current = null;
        
        // 停止进度条（设置为 0，但不清除，以便重新生成时能立即显示）
        if (onProgressChange) {
          onProgressChange(0);
        }
        
        // 通知任务列表（用于显示失败任务）
        if (onErrorTask) {
          onErrorTask(errorMessage);
        }
        
        return; // 不处理视频 URL，直接返回
      }
      
      // 处理 SUCCESS 状态：清除超时定时器和进度条
      if (packet.status === 'SUCCESS') {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        startTimeRef.current = null;
        // SUCCESS 状态时，清除进度条
        if (onProgressChange) {
          onProgressChange(0);
        }
      }
      
      // 显示进度信息并更新节点（仅在非 SUCCESS 状态时更新进度）
      if (packet.status !== 'SUCCESS') {
        if (packet.payload?.progress !== undefined) {
          const progressValue = packet.payload.progress;
          const progressText = packet.payload.text || '正在生成视频...';
          // 提取进度文案（去掉百分比）
          const progressMessage = progressText.replace(/\s*\d+%$/, '').trim() || '正在生成视频...';
          console.log(`[VideoInputPanel] 视频生成进度: ${progressValue}%`);
          // 更新节点的进度显示
          if (onProgressChange) {
            onProgressChange(progressValue);
          }
          // 更新进度文案
          if (onProgressMessageChange) {
            onProgressMessageChange(progressMessage);
          }
        } else if (packet.status === 'PROCESSING' && !packet.payload?.progress) {
          // 如果状态是 PROCESSING 但没有进度值，设置一个最小进度值以确保显示进度条
          if (onProgressChange) {
            onProgressChange(1);
          }
        }
      }
      
      // URL 嗅探：如果 payload 中包含 URL，立即更新（支持 HTTP/HTTPS 和 local-resource://）
      // 注意：并发任务时，确保使用正确的 payload（packet.payload 优先）
      const currentPayload = packet.payload || payload || {};
      const localPath = currentPayload.localPath;
      
      // 优先使用 localPath（如果存在），否则使用 url 或 videoUrl
      let videoUrl: string | undefined;
      if (localPath) {
        // 如果有本地路径，转换为 local-resource:// 格式
        let filePath = localPath.replace(/\\/g, '/');
        // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
        if (filePath.match(/^\/[a-zA-Z]:/)) {
          filePath = filePath.substring(1); // 移除开头的 /
        }
        videoUrl = `local-resource://${filePath}`;
        console.log('[VideoInputPanel] 使用本地路径:', localPath, '->', videoUrl);
      } else {
        videoUrl = currentPayload.url || 
                    currentPayload.videoUrl ||
                    (typeof currentPayload.text === 'string' && 
                     currentPayload.text.match(/https?:\/\/[^\s\)]+/)?.[0]);
      }
      
      // 优先从 payload 中提取 originalVideoUrl，确保获取网络 URL
      const originalVideoUrl = currentPayload.originalVideoUrl || 
                               (videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) ? videoUrl : undefined);
      
      console.log('[VideoInputPanel] onStatusUpdate - nodeId:', nodeId, '视频 URL:', videoUrl);
      console.log('[VideoInputPanel] onStatusUpdate - 原始网络 URL:', originalVideoUrl);
      console.log('[VideoInputPanel] onStatusUpdate - payload:', JSON.stringify(currentPayload, null, 2));
      
      // 将 file:// 格式转换为 local-resource:// 格式
      if (videoUrl && videoUrl.startsWith('file://')) {
        let filePath = videoUrl.replace(/^file:\/\/\/?/, '');
        // 处理 Windows 路径（file:///C:/ 格式）
        if (filePath.match(/^[a-zA-Z]:/)) {
          // 已经是正确的 Windows 路径格式
        } else if (filePath.match(/^[a-zA-Z]\//)) {
          // 处理 file:///c/Users 格式，转换为 C:/Users
          filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        }
        videoUrl = `local-resource://${filePath.replace(/\\/g, '/')}`;
      }
      
      // 检查 URL 是否是视频文件（通过文件扩展名或协议判断）
      if (videoUrl) {
        const isVideoFile = /\.(mp4|webm|mov|avi|mkv)$/i.test(videoUrl) || 
                           /^https?:\/\//.test(videoUrl) || // 远程 URL 假设是视频
                           (videoUrl.startsWith('local-resource://') && /\.(mp4|webm|mov|avi|mkv)$/i.test(videoUrl));
        
        if (isVideoFile) {
          console.log('[VideoInputPanel] 检测到视频 URL:', videoUrl);
          // 清除超时定时器
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          startTimeRef.current = null;
          // 视频生成后不自动上传到OSS，只在创建角色时才上传
          // 直接使用原始 URL（网络 URL 或本地路径）
          onOutputVideoChange(videoUrl, originalVideoUrl);
          // 清除进度条（视频已生成）
          if (onProgressChange) {
            onProgressChange(0);
          }
        } else {
          console.warn('[VideoInputPanel] 检测到非视频文件 URL，跳过:', videoUrl);
        }
      }
    },
    onComplete: async (payload) => {
      // 防御性检查：确保 payload 存在
      if (!payload) {
        console.warn('[VideoInputPanel] onComplete 接收到 undefined payload');
        return;
      }
      
      // URL 嗅探：如果 payload 中包含 URL，立即更新（支持 HTTP/HTTPS 和 local-resource://）
      let videoUrl = payload?.url || 
                      payload?.videoUrl ||
                      (typeof payload?.text === 'string' && 
                       payload.text.match(/https?:\/\/[^\s\)]+/)?.[0]);
      
      // 验证 videoUrl 是否为有效的字符串（排除 false、null、undefined 等）
      if (!videoUrl || typeof videoUrl !== 'string' || videoUrl === 'false' || videoUrl === 'null' || videoUrl.trim() === '') {
        console.warn('[VideoInputPanel] 视频生成完成，但 URL 无效:', videoUrl, 'payload:', payload);
        // 视频生成完成，清除进度
        if (onProgressChange) {
          onProgressChange(0);
        }
        return;
      }
      
      // 优先从 payload 中提取 originalVideoUrl，确保获取网络 URL
      const originalVideoUrl = payload?.originalVideoUrl || 
                               (videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) ? videoUrl : undefined);
      
      console.log('[VideoInputPanel] 视频生成完成，URL:', videoUrl);
      console.log('[VideoInputPanel] 原始网络 URL:', originalVideoUrl);
      
      // 将 file:// 格式转换为 local-resource:// 格式
      if (videoUrl && videoUrl.startsWith('file://')) {
        let filePath = videoUrl.replace(/^file:\/\/\/?/, '');
        // 处理 Windows 路径（file:///C:/ 格式）
        if (filePath.match(/^[a-zA-Z]:/)) {
          // 已经是正确的 Windows 路径格式
        } else if (filePath.match(/^[a-zA-Z]\//)) {
          // 处理 file:///c/Users 格式，转换为 C:/Users
          filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        }
        videoUrl = `local-resource://${filePath.replace(/\\/g, '/')}`;
      }
      
      // 检查 URL 是否是视频文件（通过文件扩展名或协议判断）
      const isVideoFile = /\.(mp4|webm|mov|avi|mkv)$/i.test(videoUrl) || 
                         /^https?:\/\//.test(videoUrl) || // 远程 URL 假设是视频
                         (videoUrl.startsWith('local-resource://') && /\.(mp4|webm|mov|avi|mkv)$/i.test(videoUrl));
      
      // 清除超时定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      startTimeRef.current = null;
      
      if (isVideoFile) {
        console.log('[VideoInputPanel] 视频生成完成，URL:', videoUrl);
        // 视频生成后不自动上传到OSS，只在创建角色时才上传
        // 直接使用原始 URL（网络 URL 或本地路径）
        onOutputVideoChange(videoUrl, originalVideoUrl);
        
        // 视频生成完成，清除进度
        if (onProgressChange) {
          onProgressChange(0);
        }
      } else {
        console.warn('[VideoInputPanel] 检测到非视频文件 URL，跳过:', videoUrl);
        // 即使不是视频文件，也清除进度
        if (onProgressChange) {
          onProgressChange(0);
        }
      }
    },
    onError: (error) => {
      // 严格验证 error 是否存在且格式正确
      let errorMessage = '视频生成失败';
      if (error) {
        if (typeof error === 'string') {
          errorMessage = error;
        } else if (typeof error === 'object' && error !== null) {
          errorMessage = (error as any).message || (error as any).error || String(error);
        } else {
          errorMessage = String(error);
        }
      }
      
      console.error('视频生成失败:', errorMessage, '原始错误对象:', error);
      
      // 检测余额不足错误
      const isQuotaError = errorMessage.includes('quota is not enough') || 
                          errorMessage.includes('remain quota') ||
                          errorMessage.includes('余额不足');
      
      if (isQuotaError) {
        // 显示余额不足弹窗
        alert('余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。');
      }
      
      // 停止进度条
      if (onProgressChange) {
        onProgressChange(0);
      }
      
      // 通知任务列表创建失败任务
      if (onErrorTask) {
        onErrorTask(errorMessage || '视频生成失败，请检查提示词或稍后重试');
      }
    },
  });

  const handleExecute = useCallback(async () => {
    if (!prompt.trim()) return;

    // 图生视频需要至少一张参考图
    if (isImageToVideoMode && (!inputImages || inputImages.length === 0)) {
      console.error('图生视频模式但没有参考图片');
      return;
    }

    // 立即重置并显示进度条（确保每次点击运行都能看到进度条，包括从 ERROR 状态重新生成）
    // 无论之前是什么状态，都重置为初始进度
    if (onProgressChange) {
      onProgressChange(1); // 设置为 1% 以显示进度条
    }
    
    // 强制重置状态：清除错误信息，重置进度条，确保 UI 能够正确显示新的进度
    console.log('[VideoInputPanel] 开始新的视频生成，强制重置所有状态');
    
    // 清除错误信息（通过 onProgressChange 和 onProgressMessageChange 回调）
    // 注意：这里需要通过 Workspace 的 handleVideoNodeDataChange 来清除 errorMessage
    // 但由于我们没有直接访问，我们通过设置 progress > 0 来触发进度条显示
    // 实际的 errorMessage 清除会在 executeAI 调用后通过 START 状态处理
    
    // 设置初始进度（1%），确保显示进度条
    if (onProgressChange) {
      onProgressChange(1);
    }
    if (onProgressMessageChange) {
      onProgressMessageChange('正在初始化...');
    }

    try {
      // 前端只负责"传地址"，不做任何处理
      // 本地图片路径（local-resource:// 或 file://）直接发送给后端
      // 由后端的 VideoProvider.ts 接收到地址后，触发 uploadImageToOSS 方法进行转运
      // 后端转运成功拿到 https URL 后，再由后端发起请求给 RunningHub
      console.log('[VideoInputPanel] 准备发送图片路径给后端处理:', inputImages);

      const payload: any = {
        prompt,
        model,
        aspect_ratio: aspectRatio,
      };

      // sora-2 系列参数
      if (model === 'sora-2' || model === 'sora-2-pro') {
        payload.hd = hd;
        payload.duration = duration;
      }

      // 全能视频V3.1-fast / Veo3.1 Pro 文生视频参数（分辨率 720p/1080p/4k）
      if (isRhartV31FastModel || isRhartV31ProModel) {
        payload.resolutionRhartV31 = resolutionRhartV31;
      }

      // kling-v2.6-pro 系列参数
      if (isKlingModel) {
        payload.duration = duration;
        if (guidanceScale !== undefined) {
          payload.guidanceScale = guidanceScale;
        }
        if (sound) {
          payload.sound = sound;
        }
      }

      // 万相2.6 文生/图生视频参数
      if (isWan26Model) {
        payload.duration = duration;
        payload.shotType = shotType;
        if (negativePrompt !== undefined && negativePrompt.trim() !== '') {
          payload.negativePrompt = negativePrompt.trim();
        }
        if (isImageToVideoMode) {
          payload.resolutionWan26 = resolutionWan26;
        }
      }

      // 海螺-02/2.3 文生、海螺-02/2.3 图生视频标准参数（时长 6|10 秒）
      if (isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) {
        payload.durationHailuo02 = durationHailuo02;
      }

      // 可灵文生/图生/首尾帧/参考生视频o1 参数（时长 5|10 秒，模式 std|pro）
      if (isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isKlingVideoO1RefModel) {
        payload.durationKlingO1 = durationKlingO1;
        payload.modeKlingO1 = modeKlingO1;
      }
      if (isKlingVideoO1RefModel) {
        payload.referenceVideoUrl = (referenceVideoUrl || '').trim();
        if (keepOriginalSound) payload.keepOriginalSound = true;
      }

      // 万相2.6 Flash 图生视频参数（仅图生，时长 2-15 秒）
      if (isWan26FlashModel) {
        payload.durationWan26Flash = durationWan26Flash;
        payload.shotType = shotType;
        payload.resolutionWan26 = resolutionWan26;
        if (negativePrompt !== undefined && negativePrompt.trim() !== '') {
          payload.negativePrompt = negativePrompt.trim();
        }
        payload.enableAudio = enableAudio;
      }

      // 直接传递原始图片路径给后端，不做任何前端处理
      // 后端会检测本地路径并自动上传到 OSS
      if (isImageToVideoMode && inputImages.length > 0) {
        payload.images = inputImages.slice(0, 10);
      }

      // 传递 projectId 以便保存到项目文件夹
      if (projectId) {
        payload.projectId = projectId;
      }

      // 调试日志：发送最终请求前，打印所有图片路径（可能包含本地路径）
      if (isImageToVideoMode && payload.images && payload.images.length > 0) {
        console.log('[VideoInputPanel] 发送图片路径给后端处理:');
        payload.images.forEach((url: string, index: number) => {
          console.log(`  [${index}] Image Path:`, url);
          // 注意：现在允许本地路径（local-resource:// 或 file://），由后端处理
        });
      }

      await executeAI(payload);
    } catch (error: any) {
      console.error('视频生成失败:', error);
      // 传递错误给 onErrorTask
      if (onErrorTask) {
        onErrorTask(error.message || '视频生成失败，请检查提示词或稍后重试');
      }
    }
  }, [prompt, model, aspectRatio, hd, duration, inputImages, executeAI, isImageToVideoMode, isKlingModel, isKlingVideoO1Model, isKlingVideoO1I2vModel, isKlingVideoO1StartEndModel, isKlingVideoO1RefModel, referenceVideoUrl, keepOriginalSound, isWan26Model, isWan26FlashModel, isRhartV31FastModel, isHailuo02Model, isHailuo23Model, isHailuo02I2vModel, isHailuo23I2vModel, guidanceScale, sound, shotType, negativePrompt, resolutionWan26, resolutionRhartV31, durationWan26Flash, durationHailuo02, durationKlingO1, modeKlingO1, enableAudio, projectId, onErrorTask]);

  // 清理超时定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      startTimeRef.current = null;
    };
  }, []);

  // 按钮禁用逻辑：只基于当前模块自己的状态
  const isRunDisabled =
    aiStatus === 'PROCESSING' ||
    !prompt.trim() ||
    (isImageToVideoMode && (!inputImages || inputImages.length === 0)) ||
    (isKlingVideoO1RefModel && !(referenceVideoUrl || '').trim());
  
  // 调试日志：确认每个模块的状态是独立的
  useEffect(() => {
    console.log(`[VideoInputPanel ${nodeId}] aiStatus: ${aiStatus}, isRunDisabled: ${isRunDisabled}`);
  }, [nodeId, aiStatus, isRunDisabled]);

  return (
    <div
      className={`${
        isDarkMode 
          ? 'bg-[#1C1C1E]' 
          : 'bg-gray-200/90 backdrop-blur-md'
      } rounded-2xl border-2 border-green-500 p-3 transform transition-all duration-300 ease-out h-full flex flex-col overflow-hidden`}
      style={!isDarkMode ? {
        background: 'rgba(229, 231, 235, 0.9)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
      } : {}}
    >
      {/* 顶部控制栏 */}
      <div
        className={`flex items-center justify-between px-2 py-1.5 border-b flex-shrink-0 gap-2 ${
          isDarkMode ? 'border-gray-700/50' : 'border-gray-300/50'
        }`}
      >
        {/* 左侧：参数 */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`text-xs ${
              isDarkMode ? 'text-white/70' : 'text-gray-700'
            } truncate`}
          >
            模型:
          </span>
          <select
            value={model}
            onChange={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const newModel = e.target.value as 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'wan-2.6' | 'wan-2.6-flash' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'rhart-video-g';
              console.log('[VideoInputPanel] 模型切换:', newModel, '当前模型:', model, 'nodeId:', nodeId);
              
              // 如果模型没有变化，直接返回
              if (newModel === model) {
                console.log('[VideoInputPanel] 模型未变化，跳过更新');
                return;
              }
              
              // 立即调用 onModelChange（这会触发父组件更新状态）
              // 使用 requestAnimationFrame 确保 UI 立即更新
              requestAnimationFrame(() => {
                onModelChange(newModel);
              });
              
              // 切换模型时自动设置默认值
              if (newModel === 'kling-v2.6-pro') {
                // kling 系列默认值
                if (onDurationChange) {
                  onDurationChange('10');
                }
              } else if (newModel === 'wan-2.6') {
                if (onDurationChange) onDurationChange('5');
                if (onShotTypeChange) onShotTypeChange('single');
                if (onResolutionWan26Change) onResolutionWan26Change('1080p');
              } else if (newModel === 'wan-2.6-flash') {
                if (onDurationWan26FlashChange) onDurationWan26FlashChange('5');
                if (onShotTypeChange) onShotTypeChange('single');
                if (onResolutionWan26Change) onResolutionWan26Change('1080p');
                if (onEnableAudioChange) onEnableAudioChange(true);
              } else if (newModel === 'rhart-v3.1-fast' || newModel === 'rhart-v3.1-fast-se' || newModel === 'rhart-v3.1-pro-se') {
                if (onResolutionRhartV31Change) onResolutionRhartV31Change('1080p');
                if (onAspectRatioChange) onAspectRatioChange('16:9');
              } else if (newModel === 'rhart-video-g') {
                if (onAspectRatioChange) onAspectRatioChange('2:3');
                if (onDurationRhartVideoGChange) onDurationRhartVideoGChange('6s');
              } else if (newModel === 'rhart-v3.1-pro') {
                if (onAspectRatioChange) onAspectRatioChange('16:9');
                if (onResolutionRhartV31Change) onResolutionRhartV31Change('1080p');
              } else {
                // sora-2 系列默认值
                if (isSora2Model) {
                  // sora-2 使用 runninghub-api，只支持 duration: [10, 15], aspectRatio: [9:16, 16:9]
                  if (onDurationChange) {
                    onDurationChange('10');
                  }
                  if (onAspectRatioChange) {
                    onAspectRatioChange('16:9');
                  }
                } else {
                  // sora-2-pro 默认值
                  if (onHdChange) {
                    onHdChange(false);
                  }
                  if (onDurationChange) {
                    onDurationChange('10');
                  }
                }
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            className={`px-2 py-1 rounded-lg text-xs ${
              isDarkMode
                ? 'bg-black/30 text-white border border-gray-600/50'
                : 'bg-white/90 text-gray-900 border border-gray-300'
            } outline-none`}
            title="选择模型"
          >
            {isImageToVideoMode ? (
              imageCount >= 3 ? (
                // 3 张图：仅全能V3.1-fast（Grok 1.5 图生仅支持 1 张）
                <>
                  <option value="rhart-v3.1-fast">Veo 3.1 fast</option>
                </>
              ) : imageCount >= 2 ? (
                // 2 张图：仅首尾帧模型（已去除 Veo 3.1 fast、Grok 1.5）
                <>
                  <option value="rhart-v3.1-fast-se">Veo3.1 fast (首尾帧)</option>
                  <option value="rhart-v3.1-pro-se">Veo3.1 Pro (首尾帧)</option>
                  <option value="hailuo-02-i2v-standard">海螺 02 (首尾帧)</option>
                  <option value="kling-video-o1-start-end">可灵O1 (首尾帧)</option>
                </>
              ) : (
                <>
                  <option value="sora-2">Sora2</option>
                  <option value="rhart-video-s-i2v-pro">Sora2 Pro</option>
                  <option value="kling-v2.6-pro">可灵2.6 Pro</option>
                  <option value="wan-2.6">万相 2.6</option>
                  <option value="wan-2.6-flash">万相 2.6 flash</option>
                  <option value="rhart-v3.1-fast">Veo 3.1 fast</option>
                  <option value="rhart-video-g" title="仅支持 1 张图">Grok 1.5（仅1张图）</option>
                  <option value="hailuo-02-i2v-standard">海螺 02 (标准)</option>
                  <option value="hailuo-2.3-i2v-standard">海螺 2.3 (标准)</option>
                  <option value="kling-video-o1-i2v">可灵 O1</option>
                </>
              )
            ) : (
              <>
                <option value="sora-2">Sora2</option>
                <option value="sora-2-pro">Sora2 Pro</option>
                <option value="kling-v2.6-pro">可灵2.6 Pro</option>
                <option value="wan-2.6">万相 2.6</option>
                <option value="rhart-v3.1-fast">Veo3.1 fast</option>
                <option value="rhart-v3.1-pro">Veo3.1 Pro</option>
                <option value="rhart-video-g">Grok</option>
                <option value="hailuo-02-t2v-standard">海螺 02 (标准)</option>
                <option value="hailuo-2.3-t2v-standard">海螺 2.3 (标准)</option>
                <option value="kling-video-o1">可灵O1</option>
              </>
            )}
          </select>

          <span
            className={`text-xs ${
              isDarkMode ? 'text-white/70' : 'text-gray-700'
            }`}
          >
            比例:
          </span>
            <select
            value={aspectRatio}
            onChange={(e) => onAspectRatioChange(e.target.value as '16:9' | '9:16' | '1:1' | '2:3' | '3:2')}
            className={`px-2 py-1 rounded-lg text-xs ${
              isDarkMode
                ? 'bg-black/30 text-white border border-gray-600/50'
                : 'bg-white/90 text-gray-900 border border-gray-300'
            } outline-none`}
            title="选择输出比例"
          >
            {isRhartVideoGModel ? (
              <>
                <option value="2:3">2:3</option>
                <option value="3:2">3:2</option>
                <option value="1:1">1:1 方形</option>
              </>
            ) : (
              <>
                <option value="16:9">16:9 横屏</option>
                <option value="9:16">9:16 竖屏</option>
                {(isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isKlingVideoO1RefModel) && <option value="1:1">1:1 方形</option>}
              </>
            )}
          </select>

          {/* 全能视频G：时长 6s/10s（仅图生，固定 720P） */}
          {isRhartVideoGModel && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>时长:</span>
              <select
                value={durationRhartVideoG}
                onChange={(e) => onDurationRhartVideoGChange?.(e.target.value as '6s' | '10s')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="全能视频G 时长"
              >
                <option value="6s">6s</option>
                <option value="10s">10s</option>
              </select>
            </>
          )}

          {/* 海螺-02/2.3 文生、海螺-02 图生视频标准：时长 6/10 秒 */}
          {(isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>时长:</span>
              <select
                value={durationHailuo02}
                onChange={(e) => onDurationHailuo02Change?.(e.target.value as '6' | '10')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="海螺-02 时长"
              >
                <option value="6">6s</option>
                <option value="10">10s</option>
              </select>
            </>
          )}

          {/* 可灵文生视频o1：时长 5/10 秒，模式 std/pro */}
          {/* 可灵文生/图生/首尾帧/参考生视频o1：时长 5/10 秒，模式 std/pro */}
          {(isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isKlingVideoO1RefModel) && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>时长:</span>
              <select
                value={durationKlingO1}
                onChange={(e) => onDurationKlingO1Change?.(e.target.value as '5' | '10')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="可灵o1 时长"
              >
                <option value="5">5s</option>
                <option value="10">10s</option>
              </select>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>模式:</span>
              <select
                value={modeKlingO1}
                onChange={(e) => onModeKlingO1Change?.(e.target.value as 'std' | 'pro')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="可灵o1 模式"
              >
                <option value="std">std</option>
                <option value="pro">pro</option>
              </select>
              {isKlingVideoO1RefModel && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keepOriginalSound}
                    onChange={(e) => onKeepOriginalSoundChange?.(e.target.checked)}
                    className="rounded border-gray-500"
                  />
                  <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>保留参考视频原声</span>
                </label>
              )}
            </>
          )}

          {/* 全能视频V3.1-fast / V3.1-pro 首尾帧 / Veo3.1 Pro 文生：分辨率 720p/1080p/4k（比例仅 16:9/9:16）；Pro 文生/首尾帧固定 8s */}
          {(isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProSEModel || isRhartV31ProModel) && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>分辨率:</span>
              <select
                value={resolutionRhartV31}
                onChange={(e) => onResolutionRhartV31Change?.(e.target.value as '720p' | '1080p' | '4k')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="输出分辨率"
                aria-label="分辨率"
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4k</option>
              </select>
              {(isRhartV31ProModel || isRhartV31ProSEModel) && (
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>时长: 8s</span>
              )}
            </>
          )}

          {/* sora-2、kling、万相2.6：显示时长选项（Veo3.1 Pro 文生固定 8s，不显示此项） */}
          {!isWan26FlashModel && !isRhartV31FastModel && !isRhartVideoGModel && !isHailuo02Model && !isHailuo23Model && !isHailuo02I2vModel && !isHailuo23I2vModel && !isKlingVideoO1Model && !isKlingVideoO1I2vModel && !isKlingVideoO1StartEndModel && !isKlingVideoO1RefModel && !isRhartV31ProSEModel && !isRhartV31ProModel && (
            <>
              <span
                className={`text-xs ${
                  isDarkMode ? 'text-white/70' : 'text-gray-700'
                }`}
              >
                时长:
              </span>
              <select
                value={(isRhartVideoSI2vProModel || isSora2ProModel) ? (duration === '25' ? '25' : '15') : duration}
                onChange={(e) => onDurationChange(e.target.value as '5' | '10' | '15' | '25')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode
                    ? 'bg-black/30 text-white border border-gray-600/50'
                    : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="选择视频时长"
              >
                {(isKlingModel || isWan26Model) && !isRhartVideoSI2vProModel && !isSora2ProModel && <option value="5">5s</option>}
                {(isRhartVideoSI2vProModel || isSora2ProModel) ? (
                  <>
                    <option value="15">15s</option>
                    <option value="25">25s</option>
                  </>
                ) : isSora2Model ? (
                  <>
                    <option value="10">10s</option>
                    <option value="15">15s</option>
                  </>
                ) : (
                  <>
                    <option value="10">10s</option>
                    {!isKlingModel && (
                      <>
                        <option value="15">15s</option>
                      </>
                    )}
                  </>
                )}
              </select>

            </>
          )}

          {/* 万相2.6：镜头类型 + 图生视频时显示分辨率 */}
          {isWan26Model && (
            <>
              <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>镜头:</span>
              <select
                value={shotType}
                onChange={(e) => onShotTypeChange?.(e.target.value as 'single' | 'multi')}
                className={`px-2 py-1 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                } outline-none`}
                title="单镜头 / 多镜头"
              >
                <option value="single">单镜头</option>
                <option value="multi">多镜头</option>
              </select>
              {isImageToVideoMode && (
                <>
                  <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>分辨率:</span>
                  <select
                    value={resolutionWan26}
                    onChange={(e) => onResolutionWan26Change?.(e.target.value as '720p' | '1080p')}
                    className={`px-2 py-1 rounded-lg text-xs ${
                      isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                    } outline-none`}
                    title="图生视频输出分辨率"
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </>
              )}
            </>
          )}

          {/* 万相2.6 Flash 图生视频：第一行 时长、镜头、分辨率；第二行 生成音频 */}
          {isWan26FlashModel && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>时长:</span>
                <select
                  value={durationWan26Flash}
                  onChange={(e) => onDurationWan26FlashChange?.(e.target.value as '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15')}
                  className={`px-2 py-1 rounded-lg text-xs ${
                    isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                  } outline-none`}
                  title="2-15 秒"
                >
                  {([2,3,4,5,6,7,8,9,10,11,12,13,14,15] as const).map((n) => (
                    <option key={n} value={String(n)}>{n}s</option>
                  ))}
                </select>
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>镜头:</span>
                <select
                  value={shotType}
                  onChange={(e) => onShotTypeChange?.(e.target.value as 'single' | 'multi')}
                  className={`px-2 py-1 rounded-lg text-xs ${
                    isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                  } outline-none`}
                  title="单镜头 / 多镜头"
                  aria-label="镜头类型"
                >
                  <option value="single">单镜头</option>
                  <option value="multi">多镜头</option>
                </select>
                <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-700'}`}>分辨率:</span>
                <select
                  value={resolutionWan26}
                  onChange={(e) => onResolutionWan26Change?.(e.target.value as '720p' | '1080p')}
                  className={`px-2 py-1 rounded-lg text-xs ${
                    isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
                  } outline-none`}
                  title="输出分辨率"
                  aria-label="分辨率"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
              <div className="flex items-center">
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableAudio}
                    onChange={(e) => onEnableAudioChange?.(e.target.checked)}
                    className="rounded border-gray-400"
                    title="生成带音频的视频"
                  />
                  <span className={isDarkMode ? 'text-white/70' : 'text-gray-700'}>生成音频</span>
                </label>
              </div>
            </div>
          )}

          {/* kling-v2.6-pro 系列：显示额外参数 */}
          {isKlingModel && (
            <>
              <span
                className={`text-xs ${
                  isDarkMode ? 'text-white/70' : 'text-gray-700'
                }`}
              >
                自由度:
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={guidanceScale}
                  onChange={(e) => onGuidanceScaleChange?.(parseFloat(e.target.value))}
                  className="w-24"
                  title="生成视频的自由度，值越大与提示词相关性越强"
                />
                <span
                  className={`text-xs w-8 ${
                    isDarkMode ? 'text-white/70' : 'text-gray-700'
                  }`}
                >
                  {guidanceScale.toFixed(1)}
                </span>
              </div>

              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={sound === 'true'}
                  onChange={(e) => onSoundChange?.(e.target.checked ? 'true' : 'false')}
                  className="rounded border-gray-400"
                  title="生成视频时是否同时生成声音"
                />
                <span
                  className={`${
                    isDarkMode ? 'text-white/70' : 'text-gray-700'
                  }`}
                >
                  声音
                </span>
              </label>
            </>
          )}

        </div>

        {/* 右侧：运行按钮（图生视频时显示最多 N 张，以及价格） */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isImageToVideoMode && inputImages && inputImages.length > 0 && (
            <span
              className={`text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`}
              title={`当前模型最多支持 ${maxRefImagesVideo} 张参考图`}
            >
              最多 {maxRefImagesVideo} 张
            </span>
          )}
          {videoPrice !== null && (
            <span
              className={`text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`}
              title="单次生成预估价格"
            >
              ¥{videoPrice.toFixed(2)}/次
            </span>
          )}

          <button
            onClick={handleExecute}
            disabled={isRunDisabled}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all duration-200 ${
              isRunDisabled
                ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
                : aiStatus === 'PROCESSING'
                  ? isImageToVideoMode
                    ? 'bg-purple-500 text-white'
                    : 'bg-blue-500 text-white'
                  : isImageToVideoMode
                    ? 'bg-purple-500 text-white hover:bg-purple-600 shadow-md shadow-purple-500/30'
                    : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md shadow-blue-500/30'
            }`}
            title={modeLabel}
          >
            {aiStatus === 'PROCESSING' ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {modeLabel}
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                {modeLabel}
              </>
            )}
          </button>
        </div>
      </div>

      {/* 提示词输入区 */}
      <div className="p-3 flex-1 min-h-0 flex flex-col">
        <div className="mb-2 flex-shrink-0">
          <label
            className={`text-xs font-medium ${
              isDarkMode ? 'text-white/80' : 'text-gray-900'
            }`}
          >
            提示词（视频描述）
          </label>
        </div>
        <div className="flex-1 min-h-0">
          <textarea
            ref={promptInputRef}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            className={`w-full h-full resize-none rounded-xl px-3 py-2 text-xs custom-scrollbar ${
              isDarkMode
                ? 'bg-black/40 text-white border border-gray-700/70 placeholder:text-white/30'
                : 'bg-white text-gray-900 border border-gray-300 placeholder:text-gray-400'
            } outline-none`}
            placeholder="请输入视频提示词，例如：一只小狗在草地上奔跑，镜头缓慢移动，电影级灯光..."
          />
        </div>
      </div>
    </div>
  );
};

export default VideoInputPanel;

