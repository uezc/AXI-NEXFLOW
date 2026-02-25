import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { store } from '../services/store.js';
import crypto from 'crypto';

/**
 * 项目路径映射工具
 * 通过创建软链接（junction）将中文项目名映射为英文路径，解决 local-resource 协议编码问题
 */

/**
 * 获取项目的英文映射路径（基于项目ID生成）
 * @param projectId 项目ID
 * @returns 英文映射路径，例如：projects/_map_abc123def456
 */
function getProjectMappedPath(projectId: string): string {
  const userDataPath = app.getPath('userData');
  // 使用项目ID的 SHA256 哈希值生成稳定的英文文件夹名
  const hash = crypto.createHash('sha256').update(projectId).digest('hex').substring(0, 12);
  return path.join(userDataPath, 'projects', `_map_${hash}`);
}

/**
 * 获取项目的原始路径（ID 化：使用项目 ID 作为文件夹名，避免中文路径 404）
 * UI 仍显示项目名，但 assets 存储路径指向 projects/<projectId>
 * @param projectId 项目ID
 * @returns 原始路径 projects/<projectId>，如果项目不存在则返回 null
 */
function getProjectOriginalPath(projectId: string): string | null {
  const projects = (store.get('projects') as Array<{
    id: string;
    name: string;
    date: string;
    createdAt: number;
    lastModified: number;
  }>) || [];
  
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    return null;
  }
  
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'projects', projectId);
}

/**
 * 获取旧版项目路径（使用中文项目名），用于兼容已存在的中文路径
 */
function getLegacyProjectPath(projectId: string): string | null {
  const projects = (store.get('projects') as Array<{
    id: string;
    name: string;
    date: string;
    createdAt: number;
    lastModified: number;
  }>) || [];
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  const sanitizedProjectName = project.name.replace(/[<>:"/\\|?*]/g, '_');
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'projects', sanitizedProjectName);
}

/**
 * 创建或更新项目的软链接映射
 * @param projectId 项目ID
 * @returns 成功返回映射路径，失败返回 null
 */
export async function ensureProjectMapping(projectId: string): Promise<string | null> {
  try {
    const originalPath = getProjectOriginalPath(projectId);
    if (!originalPath) {
      console.warn(`[路径映射] 项目不存在: ${projectId}`);
      return null;
    }
    
    const mappedPath = getProjectMappedPath(projectId);
    
    // 确保原始项目文件夹存在（ID 化路径）
    if (!fs.existsSync(originalPath)) {
      const legacyPath = getLegacyProjectPath(projectId);
      if (legacyPath && fs.existsSync(legacyPath)) {
        // 已存在使用中文路径的旧项目：创建目录联接，指向该路径
        try {
          if (process.platform === 'win32') {
            fs.symlinkSync(legacyPath, originalPath, 'junction');
            console.log(`[路径映射] 旧项目中文路径，创建 junction: ${originalPath} -> ${legacyPath}`);
          } else {
            fs.symlinkSync(legacyPath, originalPath, 'dir');
            console.log(`[路径映射] 旧项目中文路径，创建 symlink: ${originalPath} -> ${legacyPath}`);
          }
        } catch (e) {
          console.warn(`[路径映射] 创建指向旧项目路径的联接失败，将创建新目录:`, e);
          fs.mkdirSync(originalPath, { recursive: true });
        }
      } else {
        fs.mkdirSync(originalPath, { recursive: true });
        console.log(`[路径映射] 创建原始项目文件夹（ID 化）: ${originalPath}`);
      }
    }
    
    // 如果映射路径已存在，检查是否是有效的软链接
      if (fs.existsSync(mappedPath)) {
        try {
          const stats = fs.lstatSync(mappedPath);
          if (stats.isSymbolicLink()) {
            // 检查软链接是否指向正确的原始路径
            const currentTarget = fs.readlinkSync(mappedPath);
            // 规范化路径进行比较：统一斜杠、去除末尾分隔符（Windows junction 可能返回带尾反斜杠的路径）
            const trimTrailingSep = (p: string) => path.normalize(p).replace(/[\/\\]+$/, '');
            const normalizedCurrent = trimTrailingSep(currentTarget);
            const normalizedOriginal = trimTrailingSep(originalPath);
            
            if (normalizedCurrent.toLowerCase() === normalizedOriginal.toLowerCase()) {
              // 软链接已存在且指向正确，直接返回
              console.log(`[路径映射] 软链接已存在且正确: ${mappedPath} -> ${originalPath}`);
              return mappedPath;
            } else {
              // 软链接指向错误，删除并重新创建（项目名可能已修改）
              console.log(`[路径映射] 软链接指向错误（项目名可能已修改），删除并重新创建: ${mappedPath}`);
              console.log(`[路径映射] 当前指向: ${currentTarget}, 应该指向: ${originalPath}`);
              fs.unlinkSync(mappedPath);
            }
          } else {
            // 映射路径存在但不是软链接，可能是普通文件夹（不应该发生）
            console.warn(`[路径映射] 映射路径存在但不是软链接，删除: ${mappedPath}`);
            fs.rmSync(mappedPath, { recursive: true, force: true });
          }
        } catch (error) {
          console.error(`[路径映射] 检查映射路径失败: ${mappedPath}`, error);
          // 尝试删除并重新创建
          try {
            if (fs.existsSync(mappedPath)) {
              fs.rmSync(mappedPath, { recursive: true, force: true });
            }
          } catch (e) {
            console.error(`[路径映射] 删除映射路径失败: ${mappedPath}`, e);
          }
        }
      }
    
    // 创建软链接（Windows 使用 junction，Unix 使用 symlink）
    if (process.platform === 'win32') {
      // Windows 使用 junction（目录软链接）
      // 注意：junction 只能用于目录，且目标路径必须是绝对路径
      fs.symlinkSync(originalPath, mappedPath, 'junction');
      console.log(`[路径映射] 创建 Windows junction: ${mappedPath} -> ${originalPath}`);
    } else {
      // Unix/Linux/Mac 使用 symlink
      fs.symlinkSync(originalPath, mappedPath, 'dir');
      console.log(`[路径映射] 创建 Unix symlink: ${mappedPath} -> ${originalPath}`);
    }
    
    return mappedPath;
  } catch (error) {
    console.error(`[路径映射] 创建项目映射失败: ${projectId}`, error);
    return null;
  }
}

/**
 * 删除项目的软链接映射
 * @param projectId 项目ID
 */
export async function removeProjectMapping(projectId: string): Promise<void> {
  try {
    const mappedPath = getProjectMappedPath(projectId);
    
    if (fs.existsSync(mappedPath)) {
      const stats = fs.lstatSync(mappedPath);
      if (stats.isSymbolicLink()) {
        fs.unlinkSync(mappedPath);
        console.log(`[路径映射] 删除软链接: ${mappedPath}`);
      } else {
        // 如果不是软链接，可能是普通文件夹，删除它
        fs.rmSync(mappedPath, { recursive: true, force: true });
        console.log(`[路径映射] 删除映射文件夹: ${mappedPath}`);
      }
    }
  } catch (error) {
    console.error(`[路径映射] 删除项目映射失败: ${projectId}`, error);
  }
}

/**
 * 获取项目的映射路径（用于 local-resource 协议，返回英文路径）
 * 如果映射不存在，会自动创建
 * @param projectId 项目ID
 * @returns 映射路径（英文），如果项目不存在则返回 null
 */
export async function getProjectMappedFolderPath(projectId: string): Promise<string | null> {
  const mappedPath = await ensureProjectMapping(projectId);
  return mappedPath;
}

/**
 * 获取项目的原始路径（用于导出等，现为 ID 化路径 projects/<projectId>）
 * @param projectId 项目ID
 * @returns 原始路径，如果项目不存在则返回 null
 */
export function getProjectOriginalFolderPathSync(projectId: string): string | null {
  return getProjectOriginalPath(projectId);
}

/**
 * 清理所有无效的软链接映射
 * 在应用启动时调用，清理指向不存在项目的软链接
 */
export async function cleanupInvalidMappings(): Promise<void> {
  try {
    const userDataPath = app.getPath('userData');
    const projectsDir = path.join(userDataPath, 'projects');
    
    if (!fs.existsSync(projectsDir)) {
      return;
    }
    
    const projects = (store.get('projects') as Array<{
      id: string;
      name: string;
      date: string;
      createdAt: number;
      lastModified: number;
    }>) || [];
    
    const validProjectIds = new Set(projects.map(p => p.id));
    
    // 读取 projects 目录下的所有文件夹
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      
      const folderName = entry.name;
      
      // 检查是否是映射文件夹（以 _map_ 开头）
      if (folderName.startsWith('_map_')) {
        const mappedPath = path.join(projectsDir, folderName);
        
        try {
          const stats = fs.lstatSync(mappedPath);
          if (stats.isSymbolicLink()) {
            // 检查软链接指向的项目是否仍然存在（目标为 projects/<projectId> 或旧版 projects/<name>）
            const targetPath = fs.readlinkSync(mappedPath);
            const targetName = path.basename(targetPath);
            const targetIsProjectId = validProjectIds.has(targetName);
            const targetIsLegacyName = projects.some((p) => p.name.replace(/[<>:"/\\|?*]/g, '_') === targetName);
            
            if (!targetIsProjectId && !targetIsLegacyName) {
              // 项目不存在或已被删除，删除软链接
              console.log(`[路径映射] 清理无效软链接: ${mappedPath}`);
              fs.unlinkSync(mappedPath);
            }
          }
        } catch (error) {
          console.error(`[路径映射] 检查软链接失败: ${mappedPath}`, error);
        }
      }
    }
  } catch (error) {
    console.error('[路径映射] 清理无效映射失败:', error);
  }
}
