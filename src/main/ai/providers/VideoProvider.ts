/**
 * Video Generation Provider - 视频生成 (Sora2)
 * 使用 JSON 请求，支持文生视频 / 图生视频
 * 使用 BLTCY 核心算力 API
 */

import { BaseProvider } from '../BaseProvider.js';
import { AIExecuteParams } from '../types.js';
import { store } from '../../services/store.js';
import axios from 'axios';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getProjectsBasePath } from '../../utils/projectFolderHelper.js';
import OSS from 'ali-oss';

/** 万相2.6 Flash 图生视频支持的时长（秒） */
type Wan26FlashDuration = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15';

interface VideoInput {
  prompt: string;
  model?: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'rhart-video-g' | 'rhart-video-s-i2v-pro' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard';
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '2:3' | '3:2';
  hd?: boolean;
  duration?: '5' | '10' | '15' | '25';
  images?: string[]; // 图生视频参考图，支持 url / base64
  /** 可灵参考生视频o1：必填，参考视频 URL（需为可公网访问的 http(s)） */
  referenceVideoUrl?: string;
  /** 可灵参考生视频o1：是否保留参考视频原声 */
  keepOriginalSound?: boolean;
  notify_hook?: string;
  watermark?: boolean;
  private?: boolean;
  // kling 系列参数
  negativePrompt?: string;
  guidanceScale?: number;
  sound?: 'true' | 'false';
  // 万相2.6 文生/图生视频参数
  shotType?: 'single' | 'multi';
  resolutionWan26?: '720p' | '1080p';
  durationWan26Flash?: Wan26FlashDuration;
  enableAudio?: boolean;
  enablePromptExpansion?: boolean;
  // 全能视频V3.1-fast 文生视频（仅文生）
  resolutionRhartV31?: '720p' | '1080p' | '4k';
  // 全能视频G 图生视频：仅图生，时长 6s/10s
  durationRhartVideoG?: '6s' | '10s';
  // 海螺-02 文生视频标准：仅文生，时长 6|10 秒
  durationHailuo02?: '6' | '10';
  // 可灵文生视频o1：仅文生，时长 5|10 秒，模式 std|pro
  durationKlingO1?: '5' | '10';
  modeKlingO1?: 'std' | 'pro';
}

export class VideoProvider extends BaseProvider {
  readonly modelId = 'video';

  // BLTCY API 配置
  private readonly apiBaseUrl = 'https://api.bltcy.ai';

  /**
   * 获取阿里云 OSS 配置（从环境变量或 electron-store 读取）
   */
  private getOSSConfig(): {
    accessKeyId: string;
    accessKeySecret: string;
    region: string;
    bucket: string;
  } {
    // 调试日志：检查环境变量
    console.log('[OSS配置] 检查环境变量:');
    console.log('[OSS配置] OSS_ACCESS_KEY_ID:', process.env.OSS_ACCESS_KEY_ID ? '已设置（长度: ' + process.env.OSS_ACCESS_KEY_ID.length + '）' : '未设置');
    console.log('[OSS配置] OSS_ACCESS_KEY_SECRET:', process.env.OSS_ACCESS_KEY_SECRET ? '已设置（长度: ' + process.env.OSS_ACCESS_KEY_SECRET.length + '）' : '未设置');
    console.log('[OSS配置] OSS_REGION:', process.env.OSS_REGION || '未设置');
    console.log('[OSS配置] OSS_BUCKET:', process.env.OSS_BUCKET || '未设置');
    
    // 优先从环境变量读取（.env 文件），然后是 store，最后使用硬编码兜底（临时调试）
    let accessKeyId = process.env.OSS_ACCESS_KEY_ID || (store.get('ossAccessKeyId') as string) || '';
    let accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || (store.get('ossAccessKeySecret') as string) || '';
    let region = process.env.OSS_REGION || (store.get('ossRegion') as string) || 'oss-cn-hongkong';
    let bucket = process.env.OSS_BUCKET || (store.get('ossBucket') as string) || 'nexflow-temp-images';

    if (!accessKeyId || !accessKeySecret) {
      console.warn('[OSS配置] 请在 .env 或设置中配置 OSS_ACCESS_KEY_ID 和 OSS_ACCESS_KEY_SECRET');
    }

    console.log('[OSS配置] 最终配置:');
    console.log('[OSS配置] accessKeyId:', accessKeyId ? '已设置（长度: ' + accessKeyId.length + '）' : '未设置');
    console.log('[OSS配置] accessKeySecret:', accessKeySecret ? '已设置（长度: ' + accessKeySecret.length + '）' : '未设置');
    console.log('[OSS配置] region:', region);
    console.log('[OSS配置] bucket:', bucket);

    return {
      accessKeyId,
      accessKeySecret,
      region,
      bucket,
    };
  }

  /**
   * 获取 OSS 客户端实例
   */
  private getOSSClient(): OSS {
    const config = this.getOSSConfig();
    return new OSS({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      region: config.region,
      bucket: config.bucket,
      // 强制走 HTTPS(443)，避免移动热点下 http:80 超时
      secure: true,
      timeout: 120000,
    });
  }

  /**
   * 上传图片到阿里云 OSS
   * @param imageBuffer 图片 Buffer
   * @param mimeType 图片 MIME 类型
   * @returns 公网 URL
   */
  async uploadImageToOSS(imageBuffer: Buffer, mimeType: string = 'image/png'): Promise<string> {
    try {
      const client = this.getOSSClient();
      
      // 生成文件名：uploads/${Date.now()}-${Math.random().toString(36).slice(-5)}.png
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      const fileExt = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'png';
      const objectName = `uploads/${timestamp}-${randomStr}.${fileExt}`;
      
      console.log(`[OSS上传] 开始上传图片到 OSS，文件名: ${objectName}`);
      
      // 上传文件
      const result = await client.put(objectName, imageBuffer, {
        mime: mimeType,
      });
      
      // 获取公网 URL，确保格式正确（去除多余的斜杠）
      let publicUrl = result.url;
      // 确保 URL 格式正确，去除多余的斜杠
      publicUrl = publicUrl.replace(/([^:]\/)\/+/g, '$1');
      console.log(`[OSS上传] 图片上传成功，公网 URL: ${publicUrl}`);
      
      return publicUrl;
    } catch (error: any) {
      console.error('[OSS上传] OSS上传失败:', error);
      const errorMessage = error.message || error.code || '未知错误';
      throw new Error(`OSS上传失败: ${errorMessage}`);
    }
  }

  /**
   * 上传视频到阿里云 OSS
   * @param videoBuffer 视频 Buffer
   * @param mimeType 视频 MIME 类型，默认为 video/mp4
   * @returns 公网 URL
   */
  async uploadVideoToOSS(videoBuffer: Buffer, mimeType: string = 'video/mp4'): Promise<string> {
    try {
      const client = this.getOSSClient();
      
      // 生成文件名：uploads/${Date.now()}-${Math.random().toString(36).slice(-5)}.mp4
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      // 根据 MIME 类型确定文件扩展名
      let fileExt = 'mp4';
      if (mimeType.includes('webm')) {
        fileExt = 'webm';
      } else if (mimeType.includes('mov')) {
        fileExt = 'mov';
      } else if (mimeType.includes('avi')) {
        fileExt = 'avi';
      } else if (mimeType.includes('mkv')) {
        fileExt = 'mkv';
      }
      const objectName = `uploads/${timestamp}-${randomStr}.${fileExt}`;
      
      console.log(`[OSS上传] 开始上传视频到 OSS，文件名: ${objectName}，大小: ${videoBuffer.length} bytes`);
      
      // 上传文件
      const result = await client.put(objectName, videoBuffer, {
        mime: mimeType,
      });
      
      // 获取公网 URL，确保格式正确（去除多余的斜杠）
      let publicUrl = result.url;
      // 确保 URL 格式正确，去除多余的斜杠
      publicUrl = publicUrl.replace(/([^:]\/)\/+/g, '$1');
      console.log(`[OSS上传] 视频上传成功，公网 URL: ${publicUrl}`);
      
      return publicUrl;
    } catch (error: any) {
      console.error('[OSS上传] 视频上传失败:', error);
      const errorMessage = error.message || error.code || '未知错误';
      throw new Error(`OSS上传失败: ${errorMessage}`);
    }
  }

  /**
   * 上传音频到阿里云 OSS（用于 Index-TTS2 参考音等）
   * @param audioBuffer 音频 Buffer
   * @param mimeType 音频 MIME 类型，默认为 audio/mpeg
   * @returns 公网 URL
   */
  async uploadAudioToOSS(audioBuffer: Buffer, mimeType: string = 'audio/mpeg'): Promise<string> {
    try {
      const client = this.getOSSClient();
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      let fileExt = 'mp3';
      if (mimeType.includes('wav')) fileExt = 'wav';
      else if (mimeType.includes('ogg')) fileExt = 'ogg';
      else if (mimeType.includes('m4a')) fileExt = 'm4a';
      const objectName = `uploads/${timestamp}-${randomStr}.${fileExt}`;
      const result = await client.put(objectName, audioBuffer, { mime: mimeType });
      let publicUrl = result.url;
      publicUrl = publicUrl.replace(/([^:]\/)\/+/g, '$1');
      return publicUrl;
    } catch (error: any) {
      console.error('[OSS上传] 音频上传失败:', error);
      throw new Error(`OSS上传失败: ${error.message || error.code || '未知错误'}`);
    }
  }

  /**
   * 上传本地视频文件到 OSS（用于角色创建模块）
   * @param localVideoPath 本地视频路径（如 C:/Users/... 或 local-resource://...）
   * @returns OSS 公网 URL
   */
  async uploadLocalVideoToOSS(localVideoPath: string): Promise<string> {
    try {
      let filePath: string;
      
      // 处理 local-resource:// 协议
      if (localVideoPath.startsWith('local-resource://')) {
        filePath = localVideoPath.replace(/^local-resource:\/\//, '');
        filePath = decodeURIComponent(filePath);
        // 处理 Windows 路径格式（c/Users -> C:/Users）
        if (filePath.match(/^[a-zA-Z]\//)) {
          filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        }
        // 处理 /C:/ 格式（移除开头的 /）
        if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
          filePath = filePath.substring(1);
        }
      } else if (localVideoPath.startsWith('file://')) {
        filePath = localVideoPath.replace(/^file:\/\//, '');
        if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
          filePath = filePath.substring(1);
        }
        filePath = decodeURIComponent(filePath);
      } else {
        // 直接是文件路径
        filePath = localVideoPath;
        // 处理 /C:/ 格式（移除开头的 /）
        if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
          filePath = filePath.substring(1);
        }
      }
      
      const normalizedFilePath = path.normalize(filePath);
      const userDataPath = app.getPath('userData');
      const projectsBase = getProjectsBasePath();
      const allowed = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBase));
      if (!allowed) {
        throw new Error(`访问路径超出允许范围: ${filePath}`);
      }
      
      // 检查文件是否存在
      if (!fs.existsSync(normalizedFilePath)) {
        throw new Error(`文件不存在: ${normalizedFilePath}`);
      }
      
      // 使用 fs.promises.readFile 异步读取文件
      const videoBuffer = await fs.promises.readFile(normalizedFilePath);
      
      // 根据文件扩展名确定 MIME 类型
      const ext = path.extname(normalizedFilePath).toLowerCase();
      let mimeType = 'video/mp4';
      if (ext === '.webm') {
        mimeType = 'video/webm';
      } else if (ext === '.mov') {
        mimeType = 'video/quicktime';
      } else if (ext === '.avi') {
        mimeType = 'video/x-msvideo';
      } else if (ext === '.mkv') {
        mimeType = 'video/x-matroska';
      }
      
      console.log(`[OSS上传] 读取本地视频文件: ${normalizedFilePath}，大小: ${videoBuffer.length} bytes`);
      
      // 上传到 OSS（使用 uploads/ 目录，与图片上传路径相同）
      const client = this.getOSSClient();
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      let fileExt = ext.substring(1) || 'mp4'; // 移除点号
      const objectName = `uploads/${timestamp}-${randomStr}.${fileExt}`;
      
      console.log(`[OSS上传] 开始上传视频到 OSS，文件名: ${objectName}`);
      
      const result = await client.put(objectName, videoBuffer, {
        mime: mimeType,
      });
      
      const publicUrl = result.url;
      console.log(`[OSS上传] 视频上传成功，公网 URL: ${publicUrl}`);
      
      return publicUrl;
    } catch (error: any) {
      console.error('[OSS上传] 本地视频上传失败:', error);
      const errorMessage = error.message || error.code || '未知错误';
      throw new Error(`OSS上传失败: ${errorMessage}`);
    }
  }

  /**
   * 上传本地音频文件到 OSS（用于声音模块连接时，将参考音上传后回传 URL）
   * @param localAudioPath 本地路径（local-resource:// 或 file:// 或绝对路径）
   * @returns OSS 公网 URL
   */
  async uploadLocalAudioToOSS(localAudioPath: string): Promise<string> {
    let filePath = localAudioPath.trim();
    if (filePath.startsWith('local-resource://')) {
      filePath = filePath.replace(/^local-resource:\/\/+/, '').replace(/%5C/gi, '/');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
      if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    } else if (filePath.startsWith('file://')) {
      filePath = filePath.replace(/^file:\/\/+/, '');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
    }
    const normalizedFilePath = path.normalize(filePath);
    if (!fs.existsSync(normalizedFilePath)) {
      throw new Error(`文件不存在: ${normalizedFilePath}`);
    }
    const stat = fs.statSync(normalizedFilePath);
    if (!stat.isFile()) {
      throw new Error(`路径不是文件: ${normalizedFilePath}`);
    }
    const audioBuffer = fs.readFileSync(normalizedFilePath);
    const ext = path.extname(normalizedFilePath).toLowerCase();
    const mimeType = ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
    console.log(`[OSS上传] 上传本地音频: ${normalizedFilePath}，大小: ${audioBuffer.length} bytes`);
    return this.uploadAudioToOSS(audioBuffer, mimeType);
  }

  /**
   * 获取 API Key（根据模型类型选择）
   */
  private getApiKey(model?: string): string {
    // sora-2、kling-v2.6-pro、wan-2.6、wan-2.6-flash 使用插件算力 API KEY (runningHubApiKey)
    if (model === 'sora-2' || model === 'sora-2-pro' || model === 'kling-v2.6-pro' || model === 'kling-video-o1' || model === 'kling-video-o1-i2v' || model === 'kling-video-o1-start-end' || model === 'kling-video-o1-ref' || model === 'wan-2.6' || model === 'wan-2.6-flash' || model === 'rhart-v3.1-fast' || model === 'rhart-v3.1-fast-se' || model === 'rhart-v3.1-pro' || model === 'rhart-v3.1-pro-se' || model === 'rhart-video-g' || model === 'rhart-video-s-i2v-pro' || model === 'hailuo-02-t2v-standard' || model === 'hailuo-2.3-t2v-standard' || model === 'hailuo-02-i2v-standard' || model === 'hailuo-2.3-i2v-standard') {
      return (store.get('runningHubApiKey') as string) || '';
    }
    // 其他模型使用核心算力 API KEY (bltcyApiKey)
    return (store.get('bltcyApiKey') as string) || '';
  }



  async execute(params: AIExecuteParams): Promise<void> {
    const { nodeId, input, onStatus } = params;

    try {
      const videoInput = input as VideoInput;
      const {
        prompt,
        model = 'sora-2',
        aspect_ratio = '16:9',
        hd = false,
        duration = '10',
        images,
        notify_hook,
        watermark,
        private: isPrivate,
        negativePrompt,
        guidanceScale,
        sound,
        shotType: inputShotType,
        resolutionWan26: inputResolutionWan26,
        durationWan26Flash,
        enableAudio: inputEnableAudio,
        enablePromptExpansion: inputEnablePromptExpansion,
        resolutionRhartV31: inputResolutionRhartV31,
        durationRhartVideoG: inputDurationRhartVideoG,
        durationHailuo02: inputDurationHailuo02,
        durationKlingO1: inputDurationKlingO1,
        modeKlingO1: inputModeKlingO1,
      } = videoInput;

      if (!prompt) {
        throw new Error('提示词是必需的');
      }

      const isImageToVideo = Array.isArray(images) && images.length > 0;
      const isKlingModel = model === 'kling-v2.6-pro';
      const isSora2Model = model === 'sora-2';
      const isSora2ProModel = model === 'sora-2-pro';
      const isWan26Model = model === 'wan-2.6';
      const isWan26FlashModel = model === 'wan-2.6-flash';
      const isRhartV31FastModel = model === 'rhart-v3.1-fast';
      const isRhartV31FastSEModel = model === 'rhart-v3.1-fast-se';
      const isRhartV31ProModel = model === 'rhart-v3.1-pro';
      const isRhartV31ProSEModel = model === 'rhart-v3.1-pro-se';
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

      // 可灵O1 (参考) 已下线，不再支持
      if (isKlingVideoO1RefModel) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵O1 (参考) 模型已下线，请切换为其他模型（如可灵O1）。' },
        });
        return;
      }

      // 全能视频S-图生视频-pro：仅支持图生视频，1 张图
      if (isRhartVideoSI2vProModel) {
        if (!isImageToVideo) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '全能视频S-图生视频-pro 仅支持图生视频，请接入 1 张参考图。' },
          });
          return;
        }
        if (images!.length !== 1) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '全能视频S-图生视频-pro 仅支持 1 张参考图，当前提供了 ' + images!.length + ' 张。' },
          });
          return;
        }
      }

      // 可灵文生视频o1：仅支持文生视频
      if (isKlingVideoO1Model && isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵文生视频o1 仅支持文生视频，请勿传入参考图。' },
        });
        return;
      }

      // 可灵图生视频o1：仅支持图生视频，仅 1 张图
      if (isKlingVideoO1I2vModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵图生视频o1 仅支持图生视频，请接入 1 张参考图。' },
        });
        return;
      }
      if (isKlingVideoO1I2vModel && isImageToVideo && images!.length !== 1) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵图生视频o1 仅支持 1 张参考图，当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }

      // 可灵首尾帧生视频o1：仅支持首尾帧，恰好 2 张图
      if (isKlingVideoO1StartEndModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵首尾帧生视频o1 需要首帧+尾帧共 2 张参考图。' },
        });
        return;
      }
      if (isKlingVideoO1StartEndModel && isImageToVideo && images!.length !== 2) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵首尾帧生视频o1 需要恰好 2 张参考图（首帧、尾帧），当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }

      // 海螺-02 / 海螺-2.3 文生视频标准：仅支持文生视频
      if ((isHailuo02Model || isHailuo23Model) && isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺文生视频标准 仅支持文生视频，请勿传入参考图。' },
        });
        return;
      }

      // 海螺-02 图生视频标准：仅支持图生视频，1 或 2 张图（2 张为首尾帧）
      if (isHailuo02I2vModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺-02-图生视频-标准 仅支持图生视频，请接入 1 或 2 张参考图。' },
        });
        return;
      }
      if (isHailuo02I2vModel && isImageToVideo && (images!.length < 1 || images!.length > 2)) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺-02-图生视频-标准 支持 1 张图（首帧）或 2 张图（首帧+尾帧），当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }

      // 海螺-2.3 图生视频标准：仅支持图生视频，仅 1 张图
      if (isHailuo23I2vModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺-2.3-图生视频-标准 仅支持图生视频，请接入 1 张参考图。' },
        });
        return;
      }
      if (isHailuo23I2vModel && isImageToVideo && images!.length !== 1) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺-2.3-图生视频-标准 仅支持 1 张参考图，当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }

      // 全能视频G（Grok 1.5）：图生视频仅支持 1 张图；文生视频无需参考图
      if (isRhartVideoGModel && isImageToVideo && images!.length !== 1) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '全能视频G（Grok 1.5）图生视频仅支持 1 张图片，当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }

      // 全能视频V3.1-fast / V3.1-pro 首尾帧生视频仅支持恰好 2 张图片（首帧+尾帧）
      if ((isRhartV31FastSEModel || isRhartV31ProSEModel) && isImageToVideo) {
        if (images!.length !== 2) {
          const name = isRhartV31ProSEModel ? '全能视频V3.1-pro' : '全能视频V3.1-fast';
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: `${name} 首尾帧生视频需要恰好 2 张图片（首帧、尾帧），当前提供了 ${images!.length} 张。` },
          });
          return;
        }
      }

      // 全能视频V3.1-pro 仅支持文生视频（不含首尾帧时）
      if (isRhartV31ProModel && isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '全能视频V3.1-pro 仅支持文生视频，请勿传入参考图。' },
        });
        return;
      }

      // 全能视频V3.1-fast 图生视频支持 1–3 张图片
      if (isRhartV31FastModel && isImageToVideo) {
        if (images!.length < 1 || images!.length > 3) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '全能视频V3.1-fast 图生视频支持 1–3 张图片，当前提供了 ' + images!.length + ' 张。' },
          });
          return;
        }
      }

      // 万相2.6 / 万相2.6 Flash 图生视频只支持 1 张图片
      if ((isWan26Model || isWan26FlashModel) && isImageToVideo) {
        if (images!.length !== 1) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: `${isWan26FlashModel ? '万相2.6 Flash' : '万相2.6'} 图生视频只支持 1 张图片，当前提供了 ${images!.length} 张。` },
          });
          return;
        }
      }

      // 万相2.6 Flash 仅支持图生视频
      if (isWan26FlashModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '万相2.6 Flash 仅支持图生视频，请接入 1 张参考图。' },
        });
        return;
      }

      // 获取对应的 API Key
      const apiKey = this.getApiKey(model);
      if (!apiKey) {
        const apiKeyType = (isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isSora2Model || isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isRhartVideoGModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) ? '插件算力' : '核心算力';
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: {
            error: `${apiKeyType} API Key 未配置，请在设置中配置 ${apiKeyType} API KEY`,
          },
        });
        return;
      }

      // kling-v2.6-pro 图生视频只支持 1 张图片
      if (isKlingModel && isImageToVideo) {
        const imageCount = images!.length;
        if (imageCount !== 1) {
          const errorMessage = `kling-v2.6-pro 图生视频模式只支持 1 张图片，当前提供了 ${imageCount} 张`;
          console.error(`[视频生成] ${errorMessage}`);
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: {
              error: errorMessage,
            },
          });
          return;
        }
      }

      // 图生视频模型验证：根据 API 文档，只有特定模型支持图生视频
      if (isImageToVideo) {
        const imageCount = images!.length;
        
        // 支持首尾帧的模型（已移除 VEO，当前无）
        const supportedFirstLastFrameModels: string[] = ['rhart-v3.1-fast-se', 'rhart-v3.1-pro-se'];

        // 所有图生视频支持的模型（sora/sora2 pro/kling/万相仅 1 张，全能V3.1-fast 支持 1–3 张，首尾帧仅 2 张）
        const supportedImageToVideoModels = [
          'sora-2',
          'rhart-video-s-i2v-pro', // Sora2 Pro 图生视频，image-to-video-pro，仅 1 张
          'kling-v2.6-pro',
          'wan-2.6',
          'wan-2.6-flash',
          'rhart-v3.1-fast',
          'rhart-v3.1-fast-se',
          'rhart-v3.1-pro-se',
          'rhart-video-g',
          'hailuo-02-i2v-standard',
          'hailuo-2.3-i2v-standard',
          'kling-video-o1-i2v',
        ];

        // sora-2 / Sora2 Pro 图生 / 万相2.6 / 万相2.6 Flash / 海螺-2.3 图生 / 可灵图生o1 只支持 1 张图片
        if ((isSora2Model || isRhartVideoSI2vProModel || isWan26Model || isWan26FlashModel || isHailuo23I2vModel || isKlingVideoO1I2vModel) && imageCount > 1) {
          const name = isKlingVideoO1I2vModel ? '可灵图生视频o1' : isHailuo23I2vModel ? '海螺-2.3-图生视频-标准' : isRhartVideoSI2vProModel ? 'Sora2 Pro' : isWan26FlashModel ? '万相2.6 Flash' : isWan26Model ? '万相2.6' : 'sora-2';
          const errorMessage = `${name} 图生视频模式最多支持 1 张图片，当前提供了 ${imageCount} 张`;
          console.error(`[视频生成] ${errorMessage}`);
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: {
              error: errorMessage,
            },
          });
          return;
        }
        
        // 根据图片数量验证模型：2 张图时可选首尾帧(fast-se/pro-se)或图生(rhart-v3.1-fast/海螺-02-图生)；Grok 1.5 仅 1 张
        if (imageCount === 2) {
          const allowedForTwo = supportedFirstLastFrameModels.includes(model) || model === 'rhart-v3.1-fast' || model === 'hailuo-02-i2v-standard' || model === 'kling-video-o1-start-end';
          if (!allowedForTwo) {
            onStatus({
              nodeId,
              status: 'ERROR',
              payload: {
                error: '2 张参考图时请选择支持首尾帧或图生的模型（如全能视频V3.1-fast、全能视频G、海螺-02-图生视频-标准等）。',
              },
            });
            return;
          }
        } else {
          if (!supportedImageToVideoModels.includes(model)) {
            onStatus({
              nodeId,
              status: 'ERROR',
              payload: {
                error: `模型 ${model} 不支持图生视频。支持的模型：${supportedImageToVideoModels.join(', ')}`,
              },
            });
            return;
          }
        }
      }

      // kling 和 sora-2 模型使用不同的 API 端点和参数格式
      let payload: any;
      let apiEndpoint: string;
      
      if (isKlingModel) {
        // kling-v2.6-pro 模型参数格式（runninghub-api）
        payload = {
          prompt,
        };
        
        if (negativePrompt) {
          payload.negativePrompt = negativePrompt;
        }
        if (guidanceScale !== undefined) {
          payload.guidanceScale = guidanceScale;
        } else {
          payload.guidanceScale = 0.5; // 默认值
        }
        if (sound) {
          payload.sound = sound;
        } else {
          payload.sound = 'false'; // 默认值
        }
        if (aspect_ratio) {
          payload.aspectRatio = aspect_ratio;
        } else {
          payload.aspectRatio = '16:9'; // 默认值
        }
        if (duration === '5' || duration === '10') {
          payload.duration = duration;
        } else {
          payload.duration = '5'; // 默认值
        }
        
        // 图生视频模式：需要先处理图片 URL
        if (isImageToVideo) {
          const imageUrl = images && images.length > 0 ? images[0] : '';
          if (!imageUrl) {
            throw new Error('图生视频模式需要至少一张图片');
          }
          
          // 处理图片 URL：无论是什么格式，都先上传到阿里云 OSS，获取公网 URL
          let processedImageUrl = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          
          try {
            // 0. 检查是否已经是 OSS URL，如果是则直接使用，避免重复上传
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              // 检查是否是我们的 OSS URL
              if (imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                console.log(`[视频生成] kling-v2.6-pro 图生视频：检测到已经是 OSS URL，直接使用: ${imageUrl}`);
                processedImageUrl = imageUrl;
              } else {
                // 是其他 HTTP/HTTPS URL，需要下载后上传到 OSS
                console.log(`[视频生成] kling-v2.6-pro 图生视频：检测到 HTTP/HTTPS URL，先下载图片，然后上传至香港OSS...`);
                
                const response = await axios.get(imageUrl, {
                  responseType: 'arraybuffer',
                  timeout: 30000, // 30秒超时
                });
                
                imageBuffer = Buffer.from(response.data);
                const contentType = response.headers['content-type'] || 'image/png';
                mimeType = contentType;
                
                processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[视频生成] kling-v2.6-pro 图生视频：图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
              }
            }
            // 1. 处理本地文件路径（local-resource:// 或 file://）
            else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath: string;
              
              if (imageUrl.startsWith('local-resource://')) {
                filePath = imageUrl.replace(/^local-resource:\/\/+/, '');
              } else {
                filePath = imageUrl.replace(/^file:\/\/\/+/, '');
              }
              
              // 移除查询参数
              if (filePath.includes('?')) {
                filePath = filePath.split('?')[0];
              }
              
              // URL 解码
              try {
                filePath = decodeURIComponent(filePath);
              } catch (e) {
                console.warn('[视频生成] kling-v2.6-pro 图生视频：URL 解码失败，使用原始路径');
              }
              
              // 规范化路径
              if (!path.isAbsolute(filePath)) {
                const userDataPath = app.getPath('userData');
                filePath = path.resolve(userDataPath, filePath);
              }
              
              filePath = path.normalize(filePath);
              
              console.log(`[视频生成] kling-v2.6-pro 图生视频：读取本地文件: ${filePath}`);
              
              // 检查文件是否存在
              if (!fs.existsSync(filePath)) {
                throw new Error(`图片文件不存在: ${filePath}`);
              }
              
              // 读取文件
              imageBuffer = fs.readFileSync(filePath);
              
              // 根据文件扩展名确定 MIME 类型
              const ext = path.extname(filePath).toLowerCase();
              switch (ext) {
                case '.jpg':
                case '.jpeg':
                  mimeType = 'image/jpeg';
                  break;
                case '.png':
                  mimeType = 'image/png';
                  break;
                case '.webp':
                  mimeType = 'image/webp';
                  break;
                default:
                  mimeType = 'image/png';
              }
              
              // 上传到 OSS
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              console.log(`[视频生成] kling-v2.6-pro 图生视频：本地图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
            }
            // 2. 处理 base64 图片
            else if (imageUrl.startsWith('data:image/')) {
              const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
              if (!base64Match) {
                throw new Error('无效的 base64 图片格式');
              }
              
              const imageFormat = base64Match[1];
              const base64Data = base64Match[2];
              
              imageBuffer = Buffer.from(base64Data, 'base64');
              
              // 根据格式确定 MIME 类型
              mimeType = `image/${imageFormat}`;
              
              // 上传到 OSS
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              console.log(`[视频生成] kling-v2.6-pro 图生视频：base64 图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}...`);
            }
            
            // 将处理后的图片 URL 添加到 payload
            payload.imageUrl = processedImageUrl;
          } catch (error: any) {
            console.error('[视频生成] kling-v2.6-pro 图生视频：图片处理失败:', error);
            throw new Error(`图片处理失败: ${error.message || error}`);
          }
          
          // 图生视频端点
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/kling-v2.6-pro/image-to-video`;
        } else {
          // 文生视频端点
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/kling-v2.6-pro/text-to-video`;
        }
      } else if (isHailuo02Model) {
        // 海螺-02 文生视频标准：https://www.runninghub.cn/openapi/v2/minimax/hailuo-02/t2v-standard
        const dur = inputDurationHailuo02 === '10' ? '10' : '6';
        payload = { prompt, enablePromptExpansion: true, duration: dur };
        apiEndpoint = 'https://www.runninghub.cn/openapi/v2/minimax/hailuo-02/t2v-standard';
      } else if (isHailuo23Model) {
        // 海螺-2.3 文生视频标准：https://www.runninghub.cn/openapi/v2/minimax/hailuo-2.3/t2v-standard
        const dur = inputDurationHailuo02 === '10' ? '10' : '6';
        payload = { prompt, enablePromptExpansion: true, duration: dur };
        apiEndpoint = 'https://www.runninghub.cn/openapi/v2/minimax/hailuo-2.3/t2v-standard';
      } else if (isKlingVideoO1Model) {
        // 可灵文生视频o1：https://www.runninghub.cn/openapi/v2/kling-video-o1/text-to-video
        const ratio = (aspect_ratio === '1:1' || aspect_ratio === '9:16' || aspect_ratio === '16:9') ? aspect_ratio : '16:9';
        const dur = inputDurationKlingO1 === '10' ? '10' : '5';
        const mode = inputModeKlingO1 === 'pro' ? 'pro' : 'std';
        payload = { prompt: prompt || '', aspectRatio: ratio, duration: dur, mode };
        apiEndpoint = 'https://www.runninghub.cn/openapi/v2/kling-video-o1/text-to-video';
      } else if (isKlingVideoO1I2vModel) {
        // 可灵图生视频o1：https://www.runninghub.cn/openapi/v2/kling-video-o1/image-to-video
        // 参数：firstImageUrl(必填), prompt(可选), aspectRatio(必填), duration(5|10), mode(std|pro)
        const imageUrl = images && images.length > 0 ? images[0] : '';
        if (!imageUrl) throw new Error('可灵图生视频o1 需要 1 张参考图');
        let processedImageUrl = imageUrl;
        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        try {
          if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            if (!imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
              const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
              imageBuffer = Buffer.from(response.data);
              mimeType = (response.headers['content-type'] as string) || 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            }
          } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
            let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
            if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
            filePath = decodeURIComponent(filePath);
            if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            const userDataPath = app.getPath('userData');
            const normalizedFilePath = path.normalize(filePath);
            const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
            if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
            imageBuffer = fs.readFileSync(normalizedFilePath);
            const ext = path.extname(normalizedFilePath).toLowerCase();
            mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else if (imageUrl.startsWith('data:image/')) {
            const base64Data = imageUrl.split(',')[1];
            if (!base64Data) throw new Error('Base64 Data URL 格式无效');
            imageBuffer = Buffer.from(base64Data, 'base64');
            const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
            mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else {
            throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
          }
        } catch (err: any) {
          throw new Error(`可灵图生视频o1 图片处理失败: ${err.message || err}`);
        }
        if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
          throw new Error('图片上传失败，请检查图片格式和网络连接');
        }
        const ratio = (aspect_ratio === '1:1' || aspect_ratio === '9:16' || aspect_ratio === '16:9') ? aspect_ratio : '16:9';
        const dur = inputDurationKlingO1 === '10' ? '10' : '5';
        const mode = inputModeKlingO1 === 'pro' ? 'pro' : 'std';
        payload = { prompt: prompt || '', aspectRatio: ratio, duration: dur, firstImageUrl: processedImageUrl, mode };
        apiEndpoint = 'https://www.runninghub.cn/openapi/v2/kling-video-o1/image-to-video';
      } else if (isKlingVideoO1StartEndModel) {
        // 可灵首尾帧生视频o1：https://www.runninghub.cn/openapi/v2/kling-video-o1/start-to-end
        // 参数：firstImageUrl(必填), lastImageUrl(必填), prompt(可选), aspectRatio, duration(5|10), mode(std|pro)
        const toProcess = (images || []).slice(0, 2);
        let firstImageUrl = '';
        let lastImageUrl = '';
        for (let i = 0; i < toProcess.length; i++) {
          const imageUrl = toProcess[i];
          if (!imageUrl) continue;
          let processed = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`可灵首尾帧生视频o1 图片处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            if (i === 0) firstImageUrl = processed;
            else lastImageUrl = processed;
          }
        }
        if (!firstImageUrl || !lastImageUrl) throw new Error('可灵首尾帧生视频o1 需要首帧、尾帧共 2 张有效参考图');
        const ratio = (aspect_ratio === '1:1' || aspect_ratio === '9:16' || aspect_ratio === '16:9') ? aspect_ratio : '16:9';
        const dur = inputDurationKlingO1 === '10' ? '10' : '5';
        const mode = inputModeKlingO1 === 'pro' ? 'pro' : 'std';
        payload = { prompt: prompt || '', aspectRatio: ratio, duration: dur, firstImageUrl, lastImageUrl, mode };
        apiEndpoint = 'https://www.runninghub.cn/openapi/v2/kling-video-o1/start-to-end';
      } else if (isHailuo02I2vModel) {
        // 海螺-02 图生视频标准：https://www.runninghub.cn/openapi/v2/minimax/hailuo-02/i2v-standard
        // 参数：firstImageUrl(必填), lastImageUrl(可选), prompt(可选), enablePromptExpansion, duration(6|10)
        const dur = inputDurationHailuo02 === '10' ? '10' : '6';
        const toProcess = (images || []).slice(0, 2);
        let firstImageUrl = '';
        let lastImageUrl = '';
        for (let i = 0; i < toProcess.length; i++) {
          const imageUrl = toProcess[i];
          if (!imageUrl) continue;
          let processed = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`海螺-02 图生视频图片处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            if (i === 0) firstImageUrl = processed;
            else lastImageUrl = processed;
          }
        }
        if (!firstImageUrl) throw new Error('海螺-02 图生视频需要至少一张有效参考图');
        payload = {
          prompt: prompt || '',
          enablePromptExpansion: true,
          firstImageUrl,
          duration: dur,
        };
        if (lastImageUrl) (payload as Record<string, string>)['lastImageUrl'] = lastImageUrl;
        apiEndpoint = 'https://www.runninghub.cn/openapi/v2/minimax/hailuo-02/i2v-standard';
      } else if (isHailuo23I2vModel) {
        // 海螺-2.3 图生视频标准：https://www.runninghub.cn/openapi/v2/minimax/hailuo-2.3/i2v-standard
        // 参数：imageUrl(必填), prompt(可选), enablePromptExpansion, duration(6|10)，仅 1 张图
        const imageUrl = images && images.length > 0 ? images[0] : '';
        if (!imageUrl) throw new Error('海螺-2.3 图生视频需要 1 张参考图');
        let processedImageUrl = imageUrl;
        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        try {
          if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            if (!imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
              const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
              imageBuffer = Buffer.from(response.data);
              mimeType = (response.headers['content-type'] as string) || 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            }
          } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
            let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
            if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
            filePath = decodeURIComponent(filePath);
            if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            const userDataPath = app.getPath('userData');
            const normalizedFilePath = path.normalize(filePath);
            const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
            if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
            imageBuffer = fs.readFileSync(normalizedFilePath);
            const ext = path.extname(normalizedFilePath).toLowerCase();
            mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else if (imageUrl.startsWith('data:image/')) {
            const base64Data = imageUrl.split(',')[1];
            if (!base64Data) throw new Error('Base64 Data URL 格式无效');
            imageBuffer = Buffer.from(base64Data, 'base64');
            const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
            mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else {
            throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
          }
        } catch (err: any) {
          throw new Error(`海螺-2.3 图生视频图片处理失败: ${err.message || err}`);
        }
        if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
          throw new Error('图片上传失败，请检查图片格式和网络连接');
        }
        const dur = inputDurationHailuo02 === '10' ? '10' : '6';
        payload = { prompt: prompt || '', enablePromptExpansion: true, imageUrl: processedImageUrl, duration: dur };
        apiEndpoint = 'https://www.runninghub.cn/openapi/v2/minimax/hailuo-2.3/i2v-standard';
      } else if (isWan26Model) {
        const shotType = inputShotType === 'multi' ? 'multi' : 'single';
        const wanDuration = duration === '5' || duration === '10' || duration === '15' ? duration : '5';
        const resolutionWan26 = inputResolutionWan26 === '720p' ? '720p' : '1080p';

        if (isImageToVideo) {
          // 万相2.6 图生视频：https://www.runninghub.cn/openapi/v2/alibaba/wan-2.6/image-to-video
          // 参数：imageUrl(必填), prompt(可选), negativePrompt(可选), resolution(720p|1080p), duration(5|10|15), shotType(single|multi)
          const imageUrl = images && images.length > 0 ? images[0] : '';
          if (!imageUrl) {
            throw new Error('图生视频模式需要至少一张图片');
          }
          let processedImageUrl = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                processedImageUrl = imageUrl;
              } else {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://')
                ? imageUrl.replace(/^local-resource:\/\//, '')
                : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const projectsBaseV2 = getProjectsBasePath();
              const normalizedFilePath = path.normalize(filePath);
              const allowedV2 = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBaseV2));
              if (!allowedV2) {
                throw new Error(`访问路径超出允许范围: ${filePath}`);
              }
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`万相2.6 图生视频图片处理失败: ${err.message || err}`);
          }
          if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
            throw new Error('图片上传失败，请检查图片格式和网络连接');
          }
          payload = {
            imageUrl: processedImageUrl,
            prompt: prompt || '',
            negativePrompt: negativePrompt || '',
            resolution: resolutionWan26,
            duration: wanDuration,
            shotType,
          };
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/alibaba/wan-2.6/image-to-video`;
          console.log('[视频生成] 万相2.6 图生视频 请求体:', JSON.stringify({ ...payload, imageUrl: processedImageUrl.substring(0, 80) + '...' }, null, 2));
        } else {
          // 万相2.6 文生视频：https://www.runninghub.cn/openapi/v2/alibaba/wan-2.6/text-to-video
          const resolutionMap: Record<string, string> = {
            '16:9': '1920*1080',
            '9:16': '1080*1920',
            '1:1': '1280*720',
          };
          const resolution = resolutionMap[aspect_ratio || '16:9'] || '1920*1080';
          payload = {
            prompt,
            negativePrompt: negativePrompt || '',
            duration: wanDuration,
            resolution,
            shotType,
          };
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/alibaba/wan-2.6/text-to-video`;
        }
      } else if (isRhartV31ProSEModel) {
        // 全能视频V3.1-pro 首尾帧生视频：https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-pro/start-end-to-video
        // 参数：prompt(必填), firstFrameUrl(必填), lastFrameUrl(可选), aspectRatio(16:9|9:16), duration(可选 仅8), resolution(必填 720p|1080p|4k)
        const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        const toProcess = (images || []).slice(0, 2);
        let firstFrameUrl = '';
        let lastFrameUrl = '';
        for (let i = 0; i < toProcess.length; i++) {
          const imageUrl = toProcess[i];
          if (!imageUrl) continue;
          let processed = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`全能V3.1-pro 首尾帧生视频图片处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            if (i === 0) firstFrameUrl = processed;
            else lastFrameUrl = processed;
          }
        }
        if (!firstFrameUrl || !lastFrameUrl) throw new Error('首尾帧生视频需要恰好两张有效图片（首帧、尾帧）');
        const resProSe = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k' ? inputResolutionRhartV31 : '1080p';
        payload = {
          prompt: prompt || '',
          firstFrameUrl,
          lastFrameUrl,
          aspectRatio: ratio,
          duration: '8',
          resolution: resProSe,
        };
        apiEndpoint = `https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-pro/start-end-to-video`;
      } else if (isRhartV31ProModel) {
        // 全能视频V3.1-pro 仅文生视频：https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-pro/text-to-video
        // 参数：prompt(必填 5-8000), aspectRatio(必填 16:9|9:16), resolution(必填 720p|1080p|4k), duration(可选 8)
        const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        const resProT2v = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k' ? inputResolutionRhartV31 : '1080p';
        payload = {
          prompt,
          aspectRatio: ratio,
          resolution: resProT2v,
          duration: '8',
        };
        apiEndpoint = `https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-pro/text-to-video`;
      } else if (isRhartV31FastSEModel) {
        // 全能视频V3.1-fast 首尾帧生视频：https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/start-end-to-video
        // 参数：prompt(必填), firstFrameUrl(必填), lastFrameUrl(必填), aspectRatio(16:9|9:16), resolution(720p|1080p|4k), duration(可选8)
        const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        const res = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k' ? inputResolutionRhartV31 : '1080p';
        const toProcess = (images || []).slice(0, 2);
        let firstFrameUrl = '';
        let lastFrameUrl = '';
        for (let i = 0; i < toProcess.length; i++) {
          const imageUrl = toProcess[i];
          if (!imageUrl) continue;
          let processed = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`全能V3.1-fast 首尾帧生视频图片处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            if (i === 0) firstFrameUrl = processed;
            else lastFrameUrl = processed;
          }
        }
        if (!firstFrameUrl || !lastFrameUrl) throw new Error('首尾帧生视频需要恰好两张有效图片（首帧、尾帧）');
        payload = {
          prompt: prompt || '',
          firstFrameUrl,
          lastFrameUrl,
          aspectRatio: ratio,
          resolution: res,
          duration: '8',
        };
        apiEndpoint = `https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/start-end-to-video`;
      } else if (isRhartV31FastModel) {
        const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        const res = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k' ? inputResolutionRhartV31 : '1080p';

        if (isImageToVideo) {
          // 全能视频V3.1-fast 图生视频：https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/image-to-video
          // 参数：prompt(必填), aspectRatio(16:9|9:16), imageUrls(必填, 最多3张), resolution(720p|1080p|4k), duration(可选8)
          const toProcess = (images || []).slice(0, 3);
          const imageUrls: string[] = [];
          for (const imageUrl of toProcess) {
            if (!imageUrl) continue;
            let processed = imageUrl;
            let imageBuffer: Buffer;
            let mimeType = 'image/png';
            try {
              if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                if (!imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                  const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                  imageBuffer = Buffer.from(response.data);
                  mimeType = (response.headers['content-type'] as string) || 'image/png';
                  processed = await this.uploadImageToOSS(imageBuffer, mimeType);
                }
              } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
                let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
                if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
                filePath = decodeURIComponent(filePath);
                if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                const userDataPath = app.getPath('userData');
                const normalizedFilePath = path.normalize(filePath);
                const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
                if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
                imageBuffer = fs.readFileSync(normalizedFilePath);
                const ext = path.extname(normalizedFilePath).toLowerCase();
                mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              } else if (imageUrl.startsWith('data:image/')) {
                const base64Data = imageUrl.split(',')[1];
                if (!base64Data) throw new Error('Base64 Data URL 格式无效');
                imageBuffer = Buffer.from(base64Data, 'base64');
                const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
                mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              } else {
                throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
              }
            } catch (err: any) {
              throw new Error(`全能V3.1-fast 图生视频图片处理失败: ${err.message || err}`);
            }
            if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
              imageUrls.push(processed);
            }
          }
          if (imageUrls.length === 0) throw new Error('图生视频需要至少一张有效图片');
          payload = {
            prompt: prompt || '',
            aspectRatio: ratio,
            imageUrls,
            resolution: res,
            duration: '8',
          };
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/image-to-video`;
        } else {
          // 全能视频V3.1-fast 文生视频
          payload = {
            prompt,
            aspectRatio: ratio,
            resolution: res,
            duration: '8',
          };
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/text-to-video`;
        }
      } else if (isRhartVideoGModel) {
        const ratioG = aspect_ratio === '2:3' || aspect_ratio === '3:2' || aspect_ratio === '1:1' ? aspect_ratio : '2:3';
        const durationG = inputDurationRhartVideoG === '10s' ? '10s' : '6s';
        if (isImageToVideo) {
          // 全能视频G 图生视频：https://www.runninghub.cn/openapi/v2/rhart-video-g/image-to-video
          const toProcess = (images || []).slice(0, 3);
          const imageUrlsG: string[] = [];
          for (const imageUrl of toProcess) {
            if (!imageUrl) continue;
            let processed = imageUrl;
            let imageBuffer: Buffer;
            let mimeType = 'image/png';
            try {
              if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                if (!imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                  const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                  imageBuffer = Buffer.from(response.data);
                  mimeType = (response.headers['content-type'] as string) || 'image/png';
                  processed = await this.uploadImageToOSS(imageBuffer, mimeType);
                }
              } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
                let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
                if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
                filePath = decodeURIComponent(filePath);
                if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                const userDataPath = app.getPath('userData');
                const normalizedFilePath = path.normalize(filePath);
                const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
                if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
                imageBuffer = fs.readFileSync(normalizedFilePath);
                const ext = path.extname(normalizedFilePath).toLowerCase();
                mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              } else if (imageUrl.startsWith('data:image/')) {
                const base64Data = imageUrl.split(',')[1];
                if (!base64Data) throw new Error('Base64 Data URL 格式无效');
                imageBuffer = Buffer.from(base64Data, 'base64');
                const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
                mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              } else {
                throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
              }
            } catch (err: any) {
              throw new Error(`全能视频G 图生视频图片处理失败: ${err.message || err}`);
            }
            if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
              imageUrlsG.push(processed);
            }
          }
          if (imageUrlsG.length === 0) throw new Error('图生视频需要至少一张有效图片');
          payload = {
            prompt: prompt || '',
            aspectRatio: ratioG,
            imageUrls: imageUrlsG,
            resolution: '720P',
            duration: durationG,
          };
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/rhart-video-g/image-to-video`;
        } else {
          // 全能视频G 文生视频：https://www.runninghub.cn/openapi/v2/rhart-video-g/text-to-video
          payload = {
            prompt: prompt || '',
            aspectRatio: ratioG,
            resolution: '720P',
            duration: durationG,
          };
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/rhart-video-g/text-to-video`;
        }
      } else if (isWan26FlashModel) {
        // 万相2.6 图生视频 Flash：仅图生视频，https://www.runninghub.cn/openapi/v2/alibaba/wan-2.6/image-to-video-flash
        // 参数：prompt(必填), negativePrompt, imageUrl(必填), audioUrl(可选), resolution(720p|1080p), duration(2-15), shotType, enablePromptExpansion, enableAudio
        const imageUrl = images && images.length > 0 ? images[0] : '';
        if (!imageUrl) throw new Error('图生视频模式需要至少一张图片');
        const shotType = inputShotType === 'multi' ? 'multi' : 'single';
        const resolutionWan26 = inputResolutionWan26 === '720p' ? '720p' : '1080p';
        const flashDuration = (durationWan26Flash && /^([2-9]|1[0-5])$/.test(durationWan26Flash)) ? durationWan26Flash : '5';
        let processedImageUrl = imageUrl;
        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        try {
          if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            if (imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
              processedImageUrl = imageUrl;
            } else {
              const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
              imageBuffer = Buffer.from(response.data);
              mimeType = (response.headers['content-type'] as string) || 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            }
          } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
            let filePath = imageUrl.startsWith('local-resource://')
              ? imageUrl.replace(/^local-resource:\/\//, '')
              : imageUrl.replace(/^file:\/\//, '');
            if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
            filePath = decodeURIComponent(filePath);
            if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            const userDataPath = app.getPath('userData');
            const projectsBaseV3 = getProjectsBasePath();
            const normalizedFilePath = path.normalize(filePath);
            const allowedV3 = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBaseV3));
            if (!allowedV3) {
              throw new Error(`访问路径超出允许范围: ${filePath}`);
            }
            if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
            imageBuffer = fs.readFileSync(normalizedFilePath);
            const ext = path.extname(normalizedFilePath).toLowerCase();
            mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else if (imageUrl.startsWith('data:image/')) {
            const base64Data = imageUrl.split(',')[1];
            if (!base64Data) throw new Error('Base64 Data URL 格式无效');
            imageBuffer = Buffer.from(base64Data, 'base64');
            const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
            mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else {
            throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
          }
        } catch (err: any) {
          throw new Error(`万相2.6 Flash 图生视频图片处理失败: ${err.message || err}`);
        }
        if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
          throw new Error('图片上传失败，请检查图片格式和网络连接');
        }
        payload = {
          prompt: prompt || '',
          negativePrompt: negativePrompt || '',
          imageUrl: processedImageUrl,
          audioUrl: '',
          resolution: resolutionWan26,
          duration: flashDuration,
          shotType,
          enablePromptExpansion: inputEnablePromptExpansion === true,
          enableAudio: inputEnableAudio !== false,
        };
        apiEndpoint = `https://www.runninghub.cn/openapi/v2/alibaba/wan-2.6/image-to-video-flash`;
        console.log('[视频生成] 万相2.6 Flash 图生视频 请求体:', JSON.stringify({ ...payload, imageUrl: processedImageUrl.substring(0, 80) + '...' }, null, 2));
      } else if (isRhartVideoSI2vProModel) {
        // 全能视频S-图生视频-pro：https://www.runninghub.cn/openapi/v2/rhart-video-s/image-to-video-pro
        // 参数：prompt(必填), imageUrl(必填 1 张), duration("15"|"25"), aspectRatio("9:16"|"16:9"), storyboard: false
        const imageUrl = images && images.length > 0 ? images[0] : '';
        let processedImageUrl = imageUrl;
        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        try {
          if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            if (imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
              processedImageUrl = imageUrl;
            } else {
              const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
              imageBuffer = Buffer.from(response.data);
              mimeType = (response as any).headers['content-type'] || 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            }
          } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
            let filePath = imageUrl.replace(/^local-resource:\/\//, '').replace(/^file:\/\//, '');
            filePath = decodeURIComponent(filePath);
            if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.substring(1);
            const normalizedFilePath = path.normalize(filePath);
            const userDataPath = app.getPath('userData');
            const projectsBase = getProjectsBasePath();
            const allowed = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBase));
            if (!allowed || !fs.existsSync(normalizedFilePath)) throw new Error(allowed ? `文件不存在: ${normalizedFilePath}` : `访问路径超出允许范围: ${filePath}`);
            imageBuffer = fs.readFileSync(normalizedFilePath);
            const fileExt = path.extname(normalizedFilePath).toLowerCase();
            mimeType = fileExt === '.jpg' || fileExt === '.jpeg' ? 'image/jpeg' : fileExt === '.png' ? 'image/png' : fileExt === '.webp' ? 'image/webp' : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else if (imageUrl.startsWith('data:image/')) {
            const base64Data = imageUrl.split(',')[1];
            if (!base64Data) throw new Error('Base64 Data URL 格式无效');
            imageBuffer = Buffer.from(base64Data, 'base64');
            const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
            mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else {
            throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
          }
        } catch (error: any) {
          console.error('[视频生成] 全能视频S-图生视频-pro 处理图片失败:', error.message || error);
          throw new Error(`处理图片失败: ${error.message || error}`);
        }
        if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
          throw new Error('imageUrl 必须为可公网访问的 HTTP/HTTPS URL');
        }
        const validDuration = duration === '25' ? '25' : '15';
        const validAspectRatio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        payload = {
          prompt,
          imageUrl: processedImageUrl,
          duration: validDuration,
          aspectRatio: validAspectRatio,
          storyboard: false,
        };
        apiEndpoint = 'https://www.runninghub.cn/openapi/v2/rhart-video-s/image-to-video-pro';
        console.log('[视频生成] 全能视频S-图生视频-pro 请求体:', JSON.stringify({ ...payload, imageUrl: processedImageUrl.substring(0, 80) + '...' }, null, 2));
      } else if (model === 'sora-2-pro' && !isImageToVideo) {
        // Sora2 Pro 文生视频：https://www.runninghub.cn/openapi/v2/rhart-video-s/text-to-video-pro
        // 参数：prompt(5-4000), duration("15"|"25"), aspectRatio("9:16"|"16:9"), storyboard: false
        const validDuration = duration === '25' ? '25' : '15';
        const validAspectRatio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        payload = {
          prompt,
          duration: validDuration,
          aspectRatio: validAspectRatio,
          storyboard: false,
        };
        apiEndpoint = 'https://www.runninghub.cn/openapi/v2/rhart-video-s/text-to-video-pro';
        console.log('[视频生成] Sora2 Pro 文生视频 请求体:', JSON.stringify(payload, null, 2));
      } else if (isSora2Model) {
        // sora-2 模型参数格式
        if (isImageToVideo) {
          // 图生视频模式：需要先处理图片 URL
          // 注意：sora-2 图生视频只支持 1 张图片，使用 imageUrl 参数
          const imageUrl = images && images.length > 0 ? images[0] : '';
          if (!imageUrl) {
            throw new Error('图生视频模式需要至少一张图片');
          }
          
          // 处理图片 URL：无论是什么格式，都先上传到阿里云 OSS，获取公网 URL
          // 这是为了确保所有图片都通过 OSS 中转，保证 API 调用的稳定性
          let processedImageUrl = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          
          try {
            // 0. 检查是否已经是 OSS URL，如果是则直接使用，避免重复上传
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              // 检查是否是我们的 OSS URL
              if (imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                console.log(`[视频生成] sora-2 图生视频：检测到已经是 OSS URL，直接使用: ${imageUrl}`);
                processedImageUrl = imageUrl;
                // 跳过后续处理，直接使用这个 URL
              } else {
                // 是其他 HTTP/HTTPS URL，需要下载后上传到 OSS
                console.log(`[视频生成] sora-2 图生视频：检测到 HTTP/HTTPS URL，先下载图片，然后上传至香港OSS...`);
                
                // 使用已导入的 axios 下载图片
                const response = await axios.get(imageUrl, {
                  responseType: 'arraybuffer',
                  timeout: 30000, // 30秒超时
                });
                
                imageBuffer = Buffer.from(response.data);
                
                // 从响应头获取 MIME 类型
                const contentType = response.headers['content-type'] || 'image/png';
                mimeType = contentType;
                
                // 统一上传到 OSS
                processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[视频生成] sora-2 图生视频：图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
              }
            }
            // 1. 处理本地文件路径（local-resource:// 或 file://）
            else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath: string;
              
              if (imageUrl.startsWith('local-resource://')) {
                filePath = imageUrl.replace(/^local-resource:\/\//, '');
                filePath = decodeURIComponent(filePath);
                
                // 如果路径像 "c/Users"，修正为 "C:/Users"
                if (filePath.match(/^[a-zA-Z]\//)) {
                  filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                }
              } else {
                // file:// 协议
                filePath = imageUrl.replace(/^file:\/\//, '');
                if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
                  filePath = filePath.substring(1);
                }
                filePath = decodeURIComponent(filePath);
              }
              
              const userDataPath = app.getPath('userData');
              const projectsBaseV4 = getProjectsBasePath();
              const normalizedFilePath = path.normalize(filePath);
              const allowedV4 = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBaseV4));
              if (!allowedV4) {
                throw new Error(`访问路径超出允许范围: ${filePath}`);
              }
              if (!fs.existsSync(normalizedFilePath)) {
                throw new Error(`文件不存在: ${normalizedFilePath}`);
              }
              
              // 读取文件 Buffer
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const fileExt = path.extname(normalizedFilePath).toLowerCase();
              if (fileExt === '.jpg' || fileExt === '.jpeg') {
                mimeType = 'image/jpeg';
              } else if (fileExt === '.png') {
                mimeType = 'image/png';
              } else if (fileExt === '.webp') {
                mimeType = 'image/webp';
              }
              
              console.log(`[视频生成] sora-2 图生视频：检测到本地图片，正在上传至香港OSS...`);
              
              // 统一上传到 OSS
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              console.log(`[视频生成] sora-2 图生视频：图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
            } 
            // 2. 处理 Base64 Data URL
            else if (imageUrl.startsWith('data:image/')) {
              console.log(`[视频生成] sora-2 图生视频：检测到 Base64 Data URL，转换为 Buffer 后上传至香港OSS...`);
              
              // 提取 Base64 数据：使用 split(',')[1] 获取 base64 部分
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) {
                throw new Error('Base64 Data URL 格式无效：无法提取 base64 数据');
              }
              
              // 使用 Buffer.from 将 base64 字符串转换为二进制 Buffer
              imageBuffer = Buffer.from(base64Data, 'base64');
              
              console.log(`[视频生成] Base64 数据已转换为 Buffer，大小: ${imageBuffer.length} bytes`);
              
              // 从 Data URL 中提取 MIME 类型
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              if (mimeMatch) {
                const imageType = mimeMatch[1];
                mimeType = `image/${imageType}`;
                console.log(`[视频生成] 检测到 MIME 类型: ${mimeType}`);
              } else {
                // 如果没有匹配到，默认使用 png
                mimeType = 'image/png';
                console.log(`[视频生成] 未检测到 MIME 类型，使用默认: ${mimeType}`);
              }
              
              // 统一上传到 OSS
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              console.log(`[视频生成] sora-2 图生视频：图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
            }
            // 3. 其他格式不支持
            else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (error: any) {
            console.error(`[视频生成] sora-2 图生视频：处理图片失败:`, error.message || error);
            throw new Error(`处理图片失败: ${error.message || error}`);
          }
          
          // 验证 imageUrl 必须是 HTTP/HTTPS URL 格式
          if (!processedImageUrl) {
            throw new Error('imageUrl 不能为空');
          }
          
          // 检查 URL 格式：必须是 HTTP/HTTPS URL
          const isValidHttpUrl = processedImageUrl.startsWith('http://') || processedImageUrl.startsWith('https://');
          
          if (!isValidHttpUrl) {
            // 不是 HTTP/HTTPS URL，说明上传失败
            if (processedImageUrl.startsWith('local-resource://') || processedImageUrl.startsWith('file://')) {
              throw new Error('图片上传失败，请检查图片格式和网络连接，或稍后重试。如果问题持续，请检查 OSS 配置。');
            } else {
              throw new Error(`imageUrl 格式无效，必须是 HTTP/HTTPS URL，当前格式: ${processedImageUrl.substring(0, 100)}`);
            }
          }
          
          // 构建新的 API 请求
          // 请求地址：https://www.runninghub.cn/openapi/v2/rhart-video-s/image-to-video
          // 参数限制：duration 仅支持 "10" 或 "15"（字符串），aspectRatio 仅支持 "9:16" 或 "16:9"（字符串）
          const validDuration = duration === '10' || duration === '15' ? String(duration) : '10';
          const validAspectRatio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? String(aspect_ratio) : '16:9';
          
          // 构建请求体，字段顺序与 API 文档示例保持一致
          payload = {
            prompt: prompt,
            duration: validDuration, // 确保是字符串类型，只支持 "10" 或 "15"
            imageUrl: processedImageUrl, // OSS 公网 URL（由于权限是公共读，RunningHub能直接拉取）
            aspectRatio: validAspectRatio, // 确保是字符串类型，只支持 "9:16" 或 "16:9"
          };
          
          // 新的 API 端点
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/rhart-video-s/image-to-video`;
          
          // 日志确认：确保使用的是 OSS URL，而不是 Base64
          console.log(`[视频生成] sora-2 图生视频：最终请求体（imageUrl 已替换为 OSS URL）:`, JSON.stringify({
            prompt: prompt,
            duration: validDuration,
            imageUrl: processedImageUrl, // 完整 URL，用于调试
            aspectRatio: validAspectRatio,
          }, null, 2));
        } else {
          // 文生视频模式（保持原有逻辑）
          payload = {
            prompt,
            duration: String(duration === '10' || duration === '15' ? duration : '10'), // 确保是字符串类型，只支持 "10" 或 "15"
            aspectRatio: String(aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9'), // 确保是字符串类型，只支持 "9:16" 或 "16:9"
          };
          
          // runninghub-api 文生视频端点
          apiEndpoint = `https://www.runninghub.cn/openapi/v2/rhart-video-s/text-to-video`;
        }
      } else {
        // 全能视频V3.1-pro / 全能视频V3.1-fast 首尾帧 仅走 RunningHub，若落入此处说明未命中上方分支（多为旧构建）
        if (String(model) === 'rhart-v3.1-pro' || String(model) === 'rhart-v3.1-fast-se' || String(model) === 'rhart-v3.1-pro-se' || String(model) === 'rhart-video-g') {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: {
              error: '该模型需使用插件算力接口。请完全退出应用后重新打开，或重新执行 npm run build:main 后重启。',
            },
          });
          return;
        }
        // 其他模型使用原有格式（BLTCY 核心算力）
        payload = {
          prompt,
          model,
          aspect_ratio,
        };

        // sora-2-pro 系列参数（使用 bltcy-api）
        if (model === 'sora-2-pro') {
          payload.hd = hd;
          payload.duration = duration;
        }

        apiEndpoint = `${this.apiBaseUrl}/v2/videos/generations`;
      }

      // 注意：sora-2、全能视频S-图生视频-pro、万相2.6、万相2.6 Flash、全能V3.1-fast/pro 图生/首尾帧已在上面单独处理，这里只处理其他模型（如 kling）
      if (isImageToVideo && !isSora2Model && !isRhartVideoSI2vProModel && !isWan26Model && !isWan26FlashModel && !isRhartV31FastModel && !isRhartV31FastSEModel && !isRhartV31ProSEModel && !isRhartVideoGModel) {
        // 处理图片URL：将 local-resource:// 和 file:// 上传到 OSS
        const processedImages = await Promise.all(
          images!.slice(0, 10).map(async (imageUrl) => {
            // 如果是 local-resource:// 或 file://，转换为 base64
            if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              try {
                let filePath: string;
                
                if (imageUrl.startsWith('local-resource://')) {
                  filePath = imageUrl.replace(/^local-resource:\/\//, '');
                  filePath = decodeURIComponent(filePath);
                  
                  // 如果路径像 "c/Users"，修正为 "C:/Users"
                  if (filePath.match(/^[a-zA-Z]\//)) {
                    filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                  }
                } else {
                  // file:// 协议
                  filePath = imageUrl.replace(/^file:\/\//, '');
                  if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
                    filePath = filePath.substring(1);
                  }
                  filePath = decodeURIComponent(filePath);
                }
                
                const userDataPath = app.getPath('userData');
                const projectsBaseV5 = getProjectsBasePath();
                const normalizedFilePath = path.normalize(filePath);
                const allowedV5 = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBaseV5));
                if (!allowedV5) {
                  console.error(`[视频生成] 访问路径超出允许范围: ${filePath}`);
                  return imageUrl;
                }
                if (!fs.existsSync(normalizedFilePath)) {
                  console.error(`[视频生成] 文件不存在: ${normalizedFilePath}`);
                  return imageUrl; // 返回原URL，让API处理
                }
                
                // 读取文件并上传到 OSS
                const imageBuffer = fs.readFileSync(normalizedFilePath);
                const fileExt = path.extname(normalizedFilePath).toLowerCase();
                let mimeType = 'image/png';
                if (fileExt === '.jpg' || fileExt === '.jpeg') {
                  mimeType = 'image/jpeg';
                } else if (fileExt === '.png') {
                  mimeType = 'image/png';
                } else if (fileExt === '.webp') {
                  mimeType = 'image/webp';
                }
                
                // 上传到 OSS，获取公网 URL
                const ossUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[视频生成] 将本地图片上传到 OSS: ${normalizedFilePath} -> ${ossUrl}`);
                return ossUrl;
              } catch (error: any) {
                console.error(`[视频生成] 转换本地图片失败: ${imageUrl}`, error.message || error);
                return imageUrl; // 返回原URL，让API处理
              }
            }
            // HTTP/HTTPS URL：如果是 OSS URL，直接返回；如果是其他 URL，下载后上传到 OSS
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              // 检查是否是我们的 OSS URL
              if (imageUrl.includes('nexflow-temp-images.oss-cn-hongkong.aliyuncs.com')) {
                // 已经是 OSS URL，直接返回，避免重复上传
                console.log(`[视频生成] 检测到已经是 OSS URL，直接使用: ${imageUrl}`);
                return imageUrl;
              } else {
                // 是其他 HTTP/HTTPS URL，下载后上传到 OSS
                try {
                  console.log(`[视频生成] 检测到其他 HTTP/HTTPS URL，下载后上传到 OSS: ${imageUrl}`);
                  const response = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                  });
                  
                  const imageBuffer = Buffer.from(response.data);
                  const contentType = response.headers['content-type'] || 'image/png';
                  const mimeType = contentType;
                  
                  const ossUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                  console.log(`[视频生成] 将 HTTP/HTTPS 图片上传到 OSS: ${ossUrl}`);
                  return ossUrl;
                } catch (error: any) {
                  console.error(`[视频生成] 下载并上传 HTTP/HTTPS 图片失败: ${error.message || error}`);
                  return imageUrl; // 失败时返回原 URL
                }
              }
            } else if (imageUrl.startsWith('data:image/')) {
              // Base64 Data URL：转换为 Buffer 后上传到 OSS
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) {
                console.warn(`[视频生成] Base64 Data URL 格式无效，返回原 URL: ${imageUrl.substring(0, 50)}`);
                return imageUrl;
              }
              
              const imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              const mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              
              try {
                const ossUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[视频生成] 将 Base64 图片上传到 OSS: ${ossUrl}`);
                return ossUrl;
              } catch (error: any) {
                console.error(`[视频生成] 上传 Base64 图片到 OSS 失败: ${error.message || error}`);
                return imageUrl; // 失败时返回原 URL
              }
            }
            // 其他格式，直接返回
            return imageUrl;
          })
        );
        
        payload.images = processedImages;
      }
      // 注意：sora-2 图生视频模式的图片 URL 已在上面处理，直接使用 imageUrl 参数
      if (notify_hook) payload.notify_hook = notify_hook;
      if (typeof watermark === 'boolean') payload.watermark = watermark;
      if (typeof isPrivate === 'boolean') payload.private = isPrivate;

      console.log(
        `[视频生成] 模式: ${isImageToVideo ? '图生视频' : '文生视频'}, 模型: ${model}, 比例: ${aspect_ratio}${
          isWan26Model
            ? `, 时长: ${duration || '5'}, 镜头: ${inputShotType || 'single'}${isImageToVideo ? `, 分辨率: ${inputResolutionWan26 || '1080p'}` : ''}`
            : isRhartV31ProModel || isRhartV31ProSEModel
            ? `, 比例: ${aspect_ratio || '16:9'}`
            : isRhartVideoGModel
            ? `, 比例: ${aspect_ratio || '2:3'}, 时长: ${inputDurationRhartVideoG || '6s'}`
            : isRhartV31FastSEModel || isRhartV31FastModel
            ? `, 比例: ${aspect_ratio || '16:9'}, 分辨率: ${inputResolutionRhartV31 || '1080p'}`
            : isWan26FlashModel
            ? `, 时长: ${durationWan26Flash || '5'}s, 镜头: ${inputShotType || 'single'}, 分辨率: ${inputResolutionWan26 || '1080p'}, 音频: ${inputEnableAudio !== false}`
            : isKlingModel
            ? `, 自由度: ${guidanceScale || 0.5}, 声音: ${sound || 'false'}, 时长: ${duration || '5'}`
            : `, 时长: ${duration}, 高清: ${hd}`
        }, 参考图数量: ${isImageToVideo ? images!.length : 0}`,
      );

      // 发送 PROCESSING 状态
      onStatus({
        nodeId,
        status: 'PROCESSING',
      });

      const response = await axios.post(
        apiEndpoint,
        payload,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          proxy: false,
          timeout: 300000, // 视频生成可能较慢，给足 5 分钟
        },
      );

      console.log('[视频生成] 原始响应:', JSON.stringify(response.data, null, 2));

      const data = response.data || {};

      // runninghub-api kling-v2.6-pro 可能直接返回视频 URL 或返回 task_id
      // 其他模型返回格式：{ task_id, ... }
      let taskId: string | undefined;
      let videoUrl: string | undefined;
      
      if (isKlingModel) {
        // runninghub-api 响应格式（文档未明确说明，先尝试多种可能）
        // 可能直接返回视频 URL，也可能返回 task_id 需要轮询
        if (data.code !== undefined && data.code !== 0) {
          throw new Error(data.message || `API 返回错误: code=${data.code}`);
        }
        
        // 尝试提取视频 URL（可能直接返回）
        videoUrl = data.videoUrl || 
                  data.video_url || 
                  data.url || 
                  data.data?.videoUrl ||
                  data.data?.video_url ||
                  data.data?.url ||
                  data.data?.output ||
                  (Array.isArray(data.data) && data.data[0]?.url);
        
        // 如果没有视频 URL，尝试提取 task_id（可能需要轮询）
        if (!videoUrl) {
          taskId = data.taskId || 
                  data.task_id || 
                  data.data?.taskId ||
                  data.data?.task_id;
        }
      } else if (isSora2Model && isImageToVideo) {
        // sora-2 图生视频接口响应格式（https://www.runninghub.cn/openapi/v2/rhart-video-s/image-to-video）
        // 可能返回格式：{ taskId, ... } 或 { task_id, ... }
        taskId = data.taskId ||
                 data.task_id ||
                 data.data?.taskId ||
                 data.data?.task_id;
        videoUrl = data.videoUrl ||
                  data.video_url ||
                  data.url ||
                  data.data?.videoUrl ||
                  data.data?.video_url ||
                  data.data?.url ||
                  data.data?.output ||
                  (Array.isArray(data.data) && data.data[0]?.url);
        
        // 如果获取到 taskId，存储到 store 中以便后续追踪
        if (taskId) {
          console.log(`[视频生成] sora-2 图生视频：获取到 taskId: ${taskId}，已存储到状态中`);
          // 可以将 taskId 存储到 store 中，但通常通过 onStatus 回调传递给前端即可
        }
      } else if (isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isRhartVideoGModel || isRhartVideoSI2vProModel || isSora2ProModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel) {
        taskId = data.taskId || data.task_id || data.data?.taskId || data.data?.task_id;
        videoUrl = data.results?.[0]?.url || data.data?.results?.[0]?.url || data.url || data.data?.url;
      } else {
        // 其他模型响应格式
        taskId = data.task_id || data.taskId;
        videoUrl = data.data?.output ||
                  data.video_url || 
                  data.url || 
                  (Array.isArray(data.data) && data.data[0]?.url);
      }

      // 如果是 veo、kling、sora-2 或 wan-2.6 且返回了 task_id，需要轮询获取结果
      let successSent = false; // 标记是否已发送 SUCCESS 状态
      if ((isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isSora2Model || isSora2ProModel || isRhartVideoSI2vProModel || isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isRhartVideoGModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) && taskId && !videoUrl) {
        console.log(`[视频生成] ${model} 返回 task_id: ${taskId}，开始轮询...`);
        
        // 轮询配置：10 分钟总超时时间
        const totalTimeout = 10 * 60 * 1000; // 10 分钟（毫秒）
        const startTime = Date.now();
        let attempt = 0;
        let lastPollTime = startTime;
        
        // 统一使用模拟进度引擎（所有视频模型）
        const { createProgressEngine } = await import('../utils/ProgressHelper.js');
        const progressEngine = createProgressEngine('video', startTime);
        
        // runninghub-api kling、sora-2、万相2.6 使用通用查询接口
        const pollEndpoint = (isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isSora2Model || isSora2ProModel || isRhartVideoSI2vProModel || isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isRhartVideoGModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel)
          ? `https://www.runninghub.cn/openapi/v2/query`
          : `${this.apiBaseUrl}/v2/videos/generations/${taskId}`;
        
        // 轮询循环：只有 SUCCESS 或 FAILURE 时才停止
        while (true) {
          // 检查总超时时间
          const elapsed = Date.now() - startTime;
          if (elapsed >= totalTimeout) {
            throw new Error(`轮询超时（10分钟）：无法获取视频结果，任务 ID: ${taskId}`);
          }
          
          // 更新统一模拟进度条（所有视频模型）
          const currentProgress = progressEngine.getProgress();
          const progressMessage = progressEngine.getMessage();
          
          // 发送进度更新
          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: {
              progress: currentProgress,
              text: progressMessage, // 只显示轮播文字，不显示百分比
            },
          });
          
          // 计算轮询间隔：前 30 秒每 2 秒，之后每 5 秒
          const timeSinceStart = Date.now() - startTime;
          const pollInterval = timeSinceStart < 30000 ? 2000 : 5000;
          
          // 等待到下一次轮询时间
          const timeSinceLastPoll = Date.now() - lastPollTime;
          if (timeSinceLastPoll < pollInterval) {
            await new Promise(resolve => setTimeout(resolve, pollInterval - timeSinceLastPoll));
          }
          
          attempt++;
          lastPollTime = Date.now();
          
          try {
            // runninghub-api 使用 POST 方法查询任务
            let pollResponse;
            if (isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isSora2Model || isSora2ProModel || isRhartVideoSI2vProModel || isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isRhartVideoGModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) {
              // kling、可灵o1、sora-2、sora-2-pro、全能视频S-图生视频-pro、万相2.6、全能V3.1、全能视频G、海螺 使用 POST 方法，请求体包含 taskId
              pollResponse = await axios.post(
                pollEndpoint,
                { taskId },
                {
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                  },
                  proxy: false,
                  timeout: 15000, // 15 秒请求超时
                },
              );
            } else {
              // 其他模型使用 GET 方法
              pollResponse = await axios.get(
                pollEndpoint,
                {
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                  },
                  proxy: false,
                  timeout: 15000, // 15 秒请求超时
                },
              );
            }
            
            const pollData = pollResponse.data || {};
            console.log(`[视频生成] 轮询结果 (第 ${attempt} 次，已用时 ${Math.floor(elapsed / 1000)} 秒):`, JSON.stringify(pollData, null, 2));
            
            // runninghub-api kling-v2.6-pro 和 sora-2 响应格式：{ taskId, status, results, ... }
            // 其他模型响应格式：{ status, ... }
            let status: string | undefined;
            let progress: string | undefined;
            
            if (isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isSora2Model || isSora2ProModel || isRhartVideoSI2vProModel || isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isRhartVideoGModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel) {
              // runninghub-api 响应格式
              // status: QUEUED | RUNNING | FAILED | SUCCESS
              status = pollData.status;
              
              // 转换状态格式
              if (status === 'SUCCESS') {
                status = 'SUCCESS';
              } else if (status === 'FAILED') {
                status = 'FAILURE';
              } else if (status === 'RUNNING') {
                status = 'IN_PROGRESS';
              } else if (status === 'QUEUED') {
                status = 'NOT_START';
              }
              
              // 检查是否有错误（在状态转换后检查，避免重复处理）
              // 如果状态已经是 FAILED，会在后面统一处理
              if (status !== 'FAILURE' && pollData.errorCode && pollData.errorCode !== '') {
                // 非 FAILED 状态但有错误码，可能是警告，记录但不抛出
                console.warn(`[视频生成] 检测到错误码: ${pollData.errorCode}, 消息: ${pollData.errorMessage}`);
              }
              
              // runninghub-api 不提供进度百分比，统一使用模拟进度
              // 如果状态是 RUNNING 或 QUEUED，继续使用模拟进度
              if (status === 'IN_PROGRESS' || status === 'NOT_START') {
                // 使用进度引擎的当前值
                const currentProgress = progressEngine.getProgress();
                progress = `${currentProgress}%`;
              } else {
                progress = '100%';
              }
            } else {
              // 其他模型也统一使用模拟进度（废弃真实进度读取）
              status = pollData.status;
              // 使用进度引擎的当前值，而不是从 API 读取
              const currentProgress = progressEngine.getProgress();
              progress = `${currentProgress}%`;
              
              // 对于其他模型，如果状态是 SUCCESS，检查是否有 output
              if (status === 'SUCCESS' && pollData.data?.output) {
                // 提前提取 URL，避免后续逻辑遗漏
                console.log(`[视频生成] 检测到 SUCCESS 状态，提前提取 URL: ${pollData.data.output}`);
              }
            }
            
            // 进度值已通过 progressEngine.getProgress() 获取，无需再次计算
            
            // 尝试从多个可能的字段中获取视频 URL
            let possibleVideoUrl: string | undefined;
            if (isKlingModel) {
              // 可灵 (Kling) 路径：response.data.data.task_result.videos[0].url
              // 也支持 runninghub-api 的 results 格式
              if (pollData.data?.task_result?.videos && Array.isArray(pollData.data.task_result.videos) && pollData.data.task_result.videos.length > 0) {
                possibleVideoUrl = pollData.data.task_result.videos[0]?.url;
                console.log(`[视频生成] kling-v2.6-pro - 从 data.task_result.videos[0].url 提取到视频 URL: ${possibleVideoUrl}`);
              } else if (Array.isArray(pollData.results) && pollData.results.length > 0) {
                // runninghub-api 响应格式：results 数组中包含 url
                possibleVideoUrl = pollData.results[0]?.url;
                console.log(`[视频生成] kling-v2.6-pro - 从 results[0].url 提取到视频 URL: ${possibleVideoUrl}`);
              } else {
                console.warn(`[视频生成] kling-v2.6-pro - 未找到视频 URL，完整响应:`, JSON.stringify(pollData, null, 2));
              }
            } else if (isSora2Model || isSora2ProModel || isRhartVideoSI2vProModel || isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isRhartVideoGModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel) {
              const resultsArray = Array.isArray(pollData.results) ? pollData.results : pollData.data?.results;
              if (resultsArray && resultsArray.length > 0 && resultsArray[0]?.url) {
                possibleVideoUrl = resultsArray[0].url;
                const name = isRhartVideoSI2vProModel ? 'rhart-video-s-i2v-pro' : isSora2ProModel ? 'sora-2-pro' : isKlingVideoO1StartEndModel ? 'kling-video-o1-start-end' : isKlingVideoO1I2vModel ? 'kling-video-o1-i2v' : isKlingVideoO1Model ? 'kling-video-o1' : isHailuo23I2vModel ? 'hailuo-2.3-i2v-standard' : isHailuo02I2vModel ? 'hailuo-02-i2v-standard' : isHailuo23Model ? 'hailuo-2.3-t2v-standard' : isHailuo02Model ? 'hailuo-02-t2v-standard' : isRhartVideoGModel ? 'rhart-video-g' : isRhartV31ProSEModel ? 'rhart-v3.1-pro-se' : isRhartV31ProModel ? 'rhart-v3.1-pro' : isRhartV31FastSEModel ? 'rhart-v3.1-fast-se' : isRhartV31FastModel ? 'rhart-v3.1-fast' : isWan26FlashModel ? 'wan-2.6-flash' : isWan26Model ? 'wan-2.6' : 'sora-2';
                console.log(`[视频生成] ${name} - 从 results[0].url 提取到视频 URL: ${possibleVideoUrl}`);
              } else {
                const name = isRhartVideoSI2vProModel ? 'rhart-video-s-i2v-pro' : isSora2ProModel ? 'sora-2-pro' : isKlingVideoO1StartEndModel ? 'kling-video-o1-start-end' : isKlingVideoO1I2vModel ? 'kling-video-o1-i2v' : isKlingVideoO1Model ? 'kling-video-o1' : isHailuo23I2vModel ? 'hailuo-2.3-i2v-standard' : isHailuo02I2vModel ? 'hailuo-02-i2v-standard' : isHailuo23Model ? 'hailuo-2.3-t2v-standard' : isHailuo02Model ? 'hailuo-02-t2v-standard' : isRhartVideoGModel ? 'rhart-video-g' : isRhartV31ProSEModel ? 'rhart-v3.1-pro-se' : isRhartV31ProModel ? 'rhart-v3.1-pro' : isRhartV31FastSEModel ? 'rhart-v3.1-fast-se' : isRhartV31FastModel ? 'rhart-v3.1-fast' : isWan26FlashModel ? 'wan-2.6-flash' : isWan26Model ? 'wan-2.6' : 'sora-2';
                console.warn(`[视频生成] ${name} - 未找到视频 URL，完整响应:`, JSON.stringify(pollData, null, 2));
              }
            } else if (isKlingModel) {
              // kling 模型在 SUCCESS 时再次尝试提取 URL
              if (!possibleVideoUrl) {
                // 尝试深层路径：data.data.task_result.videos[0].url
                const deepTaskResult = pollData.data?.data?.task_result;
                const deepVideos = deepTaskResult?.videos;
                if (Array.isArray(deepVideos) && deepVideos.length > 0 && deepVideos[0]?.url) {
                  possibleVideoUrl = deepVideos[0].url;
                  console.log(`[视频生成] kling 模型 - 从 data.data.task_result.videos[0].url 提取到 URL: ${possibleVideoUrl}`);
                } else {
                  // 尝试浅层路径：data.task_result.videos[0].url
                  const taskResult = pollData.data?.task_result;
                  const videos = taskResult?.videos;
                  if (Array.isArray(videos) && videos.length > 0 && videos[0]?.url) {
                    possibleVideoUrl = videos[0].url;
                    console.log(`[视频生成] kling 模型 - 从 data.task_result.videos[0].url 提取到 URL: ${possibleVideoUrl}`);
                  }
                }
              }
            } else {
              // 其他模型响应格式
              possibleVideoUrl = pollData.data?.output || 
                                pollData.video_url || 
                                pollData.url || 
                                (Array.isArray(pollData.data) && pollData.data[0]?.url) ||
                                pollData.result?.video_url || 
                                pollData.result?.url ||
                                pollData.output ||
                                pollData.videoUrl;
            }
            
            console.log(`[视频生成] 最终提取的视频 URL: ${possibleVideoUrl}, 状态: ${status}`);
            
            // 状态闭环：只有 SUCCESS 或 FAILURE 时才停止
            // 注意：对于 kling 模型，即使状态是 succeed，也要检查是否有视频 URL
            // 确保状态统一为 SUCCESS 格式
            const finalStatus = (status === 'SUCCESS' || (isKlingModel && status === 'succeed')) ? 'SUCCESS' : status;
            
            if (finalStatus === 'SUCCESS') {
              // 如果是 kling 模型且还没有提取到 URL，再次尝试提取
              // 可灵 (Kling) 路径：response.data.data.task_result.videos[0].url
              if (isKlingModel && !possibleVideoUrl) {
                // 尝试深层路径：data.data.task_result.videos[0].url
                const deepTaskResult = pollData.data?.data?.task_result;
                const deepVideos = deepTaskResult?.videos;
                if (Array.isArray(deepVideos) && deepVideos.length > 0 && deepVideos[0]?.url) {
                  possibleVideoUrl = deepVideos[0].url;
                  console.log(`[视频生成] kling 模型 - 从 data.data.task_result.videos[0].url 提取到 URL: ${possibleVideoUrl}`);
                } else {
                  // 尝试浅层路径：data.task_result.videos[0].url
                  const taskResult = pollData.data?.task_result;
                  const videos = taskResult?.videos;
                  console.log(`[视频生成] kling 模型 - 在 SUCCESS 检查时重新提取 URL，videos:`, JSON.stringify(videos, null, 2));
                  if (Array.isArray(videos) && videos.length > 0 && videos[0]?.url) {
                    possibleVideoUrl = videos[0].url;
                    console.log(`[视频生成] kling 模型 - 从 data.task_result.videos[0].url 提取到 URL: ${possibleVideoUrl}`);
                  }
                }
              }
              
              // 对于所有模型，如果状态是 SUCCESS 但还没有提取到 URL，再次尝试从 data.output 提取
              // 这是为了处理不同 API 平台可能返回的不同格式
              if (!possibleVideoUrl) {
                const fallbackUrl = pollData.data?.results?.[0]?.url ||
                                   pollData.data?.output ||
                                   pollData.output ||
                                   pollData.data?.video_url ||
                                   pollData.data?.url ||
                                   pollData.video_url ||
                                   pollData.url;
                if (fallbackUrl) {
                  possibleVideoUrl = fallbackUrl;
                  console.log(`[视频生成] SUCCESS 状态 - 从备用路径提取到 URL: ${possibleVideoUrl}`);
                } else {
                  console.warn(`[视频生成] SUCCESS 状态但未找到 URL，完整响应:`, JSON.stringify(pollData, null, 2));
                  console.warn(`[视频生成] 尝试的路径: data.output=${pollData.data?.output}, output=${pollData.output}, data.video_url=${pollData.data?.video_url}`);
                }
              }
              
              // 状态为 SUCCESS，立即提取视频 URL
              if (possibleVideoUrl) {
                videoUrl = possibleVideoUrl;
                console.log(`[视频生成] 任务状态 SUCCESS，视频 URL: ${videoUrl}`);
                // 自动下载并保存视频到本地（如果 videoUrl 是远程 URL）
                let localPath: string | undefined;
                let finalVideoUrl = videoUrl;
                
                if (videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://'))) {
                  try {
                    // 自动下载视频到本地
                    const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
                    // 从 input 中获取项目 ID（如果存在）
                    const projectId = (input as any)?.projectId;
                    const nodeTitle = (input as any)?.nodeTitle || 'video';
                    
                    const downloadedPath = await autoDownloadResource(
                      videoUrl,
                      'video',
                      {
                        resourceType: 'video',
                        nodeId: nodeId,
                        nodeTitle: nodeTitle,
                        projectId: projectId,
                      }
                    );
                    
                    if (downloadedPath) {
                      localPath = downloadedPath;
                      // 使用本地路径作为最终 URL
                      finalVideoUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
                      console.log(`[视频生成] 视频已自动下载到本地: ${localPath}`);
                    }
                  } catch (downloadError) {
                    console.error(`[视频生成] 自动下载视频失败:`, downloadError);
                    // 下载失败不影响视频显示，继续使用远程 URL
                  }
                }
                
                // 立即发送 SUCCESS 状态，停止进度显示
                onStatus({
                  nodeId,
                  status: 'SUCCESS',
                  payload: {
                    url: finalVideoUrl, // 优先使用本地路径
                    videoUrl: finalVideoUrl,
                    originalVideoUrl: videoUrl, // 保存原始远程 URL
                    localPath: localPath, // 传递本地路径
                    text: `视频生成完成: ${finalVideoUrl}`,
                    taskId: taskId,
                    progress: 100, // 确保进度为 100%
                  },
                });
                successSent = true; // 标记已发送 SUCCESS
                break; // 立即退出轮询循环
              } else {
                // 状态为SUCCESS但没有URL，可能是API返回格式不同，立即再次轮询一次
                console.warn(`[视频生成] 任务状态为 ${status}，但未找到视频 URL`);
                console.warn(`[视频生成] 完整响应数据:`, JSON.stringify(pollData, null, 2));
                console.warn(`[视频生成] data.task_result:`, JSON.stringify(pollData.data?.task_result, null, 2));
                console.warn(`[视频生成] data.task_result.videos:`, JSON.stringify(pollData.data?.task_result?.videos, null, 2));
                // 对于 kling 模型，如果状态是 SUCCESS 但没有 URL，可能是视频还在生成中，继续轮询
                if (isKlingModel) {
                  // 等待 2 秒后继续轮询
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  continue;
                } else {
                  // 其他模型，不等待，立即继续下一次循环
                  continue;
                }
              }
            } else if (status === 'FAILURE' || status === 'FAILED' || pollData.status === 'FAILED') {
              // 状态为 FAILURE 或 FAILED，停止轮询并发送错误状态
              // 注意：检查原始 pollData.status，因为可能在某些情况下状态转换有问题
              let failReason = pollData.fail_reason || pollData.error || pollData.message || '视频生成失败';
              
              // 对于 runninghub-api，优先使用 errorMessage 和 errorCode
              if (isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isSora2Model || isSora2ProModel || isRhartVideoSI2vProModel || isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isRhartVideoGModel) {
                if (pollData.errorMessage) {
                  failReason = pollData.errorMessage;
                  if (pollData.errorCode) {
                    failReason = `[错误码: ${pollData.errorCode}] ${pollData.errorMessage}`;
                  }
                } else if (pollData.errorCode) {
                  failReason = `错误码: ${pollData.errorCode}`;
                }
              }
              
              console.error(`[视频生成] 任务失败: ${failReason}`);
              console.error(`[视频生成] 任务状态详情:`, JSON.stringify(pollData, null, 2));
              
              // 发送 ERROR 状态，停止进度条
              onStatus({
                nodeId,
                status: 'ERROR',
                payload: {
                  error: failReason,
                  progress: 0, // 停止进度条
                  text: `视频生成失败: ${failReason}`,
                },
              });
              
              // 退出轮询循环
              break;
            }
            
            // 只有在任务未完成且未发送SUCCESS时才发送进度更新
            if (!successSent && status !== 'SUCCESS' && status !== 'FAILURE' && status !== 'FAILED') {
              // 发送进度更新（统一使用模拟进度引擎）
              const displayProgress = progressEngine.getProgress();
              const progressMessage = progressEngine.getMessage();
              
              onStatus({
                nodeId,
                status: 'PROCESSING',
                payload: {
                  progress: displayProgress,
                  text: progressMessage, // 只显示轮播文字，不显示百分比
                },
              });
              
              if (status === 'NOT_START' || status === 'IN_PROGRESS') {
                // 继续轮询
                console.log(`[视频生成] 任务状态: ${status}, 进度: ${progress}`);
              } else if (status && status !== 'SUCCESS' && status !== 'FAILURE' && status !== 'FAILED') {
                // 未知状态，继续轮询
                console.warn(`[视频生成] 未知任务状态: ${status}，继续轮询...`);
              }
            }
          } catch (pollError: any) {
            // 健壮的错误处理：捕获网络错误并重试
            const errorMessage = pollError?.message || String(pollError);
            const isConnectionError = 
              errorMessage.includes('ECONNRESET') ||
              errorMessage.includes('socket hang up') ||
              errorMessage.includes('ETIMEDOUT') ||
              errorMessage.includes('ECONNREFUSED') ||
              pollError?.code === 'ECONNRESET' ||
              pollError?.code === 'ETIMEDOUT' ||
              pollError?.code === 'ECONNREFUSED';
            
            if (isConnectionError) {
              // 网络连接错误，等待 5 秒后重试
              console.warn(`[视频生成] 轮询网络错误 (第 ${attempt} 次): ${errorMessage}，等待 5 秒后重试...`);
              await new Promise(resolve => setTimeout(resolve, 5000));
              lastPollTime = Date.now(); // 重置最后轮询时间
              continue; // 继续轮询，不退出
            } else if (pollError?.response?.status === 404) {
              // 404 错误：任务不存在，可能任务 ID 错误
              console.error(`[视频生成] 任务不存在 (404): ${taskId}`);
              throw new Error(`任务不存在，任务 ID: ${taskId}`);
            } else {
              // 其他错误，记录但继续尝试
              console.warn(`[视频生成] 轮询失败 (第 ${attempt} 次): ${errorMessage}`);
              // 继续轮询，不退出（除非是明确的业务错误）
              if (pollError?.response?.status >= 400 && pollError?.response?.status < 500) {
                // 4xx 客户端错误，可能是任务 ID 错误或其他业务错误
                const errorMsg = pollError?.response?.data?.error || pollError?.response?.data?.message || errorMessage;
                throw new Error(`轮询失败: ${errorMsg}`);
              }
              // 5xx 服务器错误或其他错误，继续重试
              await new Promise(resolve => setTimeout(resolve, 5000));
              lastPollTime = Date.now();
            }
          }
        }
      }

      // 只有在轮询中没有发送 SUCCESS 状态时才发送（避免重复）
      if (!successSent) {
        if (videoUrl) {
          // 首次响应即带 videoUrl：与轮询 SUCCESS 一致，尝试下载到本地并传 originalVideoUrl，确保前端能显示
          let finalVideoUrl = videoUrl;
          let localPath: string | undefined;
          if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
            try {
              const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
              const projectId = (input as any)?.projectId;
              const nodeTitle = (input as any)?.nodeTitle || 'video';
              const downloadedPath = await autoDownloadResource(videoUrl, 'video', {
                resourceType: 'video',
                nodeId: nodeId,
                nodeTitle: nodeTitle,
                projectId: projectId,
              });
              if (downloadedPath) {
                localPath = downloadedPath;
                finalVideoUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
                console.log('[视频生成] 首次响应视频已下载到本地:', localPath);
              }
            } catch (downloadError) {
              console.error('[视频生成] 首次响应视频下载失败，使用远程 URL:', downloadError);
            }
          }
          onStatus({
            nodeId,
            status: 'SUCCESS',
            payload: {
              url: finalVideoUrl,
              videoUrl: finalVideoUrl,
              originalVideoUrl: videoUrl,
              localPath: localPath,
              text: taskId ? `任务 ID: ${taskId}，视频已就绪` : `视频生成完成: ${finalVideoUrl}`,
              taskId: taskId,
              progress: 100,
            },
          });
        } else if (taskId) {
          // 如果有 taskId 但没有 videoUrl，说明任务已提交但还在处理中（非 veo 模型的情况）
          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: {
              text: `任务已提交，任务 ID: ${taskId}，正在处理中...`,
              taskId: taskId,
            },
          });
        } else {
          // 其他情况，发送 SUCCESS 但提示用户查看任务列表
          onStatus({
            nodeId,
            status: 'SUCCESS',
            payload: {
              text: '视频生成任务已提交，请稍后在控制台或任务列表中查看结果',
            },
          });
        }
      }
    } catch (error: any) {
      const message =
        error?.response?.data?.error?.message ||
        error?.message ||
        '视频生成失败，请稍后重试';

      console.error('[视频生成] 调用失败:', message, error?.response?.data || '');

      onStatus({
        nodeId,
        status: 'ERROR',
        payload: {
          error: message,
        },
      });
    }
  }
}

