/**
 * Image Generation Provider - 图片生成
 * 文生图：使用 RunningHub 插件算力 API
 * 图生图：使用 BLTCY 核心算力 API
 */

import { BaseProvider } from '../BaseProvider.js';
import { AIExecuteParams } from '../types.js';
import { store } from '../../services/store.js';
import axios from 'axios';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { isLocalResourcePathAllowed } from '../../utils/projectFolderHelper.js';

interface ImageInput {
  model?: string;
  prompt: string;
  image?: string | string[]; // 图生图时使用
  negativePrompt?: string; // 文悠船等模型可选
  response_format?: 'url' | 'b64_json';
  aspect_ratio?: string;
  image_size?: '1K' | '2K' | '4K';
  n?: number;
  size?: string;
}

export class ImageProvider extends BaseProvider {
  readonly modelId = 'image';

  // RunningHub API 配置（文生图和图生图都使用插件算力）
  private readonly runningHubApiBaseUrl = 'https://www.runninghub.cn/openapi/v2';

  /**
   * 获取 RunningHub API Key（从 store 中读取）
   */
  private getRunningHubApiKey(): string {
    return (store.get('runningHubApiKey') as string) || '';
  }

  async execute(params: AIExecuteParams): Promise<void> {
    const { nodeId, input, onStatus } = params;

    // 解析输入参数
    const imageInput = input as ImageInput;
    
    // 文生图和图生图都使用 RunningHub API Key（插件算力）
    const runningHubApiKey = this.getRunningHubApiKey();
    
    if (!runningHubApiKey) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: {
          error: 'RunningHub API Key 未配置，请在设置中配置插件算力 API KEY',
        },
      });
      return;
    }

    // 创建统一模拟进度引擎
    const { createProgressEngine } = await import('../utils/ProgressHelper.js');
    const progressEngine = createProgressEngine('image', Date.now());
    
    // 启动进度更新循环（在 1.5 秒内冲到 95%）
    let progressInterval: NodeJS.Timeout | null = setInterval(() => {
      const currentProgress = progressEngine.getProgress();
      const progressMessage = progressEngine.getMessage();
      
      onStatus({
        nodeId,
        status: 'PROCESSING',
        payload: {
          progress: currentProgress,
          text: progressMessage, // 只显示轮播文字，不显示百分比
        },
      });
      
      // 如果达到最大进度，停止更新（等待实际结果）
      if (currentProgress >= 95) {
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
      }
    }, 100); // 每 100ms 更新一次

    // 清理进度更新的辅助函数
    const clearProgress = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    };

    try {
      // 解析输入参数（imageInput 已在上面定义）
      const { 
        model = 'nano-banana-2', 
        prompt, 
        aspect_ratio
      } = imageInput;

      if (!prompt) {
        throw new Error('提示词是必需的');
      }

      // 判断是文生图还是图生图
      // 默认优先文生图模式，只有当有输入图片时才切换到图生图模式
      const isImageToImage = !!imageInput.image && (Array.isArray(imageInput.image) ? imageInput.image.length > 0 : true);
      
      console.log(`[图片生成] 模式: ${isImageToImage ? '图生图' : '文生图'}, 模型: ${model}, 参考图数量: ${isImageToImage ? (Array.isArray(imageInput.image) ? imageInput.image.length : 1) : 0}`);

      // 全能图片G-1.5-图生图：https://www.runninghub.cn/openapi/v2/rhart-image-g-1.5/edit
      // 参数：prompt(必填 5-800字), imageUrls(必填 最多2张), aspectRatio(必填 auto|1:1|3:2|2:3)
      if (isImageToImage && imageInput.image && model === 'rhart-image-g-1.5') {
        const runningHubApiKey = this.getRunningHubApiKey();
        if (!runningHubApiKey) {
          throw new Error('RunningHub API Key 未配置，图生图需要插件算力 API KEY');
        }
        const imageArray = Array.isArray(imageInput.image) ? imageInput.image : [imageInput.image];
        if (imageArray.length < 1 || imageArray.length > 2) {
          throw new Error('全能图片G-1.5-图生图 支持 1 或 2 张参考图，当前提供了 ' + imageArray.length + ' 张');
        }
        const trimmedPrompt = (prompt || '').trim();
        if (trimmedPrompt.length < 5 || trimmedPrompt.length > 800) {
          throw new Error('全能图片G-1.5-图生图 提示词长度为 5-800 字');
        }
        const validAspectRatiosG15 = ['auto', '1:1', '3:2', '2:3'];
        const finalAspectRatio = aspect_ratio && validAspectRatiosG15.includes(aspect_ratio) ? aspect_ratio : '2:3';

        const imageUrlsG15: string[] = [];
        for (const imageUrl of imageArray.slice(0, 2)) {
          let finalImageUrl: string;
          if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            finalImageUrl = imageUrl;
          } else {
            let imageBuffer: Buffer;
            let mimeType = 'image/png';
            if (imageUrl.startsWith('local-resource://')) {
              let filePath = imageUrl.replace(/^local-resource:\/\//, '');
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) filePath = filePath.replace(/^[/\\]+/, '');
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              let normalizedFilePath = path.normalize(filePath);
              if (!path.isAbsolute(normalizedFilePath)) normalizedFilePath = path.resolve(userDataPath, normalizedFilePath);
              if (!isLocalResourcePathAllowed(normalizedFilePath)) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            } else if (imageUrl.startsWith('file://')) {
              let filePath = imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (!path.isAbsolute(filePath)) filePath = path.resolve(filePath);
              if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
              imageBuffer = fs.readFileSync(filePath);
              const ext = path.extname(filePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
            const { VideoProvider } = await import('./VideoProvider.js');
            const videoProvider = new VideoProvider();
            finalImageUrl = await videoProvider.uploadImageToOSS(imageBuffer, mimeType);
          }
          imageUrlsG15.push(finalImageUrl);
        }

        clearProgress();
        const submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-g-1.5/edit`;
        const submitPayload = { prompt: trimmedPrompt, imageUrls: imageUrlsG15, aspectRatio: finalAspectRatio };
        console.log(`[图片生成] 提交全能图片G-1.5-图生图，aspectRatio: ${finalAspectRatio}, 图片数: ${imageUrlsG15.length}`);

        const submitResponse = await axios.post(submitUrl, submitPayload, {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${runningHubApiKey}` },
          proxy: false,
          timeout: 30000,
        });
        if (submitResponse.status !== 200) throw new Error(`提交任务失败: ${submitResponse.status} ${submitResponse.statusText}`);
        const data = submitResponse.data;
        const taskId = data?.taskId || data?.task_id || data?.data?.taskId || data?.result?.taskId;
        if (!taskId) {
          const errMsg = data?.error || data?.errorMessage || data?.message || data?.msg;
          if (errMsg) throw new Error(`提交任务失败: ${errMsg}`);
          if (data?.code !== undefined && data?.code !== 0) {
            throw new Error(`提交任务失败: 错误码 ${data.code}，${data?.message || data?.msg || '请检查是否已激活并配置插件算力 API Key'}`);
          }
          throw new Error('提交任务失败：API 未返回任务 ID。请确认已激活软件并正确配置插件算力 API Key。');
        }

        const queryUrl = `${this.runningHubApiBaseUrl}/query`;
        let imageUrl: string | null = null;
        let pollingAttempts = 0;
        while (pollingAttempts < 120) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          try {
            const queryResponse = await axios.post(queryUrl, { taskId }, {
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${runningHubApiKey}` },
              proxy: false,
              timeout: 30000,
            });
            if (queryResponse.status !== 200) { pollingAttempts++; continue; }
            const queryResult = queryResponse.data;
            const status = queryResult.status;
            if (status === 'SUCCESS') {
              if (queryResult.results && queryResult.results.length > 0) {
                imageUrl = queryResult.results[0].url;
              }
              break;
            } else if (status === 'FAILED') {
              throw new Error(queryResult.errorMessage || '任务失败');
            }
          } catch (pollErr: any) {
            if (pollErr.message && pollErr.message !== '任务失败' && !pollErr.message.includes('任务失败')) throw pollErr;
            throw new Error(pollErr.message || '轮询失败');
          }
          pollingAttempts++;
        }

        if (!imageUrl) throw new Error('轮询超时或未获取到结果');
        clearProgress();
        onStatus({
          nodeId,
          status: 'SUCCESS',
          payload: { imageUrl, localPath: imageUrl, progress: 100 },
        });
        return;
      }

      // 图生图模式：使用 RunningHub API（插件算力）。文悠船仅文生图；全能图片G-1.5 图生图已在上方单独处理；seedream-v4.5 与全能图片PRO 共用下方 imageUrls 与轮询
      if (isImageToImage && imageInput.image && model !== 'youchuan-text-to-image-v7' && model !== 'rhart-image-g-1.5') {
        // 图生图模式使用 RunningHub API（全能图片PRO：/rhart-image-n-pro/edit；或 seedream-v4.5：/seedream-v4.5/image-to-image）
        const runningHubApiKey = this.getRunningHubApiKey();
        if (!runningHubApiKey) {
          throw new Error('RunningHub API Key 未配置，图生图需要插件算力 API KEY');
        }
        
        // 检查图片数量（全能图片PRO 最多5张；seedream-v4.5 最多10张）
        const imageArray = Array.isArray(imageInput.image) ? imageInput.image : [imageInput.image];
        const maxImagesAllowed = model === 'seedream-v4.5' ? 10 : 5;
        if (imageArray.length > maxImagesAllowed) {
          throw new Error(`连接已满：最多支持 ${maxImagesAllowed} 张参考图片`);
        }
        
        console.log(`[图片生成] 图生图模式，使用 RunningHub API，参考图数量: ${imageArray.length}`);
        
        // OSS 预处理阶段：将本地图片上传到 OSS 获取公网 URL
        const imageUrls: string[] = [];
        for (const imageUrl of imageArray) {
          try {
            let finalImageUrl: string;
            
            // 如果已经是 HTTP/HTTPS URL，直接使用
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              finalImageUrl = imageUrl;
              console.log(`[图片生成] 使用远程图片 URL: ${imageUrl}`);
            } else {
              // 本地图片需要先上传到 OSS 获取公网 URL
              console.log(`[图片生成] 检测到本地图片，开始 OSS 预处理: ${imageUrl}`);
              
              // 准备图片 Buffer
              let imageBuffer: Buffer;
              let mimeType = 'image/png';
              
              if (imageUrl.startsWith('local-resource://')) {
                // 解析 local-resource:// 协议路径
                let filePath = imageUrl.replace(/^local-resource:\/\//, '');
                filePath = decodeURIComponent(filePath);
                if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) filePath = filePath.replace(/^[/\\]+/, '');
                if (filePath.match(/^[a-zA-Z]\//)) {
                  filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                }
                const userDataPath = app.getPath('userData');
                let normalizedFilePath = path.normalize(filePath);
                if (!path.isAbsolute(normalizedFilePath)) {
                  normalizedFilePath = path.resolve(userDataPath, normalizedFilePath);
                }
                if (!isLocalResourcePathAllowed(normalizedFilePath)) {
                  throw new Error(`访问路径超出允许范围: ${normalizedFilePath}`);
                }
                
                // 检查文件是否存在（使用绝对路径）
                if (!fs.existsSync(normalizedFilePath)) {
                  throw new Error(`文件不存在: ${normalizedFilePath}`);
                }
                
                // 读取文件（使用 try-catch 捕获读取错误）
                try {
                  imageBuffer = fs.readFileSync(normalizedFilePath);
                  console.log(`[图片生成] 成功读取本地图片: ${normalizedFilePath}, 大小: ${imageBuffer.length} bytes`);
                } catch (readError: any) {
                  console.error(`[图片生成] 读取文件失败: ${normalizedFilePath}`, readError);
                  throw new Error(`读取文件失败: ${normalizedFilePath} - ${readError.message || readError}`);
                }
                
                const fileExt = path.extname(normalizedFilePath).toLowerCase();
                if (fileExt === '.jpg' || fileExt === '.jpeg') {
                  mimeType = 'image/jpeg';
                } else if (fileExt === '.png') {
                  mimeType = 'image/png';
                } else if (fileExt === '.webp') {
                  mimeType = 'image/webp';
                }
              } else if (imageUrl.startsWith('file://')) {
                let filePath = imageUrl.replace(/^file:\/\//, '');
                if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
                  filePath = filePath.substring(1);
                }
                filePath = decodeURIComponent(filePath);
                
                // 确保是绝对路径
                if (!path.isAbsolute(filePath)) {
                  filePath = path.resolve(filePath);
                }
                
                // 检查文件是否存在
                if (!fs.existsSync(filePath)) {
                  throw new Error(`文件不存在: ${filePath}`);
                }
                
                // 读取文件（使用 try-catch 捕获读取错误）
                try {
                  imageBuffer = fs.readFileSync(filePath);
                  console.log(`[图片生成] 成功读取文件图片: ${filePath}, 大小: ${imageBuffer.length} bytes`);
                } catch (readError: any) {
                  console.error(`[图片生成] 读取文件失败: ${filePath}`, readError);
                  throw new Error(`读取文件失败: ${filePath} - ${readError.message || readError}`);
                }
                
                const fileExt = path.extname(filePath).toLowerCase();
                if (fileExt === '.jpg' || fileExt === '.jpeg') {
                  mimeType = 'image/jpeg';
                } else if (fileExt === '.png') {
                  mimeType = 'image/png';
                } else if (fileExt === '.webp') {
                  mimeType = 'image/webp';
                }
              } else if (imageUrl.startsWith('data:')) {
                // Base64 data URL
                const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
                if (!base64Match) {
                  throw new Error('无效的 data URL 格式');
                }
                const [, imageType, base64Data] = base64Match;
                mimeType = `image/${imageType}`;
                
                try {
                  imageBuffer = Buffer.from(base64Data, 'base64');
                  console.log(`[图片生成] 成功解析 Base64 图片, 大小: ${imageBuffer.length} bytes`);
                } catch (base64Error: any) {
                  console.error(`[图片生成] Base64 解码失败:`, base64Error);
                  throw new Error(`Base64 解码失败: ${base64Error.message || base64Error}`);
                }
              } else {
                throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
              }
              
              // 检查图片大小（如果超过 10MB，给出警告）
              const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
              if (imageBuffer.length > MAX_IMAGE_SIZE) {
                console.warn(`[图片生成] 图片过大: ${imageBuffer.length} bytes (${(imageBuffer.length / 1024 / 1024).toFixed(2)} MB)，可能导致上传失败`);
              }
              
              // 上传到 OSS 获取公网 URL
              console.log(`[图片生成] 开始上传图片到 OSS，文件大小: ${imageBuffer.length} bytes, MIME: ${mimeType}`);
              
              try {
                // 使用 VideoProvider 的 OSS 上传方法
                const { VideoProvider } = await import('./VideoProvider.js');
                const videoProvider = new VideoProvider();
                finalImageUrl = await videoProvider.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[图片生成] 图片已上传到 OSS，获得公网 URL: ${finalImageUrl}`);
              } catch (ossError: any) {
                console.error(`[图片生成] OSS 上传失败:`, ossError);
                console.error(`[图片生成] OSS 上传错误堆栈:`, ossError.stack);
                throw new Error(`OSS 上传失败: ${ossError.message || ossError}`);
              }
            }
            
            imageUrls.push(finalImageUrl);
          } catch (error: any) {
            console.error(`[图片生成] ========== 处理参考图失败 ==========`);
            console.error(`[图片生成] 图片 URL: ${imageUrl}`);
            console.error(`[图片生成] 错误对象:`, error);
            console.error(`[图片生成] 错误堆栈:`, error.stack);
            console.error(`[图片生成] 错误消息:`, error.message);
            if (error.response) {
              console.error(`[图片生成] 错误响应:`, error.response.status, error.response.statusText);
              console.error(`[图片生成] 错误响应数据:`, JSON.stringify(error.response.data, null, 2));
            }
            console.error(`[图片生成] =====================================`);
            throw new Error(`处理参考图失败: ${error.message || error}`);
          }
        }
        
        let submitUrl: string;
        let submitPayload: any;

        if (model === 'seedream-v4.5') {
          // seedream-v4.5-图生图：宽高由输入栏填写，范围 1024-4096
          const trimmedPrompt = prompt.trim();
          if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
            throw new Error('seedream-v4.5-图生图 提示词长度为 5-2000 字');
          }
          const minS = 1024;
          const maxS = 4096;
          const width = Math.max(minS, Math.min(maxS, Number((imageInput as any).seedreamWidth) || 2048));
          const height = Math.max(minS, Math.min(maxS, Number((imageInput as any).seedreamHeight) || 2048));
          submitUrl = `${this.runningHubApiBaseUrl}/seedream-v4.5/image-to-image`;
          submitPayload = {
            prompt: trimmedPrompt,
            width,
            height,
            imageUrls: imageUrls,
            maxImages: 1,
          };
          console.log(`[图片生成] 提交图生图任务到 RunningHub API（seedream-v4.5/image-to-image），width: ${width}, height: ${height}, 图片数量: ${imageUrls.length}`);
        } else {
          // 全能图片PRO 图生图：/rhart-image-n-pro/edit
          const validAspectRatios = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
          let finalAspectRatio = aspect_ratio || 'auto';
          if (!validAspectRatios.includes(finalAspectRatio)) {
            finalAspectRatio = 'auto';
            console.warn(`[图片生成] 无效的 aspect_ratio: ${aspect_ratio}，使用默认值 auto`);
          }
          let editResolution: '1k' | '2k' | '4k' = '1k';
          if (model === 'nano-banana-2-2k') {
            editResolution = '2k';
          } else if (model === 'nano-banana-2-4k') {
            editResolution = '4k';
          } else {
            editResolution = '1k';
          }
          submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-n-pro/edit`;
          submitPayload = {
            prompt: prompt,
            aspectRatio: finalAspectRatio,
            imageUrls: imageUrls,
            resolution: editResolution,
          };
          console.log(`[图片生成] 提交图生图任务到 RunningHub API（rhart-image-n-pro/edit），resolution: ${editResolution}, aspectRatio: ${finalAspectRatio}, 图片数量: ${imageUrls.length}`);
        }
        
        console.log('[图片生成] 提交任务到 RunningHub API:', submitUrl);
        console.log('[图片生成] 提交任务载荷:', JSON.stringify(submitPayload, null, 2));
        
        // 确保 prompt 使用 UTF-8 编码
        const utf8Prompt = Buffer.from(prompt, 'utf-8').toString('utf-8');
        submitPayload.prompt = utf8Prompt;
        
        console.log('[图片生成] Sending Request to API...');
        console.log('[图片生成] Request URL:', submitUrl);
        console.log('[图片生成] Request Headers:', {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${runningHubApiKey.substring(0, 10)}...`,
        });
        console.log('[图片生成] Request Payload (prompt length):', utf8Prompt.length, 'chars');
        console.log('[图片生成] Request Payload (imageUrls count):', imageUrls.length);
        
        let submitResponse;
        try {
          submitResponse = await axios.post(
            submitUrl,
            submitPayload,
            {
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${runningHubApiKey}`,
              },
              proxy: false,
              timeout: 30000,
            }
          );
          console.log(`[图片生成] 提交任务响应状态: ${submitResponse.status}`);
          console.log(`[图片生成] 提交任务响应数据:`, JSON.stringify(submitResponse.data, null, 2));
        } catch (submitError: any) {
          console.error(`[图片生成] 提交任务失败:`, submitError);
          console.error(`[图片生成] 错误堆栈:`, submitError.stack);
          
          if (submitError.response) {
            console.error(`[图片生成] 提交任务错误响应:`, submitError.response.status, submitError.response.statusText);
            console.error(`[图片生成] 提交任务错误详情:`, JSON.stringify(submitError.response.data, null, 2));
            console.error(`[图片生成] 错误响应 Headers:`, JSON.stringify(submitError.response.headers, null, 2));
            throw new Error(`提交任务失败: ${submitError.response.status} - ${JSON.stringify(submitError.response.data)}`);
          } else if (submitError.request) {
            console.error(`[图片生成] 提交任务请求发送失败:`, submitError.message);
            console.error(`[图片生成] 请求对象:`, submitError.request);
            throw new Error(`提交任务失败: 请求发送失败 - ${submitError.message}`);
          } else {
            console.error(`[图片生成] 提交任务配置错误:`, submitError.message);
            throw new Error(`提交任务失败: ${submitError.message || '未知错误'}`);
          }
        }
        
        if (submitResponse.status !== 200) {
          throw new Error(`提交任务失败: ${submitResponse.status} ${submitResponse.statusText} - ${JSON.stringify(submitResponse.data)}`);
        }
        
        const submitResult = submitResponse.data;
        const taskId = submitResult.taskId || submitResult.task_id || submitResult.data?.taskId || submitResult.data?.task_id || submitResult.result?.taskId || submitResult.result?.task_id;

        if (!taskId) {
          const errMsg = submitResult.error || submitResult.errorMessage || submitResult.message || submitResult.msg;
          if (errMsg) throw new Error(`提交任务失败: ${errMsg}`);
          if (submitResult.code !== undefined && submitResult.code !== 0) {
            throw new Error(`提交任务失败: 错误码 ${submitResult.code}，${submitResult.message || submitResult.msg || '请检查是否已激活软件并正确配置插件算力 API Key'}`);
          }
          console.error('[图片生成] API 未返回 taskId，完整响应:', JSON.stringify(submitResult, null, 2));
          throw new Error('提交任务失败：API 未返回任务 ID。请确认已激活软件、已正确配置插件算力 API Key，且网络连接正常。');
        }

        console.log(`[图片生成] 任务已提交，taskId: ${taskId}`);
        
        // 轮询查询任务状态（复用文生图的轮询逻辑）
        const queryUrl = `${this.runningHubApiBaseUrl}/query`;
        let imageUrl: string | null = null;
        const maxPollingAttempts = 120; // 最多轮询 120 次（10分钟，每5秒一次）
        let pollingAttempts = 0;
        
        while (pollingAttempts < maxPollingAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000)); // 每5秒查询一次
          
          try {
            const queryResponse = await axios.post(
              queryUrl,
              { taskId },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${runningHubApiKey}`,
                },
                proxy: false,
                timeout: 30000,
              }
            );
            
            if (queryResponse.status !== 200) {
              console.warn(`[图片生成] 查询任务状态失败: ${queryResponse.status}`);
              pollingAttempts++;
              continue;
            }
            
            const queryResult = queryResponse.data;
            const status = queryResult.status;
            
            console.log(`[图片生成] 任务状态: ${status}, taskId: ${taskId}`);
            
            if (status === 'SUCCESS') {
              // 任务成功，获取结果
              if (queryResult.results && queryResult.results.length > 0) {
                imageUrl = queryResult.results[0].url;
                console.log(`[图片生成] 任务完成，图片 URL: ${imageUrl}`);
              } else {
                throw new Error('任务完成但未返回结果');
              }
              break;
            } else if (status === 'FAILED') {
              // 任务失败，提取详细的失败原因
              const errorMessage = queryResult.errorMessage || '任务失败';
              const errorCode = queryResult.errorCode || '';
              const failedReason = queryResult.failedReason || {};
              
              // 构建详细的错误信息
              let detailedError = errorMessage;
              if (errorCode) {
                detailedError = `[错误码: ${errorCode}] ${errorMessage}`;
              }
              
              // 如果有 failedReason，添加到错误信息中
              if (failedReason && Object.keys(failedReason).length > 0) {
                detailedError += ` | 失败详情: ${JSON.stringify(failedReason)}`;
              }
              
              console.error(`[图片生成] 任务失败，错误码: ${errorCode}, 错误信息: ${errorMessage}`);
              if (Object.keys(failedReason).length > 0) {
                console.error(`[图片生成] 失败详情:`, JSON.stringify(failedReason, null, 2));
              }
              
              throw new Error(detailedError);
            } else if (status === 'RUNNING' || status === 'QUEUED') {
              // 任务仍在处理中，继续轮询
              console.log(`[图片生成] 任务处理中，状态: ${status}`);
              pollingAttempts++;
              continue;
            } else {
              // 未知状态
              console.warn(`[图片生成] 未知任务状态: ${status}`);
              pollingAttempts++;
              continue;
            }
          } catch (queryError: any) {
            console.error(`[图片生成] 查询任务状态时出错:`, queryError);
            pollingAttempts++;
            
            // 如果是网络错误，继续重试；如果是业务错误，抛出异常
            if (queryError.response && queryError.response.status !== 200) {
              // 业务错误，继续重试
              continue;
            } else if (queryError.code === 'ETIMEDOUT' || queryError.code === 'ECONNREFUSED') {
              // 网络错误，继续重试
              continue;
            } else {
              // 其他错误，抛出异常
              throw queryError;
            }
          }
        }
        
        if (!imageUrl) {
          throw new Error('任务超时：超过最大轮询次数');
        }
        
        // 自动下载并保存图片到本地
        let localPath: string | undefined;
        let finalImageUrl = imageUrl;
        
        if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
          try {
            // 自动下载图片到本地
            const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
            // 从 input 中获取项目 ID 和节点标题（如果存在）
            const projectId = (input as any)?.projectId;
            const nodeTitle = (input as any)?.nodeTitle || 'image';
            
            const downloadedPath = await autoDownloadResource(
              imageUrl,
              'image',
              {
                resourceType: 'image',
                nodeId: nodeId,
                nodeTitle: nodeTitle,
                projectId: projectId,
                prompt: prompt,
                model: model,
              }
            );
            
            if (downloadedPath) {
              localPath = downloadedPath;
              // 使用本地路径作为最终 URL
              finalImageUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
              console.log(`[图片生成] 图片已自动下载到本地: ${localPath}`);
            }
          } catch (downloadError) {
            console.error(`[图片生成] 自动下载图片失败:`, downloadError);
            // 下载失败不影响图片显示，继续使用远程 URL
          }
        }
        
        clearProgress(); // 清除进度更新循环
        onStatus({
          nodeId,
          status: 'SUCCESS',
          payload: {
            imageUrl: finalImageUrl, // 优先使用本地路径
            originalImageUrl: imageUrl, // 保存原始远程 URL
            localPath: localPath, // 传递本地路径
            progress: 100, // 设置为 100% 表示完成
          },
        });
        
        return; // 图生图模式已处理，直接返回
      }

      // 文生图模式：使用 RunningHub API（插件算力）
      const validAspectRatiosRhart = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
      const validAspectRatiosYouchuan = ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'];
      let submitUrl: string;
      let submitPayload: any;

      if (model === 'rhart-image-g-1.5') {
        // 全能图片G-1.5-文生图：https://www.runninghub.cn/openapi/v2/rhart-image-g-1.5/text-to-image
        // 参数：prompt(必填 2-800字), aspectRatio(必填 enum: auto | 1:1 | 3:2 | 2:3)
        const trimmedPrompt = prompt.trim();
        if (trimmedPrompt.length < 2 || trimmedPrompt.length > 800) {
          throw new Error('全能图片G-1.5 提示词长度为 2-800 字');
        }
        const validAspectRatiosG15 = ['auto', '1:1', '3:2', '2:3'];
        let finalAspectRatio = aspect_ratio && validAspectRatiosG15.includes(aspect_ratio) ? aspect_ratio : '2:3';
        submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-g-1.5/text-to-image`;
        submitPayload = {
          prompt: trimmedPrompt,
          aspectRatio: finalAspectRatio,
        };
        console.log(`[图片生成] 使用全能图片G-1.5-文生图，aspectRatio: ${finalAspectRatio}`);
      } else if (model === 'seedream-v4.5') {
        // seedream-v4.5-文生图：宽高由输入栏填写，范围 1024-4096
        if (isImageToImage) {
          throw new Error('seedream-v4.5 仅支持文生图，请勿传入参考图');
        }
        const trimmedPrompt = prompt.trim();
        if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
          throw new Error('seedream-v4.5 提示词长度为 5-2000 字');
        }
        const minS = 1024;
        const maxS = 4096;
        const width = Math.max(minS, Math.min(maxS, Number((imageInput as any).seedreamWidth) || 2048));
        const height = Math.max(minS, Math.min(maxS, Number((imageInput as any).seedreamHeight) || 2048));
        submitUrl = `${this.runningHubApiBaseUrl}/seedream-v4.5/text-to-image`;
        submitPayload = {
          prompt: trimmedPrompt,
          width,
          height,
          maxImages: 1,
        };
        console.log(`[图片生成] 使用 seedream-v4.5-文生图，width: ${width}, height: ${height}`);
      } else if (model === 'youchuan-text-to-image-v7') {
        // 文悠船文生图-v7：https://www.runninghub.cn/openapi/v2/youchuan/text-to-image-v7
        let finalAspectRatio = aspect_ratio && validAspectRatiosYouchuan.includes(aspect_ratio) ? aspect_ratio : '1:1';
        submitUrl = `${this.runningHubApiBaseUrl}/youchuan/text-to-image-v7`;
        submitPayload = {
          prompt: prompt,
          negativePrompt: (imageInput.negativePrompt as string) || '',
          chaos: 0,
          stylize: 0,
          weird: 0,
          raw: false,
          imageUrl: '',
          iw: 1,
          sref: '',
          sw: 100,
          sv: 4,
          oref: '',
          ow: 100,
          tile: false,
          aspectRatio: finalAspectRatio,
        };
        // 可选：传入一张参考图时作为 imageUrl
        const firstImage = imageInput.image ? (Array.isArray(imageInput.image) ? imageInput.image[0] : imageInput.image) : '';
        if (firstImage) {
          let imageUrlForYouchuan: string;
          if (firstImage.startsWith('http://') || firstImage.startsWith('https://')) {
            imageUrlForYouchuan = firstImage;
          } else {
            let imageBuffer: Buffer;
            let mimeType = 'image/png';
            if (firstImage.startsWith('local-resource://') || firstImage.startsWith('file://')) {
              let filePath = firstImage.startsWith('local-resource://') ? firstImage.replace(/^local-resource:\/\//, '') : firstImage.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) filePath = filePath.replace(/^[/\\]+/, '');
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              let normalizedFilePath = path.normalize(filePath);
              if (!path.isAbsolute(normalizedFilePath)) normalizedFilePath = path.resolve(userDataPath, normalizedFilePath);
              if (!isLocalResourcePathAllowed(normalizedFilePath)) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            } else if (firstImage.startsWith('data:image/')) {
              const base64Data = firstImage.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = firstImage.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            } else {
              throw new Error(`不支持的图片 URL 格式: ${firstImage.substring(0, 50)}`);
            }
            const { VideoProvider } = await import('./VideoProvider.js');
            const videoProvider = new VideoProvider();
            imageUrlForYouchuan = await videoProvider.uploadImageToOSS(imageBuffer, mimeType);
          }
          submitPayload.imageUrl = imageUrlForYouchuan;
          submitPayload.iw = 1;
        }
        console.log(`[图片生成] 使用文悠船文生图-v7，aspectRatio: ${submitPayload.aspectRatio}`);
      } else {
        // 全能图片PRO 文生图：rhart-image-n-pro/text-to-image
        let resolution: '1k' | '2k' | '4k' = '1k';
        if (model === 'nano-banana-2-2k') {
          resolution = '2k';
        } else if (model === 'nano-banana-2-4k') {
          resolution = '4k';
        } else {
          resolution = '1k';
        }
        let finalAspectRatio = aspect_ratio && validAspectRatiosRhart.includes(aspect_ratio) ? aspect_ratio : '1:1';
        submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-n-pro/text-to-image`;
        submitPayload = {
          prompt: prompt,
          resolution: resolution,
        };
        if (finalAspectRatio) submitPayload.aspectRatio = finalAspectRatio;
        console.log(`[图片生成] 使用 RunningHub API，模型: ${model}, resolution: ${resolution}, aspectRatio: ${finalAspectRatio}`);
      }

      console.log('[图片生成] 提交任务到 RunningHub API:', submitUrl, submitPayload);

      const submitResponse = await axios.post(
        submitUrl,
        submitPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${runningHubApiKey}`,
          },
          proxy: false,
          timeout: 30000,
        }
      );

      if (submitResponse.status !== 200) {
        throw new Error(`提交任务失败: ${submitResponse.status} ${submitResponse.statusText}`);
      }

      const submitResult = submitResponse.data;
      const taskId = submitResult.taskId || submitResult.task_id || submitResult.data?.taskId || submitResult.data?.task_id || submitResult.result?.taskId || submitResult.result?.task_id;

      if (!taskId) {
        const errMsg = submitResult.error || submitResult.errorMessage || submitResult.message || submitResult.msg;
        if (errMsg) throw new Error(`提交任务失败: ${errMsg}`);
        if (submitResult.code !== undefined && submitResult.code !== 0) {
          throw new Error(`提交任务失败: 错误码 ${submitResult.code}，${submitResult.message || submitResult.msg || '请检查是否已激活软件并正确配置插件算力 API Key'}`);
        }
        console.error('[图片生成] API 未返回 taskId，完整响应:', JSON.stringify(submitResult, null, 2));
        throw new Error('提交任务失败：API 未返回任务 ID。请确认已激活软件、已正确配置插件算力 API Key，且网络连接正常。');
      }

      console.log(`[图片生成] 任务已提交，taskId: ${taskId}`);

      // 轮询查询任务状态
      const queryUrl = `${this.runningHubApiBaseUrl}/query`;
      let imageUrl: string | null = null;
      const maxPollingAttempts = 120; // 最多轮询 120 次（10分钟，每5秒一次）
      let pollingAttempts = 0;

      while (pollingAttempts < maxPollingAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 每5秒查询一次

        try {
          const queryResponse = await axios.post(
            queryUrl,
            { taskId },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${runningHubApiKey}`,
              },
              proxy: false,
              timeout: 30000,
            }
          );

          if (queryResponse.status !== 200) {
            console.warn(`[图片生成] 查询任务状态失败: ${queryResponse.status}`);
            pollingAttempts++;
            continue;
          }

          const queryResult = queryResponse.data;
          const status = queryResult.status;

          console.log(`[图片生成] 任务状态: ${status}, taskId: ${taskId}`);

          if (status === 'SUCCESS') {
            // 任务成功，获取结果
            if (queryResult.results && queryResult.results.length > 0) {
              imageUrl = queryResult.results[0].url;
              console.log(`[图片生成] 任务完成，图片 URL: ${imageUrl}`);
            } else {
              throw new Error('任务完成但未返回结果');
            }
            break;
          } else if (status === 'FAILED') {
            // 任务失败，提取详细的失败原因
            const errorMessage = queryResult.errorMessage || '任务失败';
            const errorCode = queryResult.errorCode || '';
            const failedReason = queryResult.failedReason || {};
            
            // 构建详细的错误信息
            let detailedError = errorMessage;
            if (errorCode) {
              detailedError = `[错误码: ${errorCode}] ${errorMessage}`;
            }
            
            // 如果有 failedReason，添加到错误信息中
            if (failedReason && Object.keys(failedReason).length > 0) {
              detailedError += ` | 失败详情: ${JSON.stringify(failedReason)}`;
            }
            
            console.error(`[图片生成] 任务失败，错误码: ${errorCode}, 错误信息: ${errorMessage}`);
            if (Object.keys(failedReason).length > 0) {
              console.error(`[图片生成] 失败详情:`, JSON.stringify(failedReason, null, 2));
            }
            
            throw new Error(detailedError);
          } else if (status === 'RUNNING' || status === 'QUEUED') {
            // 任务仍在处理中，继续轮询
            console.log(`[图片生成] 任务处理中，状态: ${status}`);
            pollingAttempts++;
            continue;
          } else {
            // 未知状态
            console.warn(`[图片生成] 未知任务状态: ${status}`);
            pollingAttempts++;
            continue;
          }
        } catch (queryError: any) {
          console.error(`[图片生成] 查询任务状态时出错:`, queryError);
          pollingAttempts++;
          
          // 如果是网络错误，继续重试；如果是业务错误，抛出异常
          if (queryError.response && queryError.response.status !== 200) {
            // 业务错误，继续重试
            continue;
          } else if (queryError.code === 'ETIMEDOUT' || queryError.code === 'ECONNREFUSED') {
            // 网络错误，继续重试
            continue;
          } else {
            // 其他错误，抛出异常
            throw queryError;
          }
        }
      }

      if (!imageUrl) {
        throw new Error('任务超时：超过最大轮询次数');
      }

      // 自动下载并保存图片到本地
      let localPath: string | undefined;
      let finalImageUrl = imageUrl;

      if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        try {
          // 自动下载图片到本地
          const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
          // 从 input 中获取项目 ID 和节点标题（如果存在）
          const projectId = (input as any)?.projectId;
          const nodeTitle = (input as any)?.nodeTitle || 'image';
          
          const downloadedPath = await autoDownloadResource(
            imageUrl,
            'image',
            {
              resourceType: 'image',
              nodeId: nodeId,
              nodeTitle: nodeTitle,
              projectId: projectId,
              prompt: prompt,
              model: model,
            }
          );
          
          if (downloadedPath) {
            localPath = downloadedPath;
            // 使用本地路径作为最终 URL
            finalImageUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
            console.log(`[图片生成] 图片已自动下载到本地: ${localPath}`);
          }
        } catch (downloadError) {
          console.error(`[图片生成] 自动下载图片失败:`, downloadError);
          // 下载失败不影响图片显示，继续使用远程 URL
        }
      }
      
      clearProgress(); // 清除进度更新循环
      onStatus({
        nodeId,
        status: 'SUCCESS',
        payload: {
          imageUrl: finalImageUrl, // 优先使用本地路径
          originalImageUrl: imageUrl, // 保存原始远程 URL
          localPath: localPath, // 传递本地路径
          progress: 100, // 设置为 100% 表示完成
        },
      });
    } catch (error: any) {
      console.error('[图片生成] ========== 发生错误 ==========');
      console.error('[图片生成] 错误对象:', error);
      console.error('[图片生成] 错误堆栈:', error.stack);
      console.error('[图片生成] 错误消息:', error.message);

      // 异常处理：打印最真实的错误原因
      if (error.response) {
        console.error('[图片生成] API 错误响应状态:', error.response.status, error.response.statusText);
        console.error('[图片生成] API 错误响应 Headers:', JSON.stringify(error.response.headers, null, 2));
        console.error('[图片生成] API 错误响应数据:', JSON.stringify(error.response.data, null, 2));
        console.error('[图片生成] error.response.data 完整内容:', error.response.data);
      } else if (error.request) {
        console.error('[图片生成] 请求发送失败，服务器无响应');
        console.error('[图片生成] 请求对象:', error.request);
        console.error('[图片生成] 错误消息:', error.message);
      } else {
        console.error('[图片生成] 请求配置错误');
        console.error('[图片生成] 错误消息:', error.message);
      }

      // 提取错误信息
      let errorMsg = error.message || '图片生成失败';
      
      // 尝试从不同位置提取错误信息
      if (error.response?.data) {
        const responseData = error.response.data;
        
        // 优先提取 errorMessage
        if (responseData.errorMessage) {
          errorMsg = responseData.errorMessage;
          // 如果有 errorCode，添加到错误信息中
          if (responseData.errorCode) {
            errorMsg = `[错误码: ${responseData.errorCode}] ${errorMsg}`;
          }
          // 如果有 failedReason，添加到错误信息中
          if (responseData.failedReason && Object.keys(responseData.failedReason).length > 0) {
            errorMsg += ` | 失败详情: ${JSON.stringify(responseData.failedReason)}`;
          }
        } else if (responseData.error?.message) {
          errorMsg = responseData.error.message;
        } else if (responseData.message) {
          errorMsg = responseData.message;
        } else if (typeof responseData === 'string') {
          errorMsg = responseData;
        } else {
          errorMsg = JSON.stringify(responseData);
        }
      }
      
      console.error('[图片生成] 最终错误信息:', errorMsg);
      console.error('[图片生成] =================================');

      clearProgress(); // 清除进度更新循环
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: {
          error: `图片生成失败: ${errorMsg}`,
          progress: 0, // 错误时重置进度
        },
      });
    }
  }
}
