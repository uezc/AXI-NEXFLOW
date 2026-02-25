#!/usr/bin/env node
/**
 * 构建前同步：将当前已保存的 LLM 人设提示词写入 resources/default-llm-personas.json，
 * 使打包后的安装包首次运行时自动注入这些人设。
 *
 * 读取 electron-store 的 nexflow-config（与主进程 store 同源）：
 * - Windows: %APPDATA%\nexflow\nexflow-config.json
 * - macOS: ~/Library/Application Support/nexflow/nexflow-config.json
 * - Linux: ~/.config/nexflow/nexflow-config.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

function getConfigPath() {
  const appName = 'nexflow';
  const configName = 'nexflow-config.json';
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(base, appName, configName);
  }
  if (process.platform === 'darwin') {
    const base = path.join(process.env.HOME || '', 'Library', 'Application Support');
    return path.join(base, appName, configName);
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config');
  return path.join(base, appName, configName);
}

const configPath = getConfigPath();
const outputPath = path.join(projectRoot, 'resources', 'default-llm-personas.json');

let personas = [];

if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const data = JSON.parse(raw);
    const list = data?.globalLLMPersonas;
    if (Array.isArray(list) && list.length > 0) {
      personas = list;
      console.log(`[sync-llm-personas] 已从 ${configPath} 读取 ${personas.length} 条人设`);
    } else {
      console.log('[sync-llm-personas] 当前无人设，将写入空数组');
    }
  } catch (e) {
    console.warn('[sync-llm-personas] 读取配置失败:', e.message);
  }
} else {
  console.log('[sync-llm-personas] 未找到本地配置，将写入空数组（可先运行应用并保存人设后再构建）');
}

try {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(personas, null, 2), 'utf-8');
  console.log('[sync-llm-personas] 已写入', outputPath);
} catch (e) {
  console.warn('[sync-llm-personas] 写入失败:', e.message);
  process.exit(1);
}
