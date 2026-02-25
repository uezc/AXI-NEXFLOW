/**
 * 去水印服务：调用 RunningHub AI 应用 2022127885233950721
 *
 * 请求文档：run/ai-app/2022127885233950721
 * - 身份验证：Authorization: Bearer [API_KEY]
 * - nodeInfoList：nodeId "166"，fieldName "image"，fieldValue 为公网图片 URL（先上传 OSS 再请求）
 * - 轮询 /openapi/v2/query，每 5 秒，SUCCESS 时从 results[0].url 取结果
 *
 * 授权：由调用方在调用前校验 PRO。
 */

import axios from 'axios';

const WATERMARK_AI_APP_ID = '2022127885233950721';
const RUN_BASE = 'https://www.runninghub.cn/openapi/v2';
const POLL_INTERVAL_MS = 5 * 1000;
const POLL_DEADLINE_MS = 5 * 60 * 1000;

export interface WatermarkRemovalResult {
  success: true;
  imageUrl: string;
}

export interface WatermarkRemovalError {
  success: false;
  message: string;
}

/**
 * 提交去水印任务并轮询结果
 * @param apiKey RunningHub API Key（Bearer 鉴权）
 * @param imageInputUrl 公网图片 URL（调用方先上传 OSS 得到）
 */
export async function runWatermarkRemoval(
  apiKey: string,
  imageInputUrl: string
): Promise<WatermarkRemovalResult | WatermarkRemovalError> {
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

  const runPayload = {
    nodeInfoList: [
      {
        nodeId: '166',
        fieldName: 'image',
        fieldValue: imageInputUrl.trim(),
        description: 'image',
      },
    ],
    instanceType: 'default',
    usePersonalQueue: 'false',
  };

  const runUrl = `${RUN_BASE}/run/ai-app/${WATERMARK_AI_APP_ID}`;
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
    console.error('[去水印] 提交响应', { status: runRes.status, body });
    return {
      success: false,
      message: `去水印任务提交失败：未返回 taskId${hint}`,
    };
  }

  const queryUrl = `${RUN_BASE}/query`;
  const deadline = Date.now() + POLL_DEADLINE_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const queryRes = await axios.post(
      queryUrl,
      { taskId },
      { headers, timeout: 15000, proxy: false }
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
        message: '去水印成功但未返回结果图片',
      };
    }

    if (status === 'FAILED' || status === 'FAILURE') {
      const msg =
        queryRes.data?.errorMessage ??
        queryRes.data?.error ??
        '去水印失败';
      return { success: false, message: String(msg) };
    }
  }

  return { success: false, message: '去水印超时' };
}
