/**
 * AI 插件化架构 - 抽象基类
 * 所有未来接入的 AI 模型必须继承此类
 */

import { AIExecuteParams, AIStatusPacket } from './types.js';

/**
 * BaseProvider 抽象基类
 * 定义所有 AI 模型必须实现的标准接口
 */
export abstract class BaseProvider {
  /**
   * 模型标识符（由子类实现）
   */
  abstract readonly modelId: string;

  /**
   * 执行 AI 任务
   * 
   * @param params 执行参数
   * @param params.nodeId 节点 ID
   * @param params.input 模型特定的输入参数
   * @param params.onStatus 状态回调函数，用于实时推送任务状态
   * 
   * @returns Promise<void> 任务完成或失败
   */
  abstract execute(params: AIExecuteParams): Promise<void>;

  /**
   * 验证输入参数
   * 子类可以重写此方法以实现自定义验证逻辑
   * 
   * @param input 输入参数
   * @returns 验证是否通过
   */
  protected validateInput(input: any): boolean {
    return input !== null && input !== undefined;
  }

  /**
   * 创建状态数据包
   * 辅助方法，确保所有状态包都符合规范
   * 
   * @param nodeId 节点 ID
   * @param status 状态
   * @param payload 负载数据
   * @returns AIStatusPacket
   */
  protected createStatusPacket(
    nodeId: string,
    status: AIStatusPacket['status'],
    payload?: AIStatusPacket['payload']
  ): AIStatusPacket {
    return {
      nodeId,
      status,
      payload,
    };
  }
}
