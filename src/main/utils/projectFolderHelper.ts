import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { store } from '../services/store.js';

const PROJECTS_KEY = 'projects';
const MIGRATED_FROM_USERDATA_KEY = 'projectsMigratedFromUserData';

type ProjectRecord = {
  id: string;
  name: string;
  date: string;
  createdAt: number;
  lastModified: number;
};

/**
 * 判断本地文件路径是否在允许访问范围内（与 main/index.ts 中 local-resource 协议允许的目录一致）。
 * 用于 ChatProvider、ImageProvider 等读取用户选择的本地图片/视频时做安全校验。
 */
export function isLocalResourcePathAllowed(filePath: string): boolean {
  // 去除 URL 风格前导斜杠（如 /E:/Users/...），否则 path.normalize 在 Windows 上会得到 \E:\... 导致后续校验失败
  let pathToCheck = filePath.trim();
  if (process.platform === 'win32' && /^[/\\][a-zA-Z]:[/\\]/.test(pathToCheck)) {
    pathToCheck = pathToCheck.replace(/^[/\\]+/, '');
  }
  const normalizedPath = path.normalize(pathToCheck);
  const userDataPath = app.getPath('userData');
  const normalizedUserData = path.normalize(userDataPath);
  const projectsBase = path.normalize(getProjectsBasePath());
  const defaultProjectsPath = path.normalize(path.join(process.cwd(), 'projects'));
  const allowedRoots = [
    normalizedUserData,
    projectsBase,
    ...(defaultProjectsPath !== projectsBase ? [defaultProjectsPath] : []),
    path.normalize(app.getPath('home')),
    path.normalize(app.getPath('desktop')),
    path.normalize(app.getPath('documents')),
    path.normalize(app.getPath('downloads')),
    path.normalize(app.getPath('music')),
    path.normalize(app.getPath('pictures')),
    path.normalize(app.getPath('videos')),
  ];
  let isAllowed = allowedRoots.some((root) => {
    const r = root.replace(/[/\\]+$/, '');
    const p = normalizedPath;
    if (process.platform === 'win32') {
      const rl = r.toLowerCase();
      const pl = p.toLowerCase();
      return pl === rl || pl.startsWith(rl + path.sep) || pl.startsWith(rl + '/');
    }
    return p === r || p.startsWith(r + path.sep) || p.startsWith(r + '/');
  });
  if (!isAllowed && process.platform === 'win32' && /^[a-zA-Z]:[\\/]Users[\\/][^\\/]+/.test(normalizedPath)) {
    isAllowed = true;
  }
  return isAllowed;
}

/**
 * 获取项目存储根路径。
 * 若用户设置了 customProjectPath 则使用该路径，否则使用程序运行目录下的 projects。
 */
export function getProjectsBasePath(): string {
  const custom = (store.get('customProjectPath') as string) || '';
  if (custom && typeof custom === 'string' && custom.trim() !== '') {
    return path.normalize(custom.trim());
  }
  return path.join(process.cwd(), 'projects');
}

/**
 * 根据项目名生成可用的文件夹名（去除非法字符）
 */
export function sanitizeProjectName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * 获取项目文件夹路径。路径固定按项目 ID（projects/[projectId]），与显示名称无关，修改卡片名称不会动磁盘路径。
 * @param projectId 项目ID
 * @returns 项目文件夹路径，若项目不存在则返回 null
 */
export function getProjectFolderPathSync(projectId: string): string | null {
  const projects = (store.get(PROJECTS_KEY) as ProjectRecord[]) || [];
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  const base = getProjectsBasePath();
  const dirName = sanitizeProjectName(projectId);
  return path.join(base, dirName);
}

export async function getProjectFolderPath(projectId: string): Promise<string | null> {
  return getProjectFolderPathSync(projectId);
}

/**
 * 获取项目原始文件夹路径（与 getProjectFolderPath 相同，均为 projects/[projectId]）
 */
export function getProjectOriginalFolderPath(projectId: string): string | null {
  return getProjectFolderPathSync(projectId);
}

/**
 * 迁移：将按“项目名”命名的旧文件夹重命名为按“项目 ID”的路径（与 getProjectFolderPathSync 一致）。
 * 修改卡片名称仅改显示，路径固定用 ID，因此需把已有的“按名称”目录迁到“按 ID”。
 * 在应用启动时调用（在 migrateProjectFolders 之后）。
 */
export function migrateNameBasedFoldersToIdBased(): void {
  try {
    const baseDir = getProjectsBasePath();
    if (!fs.existsSync(baseDir)) return;

    const projects = (store.get(PROJECTS_KEY) as ProjectRecord[]) || [];
    for (const project of projects) {
      const nameBasedDir = path.join(baseDir, sanitizeProjectName(project.name));
      const idBasedDir = path.join(baseDir, sanitizeProjectName(project.id));
      if (nameBasedDir === idBasedDir) continue;
      if (!fs.existsSync(nameBasedDir)) continue;
      if (fs.existsSync(idBasedDir)) continue;
      try {
        fs.renameSync(nameBasedDir, idBasedDir);
        console.log(`[迁移] 项目文件夹已从名称改为 ID: ${project.name} -> ${project.id}`);
      } catch (error) {
        console.error(`[迁移] 重命名失败: ${nameBasedDir} -> ${idBasedDir}`, error);
      }
    }
  } catch (error) {
    console.error('[迁移] migrateNameBasedFoldersToIdBased 出错:', error);
  }
}

/**
 * 迁移旧的项目ID文件夹到项目名文件夹（仅用于兼容极旧的 project-xxx 目录名，与当前“按 ID”路径一致则跳过）
 * 在应用启动时调用
 */
export function migrateProjectFolders(): void {
  try {
    const baseDir = getProjectsBasePath();
    if (!fs.existsSync(baseDir)) return;

    const projects = (store.get(PROJECTS_KEY) as ProjectRecord[]) || [];
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      if (!folderName.startsWith('project-')) continue;

      const project = projects.find((p) => p.id === folderName);
      if (!project) continue;

      const idBasedPath = path.join(baseDir, sanitizeProjectName(project.id));
      const oldFolderPath = path.join(baseDir, folderName);
      if (idBasedPath === oldFolderPath) continue;
      if (fs.existsSync(idBasedPath)) continue;
      if (!fs.existsSync(oldFolderPath)) continue;

      try {
        fs.renameSync(oldFolderPath, idBasedPath);
        console.log(`[迁移] 已将项目文件夹统一为 ID 路径: ${folderName} -> ${project.id}`);
      } catch (error) {
        console.error(`[迁移] 重命名文件夹失败: ${folderName} -> ${idBasedPath}`, error);
      }
    }
  } catch (error) {
    console.error('[迁移] 迁移项目文件夹时出错:', error);
  }
}

/**
 * 清理孤立项目：移除 store 中那些在磁盘上已无对应文件夹的项目记录。
 * 典型场景：卸载后重装，安装目录被删但 userData 中 config 仍保留旧项目列表。
 * 同时按 id 去重，避免重复条目。
 */
export function removeOrphanedProjects(): void {
  try {
    const projects = (store.get(PROJECTS_KEY) as ProjectRecord[]) || [];
    if (projects.length === 0) return;

    const seen = new Set<string>();
    const valid: ProjectRecord[] = [];
    for (const p of projects) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const dir = getProjectFolderPathSync(p.id);
      if (dir && fs.existsSync(dir)) {
        valid.push(p);
      } else {
        console.log('[清理] 移除孤立项目（磁盘无数据）:', p.name, p.id);
      }
    }
    if (valid.length !== projects.length) {
      store.set(PROJECTS_KEY, valid);
      console.log('[清理] 已移除', projects.length - valid.length, '个孤立项目');
    }
  } catch (error) {
    console.error('[清理] removeOrphanedProjects 出错:', error);
  }
}

/**
 * 从 C 盘 AppData/userData/projects 迁移到安装目录（或自定义路径）下的 projects。
 * 仅执行一次（通过 store 标记），将旧目录下按项目名/项目ID命名的文件夹复制到新根目录。
 */
export function migrateProjectsFromUserDataToAppDir(): void {
  if (store.get(MIGRATED_FROM_USERDATA_KEY)) {
    return;
  }
  try {
    const userDataPath = app.getPath('userData');
    const oldProjectsDir = path.join(userDataPath, 'projects');
    const newBase = getProjectsBasePath();
    if (path.normalize(oldProjectsDir) === path.normalize(newBase)) {
      return;
    }
    if (!fs.existsSync(oldProjectsDir)) {
      store.set(MIGRATED_FROM_USERDATA_KEY, true);
      return;
    }
    const entries = fs.readdirSync(oldProjectsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 0) {
      store.set(MIGRATED_FROM_USERDATA_KEY, true);
      return;
    }
    if (!fs.existsSync(newBase)) {
      fs.mkdirSync(newBase, { recursive: true });
    }
    for (const d of dirs) {
      const oldPath = path.join(oldProjectsDir, d.name);
      const newPath = path.join(newBase, d.name);
      if (fs.existsSync(newPath)) {
        console.log(`[迁移] 已存在，跳过: ${d.name}`);
        continue;
      }
      try {
        copyDirRecursive(oldPath, newPath);
        console.log(`[迁移] 已复制: ${d.name} -> ${newPath}`);
      } catch (err) {
        console.error(`[迁移] 复制失败: ${d.name}`, err);
      }
    }
    store.set(MIGRATED_FROM_USERDATA_KEY, true);
    console.log('[迁移] 已从 userData/projects 迁移到:', newBase);
  } catch (error) {
    console.error('[迁移] migrateProjectsFromUserDataToAppDir 出错:', error);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
