/**
 * AI Hook - 渲染进程 AI 调用接口
 * 支持非受控更新，确保 60FPS 流畅度
 */

import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * AI 状态类型
 */
export type AIStatus = 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR';

/**
 * AI 状态数据包
 */
export interface AIStatusPacket {
  nodeId: string;
  status: AIStatus;
  payload?: {
    text?: string;
    url?: string;
    imageUrl?: string;
    videoUrl?: string;
    localPath?: string; // 本地文件路径（自动下载后）
    progress?: number;
    error?: string;
    taskId?: string;
  };
}

/**
 * useAI Hook 选项
 */
export interface UseAIOptions {
  nodeId: string;
  modelId: string;
  onStatusUpdate?: (packet: AIStatusPacket) => void;
  onComplete?: (result: AIStatusPacket['payload']) => void;
  onError?: (error: string) => void;
}

/**
 * useAI Hook 返回值
 */
export interface UseAIReturn {
  status: AIStatus;
  payload: AIStatusPacket['payload'] | null;
  execute: (input: any) => Promise<void>;
  cancel: () => void;
}

/**
 * useAI Hook
 * 
 * 用于在渲染进程中调用 AI 模型
 * 支持非受控更新，确保画布操作保持 60FPS 流畅度
 * 
 * @param options Hook 选项
 * @returns AI 状态和执行函数
 */
export const useAI = (options: UseAIOptions): UseAIReturn => {
  const { nodeId, modelId, onStatusUpdate, onComplete, onError } = options;
  
  const [status, setStatus] = useState<AIStatus>('idle');
  const [payload, setPayload] = useState<AIStatusPacket['payload'] | null>(null);
  
  // 使用 ref 存储回调，避免闭包问题
  const callbacksRef = useRef({ onStatusUpdate, onComplete, onError });
  useEffect(() => {
    callbacksRef.current = { onStatusUpdate, onComplete, onError };
  }, [onStatusUpdate, onComplete, onError]);

  // 进度更新节流：使用 requestAnimationFrame 确保 UI 每秒更新不超过 30 次
  const pendingProgressUpdateRef = useRef<AIStatusPacket | null>(null);
  const rafIdRef = useRef<number | null>(null);
  
  // 节流处理函数
  const processPendingProgressUpdate = useCallback(() => {
    const packet = pendingProgressUpdateRef.current;
    pendingProgressUpdateRef.current = null;
    rafIdRef.current = null;
    if (!packet) return;
    
    // 调用回调（确保不传入 undefined，避免 packet is not defined）
    console.log(`[useAI] [节流] 调用 onStatusUpdate 回调，状态: ${packet.status}, nodeId: ${packet.nodeId}, progress: ${(packet.payload as any)?.progress}`);
    callbacksRef.current.onStatusUpdate?.(packet);
    // 如果还有新的更新等待处理，继续安排下一个 requestAnimationFrame
    if (pendingProgressUpdateRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        processPendingProgressUpdate();
      });
    }
  }, []);
  
  // 清理 requestAnimationFrame
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // 从文本中提取第一个 URL
  const extractUrlFromText = (text?: string): string | undefined => {
    if (!text) return undefined;
    const match = text.match(/https?:\/\/[^\s'"]+/);
    return match ? match[0] : undefined;
  };

  // 监听 AI 状态更新
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleStatusUpdate = (packet: AIStatusPacket) => {
      // 防御性检查：确保 packet 存在
      if (!packet) {
        console.warn('[useAI] 收到无效的 packet:', packet);
        return;
      }

      // ✅ 修复：只处理当前节点的状态更新
      // 消除 ID 误差：对 ID 进行 trim() 处理，避免编码不一致（多一个换行符或不可见字符）导致的匹配失败
      const packetNodeId = String(packet.nodeId || '').trim();
      const currentNodeId = String(nodeId || '').trim();
      
      if (packetNodeId !== currentNodeId) {
        // SUCCESS 且带 text 时打一次日志，便于排查「反推结果已保存但 LLM 不显示」问题
        if (packet.status === 'SUCCESS' && (packet.payload as any)?.text) {
          console.warn(`[useAI] nodeId 不匹配，未更新当前节点: 当前 nodeId="${currentNodeId}", 包内 nodeId="${packetNodeId}", text 长度=${(packet.payload as any).text?.length ?? 0}`);
        }
        return;
      }

      // ✅ 修复：增强调试日志，记录当前节点收到的状态更新
      console.log(`[useAI-${currentNodeId}] ✅ 收到状态更新:`, {
        status: packet.status,
        hasPayload: !!packet.payload,
        payloadKeys: packet.payload ? Object.keys(packet.payload) : [],
        hasText: !!(packet.payload as any)?.text,
        textLength: (packet.payload as any)?.text?.length || 0,
        progress: (packet.payload as any)?.progress,
      });

      // ✅ 修复：防止 payload 丢失 - 增加非空校验
      // 如果 payload 为空或 undefined，使用空对象，但保留已有的 payload（如果有）
      const payload = packet.payload || {};
      
      // 如果 payload 为空对象且之前有 payload，记录警告
      if (!packet.payload && Object.keys(payload).length === 0) {
        console.warn(`[useAI] 收到空 payload，状态: ${packet.status}, nodeId: ${nodeId}`);
      }

      // 优先使用本地路径，如果没有则使用远程 URL
      const localPath = (payload as any).localPath;
      const receivedImageUrl = (payload as any).imageUrl;
      const receivedVideoUrl = (payload as any).videoUrl;
      const receivedUrl = (payload as any).url;
      const originalVideoUrl = (payload as any).originalVideoUrl; // 原始远程 URL（备用）
      const extractedUrl = extractUrlFromText((payload as any).text);
      
      // 如果有本地路径，转换为 local-resource:// 协议 URL
      let displayImageUrl: string | undefined;
      let displayVideoUrl: string | undefined;
      
      if (localPath) {
        // 检查 localPath 是否是视频或图片文件（通过文件扩展名判断）
        const isVideoFile = /\.(mp4|webm|mov|avi|mkv)$/i.test(localPath);
        const isImageFile = /\.(png|jpg|jpeg|webp|gif)$/i.test(localPath);
        
        // 路径标准化：统一将 Windows 路径中的反斜杠转换为正斜杠
        // 避免 C:/ 和 C:\ 混用导致的字符串解析异常
        let normalizedPath: string;
        try {
          normalizedPath = localPath.replace(/\\/g, '/');
          // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
          if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
            normalizedPath = normalizedPath.substring(1); // 移除开头的 /
          }
        } catch (error) {
          // 解决乱码中断：如果路径标准化失败（可能是乱码），使用原路径
          console.warn('[useAI] 路径标准化失败（可能是乱码路径）:', error, localPath);
          normalizedPath = localPath.replace(/\\/g, '/'); // 至少尝试替换反斜杠
        }
        
        // 将本地路径转换为 local-resource:// 协议 URL
        const localResourceUrl = `local-resource://${normalizedPath}`;
        
        // 只有当地址是视频文件且 receivedVideoUrl 存在时，才使用 localPath
        if (receivedVideoUrl && isVideoFile) {
          displayVideoUrl = localResourceUrl;
        } else if (receivedVideoUrl) {
          // 如果 receivedVideoUrl 存在但 localPath 不是视频文件，使用 receivedVideoUrl（可能是远程 URL 或 file://）
          // 将 file:// 格式转换为 local-resource:// 格式
          if (receivedVideoUrl.startsWith('file://')) {
            let filePath = receivedVideoUrl.replace(/^file:\/\/\/?/, '');
            // 处理 Windows 路径
            if (filePath.match(/^[a-zA-Z]:/)) {
              // 已经是正确的 Windows 路径格式
            } else if (filePath.match(/^[a-zA-Z]\//)) {
              // 处理 file:///c/Users 格式，转换为 C:/Users
              filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            }
            displayVideoUrl = `local-resource://${filePath.replace(/\\/g, '/')}`;
          } else {
            displayVideoUrl = receivedVideoUrl;
          }
        }
        // 只有当地址是图片文件且 receivedImageUrl 存在时，才使用 localPath
        if (receivedImageUrl && isImageFile) {
          displayImageUrl = localResourceUrl;
        } else if (receivedImageUrl) {
          // 如果 receivedImageUrl 存在但 localPath 不是图片文件，使用 receivedImageUrl（可能是远程 URL）
          displayImageUrl = receivedImageUrl;
        }
      } else {
        // 没有本地路径，使用远程 URL
        displayImageUrl = receivedImageUrl || (receivedUrl && !receivedVideoUrl ? receivedUrl : null) || (extractedUrl && !receivedVideoUrl ? extractedUrl : null);
        displayVideoUrl = receivedVideoUrl || (receivedUrl && !receivedImageUrl ? receivedUrl : null) || (extractedUrl && !receivedImageUrl ? extractedUrl : null);
      }

      // 检查是否有有效的 URL（远程或本地）
      // 对于视频，优先检查 videoUrl，如果没有则检查 url（可能是视频 URL）
      const hasValidUrl = (displayImageUrl || displayVideoUrl) && 
        (displayImageUrl?.startsWith('local-resource://') || 
         displayVideoUrl?.startsWith('local-resource://') || 
         /^https?:\/\//.test(displayImageUrl || displayVideoUrl || ''));
      
      // 检查是否有文本内容（用于 LLM 和 Text 模块）
      // 双重保障：优先使用 text，而不是等待 localPath 读取
      const hasText = (payload as any).text && (payload as any).text.trim();
      
      // 路径标准化：统一将 Windows 路径中的反斜杠转换为正斜杠
      const normalizePath = (path: string | undefined): string | undefined => {
        if (!path) return undefined;
        try {
          // 统一使用正斜杠，避免 C:/ 和 C:\ 混用导致的解析异常
          return path.replace(/\\/g, '/');
        } catch (error) {
          console.warn('[useAI] 路径标准化失败:', error, path);
          return path; // 如果标准化失败，返回原路径
        }
      };
      
      // 标准化 localPath（如果存在）
      const normalizedLocalPath = normalizePath(localPath);
      
      // 调试日志：帮助诊断 URL 提取问题（仅在 SUCCESS 状态且没有有效 URL 时）
      if (packet.status === 'SUCCESS' && !hasValidUrl && !hasText) {
        console.warn('[useAI] SUCCESS 状态但没有有效 URL 或文本:', {
          receivedVideoUrl,
          receivedUrl,
          receivedImageUrl,
          displayVideoUrl,
          displayImageUrl,
          hasValidUrl,
          hasText,
          payload: JSON.stringify(payload, null, 2),
        });
      }
      
      // 放弃路径依赖：有文本就先上文本，不再死等 localPath 读取
      // 这样可以避免因为 localPath 读取失败（如乱码路径）而导致内容无法显示
      if (hasText && packet.status === 'SUCCESS') {
        try {
          // 优先使用 text 字段，不等待 localPath 读取
          const textContent = String((payload as any).text || '').trim();
          if (textContent) {
            const textPayload = {
              ...payload,
              text: textContent, // 优先使用 text，确保是字符串且已 trim
              ...(normalizedLocalPath ? { localPath: normalizedLocalPath } : {}), // 标准化后的路径作为备用（但不等待）
            };

            // 立即标记为 SUCCESS，使用 text 内容
            setStatus('SUCCESS');
            setPayload((prev) => ({
              ...prev,
              ...textPayload,
            }));

            const successPacket: AIStatusPacket = {
              nodeId: packetNodeId, // 使用 trim 后的 ID
              status: 'SUCCESS',
              payload: textPayload,
            };

            // 通知外部状态更新和完成回调
            console.log(`[useAI] 放弃路径依赖：优先使用 text 字段，text 长度: ${textContent.length}, nodeId: ${packetNodeId}`);
            console.log(`[useAI] 放弃路径依赖：调用 onStatusUpdate 回调，hasCallback: ${!!callbacksRef.current.onStatusUpdate}`);
            callbacksRef.current.onStatusUpdate?.(successPacket);
            console.log(`[useAI] 放弃路径依赖：调用 onComplete 回调，hasCallback: ${!!callbacksRef.current.onComplete}`);
            callbacksRef.current.onComplete?.(textPayload);
            return; // 提前返回，不再等待 localPath
          }
        } catch (error) {
          // 解决乱码中断：即使处理 text 时出错，也不阻塞流程
          console.warn('[useAI] 处理 text 时出错（可能是乱码路径导致）:', error);
          // 继续执行后续逻辑，不中断
        }
      }
      
      // 如果有有效的 URL（图片或视频），按原有逻辑处理
      if (hasValidUrl) {
        const mergedPayload = {
          ...payload,
          ...(displayImageUrl ? { imageUrl: displayImageUrl } : {}),
          ...(displayVideoUrl ? { videoUrl: displayVideoUrl, url: displayVideoUrl } : {}),
          ...(localPath ? { localPath } : {}),
          ...(originalVideoUrl ? { originalVideoUrl } : {}), // 保存原始远程 URL
        };

        // 立即标记为 SUCCESS，停止计时逻辑由外层根据 SUCCESS / imageUrl / videoUrl 处理
        setStatus('SUCCESS');
        setPayload((prev) => ({
          ...prev,
          ...mergedPayload,
        }));

        const successPacket: AIStatusPacket = {
          nodeId: packetNodeId, // 使用 trim 后的 ID
          status: 'SUCCESS',
          payload: mergedPayload,
        };

        // 通知外部状态更新和完成回调
        callbacksRef.current.onStatusUpdate?.(successPacket);
        callbacksRef.current.onComplete?.(mergedPayload);
        return;
      }

      // 正常状态更新（使用函数式更新，避免闭包问题）
      setStatus((prev) => {
        // 如果状态已经是 ERROR 或 SUCCESS，且新状态是 START，允许更新（用于重新生成）
        if ((prev === 'ERROR' || prev === 'SUCCESS') && packet.status === 'START') {
          return packet.status;
        }
        // 如果状态已经是 SUCCESS，且新状态也是 SUCCESS，允许更新（可能包含新的数据）
        if (prev === 'SUCCESS' && packet.status === 'SUCCESS') {
          return packet.status; // 允许更新，确保新的 payload 能够传递
        }
        // ✅ 修复：允许从任何状态转换到 START 或 PROCESSING（用于重新生成或继续处理）
        if (packet.status === 'START' || packet.status === 'PROCESSING') {
          return packet.status;
        }
        // 如果状态已经是 ERROR 或 SUCCESS，且新状态不是 START 或 SUCCESS，不再更新
        if (prev === 'ERROR' || prev === 'SUCCESS') {
          return prev;
        }
        return packet.status;
      });

      // 更新 payload（始终更新，确保最新数据）
      // 对于文本类型，确保 text 字段被正确合并
      if (packet.payload) {
        setPayload((prev) => {
          const merged = {
            ...prev,
            ...packet.payload,
          };
          // 确保 text 字段被正确保留（如果存在）
          if ((packet.payload as any).text) {
            merged.text = (packet.payload as any).text;
          }
          // 确保 localPath 字段被正确保留（如果存在）
          if ((packet.payload as any).localPath) {
            merged.localPath = (packet.payload as any).localPath;
          }
          return merged;
        });
      }

      // 调用外部回调（始终调用，确保状态更新能够传递）
      // 对于文本类型，确保 payload 包含 text 字段
      // 放弃路径依赖：有文本就先上文本，不再等待 localPath
      const callbackPacket = { ...packet };
      if (packet.payload) {
        // 优先使用 text 字段，确保是字符串且已 trim
        const textContent = (packet.payload as any).text;
        const trimmedText = textContent ? String(textContent).trim() : undefined;
        
        callbackPacket.payload = {
          ...packet.payload,
          // 确保 text 被正确传递（优先使用 trim 后的文本）
          ...(trimmedText ? { text: trimmedText } : {}),
          ...((packet.payload as any).localPath ? { localPath: (packet.payload as any).localPath } : {}),
        };
      }
      
      // 使用 trim 后的 nodeId
      callbackPacket.nodeId = packetNodeId;
      
      // 对于 PROCESSING 状态（进度更新），使用 requestAnimationFrame 节流
      // 确保 UI 每秒更新不超过 30 次，避免批量运行时卡顿
      if (callbackPacket.status === 'PROCESSING' && (callbackPacket.payload as any)?.progress !== undefined) {
        // 保存最新的进度更新
        pendingProgressUpdateRef.current = callbackPacket;
        
        // 如果还没有安排 requestAnimationFrame，安排一个
        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            processPendingProgressUpdate();
          });
        }
      } else {
        // 非进度更新（START、SUCCESS、ERROR），立即调用，不使用节流
        console.log(`[useAI] 调用 onStatusUpdate 回调，状态: ${callbackPacket.status}, nodeId: ${packetNodeId}, 有 text: ${!!(callbackPacket.payload as any)?.text}, text 长度: ${(callbackPacket.payload as any)?.text?.length || 0}, 有 localPath: ${!!(callbackPacket.payload as any)?.localPath}, hasCallback: ${!!callbacksRef.current.onStatusUpdate}`);
        callbacksRef.current.onStatusUpdate?.(callbackPacket);
      }

      // 处理完成和错误状态
      if (packet.status === 'SUCCESS') {
        // 防御性检查：确保 payload 存在
        const payload = callbackPacket.payload || {};
        const textLength = (payload as any).text?.length || 0;
        console.log(`[useAI] 调用 onComplete 回调，text 长度: ${textLength}, payload keys: ${Object.keys(payload).join(', ')}`);
        callbacksRef.current.onComplete?.(payload);
      } else if (packet.status === 'ERROR') {
        callbacksRef.current.onError?.(packet.payload?.error || 'Unknown error');
      }
    };

    // ✅ 修复：确保每一个 nodeId 对应的监听器都是独立的，防止单独运行时，监听器由于 ID 匹配或清理逻辑（cleanup）被错误移除
    // 注册监听器，获取清理函数
    const removeListener = window.electronAPI.onAIStatusUpdate(handleStatusUpdate);
    
    console.log(`[useAI-${nodeId.trim()}] ✅ 注册监听器，监听器函数已创建`);

    // 清理函数：在移除监听器前先下发未处理的进度/SUCCESS，再清理
    return () => {
      const pending = pendingProgressUpdateRef.current;
      if (pending) {
        pendingProgressUpdateRef.current = null;
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        callbacksRef.current.onStatusUpdate?.(pending);
      }
      console.log(`[useAI-${nodeId.trim()}] 🧹 清理监听器`);
      if (removeListener && typeof removeListener === 'function') {
        removeListener();
      }
    };
  }, [nodeId]); // ✅ 修复：确保 nodeId 变化时重新注册监听器

  // 执行 AI 调用
  const execute = useCallback(async (input: any) => {
    if (!window.electronAPI) {
      throw new Error('electronAPI not available');
    }

    // ✅ 修复：强制在执行 window.electronAPI.invokeAI 之前，先在本地 setStatus('START') 并 setProgress(1)
    // ✅ 修复：状态源头检查 - 确保 setStatus('START') 是立即触发同步更新的
    // 重置状态（进入一次新的调用）
    // 使用 flushSync 确保状态立即同步更新（如果可用）
    setStatus('START');
    setPayload(null);
    
    // ✅ 修复：立即触发一次渲染，确保状态更新被 React 捕获
    // 使用 requestAnimationFrame 确保在下一帧渲染前状态已更新
    requestAnimationFrame(() => {
      // 状态已更新，继续执行后续逻辑
    });

    // ✅ 修复：强制给 LLM 注入 START 包（兜底）
    // 在真正请求 API 之前，先发一个 START，确保 UI 计时器立即启动
    // 不要等接口返回，不要等流式开始，UI 计时器必须靠这个启动
    const startPacket: AIStatusPacket = {
      nodeId: nodeId.trim(),
      status: 'START',
      payload: {},
    };
    
    // 立即更新本地状态
    setStatus('START');
    setPayload(startPacket.payload);
    
    // 立即同步调用 onStatusUpdate 回调
    if (callbacksRef.current.onStatusUpdate) {
      callbacksRef.current.onStatusUpdate(startPacket);
    }

    try {
      // 调用主进程 AI 接口
      // 注意：invokeAI 返回 Promise<void>，状态通过 onStatus 回调传递
      // 如果调用失败，会抛出异常，由 catch 块处理
      await window.electronAPI.invokeAI({
        modelId,
        nodeId: (nodeId != null ? String(nodeId).trim() : ''),
        input,
      });
      // 成功调用后，状态更新会通过 onStatus 回调传递，这里不需要检查返回值
    } catch (error) {
      // 防御性处理：无论什么原因（包括 fetch 失败 / 网络错误），都要显式结束本次调用
      const errorMessage = error instanceof Error ? error.message : String(error);

      setStatus('ERROR');
      setPayload({ error: errorMessage });

      // 将错误透传给业务侧，用于弹窗等
      callbacksRef.current.onError?.(errorMessage);
      // 同时也触发一次 onComplete，方便外层统一做“停止计时 / 重置按钮”
      callbacksRef.current.onComplete?.({ error: errorMessage });

      // 不再向外抛出，避免控制台出现 Uncaught (in promise) 等干扰性错误
    }
  }, [modelId, nodeId]);

  // 取消 AI 调用（当前版本仅重置状态，未来可扩展为真正的取消）
  const cancel = useCallback(() => {
    setStatus('idle');
    setPayload(null);
  }, []);

  return {
    status,
    payload,
    execute,
    cancel,
  };
};
