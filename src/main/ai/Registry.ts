/**
 * AI 插件化架构 - 模型配置中心
 * 用于绑定 modelId 和对应的 Provider 实例
 */

import { BaseProvider } from './BaseProvider.js';

/**
 * Provider 注册表类型
 */
type ProviderRegistry = Map<string, BaseProvider>;

/**
 * 全局 Provider 注册表
 */
const registry: ProviderRegistry = new Map();

/**
 * 注册 AI Provider
 * 
 * @param provider Provider 实例
 */
export function registerProvider(provider: BaseProvider): void {
  if (registry.has(provider.modelId)) {
    console.warn(`Provider with modelId "${provider.modelId}" already exists. Overwriting...`);
  }
  registry.set(provider.modelId, provider);
  console.log(`✅ Registered AI Provider: ${provider.modelId}`);
}

/**
 * 获取 AI Provider
 * 
 * @param modelId 模型标识符
 * @returns Provider 实例，如果不存在则返回 undefined
 */
export function getProvider(modelId: string): BaseProvider | undefined {
  return registry.get(modelId);
}

/**
 * 获取所有已注册的 Provider
 * 
 * @returns Provider 数组
 */
export function getAllProviders(): BaseProvider[] {
  return Array.from(registry.values());
}

/**
 * 检查 Provider 是否已注册
 * 
 * @param modelId 模型标识符
 * @returns 是否已注册
 */
export function hasProvider(modelId: string): boolean {
  return registry.has(modelId);
}

/**
 * 清空注册表（主要用于测试）
 */
export function clearRegistry(): void {
  registry.clear();
}
