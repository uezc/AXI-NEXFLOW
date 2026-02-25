/**
 * AI 插件化架构 - 主进程调度中控
 * 唯一入口：监听 ai:invoke IPC 通道
 * 路由逻辑：根据 modelId 从 Registry 查找对应的 Provider 并执行
 */

import { BrowserWindow } from 'electron';
import { AIInvokeParams, AIStatusPacket } from './types.js';
import { getProvider } from './Registry.js';
import { getBLTCYBalance, getRHBalance } from '../services/balance.js';
import { autoDownloadResource } from '../utils/resourceDownloader.js';
import { recordTaskHistory, TaskType } from '../services/taskHistory.js';

/**
 * AI 核心调度器
 * 支持并发控制：最多20个并行的Image模块请求
 */
export class AICore {
  private mainWindow: BrowserWindow | null = null;
  
  // 并发控制：最多20个并行的Image模块请求
  private readonly MAX_CONCURRENT_IMAGE_REQUESTS = 20;
  private activeImageRequests = 0;
  private imageRequestQueue: Array<{
    params: AIInvokeParams;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  /**
   * 设置主窗口引用（用于发送状态更新）
   * 
   * @param window 主窗口实例
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /** 安全向渲染进程发送消息，避免窗口/帧已销毁时报错 */
  private safeSend(channel: string, ...args: any[]): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    try {
      if (!this.mainWindow.webContents.isDestroyed()) {
        this.mainWindow.webContents.send(channel, ...args);
      }
    } catch {
      // 忽略 Render frame was disposed 等
    }
  }

  /**
   * 处理 AI 调用请求
   * 每个模块的任务完全独立，互不影响
   * 
   * @param params AI 调用参数
   * @returns Promise<void>
   */
  async invoke(params: AIInvokeParams): Promise<void> {
    const { modelId, nodeId } = params;
    
    console.log(`[AICore] 收到任务提交: modelId=${modelId}, nodeId=${nodeId}`);

    // 如果是 Image 模块，需要并发控制（限制最多20个并发）
    if (modelId === 'image') {
      return this.invokeWithConcurrencyControl(params);
    }

    // 其他模块（Video、Chat等）直接执行，完全独立，不阻塞其他任务
    console.log(`[AICore] 模块 ${modelId} 直接执行，不阻塞其他任务`);
    return this.executeInvoke(params);
  }

  /**
   * 带并发控制的调用（用于 Image 模块）
   */
  private async invokeWithConcurrencyControl(params: AIInvokeParams): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 如果当前并发数未达到上限，直接执行
      if (this.activeImageRequests < this.MAX_CONCURRENT_IMAGE_REQUESTS) {
        this.activeImageRequests++;
        this.executeInvoke(params)
          .then(() => {
            this.activeImageRequests--;
            this.processImageQueue();
            resolve();
          })
          .catch((error) => {
            this.activeImageRequests--;
            this.processImageQueue();
            reject(error);
          });
      } else {
        // 加入队列等待
        console.log(`[并发控制] Image 请求 ${params.nodeId} 加入队列，当前并发数: ${this.activeImageRequests}/${this.MAX_CONCURRENT_IMAGE_REQUESTS}`);
        this.imageRequestQueue.push({
          params,
          resolve,
          reject,
        });
      }
    });
  }

  /**
   * 处理队列中的 Image 请求
   */
  private processImageQueue(): void {
    if (this.imageRequestQueue.length === 0) {
      return;
    }

    if (this.activeImageRequests >= this.MAX_CONCURRENT_IMAGE_REQUESTS) {
      return;
    }

    const next = this.imageRequestQueue.shift();
    if (!next) {
      return;
    }

    this.activeImageRequests++;
    console.log(`[并发控制] 从队列中取出 Image 请求 ${next.params.nodeId}，当前并发数: ${this.activeImageRequests}/${this.MAX_CONCURRENT_IMAGE_REQUESTS}`);
    
    this.executeInvoke(next.params)
      .then(() => {
        this.activeImageRequests--;
        next.resolve();
        this.processImageQueue();
      })
      .catch((error) => {
        this.activeImageRequests--;
        next.reject(error);
        this.processImageQueue();
      });
  }

  /**
   * 执行实际的 AI 调用
   * 每个任务完全独立，不共享状态
   */
  private async executeInvoke(params: AIInvokeParams): Promise<void> {
    const { modelId, nodeId, input } = params;
    
    console.log(`[AICore] 开始执行任务: modelId=${modelId}, nodeId=${nodeId}`);

    // 记录任务开始时间
    const startTime = Date.now();

    // 从注册表获取 Provider
    const provider = getProvider(modelId);
    if (!provider) {
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: {
          error: `Provider with modelId "${modelId}" not found in registry`,
        },
      };
      this.sendStatusUpdate(errorPacket);
      
      // 记录失败任务（耗时很短）
      const duration = (Date.now() - startTime) / 1000;
      this.recordTaskDuration(modelId, duration, false);
      
      throw new Error(`AI Provider "${modelId}" not registered`);
    }

    // 创建状态回调函数（传递 input 以便保存元数据）
    const onStatus = async (packet: AIStatusPacket) => {
      await this.sendStatusUpdate(packet, input);
    };

    try {
      // 发送 START 状态
      onStatus({
        nodeId,
        status: 'START',
      });

      // 方式2：调用模型时触发余额刷新（后台执行，不阻塞任务）
      // 使用 Promise.all 并行查询，但不等待结果，避免阻塞任务执行
      Promise.all([
        getBLTCYBalance(true).catch(err => {
          console.warn('[余额刷新] BLTCY 余额查询失败:', err);
          return null;
        }),
        getRHBalance(true).catch(err => {
          console.warn('[余额刷新] RH 余额查询失败:', err);
          return null;
        })
      ]).then(([bltcyBalance, rhBalance]) => {
        if (bltcyBalance !== null) this.safeSend('balance-updated', { type: 'bltcy', balance: bltcyBalance });
        if (rhBalance !== null) this.safeSend('balance-updated', { type: 'rh', balance: rhBalance });
      }).catch(err => {
        // 余额查询失败不影响 AI 调用
        console.warn('[余额刷新] 余额查询失败:', err);
      });

      // 执行 Provider（不等待余额查询完成）
      await provider.execute({
        nodeId,
        input,
        onStatus,
      });

      // 任务成功完成，记录时长
      const duration = (Date.now() - startTime) / 1000;
      this.recordTaskDuration(modelId, duration, true);
    } catch (error) {
      // 发送 ERROR 状态
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
      this.sendStatusUpdate(errorPacket);
      
      // 记录失败任务时长
      const duration = (Date.now() - startTime) / 1000;
      this.recordTaskDuration(modelId, duration, false);
      
      throw error;
    }
  }

  /**
   * 记录任务执行时长
   */
  private recordTaskDuration(modelId: string, duration: number, success: boolean): void {
    try {
      // 将 modelId 映射到 TaskType
      let taskType: TaskType;
      if (modelId === 'chat' || modelId === 'llm') {
        taskType = 'llm';
      } else if (modelId === 'image') {
        taskType = 'image';
      } else if (modelId === 'video') {
        taskType = 'video';
      } else {
        // 未知类型，跳过记录
        return;
      }

      recordTaskHistory(taskType, duration, success);
    } catch (error) {
      // 记录失败不影响任务执行
      console.warn('[AICore] 记录任务时长失败:', error);
    }
  }

  /**
   * 发送状态更新到渲染进程
   * 在发送 SUCCESS 状态时，先自动下载资源到本地，再发送状态更新（确保持久化）
   * 注意：资源下载在后台进行，不阻塞状态更新
   * 
   * @param packet 状态数据包
   * @param input 原始输入参数（包含 prompt、model 等信息）
   */
  private async sendStatusUpdate(packet: AIStatusPacket, input?: any): Promise<void> {
    // 统一规范化 nodeId，确保与渲染进程 trim 后的 id 一致，避免 GPT 反推等 SUCCESS 无法匹配到 LLM 节点
    const normalizedPacket: AIStatusPacket = {
      ...packet,
      nodeId: packet.nodeId != null ? String(packet.nodeId).trim() : '',
    };

    // 先立即发送状态更新（不等待资源下载），确保 UI 及时响应
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // 调试日志：记录发送的状态更新，确保路径正确编码
      const hasText = !!(normalizedPacket.payload as any)?.text;
      const textLength = (normalizedPacket.payload as any)?.text?.length || 0;
      const hasLocalPath = !!(normalizedPacket.payload as any)?.localPath;
      const localPath = (normalizedPacket.payload as any)?.localPath || 'none';

      // 确保 localPath 是字符串格式（避免编码问题）
      if (hasLocalPath && typeof localPath === 'string') {
        // 验证路径格式
        try {
          const normalizedPath = localPath.replace(/\\/g, '/');
          console.log(`[AICore] 发送状态更新: nodeId=${normalizedPacket.nodeId}, status=${normalizedPacket.status}, hasPayload=${!!normalizedPacket.payload}, hasText=${hasText}, textLength=${textLength}, hasLocalPath=${hasLocalPath}, localPath=${normalizedPath}`);
        } catch (error) {
          console.error(`[AICore] 路径编码错误:`, error);
        }
      } else {
        console.log(`[AICore] 发送状态更新: nodeId=${normalizedPacket.nodeId}, status=${normalizedPacket.status}, hasPayload=${!!normalizedPacket.payload}, hasText=${hasText}, textLength=${textLength}, hasLocalPath=${hasLocalPath}`);
      }

      // 确保 payload 中的路径是字符串格式
      if (normalizedPacket.payload && (normalizedPacket.payload as any).localPath) {
        (normalizedPacket.payload as any).localPath = String((normalizedPacket.payload as any).localPath);
      }

      this.safeSend('ai:status-update', normalizedPacket);
    }

    // 如果是 SUCCESS 状态且包含图片或视频 URL，在后台下载资源
    if (normalizedPacket.status === 'SUCCESS' && normalizedPacket.payload) {
      const { imageUrl, videoUrl, text } = normalizedPacket.payload;

      // 从 input 中提取元数据信息
      const prompt = input?.prompt || normalizedPacket.payload.prompt || '';
      const model = input?.model || normalizedPacket.payload.model || '';
      const nodeId = normalizedPacket.nodeId;
      
      // 准备元数据
      // 优先使用 normalizedPacket.payload.projectId，如果没有则尝试从 input 中获取
      const projectId = normalizedPacket.payload.projectId || input?.projectId;
      const metadata = {
        prompt,
        model,
        nodeId,
        nodeTitle: normalizedPacket.payload.nodeTitle,
        projectId: projectId,
        createdAt: Date.now(),
      };
      
      // 先下载图片（如果存在远程 URL）
      if (imageUrl && !imageUrl.startsWith('data:') && !imageUrl.startsWith('local-resource://') && !imageUrl.startsWith('file://')) {
        console.log(`[持久化] 开始下载图片: ${imageUrl}`);
        const localPath = await autoDownloadResource(imageUrl, 'image', metadata);
        if (localPath) {
          // 将本地路径转换为 local-resource:// URL
          // 确保路径格式正确：Windows 路径 C:\Users -> C:/Users
          // 注意：不要对整个路径编码，只对中文和空格部分编码，盘符的冒号必须保持原样
          let normalizedPath = localPath.replace(/\\/g, '/');
          
          // 修复盘符格式：如果路径是 "c/Users" 格式（缺少冒号），修正为 "C:/Users"
          // 这是关键修复：确保盘符格式正确
          if (normalizedPath.match(/^([a-zA-Z])\//)) {
            normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.substring(1);
          }
          
          // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
          if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
            // 移除开头的 /
            normalizedPath = normalizedPath.substring(1);
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
          
          const localResourceUrl = `local-resource://${encodedPath}`;
          normalizedPacket.payload.localPath = localPath;
          normalizedPacket.payload.imageUrl = localResourceUrl; // 替换为本地 URL
          console.log(`[持久化] 图片已下载并保存: ${localPath}`);
          console.log(`[持久化] 生成的 local-resource URL: ${localResourceUrl}`);
        }
      }
      
      // 先下载视频（如果存在远程 URL）
      if (videoUrl && !videoUrl.startsWith('local-resource://') && !videoUrl.startsWith('file://')) {
        // 保存原始远程 URL，以便在 local-resource:// 失败时使用
        const originalVideoUrl = videoUrl;
        normalizedPacket.payload.originalVideoUrl = originalVideoUrl; // 保存原始远程 URL
        
        console.log(`[持久化] 开始下载视频: ${videoUrl}`);
        const localPath = await autoDownloadResource(videoUrl, 'video', metadata);
        if (localPath) {
          // 将本地路径转换为 local-resource:// URL
          // 确保路径格式正确：Windows 路径 C:\Users -> C:/Users
          let normalizedPath = localPath.replace(/\\/g, '/');
          // 确保 Windows 路径格式正确（C:/Users 而不是 c/Users）
          if (normalizedPath.match(/^[a-zA-Z]:/)) {
            // 已经是正确的格式
          } else if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
            // 移除开头的 /
            normalizedPath = normalizedPath.substring(1);
          }
          
          // 对路径进行URL编码（处理中文字符）
          // 分段编码，保留斜杠分隔符
          const pathParts = normalizedPath.split('/');
          const encodedParts = pathParts.map((part) => {
            // 对每段路径进行编码
            return encodeURIComponent(part);
          });
          const encodedPath = encodedParts.join('/');
          
          const localResourceUrl = `local-resource://${encodedPath}`;
          normalizedPacket.payload.localPath = localPath;
          normalizedPacket.payload.videoUrl = localResourceUrl; // 替换为本地 URL
          normalizedPacket.payload.url = localResourceUrl; // 同时更新 url 字段
          console.log(`[持久化] 视频已下载并保存: ${localPath}`);
          console.log(`[持久化] 生成的 local-resource URL: ${localResourceUrl}`);
          console.log(`[持久化] 原始远程 URL 已保存: ${originalVideoUrl}`);
        }
      }
      
      // 如果是文本内容，也保存到本地（不覆盖 videoUrl/imageUrl 的 localPath）
      // 注意：如果 payload 中已经有 localPath（来自 ChatProvider），说明文本已经保存，跳过重复保存
      // 同时确保 text 字段被保留（来自 ChatProvider）
      if (text && text.trim() && !text.match(/^https?:\/\//)) {
        // 如果已经有 localPath（来自 ChatProvider），保留它和 text 字段
        if (normalizedPacket.payload.localPath) {
          console.log(`[持久化] 文本已保存（来自 Provider）: ${normalizedPacket.payload.localPath}, text 长度: ${text.length}`);
          // 确保 text 字段被保留
          if (!normalizedPacket.payload.text) {
            normalizedPacket.payload.text = text;
            console.log(`[持久化] 从 payload 恢复 text 字段，长度: ${text.length}`);
          }
        } else {
          // 如果没有 localPath，尝试保存
          const textMetadata = {
            ...metadata,
            text: text,
          };
          const textLocalPath = await autoDownloadResource(null, 'text', textMetadata);
          // 如果成功保存文本，设置 localPath 到 payload
          if (textLocalPath) {
            normalizedPacket.payload.localPath = textLocalPath;
            // 确保 text 字段被保留
            normalizedPacket.payload.text = text;
            console.log(`[持久化] 文本已保存: ${textLocalPath}, text 长度: ${text.length}`);
          }
        }
      }

      // 资源下载完成后，发送更新后的状态（包含本地路径）
      console.log(`[AICore] 发送状态更新（包含本地路径）: nodeId=${normalizedPacket.nodeId}, status=${normalizedPacket.status}, hasPayload=${!!normalizedPacket.payload}, localPath=${(normalizedPacket.payload as any)?.localPath || 'none'}`);
      this.safeSend('ai:status-update', normalizedPacket);
    }
  }
}

/**
 * 全局 AICore 实例
 */
export const aiCore = new AICore();
