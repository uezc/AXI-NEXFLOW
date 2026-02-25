/**
 * 任务历史记录服务
 * 使用 JSON 文件存储任务执行历史，用于计算平均时长
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export type TaskType = 'llm' | 'image' | 'video';

export interface TaskHistoryEntry {
  taskType: TaskType;
  duration: number; // 耗时（秒）
  timestamp: number; // 执行时间戳
  success: boolean; // 是否成功
}

interface TaskHistoryData {
  entries: TaskHistoryEntry[];
}

const HISTORY_FILE = path.join(app.getPath('userData'), 'task_history.json');
const MAX_ENTRIES = 1000; // 最多保存 1000 条记录

/**
 * 读取任务历史
 */
function readHistory(): TaskHistoryData {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('[TaskHistory] 读取历史记录失败:', error);
  }
  return { entries: [] };
}

/**
 * 写入任务历史
 */
function writeHistory(data: TaskHistoryData): void {
  try {
    // 限制记录数量
    if (data.entries.length > MAX_ENTRIES) {
      // 保留最近的 MAX_ENTRIES 条
      data.entries = data.entries
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_ENTRIES);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[TaskHistory] 写入历史记录失败:', error);
  }
}

/**
 * 记录任务执行历史
 */
export function recordTaskHistory(
  taskType: TaskType,
  duration: number,
  success: boolean = true
): void {
  const history = readHistory();
  history.entries.push({
    taskType,
    duration,
    timestamp: Date.now(),
    success,
  });
  writeHistory(history);
  console.log(`[TaskHistory] 记录任务: ${taskType}, 耗时: ${duration.toFixed(2)}s, 成功: ${success}`);
}

/**
 * 获取任务类型的平均时长
 * @param taskType 任务类型
 * @param limit 查询最近 N 次成功运行（默认 10）
 * @returns 平均时长（秒），如果数据不足则返回默认值
 */
export function getAverageDuration(taskType: TaskType, limit: number = 10): number {
  const history = readHistory();
  
  // 筛选该类型的成功任务，按时间倒序
  const successfulTasks = history.entries
    .filter(entry => entry.taskType === taskType && entry.success)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  if (successfulTasks.length === 0) {
    // 返回默认值
    const defaults: Record<TaskType, number> = {
      llm: 5,
      image: 15,
      video: 40,
    };
    return defaults[taskType];
  }

  // 计算平均时长
  const totalDuration = successfulTasks.reduce((sum, entry) => sum + entry.duration, 0);
  const average = totalDuration / successfulTasks.length;
  
  console.log(`[TaskHistory] ${taskType} 平均时长: ${average.toFixed(2)}s (基于 ${successfulTasks.length} 次成功运行)`);
  return average;
}

/**
 * 获取任务类型的最近 N 次成功运行的平均时长
 * @param taskType 任务类型
 * @param limit 查询最近 N 次（默认 10）
 * @returns 平均时长（秒）
 */
export function getRecentAverageDuration(taskType: TaskType, limit: number = 10): number {
  return getAverageDuration(taskType, limit);
}
