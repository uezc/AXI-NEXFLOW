/**
 * 路径映射工具（渲染进程）
 * 自动将中文项目路径替换为英文映射路径，解决 local-resource 协议编码问题
 */

/**
 * 将包含中文项目路径的 URL 转换为映射路径
 * @param url 原始 URL（可能包含中文路径）
 * @param projectId 项目ID（用于获取映射路径）
 * @returns 转换后的 URL（使用英文映射路径）
 */
export async function mapProjectPath(url: string, projectId?: string): Promise<string> {
  if (!url || !projectId || !window.electronAPI) {
    return url;
  }
  
  // 只处理 local-resource:// 协议的路径
  if (!url.startsWith('local-resource://')) {
    return url;
  }
  
  try {
    // 获取项目的原始路径和映射路径
    const [originalPath, mappedPath] = await Promise.all([
      window.electronAPI.getProjectOriginalPath(projectId),
      window.electronAPI.getProjectMappedPath(projectId),
    ]);
    
    if (!originalPath || !mappedPath) {
      return url;
    }
    
    // 将路径标准化（统一使用正斜杠）
    const normalizedOriginal = originalPath.replace(/\\/g, '/');
    const normalizedMapped = mappedPath.replace(/\\/g, '/');
    
    // 检查 URL 中是否包含原始路径
    // 提取 URL 中的路径部分（移除可能的查询参数）
    let urlPath = url.replace('local-resource://', '');
    if (urlPath.includes('?')) {
      urlPath = urlPath.split('?')[0];
    }
    
    // 检测中文路径：如果 URL 路径包含原始路径（中文项目名），替换为映射路径
    // 使用更宽松的匹配：检查路径中是否包含项目名（即使部分匹配）
    const originalPathParts = normalizedOriginal.split('/');
    const projectNamePart = originalPathParts[originalPathParts.length - 1]; // 获取项目名部分
    
    // 如果 URL 路径包含原始路径或项目名，替换为映射路径
    if (urlPath.includes(normalizedOriginal) || 
        urlPath.includes(originalPath.replace(/\\/g, '/')) ||
        (projectNamePart && urlPath.includes(projectNamePart))) {
      // 替换原始路径为映射路径
      let mappedUrl = url;
      if (urlPath.includes(normalizedOriginal)) {
        mappedUrl = url.replace(normalizedOriginal, normalizedMapped);
      } else if (urlPath.includes(originalPath.replace(/\\/g, '/'))) {
        mappedUrl = url.replace(originalPath.replace(/\\/g, '/'), normalizedMapped);
      } else if (projectNamePart && urlPath.includes(projectNamePart)) {
        // 部分匹配：替换项目名部分
        mappedUrl = url.replace(projectNamePart, path.basename(normalizedMapped));
      }
      console.log(`[路径映射] 检测到中文路径，转换: ${url} -> ${mappedUrl}`);
      return mappedUrl;
    }
    
    // 如果 URL 路径已经包含映射路径，直接返回
    if (urlPath.includes(normalizedMapped) || urlPath.includes(mappedPath.replace(/\\/g, '/'))) {
      return url;
    }
    
    // 如果路径中包含中文字符，尝试自动检测并替换
    if (/[\u4e00-\u9fa5]/.test(urlPath)) {
      console.log(`[路径映射] 检测到中文字符，尝试自动映射: ${url}`);
      // 尝试提取项目路径部分并替换
      const pathMatch = urlPath.match(/projects\/([^\/]+)/);
      if (pathMatch && pathMatch[1]) {
        const detectedProjectName = pathMatch[1];
        // 如果检测到的项目名包含中文，尝试替换为映射路径
        if (/[\u4e00-\u9fa5]/.test(detectedProjectName)) {
          const mappedProjectName = normalizedMapped.split('/').pop() || normalizedMapped;
          const mappedUrl = url.replace(`projects/${detectedProjectName}`, `projects/${mappedProjectName}`);
          console.log(`[路径映射] 自动检测并替换中文项目名: ${url} -> ${mappedUrl}`);
          return mappedUrl;
        }
      }
    }
    
    return url;
  } catch (error) {
    console.error('[路径映射] 转换路径失败:', error);
    return url;
  }
}

/**
 * 批量转换路径数组
 * @param urls URL 数组
 * @param projectId 项目ID
 * @returns 转换后的 URL 数组
 */
export async function mapProjectPaths(urls: string[], projectId?: string): Promise<string[]> {
  if (!urls || urls.length === 0 || !projectId) {
    return urls;
  }
  
  return Promise.all(urls.map(url => mapProjectPath(url, projectId)));
}

/**
 * 从 URL 中提取项目ID（如果 URL 包含项目路径）
 * 这是一个辅助函数，用于自动检测项目ID
 */
export function extractProjectIdFromUrl(url: string, projects: Array<{ id: string; name: string }>): string | null {
  if (!url || !url.startsWith('local-resource://') || !projects || projects.length === 0) {
    return null;
  }
  
  try {
    const urlPath = url.replace('local-resource://', '');
    
    // 尝试匹配项目名
    for (const project of projects) {
      const sanitizedProjectName = project.name.replace(/[<>:"/\\|?*]/g, '_');
      if (urlPath.includes(sanitizedProjectName)) {
        return project.id;
      }
    }
  } catch (error) {
    console.error('[路径映射] 提取项目ID失败:', error);
  }
  
  return null;
}
