/**
 * 统一进度条模拟引擎
 * 提供双段式模拟进度，优化用户感知速度
 */

export type ModelType = 'video' | 'image' | 'character' | 'chat' | 'llm';

export interface ProgressConfig {
  /** 第一阶段结束百分比（默认 80%） */
  phase1End: number;
  /** 第一阶段更新间隔（毫秒） */
  phase1Interval: number;
  /** 第一阶段步长（每次增长百分比） */
  phase1Step: number;
  /** 第二阶段更新间隔（毫秒） */
  phase2Interval: number;
  /** 第二阶段步长（每次增长百分比） */
  phase2Step: number;
  /** 最大进度值（默认 99%，确保在 SUCCESS 前不会到 100%） */
  maxProgress: number;
}

/**
 * 不同模型类型的进度配置
 */
const MODEL_CONFIGS: Record<ModelType, ProgressConfig> = {
  video: {
    phase1End: 80,
    phase1Interval: 200, // 每 200ms 更新一次
    phase1Step: 2, // 每次增长 2%
    phase2Interval: 500, // 每 500ms 更新一次
    phase2Step: 1, // 每次增长 1%
    maxProgress: 99,
  },
  image: {
    phase1End: 85,
    phase1Interval: 100, // 每 100ms 更新一次（图片生成快）
    phase1Step: 3, // 每次增长 3%
    phase2Interval: 300, // 每 300ms 更新一次
    phase2Step: 1, // 每次增长 1%
    maxProgress: 95, // 图片生成在 1.5 秒内冲到 95%
  },
  character: {
    phase1End: 70,
    phase1Interval: 250, // 每 250ms 更新一次
    phase1Step: 2, // 每次增长 2%
    phase2Interval: 600, // 每 600ms 更新一次
    phase2Step: 0.5, // 每次增长 0.5%（更慢）
    maxProgress: 99,
  },
  chat: {
    phase1End: 80,
    phase1Interval: 300,
    phase1Step: 2,
    phase2Interval: 500,
    phase2Step: 1,
    maxProgress: 99,
  },
  llm: {
    phase1End: 80,
    phase1Interval: 300,
    phase1Step: 2,
    phase2Interval: 500,
    phase2Step: 1,
    maxProgress: 99,
  },
};

/**
 * 进度状态文案配置（文字轮播）
 */
export const PROGRESS_MESSAGES = [
  '正在生成...',
  '处理中...',
  '思考中...',
  '解析中...',
  '正在创作...',
  '生成内容中...',
  '正在组织语言...',
];

/**
 * 根据进度百分比获取对应的状态文案（文字轮播）
 * 使用时间戳计算索引，实现平滑轮播
 */
export function getProgressMessage(progress: number, startTime?: number): string {
  const messages = PROGRESS_MESSAGES;
  const messageCount = messages.length;
  
  // 如果提供了 startTime，使用时间戳计算索引（每 1.5 秒切换一次）
  if (startTime !== undefined) {
    const elapsed = Date.now() - startTime;
    const interval = 1500; // 每 1.5 秒切换一次
    const index = Math.floor(elapsed / interval) % messageCount;
    return messages[index];
  }
  
  // 如果没有提供 startTime，使用进度值计算索引（作为备用方案）
  const index = Math.floor(progress / (100 / messageCount)) % messageCount;
  return messages[index];
}

/**
 * 进度计算引擎
 */
export class ProgressEngine {
  private config: ProgressConfig;
  private currentProgress: number = 0;
  private startTime: number;
  private lastUpdateTime: number;
  private isPhase1: boolean = true;

  constructor(modelType: ModelType, startTime?: number) {
    this.config = MODEL_CONFIGS[modelType];
    this.startTime = startTime || Date.now();
    this.lastUpdateTime = this.startTime;
    this.currentProgress = 0;
    this.isPhase1 = true;
  }

  /**
   * 获取当前进度值
   * 根据时间自动计算进度
   */
  getProgress(): number {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;
    
    // 判断当前阶段
    if (this.isPhase1 && this.currentProgress >= this.config.phase1End) {
      this.isPhase1 = false;
    }

    // 根据阶段选择配置
    const interval = this.isPhase1 ? this.config.phase1Interval : this.config.phase2Interval;
    const step = this.isPhase1 ? this.config.phase1Step : this.config.phase2Step;

    // 检查是否需要更新
    if (timeSinceLastUpdate >= interval) {
      const newProgress = Math.min(
        this.config.maxProgress,
        this.currentProgress + step
      );
      this.currentProgress = newProgress;
      this.lastUpdateTime = now;
    }

    return Math.min(this.config.maxProgress, this.currentProgress);
  }

  /**
   * 获取当前进度对应的状态文案（文字轮播）
   */
  getMessage(): string {
    return getProgressMessage(this.getProgress(), this.startTime);
  }

  /**
   * 重置进度引擎
   */
  reset(startTime?: number): void {
    this.currentProgress = 0;
    this.startTime = startTime || Date.now();
    this.lastUpdateTime = this.startTime;
    this.isPhase1 = true;
  }

  /**
   * 手动设置进度（用于特殊情况）
   */
  setProgress(progress: number): void {
    this.currentProgress = Math.min(this.config.maxProgress, Math.max(0, progress));
    this.isPhase1 = this.currentProgress < this.config.phase1End;
  }
}

/**
 * 创建进度引擎实例
 */
export function createProgressEngine(modelType: ModelType, startTime?: number): ProgressEngine {
  return new ProgressEngine(modelType, startTime);
}
