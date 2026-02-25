/**
 * 资源自动下载工具
 * 用于将远程资源下载到本地 assets 文件夹，并保存元数据（包括提示词）
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import crypto from 'crypto';

/**
 * 资源元数据接口
 */
export interface ResourceMetadata {
  resourceType: 'image' | 'video' | 'text' | 'audio' | 'character-avatar';
  prompt?: string; // 提示词
  text?: string; // 文本内容（用于 text 类型）
  nodeId?: string; // 节点 ID
  nodeTitle?: string; // 节点标题
  model?: string; // 使用的模型
  remoteUrl?: string; // 原始远程 URL
  localPath: string; // 本地文件路径
  createdAt: number; // 创建时间戳
  projectId?: string; // 项目 ID
  [key: string]: any; // 允许其他扩展字段
}

/**
 * 自动下载资源到本地 assets 文件夹，并保存元数据
 * @param remoteUrl 远程 URL（对于 text 类型可以为空）
 * @param resourceType 'image' | 'video' | 'text' | 'audio'
 * @param metadata 资源元数据（包括提示词等）
 * @returns 本地文件路径，如果下载失败则返回 null
 */
export async function autoDownloadResource(
  remoteUrl: string | null,
  resourceType: 'image' | 'video' | 'text' | 'audio',
  metadata: Partial<ResourceMetadata> = {}
): Promise<string | null> {
  try {
    // 确定保存目录：如果有 projectId，保存到项目文件夹的 assets 子文件夹，否则保存到全局 assets 或 avatars
    const userDataPath = app.getPath('userData');
    let saveDir: string;
    
    // 如果是角色头像（通过 nodeId 判断，或者 metadata 中有特殊标记）
    const isCharacterAvatar = metadata.nodeId?.startsWith('character-') || metadata.resourceType === 'character-avatar';
    
    if (isCharacterAvatar) {
      // 角色头像保存到全局 avatars 文件夹
      saveDir = path.join(userDataPath, 'avatars');
    } else if (metadata.projectId) {
      // 使用统一的项目文件夹路径获取函数
      const { getProjectFolderPath } = await import('./projectFolderHelper.js');
      const projectFolderPath = await getProjectFolderPath(metadata.projectId);
      if (projectFolderPath) {
        // 保存到项目文件夹的 assets 子文件夹
        saveDir = path.join(projectFolderPath, 'assets');
      } else {
        // 项目不存在，保存到全局 assets 文件夹
        console.warn(`[自动下载] 项目不存在: ${metadata.projectId}，保存到全局 assets 文件夹`);
        saveDir = path.join(userDataPath, 'assets');
      }
    } else {
      // 没有项目ID，保存到全局 assets 文件夹
      saveDir = path.join(userDataPath, 'assets');
    }
    
    // 确保目录存在
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    // 生成唯一文件名
    let fileName: string;
    let filePath: string;

    if (resourceType === 'text') {
      // 文本类型：使用时间戳和内容哈希
      const textContent = metadata.text || '';
      const textHash = crypto.createHash('md5').update(textContent).digest('hex').substring(0, 8);
      const timestamp = Date.now();
      fileName = `text-${timestamp}-${textHash}.txt`;
      filePath = path.join(saveDir, fileName);

      // 保存文本内容
      fs.writeFileSync(filePath, textContent, 'utf-8');
      // 确保路径正确编码（使用 UTF-8）
      const normalizedPath = filePath.replace(/\\/g, '/');
      console.log(`[自动保存] 文本已保存: ${normalizedPath}`);
    } else {
      // 图片和视频类型：使用 URL 的 MD5 作为文件名
      if (!remoteUrl) {
        console.error(`[自动下载] ${resourceType} 类型需要 remoteUrl`);
        return null;
      }

      const urlHash = crypto.createHash('md5').update(remoteUrl).digest('hex');
      let ext: string;
      if (resourceType === 'image') {
        ext = remoteUrl.match(/\.(png|jpg|jpeg|webp)/i)?.[0] || '.png';
      } else if (resourceType === 'video') {
        ext = remoteUrl.match(/\.(mp4|webm|mov)/i)?.[0] || '.mp4';
      } else if (resourceType === 'audio') {
        ext = remoteUrl.match(/\.(mp3|wav|ogg|m4a)/i)?.[0] || '.mp3';
      } else {
        ext = '.bin';
      }
      fileName = `${urlHash}${ext}`;
      filePath = path.join(saveDir, fileName);

      // 如果文件已存在，直接返回路径（避免重复下载）
      if (fs.existsSync(filePath)) {
        console.log(`[自动下载] 文件已存在，跳过下载: ${filePath}`);
        // 即使文件已存在，也更新元数据（可能提示词等信息有更新）
        await saveResourceMetadata(filePath, resourceType, metadata, remoteUrl);
        return filePath;
      }

      // 下载文件
      const response = await axios.get(remoteUrl, {
        responseType: 'arraybuffer',
        timeout: resourceType === 'video' ? 300000 : resourceType === 'audio' ? 60000 : 30000,
        proxy: false,
      });

      // 保存到本地
      fs.writeFileSync(filePath, Buffer.from(response.data));
      // 确保路径正确编码（使用 UTF-8）
      const normalizedPath = filePath.replace(/\\/g, '/');
      console.log(`[自动下载] 资源已保存: ${normalizedPath}`);
    }

    // 保存元数据
    await saveResourceMetadata(filePath, resourceType, metadata, remoteUrl || undefined);

    return filePath;
  } catch (error) {
    console.error(`[自动下载] 保存失败: ${resourceType}`, error);
    return null;
  }
}

/**
 * 保存资源元数据到项目的 metadata.json 文件（统一管理，不再单独保存 .meta.json）
 */
async function saveResourceMetadata(
  filePath: string,
  resourceType: 'image' | 'video' | 'text' | 'audio',
  metadata: Partial<ResourceMetadata>,
  remoteUrl?: string
): Promise<void> {
  try {
    // 如果项目ID不存在，不保存元数据（全局 assets 不需要元数据）
    if (!metadata.projectId) {
      return;
    }

    const { getProjectFolderPath } = await import('./projectFolderHelper.js');
    const projectFolderPath = await getProjectFolderPath(metadata.projectId);
    if (!projectFolderPath) {
      console.warn(`[元数据] 项目不存在: ${metadata.projectId}，跳过元数据保存`);
      return;
    }

    // 元数据保存到项目根目录的 metadata.json 文件
    const metadataFilePath = path.join(projectFolderPath, 'metadata.json');
    
    // 读取现有的元数据（如果存在）
    let allMetadata: Record<string, ResourceMetadata> = {};
    if (fs.existsSync(metadataFilePath)) {
      try {
        const existingData = fs.readFileSync(metadataFilePath, 'utf-8');
        allMetadata = JSON.parse(existingData);
      } catch (error) {
        console.warn(`[元数据] 读取现有元数据失败，将创建新文件:`, error);
        allMetadata = {};
      }
    }

    // 构建完整的元数据对象
    const fullMetadata: ResourceMetadata = {
      resourceType,
      localPath: filePath,
      remoteUrl: remoteUrl || undefined,
      createdAt: Date.now(),
      ...metadata,
    };

    // 使用文件路径作为 key（相对于项目文件夹的路径）
    const relativePath = path.relative(projectFolderPath, filePath).replace(/\\/g, '/');
    allMetadata[relativePath] = fullMetadata;

    // 保存到 metadata.json
    fs.writeFileSync(metadataFilePath, JSON.stringify(allMetadata, null, 2), 'utf-8');
    console.log(`[元数据] 已保存到统一元数据文件: ${metadataFilePath}`);
  } catch (error) {
    console.error(`[元数据] 保存失败:`, error);
    // 元数据保存失败不影响主流程
  }
}
