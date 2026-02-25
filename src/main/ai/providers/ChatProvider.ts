/**
 * Chat API Provider - 大语言模型调用
 * 基于 OpenAPI 规范的 Chat Completions API
 * 使用 BLTCY 核心算力 API
 */

import { BaseProvider } from '../BaseProvider.js';
import { AIExecuteParams, AIStatusPacket } from '../types.js';
import { store } from '../../services/store.js';
import { ApiService } from '../../services/api.js';
import { autoDownloadResource } from '../../utils/resourceDownloader.js';
import fs from 'fs';
import path from 'path';
import { isLocalResourcePathAllowed } from '../../utils/projectFolderHelper.js';
import axios from 'axios';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  // 对于纯文本对话，content 为字符串；对于图像分析等场景，content 可以是对象或数组
  // 使用 any 以兼容多种内容格式（例如包含 image_url 的结构）。
  content: any;
}

interface ChatInput {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: any;
  user?: string;
  response_format?: any;
  seen?: number;
  tools?: string[];
  tool_choice?: any;
  [key: string]: any;
}

export class ChatProvider extends BaseProvider {
  readonly modelId = 'chat';

  // BLTCY API 配置（国内中转 API）
  private readonly apiBaseUrl = 'https://api.bltcy.ai/v1';

  /**
   * 获取 BLTCY API Key（从 store 中读取）
   */
  private getApiKey(): string {
    return (store.get('bltcyApiKey') as string) || '';
  }

  /**
   * 获取 RunningHub API Key（用于 joy-caption-two 等 AI 应用）
   */
  private getRunningHubApiKey(): string {
    return (store.get('runningHubApiKey') as string) || '';
  }

  async execute(params: AIExecuteParams): Promise<void> {
    const { nodeId, input, onStatus } = params;

    // 验证输入
    if (!this.validateInput(input)) {
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: {
          error: 'Invalid input: input is required',
        },
      };
      onStatus(errorPacket);
      return;
    }

    const chatInput = input as ChatInput;

    // 验证必需字段
    if (!chatInput.model || !chatInput.messages || !Array.isArray(chatInput.messages)) {
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: {
          error: 'Invalid input: model and messages are required',
        },
      };
      onStatus(errorPacket);
      return;
    }

    // 发送 START 状态
    onStatus({
      nodeId,
      status: 'START',
      payload: {},
    });
    
    // 发送 PROCESSING 状态
    onStatus({
      nodeId,
      status: 'PROCESSING',
      payload: {},
    });

    try {
      // Joy Caption Two 反推提示词：RunningHub AI 应用
      if (chatInput.model === 'joy-caption-two') {
        const runningHubKey = this.getRunningHubApiKey();
        if (!runningHubKey) {
          throw new Error('RunningHub API Key 未配置，请在设置中配置插件算力 API Key');
        }
        let imageUrl: string | null = null;
        for (const msg of chatInput.messages || []) {
          if (Array.isArray(msg.content)) {
            for (const item of msg.content) {
              if (item?.type === 'image_url' && item.image_url?.url) {
                imageUrl = item.image_url.url;
                break;
              }
            }
            if (imageUrl) break;
          }
        }
        if (!imageUrl) {
          throw new Error('未找到图片：请从图片节点连线到本 LLM 节点');
        }
        let fieldValue = imageUrl;
        if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
          let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
          if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
          filePath = decodeURIComponent(filePath);
          if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) filePath = filePath.replace(/^[/\\]+/, '');
          if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
          const normalizedFilePath = path.normalize(filePath);
          if (!isLocalResourcePathAllowed(normalizedFilePath)) {
            throw new Error(`访问路径超出允许范围: ${filePath}`);
          }
          if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
          const imageBuffer = fs.readFileSync(normalizedFilePath);
          const ext = path.extname(normalizedFilePath).toLowerCase();
          const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
          const { VideoProvider } = await import('./VideoProvider.js');
          const vp = new VideoProvider();
          fieldValue = await vp.uploadImageToOSS(imageBuffer, mimeType);
        } else if (imageUrl.startsWith('data:image/')) {
          const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
          if (!base64Match) throw new Error('Base64 图片格式无效');
          const [, imageType, base64Data] = base64Match;
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const mimeType = `image/${imageType}`;
          const { VideoProvider } = await import('./VideoProvider.js');
          const vp = new VideoProvider();
          fieldValue = await vp.uploadImageToOSS(imageBuffer, mimeType);
        } else if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          throw new Error('Joy Caption Two 仅支持本地图片、Base64 图片或 http(s) 图片链接');
        }
        const appId = '2021821541272526850';
        const submitUrl = `https://www.runninghub.cn/openapi/v2/run/ai-app/${appId}`;
        const appPayload = {
          nodeInfoList: [
            { nodeId: '3', fieldName: 'image', fieldValue, description: 'image' },
          ],
          instanceType: 'default',
          usePersonalQueue: 'false',
        };
        const submitRes = await axios.post(submitUrl, appPayload, {
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runningHubKey}` },
          proxy: false,
          timeout: 30000,
        });
        const taskId = submitRes.data?.taskId ?? submitRes.data?.task_id;
        if (!taskId) throw new Error('Joy Caption Two 提交失败：未返回 taskId');
        const queryUrl = 'https://www.runninghub.cn/openapi/v2/query';
        let attempts = 0;
        while (attempts < 120) {
          await new Promise((r) => setTimeout(r, 5000));
          const queryRes = await axios.post(queryUrl, { taskId }, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runningHubKey}` },
            proxy: false,
            timeout: 15000,
          });
          const status = queryRes.data?.status;
          if (status === 'SUCCESS') {
            const results = queryRes.data?.results;
            let captionText = '';
            if (Array.isArray(results) && results.length > 0) {
              const withText = results.find((r: any) => typeof r?.text === 'string' && r.text.trim());
              if (withText) {
                captionText = withText.text.trim();
              } else {
                const txtResult = results.find((r: any) => r?.url && (r.outputType === 'txt' || (typeof r.url === 'string' && r.url.toLowerCase().endsWith('.txt'))));
                if (txtResult?.url) {
                  try {
                    const fetchRes = await axios.get(txtResult.url, { responseType: 'text', timeout: 15000 });
                    captionText = typeof fetchRes.data === 'string' ? fetchRes.data.trim() : '';
                  } catch (e) {
                    console.warn('[ChatProvider] Joy Caption Two 拉取 txt 结果失败:', txtResult.url, e);
                  }
                }
              }
            }
            onStatus({
              nodeId,
              status: 'SUCCESS',
              payload: { text: captionText || '(未生成文本)' },
            });
            return;
          }
          if (status === 'FAILED') {
            throw new Error(queryRes.data?.errorMessage || 'Joy Caption Two 任务失败');
          }
          attempts++;
        }
        throw new Error('Joy Caption Two 轮询超时');
      }

      // 获取 API Key（核心算力 API Key）
      const apiKey = this.getApiKey();
      if (!apiKey) {
        throw new Error('BLTCY API Key 未配置，请在设置中配置核心算力 API Key');
      }
      console.log(`[ChatProvider] 使用核心算力 API Key (BLTCY)，API 端点: ${this.apiBaseUrl}/chat/completions`);

      // 处理 messages 中的 local-resource:// 图片 URL，转换为 base64
      let imageConversionError: string | null = null;
      const processedMessages = chatInput.messages.map((msg: ChatMessage) => {
        if (Array.isArray(msg.content)) {
          // 处理包含 image_url 的消息
          const processedContent = msg.content.map((item: any) => {
            if (item.type === 'image_url' && item.image_url?.url) {
              const imageUrl = item.image_url.url;
              console.log(`[ChatProvider] 处理图片 URL: ${imageUrl.substring(0, 100)}...`);
              
              // 如果是 local-resource:// 或 file://，转换为 base64 data URL
              if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
                try {
                  let filePath: string;
                  
                  if (imageUrl.startsWith('local-resource://')) {
                    filePath = imageUrl.replace(/^local-resource:\/\//, '');
                    filePath = decodeURIComponent(filePath);
                    // URL 可能产生 /E:/ 或 //E:/，去掉前导斜杠以便 Windows 路径校验通过
                    if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) {
                      filePath = filePath.replace(/^[/\\]+/, '');
                    }
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
                  
                  console.log(`[ChatProvider] 解析后的文件路径: ${filePath}`);
                  
                  const normalizedFilePath = path.normalize(filePath);
                  if (!isLocalResourcePathAllowed(normalizedFilePath)) {
                    const errorMsg = `访问路径超出允许范围: ${filePath}`;
                    console.error(`[ChatProvider] ${errorMsg}`);
                    imageConversionError = errorMsg;
                    throw new Error(errorMsg);
                  }
                  
                  // 检查文件是否存在
                  if (!fs.existsSync(normalizedFilePath)) {
                    const errorMsg = `文件不存在: ${normalizedFilePath}`;
                    console.error(`[ChatProvider] ${errorMsg}`);
                    imageConversionError = errorMsg;
                    throw new Error(errorMsg);
                  }
                  
                  // 读取文件并转换为 base64
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
                  
                  const base64 = imageBuffer.toString('base64');
                  const base64Url = `data:${mimeType};base64,${base64}`;
                  console.log(`[ChatProvider] 成功将本地图片转换为 base64: ${normalizedFilePath}, 大小: ${imageBuffer.length} 字节, MIME: ${mimeType}`);
                  
                  return {
                    ...item,
                    image_url: {
                      url: base64Url,
                    },
                  };
                } catch (error: any) {
                  const errorMsg = `转换本地图片失败: ${imageUrl} - ${error.message || error}`;
                  console.error(`[ChatProvider] ${errorMsg}`);
                  imageConversionError = errorMsg;
                  throw error; // 抛出错误，而不是返回原始项
                }
              } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                // HTTP/HTTPS URL 直接使用，无需转换
                console.log(`[ChatProvider] 使用远程图片 URL: ${imageUrl}`);
                return item;
              } else {
                // 未知协议，记录警告
                console.warn(`[ChatProvider] 未知的图片 URL 协议: ${imageUrl}`);
                return item;
              }
            }
            return item;
          });
          
          return {
            ...msg,
            content: processedContent,
          };
        }
        return msg;
      });
      
      // 如果图片转换失败，立即抛出错误
      if (imageConversionError) {
        throw new Error(`图片处理失败: ${imageConversionError}`);
      }

      // 构建请求体（符合 OpenAPI 规范）
      const requestPayload: any = {
        model: chatInput.model,
        messages: processedMessages,
      };

      // 可选参数（如果提供则添加）
      if (chatInput.temperature !== undefined) {
        requestPayload.temperature = chatInput.temperature;
      }
      if (chatInput.top_p !== undefined) {
        requestPayload.top_p = chatInput.top_p;
      }
      if (chatInput.n !== undefined) {
        requestPayload.n = chatInput.n;
      }
      if (chatInput.stream !== undefined) {
        requestPayload.stream = chatInput.stream;
      }
      if (chatInput.stop !== undefined) {
        requestPayload.stop = chatInput.stop;
      }
      if (chatInput.max_tokens !== undefined) {
        requestPayload.max_tokens = chatInput.max_tokens;
      }
      if (chatInput.presence_penalty !== undefined) {
        requestPayload.presence_penalty = chatInput.presence_penalty;
      }
      if (chatInput.frequency_penalty !== undefined) {
        requestPayload.frequency_penalty = chatInput.frequency_penalty;
      }
      if (chatInput.logit_bias !== undefined) {
        requestPayload.logit_bias = chatInput.logit_bias;
      }
      if (chatInput.user !== undefined) {
        requestPayload.user = chatInput.user;
      }
      if (chatInput.response_format !== undefined) {
        requestPayload.response_format = chatInput.response_format;
      }
      if (chatInput.seen !== undefined) {
        requestPayload.seen = chatInput.seen;
      }
      if (chatInput.tools !== undefined) {
        requestPayload.tools = chatInput.tools;
      }
      if (chatInput.tool_choice !== undefined) {
        requestPayload.tool_choice = chatInput.tool_choice;
      }

      // 使用 ApiService 发送请求（支持 keepAlive 和 429 退避）
      const apiService = new ApiService(this.apiBaseUrl);
      
      console.log(`[ChatProvider] 发送请求到 ${this.apiBaseUrl}/chat/completions`);
      console.log(`[ChatProvider] 使用模型: ${requestPayload.model}`);
      console.log(`[ChatProvider] 使用核心算力 API Key (BLTCY)`);
      console.log(`[ChatProvider] 请求体:`, JSON.stringify(requestPayload, null, 2));
      
      // 重试逻辑：最多重试 2 次
      let lastError: Error | null = null;
      let retryCount = 0;
      const maxRetries = 2;
      
      let response: {
        id: string;
        object: string;
        created: number;
        choices: Array<{
          index: number;
          message: {
            role: string;
            content: string;
          };
          finish_reason: string;
        }>;
        usage: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      } | null = null;

      while (retryCount <= maxRetries) {
        try {
          response = await apiService.post<{
            id: string;
            object: string;
            created: number;
            choices: Array<{
              index: number;
              message: {
                role: string;
                content: string;
              };
              finish_reason: string;
            }>;
            usage: {
              prompt_tokens: number;
              completion_tokens: number;
              total_tokens: number;
            };
          }>(
            '/chat/completions',
            requestPayload,
            {
              headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json; charset=utf-8',
              },
              timeout: 30000, // 30 秒超时
            }
          );
          break; // 成功则跳出重试循环
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          retryCount++;
          
          // 提取详细的错误信息
          let errorMessage = lastError.message;
          let errorDetails: any = null;
          
          // 如果是 axios 错误，尝试提取响应数据
          if ((error as any).response) {
            const axiosError = error as any;
            errorDetails = axiosError.response?.data;
            if (axiosError.response?.status) {
              errorMessage = `HTTP ${axiosError.response.status}: ${errorMessage}`;
            }
            if (errorDetails && typeof errorDetails === 'object') {
              // 尝试提取 API 返回的错误信息
              const apiErrorMsg = errorDetails.error?.message || errorDetails.message || JSON.stringify(errorDetails);
              if (apiErrorMsg && apiErrorMsg !== errorMessage) {
                errorMessage = `${errorMessage} - ${apiErrorMsg}`;
              }
            }
          }
          
          console.error(`[ChatProvider] API 请求失败 (尝试 ${retryCount}/${maxRetries + 1}):`, errorMessage);
          if (errorDetails) {
            console.error(`[ChatProvider] 错误详情:`, JSON.stringify(errorDetails, null, 2));
          }
          
          // 如果是连接超时或网络错误，进行重试
          const shouldRetry = 
            errorMessage.includes('ETIMEDOUT') ||
            errorMessage.includes('ECONNREFUSED') ||
            errorMessage.includes('ENOTFOUND') ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('Network Error');
          
          // 图片处理错误不应该重试
          const isImageError = errorMessage.includes('图片处理失败') || errorMessage.includes('文件不存在') || errorMessage.includes('访问路径超出');
          
          if (isImageError) {
            // 图片处理错误，立即抛出
            throw lastError;
          } else if (shouldRetry && retryCount <= maxRetries) {
            console.warn(`[ChatProvider] 请求失败，${retryCount} 秒后重试 (${retryCount}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // 递增延迟
            continue;
          } else {
            throw lastError; // 不应该重试或已达到最大重试次数，抛出错误
          }
        }
      }

      if (!response) {
        throw lastError || new Error('请求失败：未知错误');
      }

      // 处理响应（符合 OpenAPI 规范）
      console.log(`[ChatProvider] 处理响应，response 存在: ${!!response}, choices 存在: ${!!response?.choices}, choices 长度: ${response?.choices?.length || 0}`);
      
      if (response && response.choices && response.choices.length > 0) {
        const content = response.choices[0].message?.content || '';
        console.log(`[ChatProvider] 提取到内容，长度: ${content.length}`);
        
        // 自动下载文本到本地（如果提供了 projectId）
        let localPath: string | null = null;
        try {
          const projectId = (chatInput as any)?.projectId;
          const nodeTitle = (chatInput as any)?.nodeTitle || 'llm';
          console.log(`[ChatProvider] projectId: ${projectId}, nodeTitle: ${nodeTitle}, content 存在: ${!!content}`);
          
          if (projectId && content) {
            // 保存文本到本地
            console.log(`[ChatProvider] 开始保存文本到本地...`);
            localPath = await autoDownloadResource(
              null, // 文本类型不需要远程 URL
              'text',
              {
                text: content,
                prompt: chatInput.messages?.map((m: ChatMessage) => 
                  typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
                ).join('\n') || '',
                model: chatInput.model,
                nodeId: nodeId,
                nodeTitle: nodeTitle,
                projectId: projectId,
              }
            );
            
            if (localPath) {
              console.log(`[ChatProvider] 文本已保存到本地: ${localPath}`);
            } else {
              console.warn(`[ChatProvider] 文本保存返回 null`);
            }
          } else {
            console.log(`[ChatProvider] 跳过保存文本: projectId=${projectId}, content存在=${!!content}`);
          }
        } catch (error) {
          console.error(`[ChatProvider] 保存文本到本地失败:`, error);
          // 保存失败不影响主流程，继续发送 SUCCESS 状态
        }
        
        // 发送 SUCCESS 状态
        const successPacket = {
          nodeId,
          status: 'SUCCESS' as const,
          payload: {
            text: content,
            localPath: localPath || undefined, // 包含本地路径（如果已保存）
          },
        };
        console.log(`[ChatProvider] 准备发送 SUCCESS 状态，text 长度: ${content.length}, localPath: ${localPath || 'none'}, payload keys: ${Object.keys(successPacket.payload).join(', ')}`);
        onStatus(successPacket);
        console.log(`[ChatProvider] SUCCESS 状态已发送`);
      } else {
        console.error(`[ChatProvider] 响应格式无效: response存在=${!!response}, choices存在=${!!response?.choices}, choices长度=${response?.choices?.length || 0}`);
        throw new Error('Invalid response format: missing choices or message');
      }
    } catch (error) {
      let errorMessage = '未知错误';
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // 处理连接超时错误
        if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
          errorMessage = `连接超时：无法连接到 ${this.apiBaseUrl}。请检查网络连接或稍后重试。`;
        } else if (errorMessage.includes('ECONNREFUSED')) {
          errorMessage = `连接被拒绝：无法连接到 ${this.apiBaseUrl}。请检查 API 端点是否正确。`;
        } else if (errorMessage.includes('ENOTFOUND')) {
          errorMessage = `DNS 解析失败：无法解析 ${this.apiBaseUrl}。请检查网络连接。`;
        }
        
        console.error(`[ChatProvider] API 调用失败:`, errorMessage);
        console.error(`[ChatProvider] 错误详情:`, error);
      } else {
        errorMessage = String(error);
      }
      
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: {
          error: `Chat API 错误: ${errorMessage}`,
        },
      };
      onStatus(errorPacket);
      throw error;
    }
  }
}
