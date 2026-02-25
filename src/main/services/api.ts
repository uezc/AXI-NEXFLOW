import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import http from 'http';
import https from 'https';

/**
 * API 服务基类
 * 所有 API 请求都应该通过主进程发起，避免跨域问题
 * 
 * 优化：
 * 1. 全局单例 axios 实例，避免重复创建连接
 * 2. 开启 keepAlive，复用 TCP 连接
 * 3. 429 错误退避算法：收到 429 后停止所有请求 60 秒
 */

// 全局 axios 实例缓存（按 baseURL 区分）
const axiosInstances = new Map<string, AxiosInstance>();

// 429 错误退避状态
let rateLimitBlocked = false;
let rateLimitBlockUntil = 0;

// 创建 HTTP Agent（开启 keepAlive）
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

// 创建 HTTPS Agent（开启 keepAlive）
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

/**
 * 获取或创建全局 axios 实例
 */
function getAxiosInstance(baseURL: string): AxiosInstance {
  if (axiosInstances.has(baseURL)) {
    return axiosInstances.get(baseURL)!;
  }

  const instance = axios.create({
    baseURL: baseURL || '',
    timeout: 30000, // 30 秒超时
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    // 禁用代理，确保请求直接发送到目标服务器（避免 Clash 等系统代理干扰）
    proxy: false,
    // 使用 keepAlive agent
    httpAgent: baseURL.startsWith('https') ? httpsAgent : httpAgent,
    httpsAgent: httpsAgent,
  });

  // 请求拦截器
  instance.interceptors.request.use(
    (config) => {
      // 检查是否处于 429 退避期
      if (rateLimitBlocked && Date.now() < rateLimitBlockUntil) {
        const remainingSeconds = Math.ceil((rateLimitBlockUntil - Date.now()) / 1000);
        console.warn(`[限流保护] 请求被阻止，还需等待 ${remainingSeconds} 秒`);
        return Promise.reject(new Error(`Rate limit: 请求被限流，请等待 ${remainingSeconds} 秒后重试`));
      }

      // 如果退避期已过，重置状态
      if (rateLimitBlocked && Date.now() >= rateLimitBlockUntil) {
        rateLimitBlocked = false;
        rateLimitBlockUntil = 0;
        console.log('[限流保护] 退避期已过，恢复正常请求');
      }

      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // 响应拦截器
  instance.interceptors.response.use(
    (response) => {
      return response;
    },
    (error: AxiosError) => {
      // 429 错误处理：立即停止所有请求 60 秒
      if (error.response?.status === 429) {
        rateLimitBlocked = true;
        rateLimitBlockUntil = Date.now() + 60000; // 60 秒
        console.error('[限流保护] 收到 429 错误，停止所有请求 60 秒');
        console.error('[限流保护] 错误详情:', error.response.data);
        return Promise.reject(new Error('Rate limit exceeded: 请求过于频繁，已自动暂停 60 秒'));
      }

      // 统一错误处理
      console.error('API Error:', error.message);
      if (error.response) {
        console.error('API 响应错误:', error.response.status, error.response.data);
      } else if (error.request) {
        console.error('请求发送失败，服务器无响应');
      }
      return Promise.reject(error);
    }
  );

  axiosInstances.set(baseURL, instance);
  return instance;
}

export class ApiService {
  private client: AxiosInstance;

  constructor(baseURL?: string) {
    // 使用全局单例实例
    this.client = getAxiosInstance(baseURL || '');
  }

  /**
   * GET 请求
   */
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  /**
   * POST 请求
   */
  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  /**
   * PUT 请求
   */
  async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  /**
   * DELETE 请求
   */
  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }
}
