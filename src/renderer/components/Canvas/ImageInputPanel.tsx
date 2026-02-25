import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Play, ChevronDown } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { getImagePrice } from '../../utils/priceCalc';

interface ImageInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  prompt: string;
  resolution: string;
  aspectRatio: string;
  model: string;
  /** seedream-v4.5 专用：宽（1024-4096） */
  seedreamWidth?: number;
  /** seedream-v4.5 专用：高（1024-4096） */
  seedreamHeight?: number;
  inputImages?: string[]; // 输入的参考图数组（最多10张）
  isConnected?: boolean; // 是否有输入连线（从父组件传递）
  projectId?: string; // 项目ID，用于资源保存
  onStart?: () => void; // 任务开始时的回调
  onErrorTask?: (message: string) => void; // 任务失败时的回调（用于任务列表）
  onPromptChange: (value: string) => void;
  onResolutionChange: (value: string) => void;
  onAspectRatioChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSeedreamWidthChange?: (value: number) => void;
  onSeedreamHeightChange?: (value: number) => void;
  onOutputImageChange: (imageUrl: string) => void;
  onProgressChange?: (progress: number) => void;
  onProgressMessageChange?: (message: string) => void; // 进度文案更新回调
}

// seedream-v4.5 比例与宽高映射（比例选择后固定宽高）
const SEEDREAM_RATIO_MAP: Record<string, { width: number; height: number }> = {
  '1:1': { width: 2048, height: 2048 },
  '2:3': { width: 1664, height: 2496 },
  '3:2': { width: 2496, height: 1664 },
  '3:4': { width: 1728, height: 2304 },
  '4:3': { width: 2304, height: 1728 },
  '9:16': { width: 1440, height: 2560 },
  '16:9': { width: 2560, height: 1440 },
  '21:9': { width: 3024, height: 1296 },
};
const SEEDREAM_RATIO_OPTIONS = [
  { value: '1:1', label: '1:1 (正方形 2048×2048)' },
  { value: '2:3', label: '2:3 (纵向 1664×2496)' },
  { value: '3:2', label: '3:2 (横向 2496×1664)' },
  { value: '3:4', label: '3:4 (纵向 1728×2304)' },
  { value: '4:3', label: '4:3 (横向 2304×1728)' },
  { value: '9:16', label: '9:16 (纵向 1440×2560)' },
  { value: '16:9', label: '16:9 (横向 2560×1440)' },
  { value: '21:9', label: '21:9 (超宽屏 3024×1296)' },
];

/** 提示词标签：点击填入对应文案，颜色用于区分 */
const PROMPT_TAGS: { label: string; text: string; color: string }[] = [
  { label: '多机位九宫格', text: 'A character sheet of [Subject], 9-grid split screen, different angles including front view, side view, back view, and close-up, cinematic lighting, high detail', color: 'bg-emerald-500/90 hover:bg-emerald-500 text-white border-emerald-400/50' },
  { label: '电影级光影校正', text: '[Subject], cinematic lighting, masterpiece, volumetric fog, realistic shadows, anamorphic lens flares, high contrast, 8k resolution, shot on 35mm lens.', color: 'bg-violet-500/90 hover:bg-violet-500 text-white border-violet-400/50' },
  { label: '角色三视图', text: 'Character design of [Subject], three-view drawing (front, side, back), orthographic view, standing pose, neutral expression, plain grey background, professional concept art.', color: 'bg-amber-500/90 hover:bg-amber-500 text-white border-amber-400/50' },
  { label: '画面推演 - 5秒前', text: 'Reverse motion of [Current Scene], showing the origin of the explosion, the precursor to the action.', color: 'bg-rose-500/90 hover:bg-rose-500 text-white border-rose-400/50' },
  { label: '画面推演 - 3秒后', text: '[Current Scene], the action continues, [Subject] moving towards the camera, smoke expanding.', color: 'bg-sky-500/90 hover:bg-sky-500 text-white border-sky-400/50' },
];
/** 图像放大下拉选项 */
const ENLARGE_OPTIONS = ['放大第一张图', '放大第二张图', '放大第三张图', '放大第四张图'];

const ImageInputPanel: React.FC<ImageInputPanelProps> = ({
  nodeId,
  isDarkMode,
  prompt,
  resolution,
  aspectRatio,
  model,
  seedreamWidth = 2048,
  seedreamHeight = 2048,
  inputImages = [],
  isConnected = false, // 从父组件传递连线状态
  projectId,
  onStart,
  onErrorTask,
  onPromptChange,
  onResolutionChange,
  onAspectRatioChange,
  onModelChange,
  onSeedreamWidthChange,
  onSeedreamHeightChange,
  onOutputImageChange,
  onProgressChange,
  onProgressMessageChange,
}) => {
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const [enlargeDropdownOpen, setEnlargeDropdownOpen] = useState(false);

  /** 将文案填入提示词（追加，已有内容前加空格） */
  const appendToPrompt = useCallback((text: string) => {
    const sep = prompt.trim() ? ', ' : '';
    onPromptChange(prompt + sep + text);
    promptInputRef.current?.focus();
  }, [prompt, onPromptChange]);

  // 模型选项
  const allModelOptions = [
    { value: 'nano-banana-2', label: 'Nano banana Pro 1K' },
    { value: 'nano-banana-2-2k', label: 'Nano banana Pro 2K' },
    { value: 'nano-banana-2-4k', label: 'Nano banana Pro 4K' },
    { value: 'youchuan-text-to-image-v7', label: 'Midjourney v7' },
    { value: 'rhart-image-g-1.5', label: 'Grok 1.5' },
    { value: 'seedream-v4.5', label: 'Seedream 4.5' },
  ];
  
  // 根据模式过滤模型选项
  // 只有当有输入图片（inputImages.length > 0）时才切换到图生图模式
  const isImageToImageMode = inputImages && inputImages.length > 0;

  /** 图生图模式下各模型最大参考图数量（与 ImageProvider 一致） */
  const getMaxRefImages = (m: string): number => {
    if (m === 'rhart-image-g-1.5') return 2;
    if (m === 'seedream-v4.5') return 10;
    return 5; // nano-banana 系列 / 全能图片PRO
  };
  const maxRefImages = getMaxRefImages(model);
  const imagePrice = getImagePrice({ model, resolution });

  // 图生图模式下：排除仅文生图模型（文悠船文生图-v7），其余部分显示为「xxx-图生图」
  const modelOptions = isImageToImageMode
    ? allModelOptions
        .filter((opt) => opt.value !== 'youchuan-text-to-image-v7')
        .map((opt) => {
          if (opt.value === 'rhart-image-g-1.5') return { ...opt, label: 'Grok 1.5' };
          if (opt.value === 'seedream-v4.5') return { ...opt, label: 'Seedream 4.5' };
          return opt;
        })
    : allModelOptions;

  // 图生图模式下若当前为仅文生图模型（文悠船），自动切到第一个可用图生图模型
  useEffect(() => {
    if (isImageToImageMode && model === 'youchuan-text-to-image-v7' && modelOptions.length > 0) {
      onModelChange?.(modelOptions[0].value);
    }
  }, [isImageToImageMode, model, modelOptions, onModelChange]);

  // 比例选项（根据 API 文档）
  const aspectRatioOptions = [
    { value: '1:1', label: '1:1 (正方形)' },
    { value: '2:3', label: '2:3 (纵向)' },
    { value: '3:2', label: '3:2 (横向)' },
    { value: '3:4', label: '3:4 (纵向)' },
    { value: '4:3', label: '4:3 (横向)' },
    { value: '4:5', label: '4:5 (纵向)' },
    { value: '5:4', label: '5:4 (横向)' },
    { value: '9:16', label: '9:16 (纵向)' },
    { value: '16:9', label: '16:9 (横向)' },
    { value: '21:9', label: '21:9 (超宽屏)' },
  ];

  const isSeedreamV45 = model === 'seedream-v4.5';
  // 全能图片G-1.5 仅支持 auto / 1:1 / 3:2 / 2:3
  const isRhartImageG15 = model === 'rhart-image-g-1.5';
  const aspectRatioOptionsG15 = [
    { value: 'auto', label: 'auto (自动)' },
    { value: '1:1', label: '1:1 (正方形)' },
    { value: '3:2', label: '3:2 (横向)' },
    { value: '2:3', label: '2:3 (纵向)' },
  ];
  const effectiveAspectRatioOptions = isSeedreamV45
    ? SEEDREAM_RATIO_OPTIONS
    : isRhartImageG15
      ? aspectRatioOptionsG15
      : aspectRatioOptions;

  // AI Hook
  const { status: aiStatus, execute: executeAI } = useAI({
    nodeId,
    modelId: 'image',
    onStatusUpdate: (packet) => {
      // 处理进度更新
      if (packet.status === 'START') {
        if (onProgressChange) {
          onProgressChange(1);
        }
        if (onProgressMessageChange) {
          onProgressMessageChange('正在初始化模型...');
        }
      } else if (packet.status === 'PROCESSING') {
        if (packet.payload?.progress !== undefined) {
          const progressValue = packet.payload.progress;
          const progressText = packet.payload.text || '正在生成图片...';
          
          // 移除进度百分比后缀（如果存在）
          const progressMessage = progressText.replace(/\s*\d+%$/, '').trim() || '正在生成图片...';
          console.log(`[ImageInputPanel] 图片生成进度: ${progressValue}%`);
          
          if (onProgressChange) {
            onProgressChange(progressValue);
          }
          if (onProgressMessageChange) {
            onProgressMessageChange(progressMessage);
          }
        }
      } else if (packet.status === 'SUCCESS') {
        // SUCCESS 状态：更新输出图片（优先使用 localPath）
        const localPath = packet.payload?.localPath;
        let imageUrl = packet.payload?.imageUrl;
        
        console.log('[ImageInputPanel] SUCCESS 状态，收到数据:', {
          localPath,
          imageUrl,
          payload: packet.payload,
        });
        
        if (localPath) {
          // 如果有本地路径，转换为 local-resource:// 格式
          // 注意：不要对整个路径编码，只对中文和空格部分编码，盘符的冒号必须保持原样
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
          
          imageUrl = `local-resource://${encodedPath}`;
          console.log('[ImageInputPanel] 使用本地路径:', localPath, '->', imageUrl);
        } else if (imageUrl && imageUrl.startsWith('local-resource://')) {
          // 如果 imageUrl 已经是 local-resource:// 格式，直接使用（协议处理器会自己处理解码）
          console.log('[ImageInputPanel] imageUrl 已经是 local-resource:// 格式:', imageUrl);
        } else if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
          // 如果是远程 URL，保持原样（后续会通过 autoSaveImage 下载到本地）
          console.log('[ImageInputPanel] 使用远程 URL:', imageUrl);
        }
        
        if (imageUrl) {
          // 先更新图片，然后清除进度（确保图片显示）
          console.log('[ImageInputPanel] 调用 onOutputImageChange:', imageUrl);
          onOutputImageChange(imageUrl);
        } else {
          console.warn('[ImageInputPanel] SUCCESS 状态但没有 imageUrl 或 localPath');
        }
        
        // 清除进度（在更新图片之后）
        if (onProgressChange) {
          onProgressChange(0);
        }
        if (onProgressMessageChange) {
          onProgressMessageChange('');
        }
      } else if (packet.status === 'ERROR') {
        // 清除进度
        if (onProgressChange) {
          onProgressChange(0);
        }
        if (onProgressMessageChange) {
          onProgressMessageChange('');
        }
      }
    },
    // 仅在完成时更新输出图片，避免任务列表重复记录
    onComplete: (result) => {
      // 优先使用 localPath（如果存在）
      const localPath = result?.localPath;
      let imageUrl = result?.imageUrl;
      
      if (localPath) {
        // 如果有本地路径，转换为 local-resource:// 格式
        let filePath = localPath.replace(/\\/g, '/');
        // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
        if (filePath.match(/^\/[a-zA-Z]:/)) {
          filePath = filePath.substring(1); // 移除开头的 /
        }
        imageUrl = `local-resource://${filePath}`;
        console.log('[ImageInputPanel] onComplete 使用本地路径:', localPath, '->', imageUrl);
      }
      
      if (imageUrl) {
        onOutputImageChange(imageUrl);
        // 图片生成完成后，ImageNode 会自动根据图片尺寸调整大小
      }
      // 清除进度
      if (onProgressChange) {
        onProgressChange(0);
      }
      if (onProgressMessageChange) {
        onProgressMessageChange('');
      }
    },
    onError: (error) => {
      console.error('图片生成失败:', error);
      
      // 清除进度
      if (onProgressChange) {
        onProgressChange(0);
      }
      if (onProgressMessageChange) {
        onProgressMessageChange('');
      }
      
      // 检测余额不足错误
      const errorMessage = typeof error === 'string' ? error : (error?.message || String(error));
      const isQuotaError = errorMessage.includes('quota is not enough') || 
                          errorMessage.includes('remain quota') ||
                          errorMessage.includes('余额不足');
      
      if (isQuotaError) {
        // 显示余额不足弹窗
        alert('余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。');
      }
      
      if (onErrorTask) {
        onErrorTask(error);
      }
    },
  });

  // 执行图片生成
  const handleExecute = useCallback(async () => {
    if (!prompt.trim()) {
      return;
    }

    // 强制验证：如果图生图模式但没有图片数据，报错
    // 注意：text/llm 连接到 image 时，isConnected 可能为 true，但 inputImages 为空，这是正常的文生图模式
    if (isImageToImageMode && (!inputImages || inputImages.length === 0)) {
      console.error("错误：图生图模式但无法获取源图片数据");
      return;
    }

    // 通知任务开始
    onStart?.();

    try {
      // 判断是否支持 image_size（仅 nano-banana-2-2k 和 nano-banana-2-4k 支持）
      const supportsImageSize = model === 'nano-banana-2-2k' || model === 'nano-banana-2-4k';
      
      // 从 resolution 解析 image_size（如果支持）
      let imageSize: '1K' | '2K' | '4K' | undefined;
      if (supportsImageSize) {
        // 根据 resolution 判断 image_size
        if (resolution.includes('512') || resolution.includes('768')) {
          imageSize = '1K';
        } else if (resolution.includes('1024')) {
          imageSize = '2K';
        } else if (resolution.includes('1792') || model === 'nano-banana-2-4k') {
          imageSize = '4K';
        }
      }

      // 默认文生图模式，只有当有输入图片时才使用图生图模式
      const requestParams: any = {
        model,
        prompt,
        response_format: 'url',
        aspect_ratio: aspectRatio,
        image_size: imageSize,
        resolution,
      };
      if (isSeedreamV45) {
        requestParams.seedreamWidth = seedreamWidth;
        requestParams.seedreamHeight = seedreamHeight;
      }

      // 图生图模式：如果有输入图片，添加 image 参数
      if (isImageToImageMode && inputImages && inputImages.length > 0) {
        // 限制最多10张参考图
        const imagesToUse = inputImages.slice(0, 10);
        requestParams.image = imagesToUse;
        console.log(`[图片生成] 图生图模式，使用 ${imagesToUse.length} 张参考图`);
      }

      // 添加项目ID用于资源保存
      if (projectId) {
        requestParams.projectId = projectId;
      }

      await executeAI(requestParams);
    } catch (error) {
      console.error('图片生成失败:', error);
    }
  }, [prompt, model, aspectRatio, resolution, seedreamWidth, seedreamHeight, inputImages, executeAI, isImageToImageMode, onStart, projectId, isSeedreamV45]);

  // 判断当前模式：根据输入图片数量自动切换（已在上面定义）
  // 图生图模式时，必须有图片数据才能运行
  // 按钮禁用逻辑：只基于当前模块自己的状态
  const isRunDisabled = aiStatus === 'PROCESSING' || !prompt.trim() || (isImageToImageMode && (!inputImages || inputImages.length === 0));
  
  // 调试日志：确认每个模块的状态是独立的
  useEffect(() => {
    console.log(`[ImageInputPanel ${nodeId}] aiStatus: ${aiStatus}, isRunDisabled: ${isRunDisabled}`);
  }, [nodeId, aiStatus, isRunDisabled]);

  return (
    <div 
      className={`${isDarkMode ? 'bg-[#1C1C1E]' : 'bg-gray-200/90 backdrop-blur-md'} rounded-2xl border-2 border-green-500 p-3 transform transition-all duration-300 ease-out h-full flex flex-col overflow-hidden`}
      style={!isDarkMode ? {
        background: 'rgba(229, 231, 235, 0.9)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
      } : {}}
    >
      {/* 顶部控制栏 */}
      <div className={`flex items-center justify-between px-2 py-1.5 border-b flex-shrink-0 gap-2 ${isDarkMode ? 'border-gray-700/50' : 'border-gray-300/50'}`}>
        {/* 左侧：模型选择和比例选择（紧挨着） */}
        <div className="flex items-center gap-1.5 flex-1">
          {/* 模型选择 */}
          <div className="flex items-center gap-1.5">
            <label className={`text-xs ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
              模型:
            </label>
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className={`px-2 py-1 rounded-lg text-xs ${
                isDarkMode 
                  ? 'bg-black/30 text-white border border-gray-600/50' 
                  : 'bg-white/90 text-gray-900 border border-gray-300'
              } outline-none`}
              title="选择模型"
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 比例选择（seedream-v4.5 使用固定 8 档比例→宽高映射，其他模型用通用比例） */}
          <div className="flex items-center gap-1.5">
            <label className={`text-xs ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
              比例:
            </label>
            <select
              value={effectiveAspectRatioOptions.some((o) => o.value === aspectRatio) ? aspectRatio : (isRhartImageG15 ? '2:3' : isSeedreamV45 ? '1:1' : '1:1')}
              onChange={(e) => {
                const ratio = e.target.value;
                onAspectRatioChange(ratio);
                if (isSeedreamV45 && SEEDREAM_RATIO_MAP[ratio]) {
                  const { width, height } = SEEDREAM_RATIO_MAP[ratio];
                  onSeedreamWidthChange?.(width);
                  onSeedreamHeightChange?.(height);
                }
              }}
              className={`px-2 py-1 rounded-lg text-xs ${
                isDarkMode 
                  ? 'bg-black/30 text-white border border-gray-600/50' 
                  : 'bg-white/90 text-gray-900 border border-gray-300'
              } outline-none`}
              title="选择比例"
            >
              {effectiveAspectRatioOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 右侧：模式按钮（自动切换文生图/图生图） */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 图生图模式下显示参考图数量与当前模型最大数量 */}
          {isImageToImageMode && inputImages && inputImages.length > 0 && (
            <>
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-white/80 bg-purple-500/20' : 'text-gray-700 bg-purple-100'
              }`}>
                参考图 {inputImages.length} 张
              </span>
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`} title={`当前模型最多支持 ${maxRefImages} 张参考图`}>
                最多 {maxRefImages} 张
              </span>
            </>
          )}
          {imagePrice !== null && (
            <span
              className={`text-xs font-medium px-2 py-1 rounded ${
                isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`}
              title="单次生成预估价格"
            >
              ¥{imagePrice.toFixed(2)}/次
            </span>
          )}
          {/* 模式按钮：根据输入状态自动切换文案和颜色 */}
          <button
            onClick={handleExecute}
            disabled={isRunDisabled}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all duration-200 ${
              isRunDisabled
                ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
                : aiStatus === 'PROCESSING'
                  ? isImageToImageMode
                    ? 'bg-purple-500 text-white'
                    : 'bg-blue-500 text-white'
                  : isImageToImageMode
                    ? 'bg-purple-500 text-white hover:bg-purple-600 shadow-md shadow-purple-500/30'
                    : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md shadow-blue-500/30'
            }`}
            title={isImageToImageMode ? `图生图模式（${inputImages.length}张参考图）` : '文生图模式'}
          >
            {aiStatus === 'PROCESSING' ? (
              <>
                <div className={`w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin`} />
                {isImageToImageMode ? '图生图' : '文生图'}
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                {isImageToImageMode ? '图生图' : '文生图'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* 提示词输入区域 */}
      <div className="p-3 flex-1 min-h-0 flex flex-col">
        <div className="mb-2 flex-shrink-0">
          <label className={`text-xs font-medium ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
            提示词
          </label>
        </div>
        {/* 提示词标签按钮：点击快速填入下方提示词 */}
        <div className="mb-2 flex flex-wrap gap-1.5 flex-shrink-0">
          <div className="relative">
            <button
              type="button"
              onClick={() => setEnlargeDropdownOpen((v) => !v)}
              className={`px-2 py-1 text-xs rounded border font-medium transition-colors bg-blue-500/90 hover:bg-blue-500 text-white border-blue-400/50 flex items-center gap-0.5 ${enlargeDropdownOpen ? 'ring-1 ring-blue-300' : ''}`}
              title="图像放大"
            >
              图像放大
              <ChevronDown className="w-3 h-3" />
            </button>
            {enlargeDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" aria-hidden onClick={() => setEnlargeDropdownOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-20 py-1 rounded border shadow-lg min-w-[120px] bg-[#1C1C1E] border-white/15">
                  {ENLARGE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        appendToPrompt(opt);
                        setEnlargeDropdownOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 text-white"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {PROMPT_TAGS.map((tag) => (
            <button
              key={tag.label}
              type="button"
              onClick={() => appendToPrompt(tag.text)}
              className={`px-2 py-1 text-xs rounded border font-medium transition-colors ${tag.color}`}
              title={tag.label}
            >
              {tag.label}
            </button>
          ))}
        </div>
        <textarea
          ref={promptInputRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          className={`w-full flex-1 custom-scrollbar bg-transparent resize-none outline-none text-sm rounded-lg p-2 border ${
            isDarkMode 
              ? 'text-white placeholder:text-white/40 border-gray-600/50' 
              : 'text-gray-900 placeholder:text-gray-500 border-gray-300/50'
          }`}
          placeholder="输入图片生成提示词..."
          style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
          title="提示词输入框"
        />
      </div>
    </div>
  );
};

export default ImageInputPanel;
