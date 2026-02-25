import { ApiService } from './api.js';
import { store } from './store.js';

/**
 * 余额查询服务
 * 所有余额查询都在主进程进行，避免跨域问题
 * 
 * 限流保护：
 * - 余额查询频率限制为每 5 分钟一次
 * - 仅在应用启动和手动刷新时触发
 * - 避免轮询导致的 429 错误
 */

// 余额查询限流状态
const balanceQueryState = {
  lastQueryTime: {
    bltcy: 0,
    rh: 0,
  },
  minInterval: 5 * 60 * 1000, // 5 分钟（毫秒）
  pendingQueries: {
    bltcy: null as Promise<number | null> | null,
    rh: null as Promise<number | null> | null,
  },
};

/**
 * 检查是否可以查询余额（限流保护）
 * 即使 force=true，也要检查最小间隔（防止疯狂请求）
 */
function canQueryBalance(type: 'bltcy' | 'rh', force: boolean = false): boolean {
  const now = Date.now();
  const lastQuery = balanceQueryState.lastQueryTime[type];
  const timeSinceLastQuery = now - lastQuery;

  // 最小间隔：即使 force=true，也要至少间隔 2 秒（防止疯狂点击）
  const minInterval = 2000; // 2 秒
  if (timeSinceLastQuery < minInterval) {
    const remainingMs = minInterval - timeSinceLastQuery;
    console.warn(`[余额查询限流] ${type.toUpperCase()} 余额查询过于频繁，还需等待 ${Math.ceil(remainingMs / 1000)} 秒`);
    return false;
  }

  // 如果不是强制刷新，检查 5 分钟间隔
  if (!force) {
    if (timeSinceLastQuery < balanceQueryState.minInterval) {
      const remainingSeconds = Math.ceil((balanceQueryState.minInterval - timeSinceLastQuery) / 1000);
      console.warn(`[余额查询限流] ${type.toUpperCase()} 余额查询过于频繁，还需等待 ${remainingSeconds} 秒`);
      return false;
    }
  }

  return true;
}

/**
 * 更新最后查询时间
 */
function updateLastQueryTime(type: 'bltcy' | 'rh'): void {
  balanceQueryState.lastQueryTime[type] = Date.now();
}

// BLTCY 余额查询服务（查询令牌余额）
export async function getBLTCYBalance(force: boolean = false): Promise<number | null> {
  // 限流检查
  if (!canQueryBalance('bltcy', force)) {
    return null;
  }

  // 如果已有正在进行的查询，返回该查询的 Promise
  if (balanceQueryState.pendingQueries.bltcy) {
    return balanceQueryState.pendingQueries.bltcy;
  }

  const apiKey = store.get('bltcyApiKey') as string;
  
  if (!apiKey) {
    return null;
  }

  // 创建查询 Promise
  const queryPromise = (async () => {
    try {
      // BLTCY API: GET /v1/token/quota
      // API 域名: https://api.bltcy.ai
      const apiService = new ApiService('https://api.bltcy.ai');
      
      const response = await apiService.get<{
        id: number;
        name: string;
        quota: number;
      }>('/v1/token/quota', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      
      // 更新最后查询时间
      updateLastQueryTime('bltcy');
      
      // 返回 quota（令牌余额）
      return response.quota ?? 0;
    } catch (error: any) {
      console.error('获取核心算力余额失败:', error);
      // 如果是网络错误，返回 null；如果是业务错误，记录详细信息
      if (error.response) {
        console.error('API 响应错误:', error.response.status, error.response.data);
      } else if (error.request) {
        console.error('请求发送失败，服务器无响应');
      }
      return null;
    } finally {
      // 清除正在进行的查询
      balanceQueryState.pendingQueries.bltcy = null;
    }
  })();

  // 保存查询 Promise
  balanceQueryState.pendingQueries.bltcy = queryPromise;

  return queryPromise;
}

// RunningHub 余额查询服务
export async function getRHBalance(force: boolean = false): Promise<number | null> {
  // 限流检查
  if (!canQueryBalance('rh', force)) {
    return null;
  }

  // 如果已有正在进行的查询，返回该查询的 Promise
  if (balanceQueryState.pendingQueries.rh) {
    return balanceQueryState.pendingQueries.rh;
  }

  const apiKey = store.get('runningHubApiKey') as string;
  
  if (!apiKey) {
    return null;
  }

  // 创建查询 Promise
  const queryPromise = (async () => {
    try {
      const apiService = new ApiService('https://www.runninghub.cn');
      
      // RunningHub API: POST /uc/openapi/accountStatus
      const response = await apiService.post<{
        code?: number;
        data?: {
          balance?: number;
          rhCoin?: number; // RH币
          coin?: number; // 可能的其他字段名
          [key: string]: any;
        };
        message?: string;
        [key: string]: any;
      }>('/uc/openapi/accountStatus', {
        apikey: apiKey,
      }, {
        headers: {
          'Host': 'www.runninghub.cn',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      // 检查响应状态码
      if (response.code && response.code !== 200 && response.code !== 0) {
        console.error('RunningHub API 返回错误:', response.message || response);
        return null;
      }
      
      // RunningHub 余额字段：remainMoney（钱包余额）
      if (response.data) {
        const balance = response.data.remainMoney;
        if (balance !== undefined) {
          // 更新最后查询时间
          updateLastQueryTime('rh');
          return Number(balance);
        }
      }
      
      // 如果没有找到余额字段，尝试直接从响应中查找
      const balance = (response as any).remainMoney;
      if (balance !== undefined) {
        // 更新最后查询时间
        updateLastQueryTime('rh');
        return Number(balance);
      }
      
      console.warn('RunningHub API 响应中未找到 remainMoney 字段:', response);
      return 0;
    } catch (error: any) {
      console.error('获取插件算力余额失败:', error);
      // 如果是网络错误，返回 null；如果是业务错误，记录详细信息
      if (error.response) {
        console.error('API 响应错误:', error.response.status, error.response.data);
      } else if (error.request) {
        console.error('请求发送失败，服务器无响应');
      }
      return null;
    } finally {
      // 清除正在进行的查询
      balanceQueryState.pendingQueries.rh = null;
    }
  })();

  // 保存查询 Promise
  balanceQueryState.pendingQueries.rh = queryPromise;

  return queryPromise;
}
