/**
 * 抠图服务：调用 RunningHub AI 应用 2021955919764000770
 *
 * 核心逻辑：
 * - 身份验证：请求头 Authorization: Bearer [API_KEY]
 * - 提交：POST run/ai-app/2021955919764000770，nodeInfoList 中 nodeId "3"、fieldName "image"、fieldValue 为公网图片 URL
 * - 异步轮询：提交后取 taskId，每 5 秒调用 /openapi/v2/query，仅当 status 为 SUCCESS 时从 results 取最终图片 URL
 *
 * 授权：仅当软件处于已激活的 PRO 状态时才允许执行（由调用方在调用前校验）。
 */

import axios from 'axios';

const MATTING_AI_APP_ID = '2021955919764000770';
const RUN_BASE = 'https://www.runninghub.cn/openapi/v2';
const POLL_INTERVAL_MS = 5 * 1000;
const POLL_DEADLINE_MS = 5 * 60 * 1000;

export interface MattingResult {
  success: true;
  imageUrl: string;
}

export interface MattingError {
  success: false;
  message: string;
}

/**
 * 提交工作流并轮询结果
 * @param apiKey RunningHub API Key（Bearer 鉴权）
 * @param imageInputUrl 已可访问的图片 URL（需由调用方先完成本地上传等）
 */
export async function runMatting(
  apiKey: string,
  imageInputUrl: string
): Promise<MattingResult | MattingError> {
  if (!apiKey?.trim()) {
    return { success: false, message: '请先在设置中配置插件算力 API Key' };
  }
  if (!imageInputUrl?.trim()) {
    return { success: false, message: '图片地址为空' };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey.trim()}`,
  };

  // 提交 AI 应用：nodeInfoList 中 nodeId "3"、fieldName "image"、fieldValue 为公网图片 URL
  const runPayload = {
    nodeInfoList: [
      {
        nodeId: '3',
        fieldName: 'image',
        fieldValue: imageInputUrl.trim(),
        description: 'image',
      },
    ],
    instanceType: 'default',
    usePersonalQueue: 'false',
  };

  const runUrl = `${RUN_BASE}/run/ai-app/${MATTING_AI_APP_ID}`;
  const runRes = await axios.post(runUrl, runPayload, {
    headers,
    timeout: 30000,
    proxy: false,
    validateStatus: () => true,
  });

  const body = runRes.data ?? {};
  const taskId = body.taskId ?? body.task_id;
  if (!taskId) {
    const msg =
      body.errorMessage ??
      body.error ??
      body.message ??
      (typeof body.msg === 'string' ? body.msg : null);
    const code = body.errorCode ?? body.code ?? body.status;
    const hint = msg ? `：${msg}` : code ? `（code: ${code}）` : '';
    console.error('[matting] 提交工作流响应', { status: runRes.status, body });
    return {
      success: false,
      message: `抠图任务提交失败：未返回 taskId${hint}`,
    };
  }

  // 轮询：每 5 秒调用 /openapi/v2/query，仅当 status 为 SUCCESS 时从 results 取 URL
  const queryUrl = `${RUN_BASE}/query`;
  const deadline = Date.now() + POLL_DEADLINE_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const queryRes = await axios.post(
      queryUrl,
      { taskId },
      {
        headers,
        timeout: 15000,
        proxy: false,
      }
    );

    const status = queryRes.data?.status;
    if (status === 'SUCCESS') {
      const results = queryRes.data?.results;
      if (results && Array.isArray(results) && results.length > 0) {
        const first = results[0];
        const url =
          typeof first?.url === 'string'
            ? first.url
            : first?.url?.url ?? first?.url?.href;
        if (url) {
          return { success: true, imageUrl: url };
        }
      }
      return {
        success: false,
        message: '抠图成功但未返回结果图片',
      };
    }

    if (status === 'FAILED' || status === 'FAILURE') {
      const msg =
        queryRes.data?.errorMessage ??
        queryRes.data?.error ??
        '抠图失败';
      return { success: false, message: String(msg) };
    }

    // QUEUED / RUNNING 等继续轮询
  }

  return { success: false, message: '抠图超时' };
}
