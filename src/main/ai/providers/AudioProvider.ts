/**
 * Audio Generation Provider - 声音生成
 * 使用 RunningHub 插件算力 API (text-to-audio) 或 AI 应用 (Index-TTS2.0 等)
 */

import { BaseProvider } from '../BaseProvider.js';
import { AIExecuteParams } from '../types.js';
import { store } from '../../services/store.js';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

interface AudioInput {
  text: string;
  model?: string; // 'speech-2.8-hd' | 'index-tts2' | 'rhart-song'
  voice_id?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  pronunciation_dict?: string[];
  enable_base64_output?: boolean;
  english_normalization?: boolean;
  emotion?: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
  projectId?: string;
  nodeTitle?: string;
  referenceAudioUrl?: string;
  indexTts2Select?: string;
  /** 全能写歌：歌曲名 */
  songName?: string;
  /** 全能写歌：风格描述 */
  styleDesc?: string;
  /** 全能写歌：歌词 */
  lyrics?: string;
}

export class AudioProvider extends BaseProvider {
  readonly modelId = 'audio';

  // RunningHub API 配置
  private readonly runningHubApiBaseUrl = 'https://www.runninghub.cn/openapi/v2';

  /**
   * 获取 RunningHub API Key（从 store 中读取）
   */
  private getRunningHubApiKey(): string {
    return (store.get('runningHubApiKey') as string) || '';
  }

  async execute(params: AIExecuteParams): Promise<void> {
    const { nodeId, input, onStatus } = params;

    try {
      const audioInput = input as AudioInput;
      const {
        text,
        model = 'speech-2.8-hd',
        voice_id = 'Wise_Woman',
        speed = 1,
        volume = 1,
        pitch = 0,
        pronunciation_dict = [],
        enable_base64_output = false,
        english_normalization = false,
        emotion,
        projectId,
        nodeTitle = 'audio',
        referenceAudioUrl,
        indexTts2Select = '1',
        songName,
        styleDesc,
        lyrics,
      } = audioInput;

      const isRhartSong = model === 'rhart-song';
      if (!isRhartSong && !text) {
        throw new Error('文本是必需的');
      }
      if (isRhartSong) {
        if (!(songName ?? '').trim()) throw new Error('全能写歌 需要填写歌曲名');
        if (!(styleDesc ?? '').trim()) throw new Error('全能写歌 需要填写风格描述');
        if (!(lyrics ?? '').trim()) throw new Error('全能写歌 需要填写歌词');
      }

      const apiKey = this.getRunningHubApiKey();
      if (!apiKey) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: {
            error: 'RunningHub API Key 未配置，请在设置中配置插件算力 API KEY',
          },
        });
        return;
      }

      // 发送 START 状态
      onStatus({
        nodeId,
        status: 'START',
        payload: {},
      });

      onStatus({
        nodeId,
        status: 'PROCESSING',
        payload: {},
      });

      // 全能写歌：AI 应用 run/ai-app/2021841072451756033（歌曲名/风格描述/歌词）
      if (model === 'rhart-song') {
        const appPayload = {
          nodeInfoList: [
            { nodeId: '5', fieldName: 'value', fieldValue: String(songName ?? '').trim(), description: '歌曲名' },
            { nodeId: '7', fieldName: 'value', fieldValue: String(styleDesc ?? '').trim(), description: '风格描述' },
            { nodeId: '6', fieldName: 'value', fieldValue: String(lyrics ?? '').trim(), description: '歌词' },
          ],
          instanceType: 'default',
          usePersonalQueue: 'false',
        };
        const response = await axios.post(
          `${this.runningHubApiBaseUrl}/run/ai-app/2021841072451756033`,
          appPayload,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            proxy: false,
            timeout: 30000,
          },
        );
        const data = response.data || {};
        const taskId = data.taskId || data.task_id;
        if (!taskId) throw new Error('全能写歌 提交失败：未返回 taskId');
        const pollResult = await this.pollTaskUntilSuccess(apiKey, taskId, nodeId, onStatus);
        if (pollResult.audioUrl) await this.handleAudioResult(pollResult.audioUrl, nodeId, onStatus, projectId, nodeTitle);
        return;
      }

      // Index-TTS2.0 配音神器：AI 应用 run/ai-app/2008113338793857025
      if (model === 'index-tts2') {
        if (!referenceAudioUrl || !referenceAudioUrl.trim()) {
          throw new Error('Index-TTS2.0 配音神器需要上传参考音（参考音为必填）');
        }
        let audioFieldValue: string = referenceAudioUrl.trim();
        if (audioFieldValue.startsWith('local-resource://') || audioFieldValue.startsWith('file://')) {
          let filePath = audioFieldValue.startsWith('local-resource://') ? audioFieldValue.replace(/^local-resource:\/\/+/, '') : audioFieldValue.replace(/^file:\/\/+/, '');
          filePath = filePath.replace(/%5C/gi, '/');
          if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
          filePath = decodeURIComponent(filePath);
          if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
          const normalizedFilePath = path.normalize(filePath);
          // 参考音来自应用内“选择文件”对话框，允许用户选择的任意路径
          if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
          const audioBuffer = fs.readFileSync(normalizedFilePath);
          const ext = path.extname(normalizedFilePath).toLowerCase();
          const mimeType = ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
          const { VideoProvider } = await import('./VideoProvider.js');
          const vp = new VideoProvider();
          audioFieldValue = await vp.uploadAudioToOSS(audioBuffer, mimeType);
        } else if (!audioFieldValue.startsWith('http://') && !audioFieldValue.startsWith('https://')) {
          throw new Error('参考音需为公网 URL 或本地文件路径（local-resource:// 或 file://）');
        }
        const appPayload = {
          nodeInfoList: [
            { nodeId: '13', fieldName: 'audio', fieldValue: audioFieldValue, description: '参考音' },
            { nodeId: '60', fieldName: 'text', fieldValue: text.trim(), description: '台词' },
            { nodeId: '106', fieldName: 'select', fieldValue: String(indexTts2Select || '1'), description: 'select' },
          ],
          instanceType: 'default',
          usePersonalQueue: 'false',
        };
        console.log('[音频生成] Index-TTS2.0 提交任务，nodeInfoList(参考音已处理)');
        const response = await axios.post(
          `${this.runningHubApiBaseUrl}/run/ai-app/2008113338793857025`,
          appPayload,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            proxy: false,
            timeout: 30000,
          },
        );
        const data = response.data || {};
        const taskId = data.taskId || data.task_id;
        if (!taskId) throw new Error('Index-TTS2.0 提交失败：未返回 taskId');
        const pollResult = await this.pollTaskUntilSuccess(apiKey, taskId, nodeId, onStatus);
        if (pollResult.audioUrl) await this.handleAudioResult(pollResult.audioUrl, nodeId, onStatus, projectId, nodeTitle);
        return;
      }

      // 默认：语音合成 speech-2.8-hd
      const payload: any = {
        text,
        voice_id,
        speed: Math.max(0.5, Math.min(2, speed)),
        volume: Math.max(0.1, Math.min(10, volume)),
        pitch: Math.max(-12, Math.min(12, pitch)),
        enable_base64_output,
        english_normalization,
      };
      if (pronunciation_dict && pronunciation_dict.length > 0) payload.pronunciation_dict = pronunciation_dict;
      if (emotion) payload.emotion = emotion;
      console.log('[音频生成] 提交任务，参数:', JSON.stringify(payload, null, 2));

      const response = await axios.post(
        `${this.runningHubApiBaseUrl}/rhart-audio/text-to-audio/speech-2.8-hd`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          proxy: false,
          timeout: 30000,
        },
      );

      console.log('[音频生成] 提交响应:', JSON.stringify(response.data, null, 2));

      const data = response.data || {};

      // 提取 taskId
      const taskId = data.taskId || data.task_id || data.data?.taskId || data.data?.task_id;

      if (!taskId) {
        // 如果没有 taskId，可能直接返回了结果
        if (data.results && Array.isArray(data.results) && data.results.length > 0) {
          const audioUrl = data.results[0]?.url;
          if (audioUrl) {
            // 直接下载音频
            await this.handleAudioResult(audioUrl, nodeId, onStatus, projectId, nodeTitle);
            return;
          }
        }
        throw new Error('未获取到任务 ID，请检查 API 响应');
      }

      console.log(`[音频生成] 获取到 taskId: ${taskId}，开始轮询...`);

      // 轮询配置：10 分钟总超时时间
      const totalTimeout = 10 * 60 * 1000; // 10 分钟（毫秒）
      const startTime = Date.now();
      let attempt = 0;
      let lastPollTime = startTime;

      // 轮询循环
      while (true) {
        // 检查总超时时间
        const elapsed = Date.now() - startTime;
        if (elapsed >= totalTimeout) {
          throw new Error(`轮询超时（10分钟）：无法获取音频结果，任务 ID: ${taskId}`);
        }

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
          // 查询任务状态
          const pollResponse = await axios.post(
            `${this.runningHubApiBaseUrl}/query`,
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

          const pollData = pollResponse.data || {};
          console.log(`[音频生成] 轮询结果 (第 ${attempt} 次，已用时 ${Math.floor(elapsed / 1000)} 秒):`, JSON.stringify(pollData, null, 2));

          const status = pollData.status;

          if (status === 'SUCCESS') {
            // 提取音频 URL
            let audioUrl: string | undefined;
            if (Array.isArray(pollData.results) && pollData.results.length > 0) {
              audioUrl = pollData.results[0]?.url;
            }

            if (audioUrl) {
              // 下载音频
              await this.handleAudioResult(audioUrl, nodeId, onStatus, projectId, nodeTitle);
              break; // 退出轮询循环
            } else {
              console.warn('[音频生成] SUCCESS 状态但未找到音频 URL，继续轮询...');
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            }
          } else if (status === 'FAILED' || status === 'FAILURE') {
            // 任务失败
            const errorMessage = pollData.errorMessage || pollData.error || '音频生成失败';
            const errorCode = pollData.errorCode ? `[错误码: ${pollData.errorCode}] ` : '';
            
            onStatus({
              nodeId,
              status: 'ERROR',
              payload: {
                error: `${errorCode}${errorMessage}`,
              },
            });
            break; // 退出轮询循环
          } else if (status === 'QUEUED' || status === 'RUNNING') {
            // 任务进行中，继续轮询
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: {},
            });
            continue;
          } else {
            // 未知状态，继续轮询
            console.warn(`[音频生成] 未知任务状态: ${status}，继续轮询...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
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
            console.warn(`[音频生成] 轮询网络错误 (第 ${attempt} 次): ${errorMessage}，等待 5 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            lastPollTime = Date.now();
            continue;
          } else if (pollError?.response?.status === 404) {
            // 404 错误：任务不存在
            console.error(`[音频生成] 任务不存在 (404): ${taskId}`);
            throw new Error(`任务不存在，任务 ID: ${taskId}`);
          } else {
            // 其他错误，记录但继续尝试
            console.warn(`[音频生成] 轮询失败 (第 ${attempt} 次): ${errorMessage}`);
            if (pollError?.response?.status >= 400 && pollError?.response?.status < 500) {
              // 4xx 客户端错误
              const errorMsg = pollError?.response?.data?.error || pollError?.response?.data?.message || errorMessage;
              throw new Error(`轮询失败: ${errorMsg}`);
            }
            // 5xx 服务器错误，继续重试
            await new Promise(resolve => setTimeout(resolve, 5000));
            lastPollTime = Date.now();
          }
        }
      }
    } catch (error: any) {
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.errorMessage ||
        error?.message ||
        '音频生成失败，请稍后重试';

      console.error('[音频生成] 调用失败:', message, error?.response?.data || '');

      onStatus({
        nodeId,
        status: 'ERROR',
        payload: {
          error: message,
        },
      });
    }
  }

  /**
   * 轮询任务直到成功或失败，返回结果音频 URL（用于 Index-TTS2 等 AI 应用）
   */
  private async pollTaskUntilSuccess(
    apiKey: string,
    taskId: string,
    nodeId: string,
    onStatus: (packet: any) => void,
  ): Promise<{ audioUrl: string }> {
    const totalTimeout = 10 * 60 * 1000;
    const startTime = Date.now();
    let attempt = 0;
    let lastPollTime = startTime;
    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= totalTimeout) throw new Error(`轮询超时（10分钟），任务 ID: ${taskId}`);
      const pollInterval = elapsed < 30000 ? 2000 : 5000;
      const timeSinceLastPoll = Date.now() - lastPollTime;
      if (timeSinceLastPoll < pollInterval) await new Promise((r) => setTimeout(r, pollInterval - timeSinceLastPoll));
      attempt++;
      lastPollTime = Date.now();
      const pollResponse = await axios.post(
        `${this.runningHubApiBaseUrl}/query`,
        { taskId },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' }, proxy: false, timeout: 15000 },
      );
      const pollData = pollResponse.data || {};
      const status = pollData.status;
      if (status === 'SUCCESS') {
        const audioUrl = Array.isArray(pollData.results) && pollData.results.length > 0 ? pollData.results[0]?.url : undefined;
        if (audioUrl) return { audioUrl };
      } else if (status === 'FAILED' || status === 'FAILURE') {
        const errorMessage = pollData.errorMessage || pollData.error || '任务失败';
        const errorCode = pollData.errorCode ? `[错误码: ${pollData.errorCode}] ` : '';
        throw new Error(`${errorCode}${errorMessage}`);
      }
      onStatus({ nodeId, status: 'PROCESSING', payload: {} });
    }
  }

  /**
   * 处理音频结果：下载音频文件到本地
   */
  private async handleAudioResult(
    audioUrl: string,
    nodeId: string,
    onStatus: (packet: any) => void,
    projectId?: string,
    nodeTitle?: string,
  ): Promise<void> {
    try {
      // 自动下载音频到本地
      const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
      
      const downloadedPath = await autoDownloadResource(
        audioUrl,
        'audio',
        {
          resourceType: 'audio',
          nodeId: nodeId,
          nodeTitle: nodeTitle || 'audio',
          projectId: projectId,
        }
      );

      if (downloadedPath) {
        // 使用本地路径
        const localAudioUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
        console.log(`[音频生成] 音频已自动下载到本地: ${downloadedPath}`);

        onStatus({
          nodeId,
          status: 'SUCCESS',
          payload: {
            url: localAudioUrl,
            audioUrl: localAudioUrl,
            originalAudioUrl: audioUrl, // 保存原始远程 URL
            localPath: downloadedPath,
            text: `音频生成完成: ${localAudioUrl}`,
          },
        });
      } else {
        // 下载失败，使用远程 URL
        console.warn('[音频生成] 音频下载失败，使用远程 URL');
        onStatus({
          nodeId,
          status: 'SUCCESS',
          payload: {
            url: audioUrl,
            audioUrl: audioUrl,
            text: `音频生成完成: ${audioUrl}`,
          },
        });
      }
    } catch (downloadError: any) {
      console.error('[音频生成] 处理音频结果失败:', downloadError);
      // 下载失败不影响音频显示，使用远程 URL
      onStatus({
        nodeId,
        status: 'SUCCESS',
        payload: {
          url: audioUrl,
          audioUrl: audioUrl,
          text: `音频生成完成: ${audioUrl}`,
        },
      });
    }
  }
}
