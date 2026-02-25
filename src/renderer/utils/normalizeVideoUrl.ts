/**
 * 视频 URL 标准化工具函数
 * 
 * 用于清理和标准化视频 URL，防止脏 URL 导致播放失败
 * 将 file:// 格式转换为 local-resource:// 格式
 * 确保 Windows 路径格式正确（C:/Users 而不是 c/Users）
 */
export function normalizeVideoUrl(url: string): string {
  if (!url) return url;

  // 强制去掉多余空格
  let cleanUrl = url.trim();

  // 将 file:// 格式转换为 local-resource:// 格式
  if (cleanUrl.startsWith('file://')) {
    // 移除 file:// 前缀
    let filePath = cleanUrl.replace(/^file:\/\/\/?/, '');
    // 处理 Windows 路径（file:///C:/ 格式）
    if (filePath.match(/^[a-zA-Z]:/)) {
      // 已经是正确的 Windows 路径格式
    } else if (filePath.match(/^[a-zA-Z]\//)) {
      // 处理 file:///c/Users 格式，转换为 C:/Users
      filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    }
    // 转换为 local-resource:// 格式，确保路径以 / 开头
    if (!filePath.startsWith('/') && filePath.match(/^[a-zA-Z]:/)) {
      filePath = '/' + filePath;
    }
    cleanUrl = `local-resource://${filePath.replace(/\\/g, '/')}`;
  }
  
  // 处理 local-resource:// 格式：强制反斜杠转正斜杠，Windows 盘符首字母大写
  if (cleanUrl.startsWith('local-resource://')) {
    let filePath = cleanUrl.replace(/^local-resource:\/\//, '');
    // 强制将所有反斜杠 \ 转换为正斜杠 /
    filePath = filePath.replace(/\\/g, '/');
    // 如果路径像 "c/Users"，修正为 "C:/Users"（盘符首字母大写并紧跟冒号）
    if (filePath.match(/^[a-zA-Z]\//)) {
      filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    }
    // 如果路径以 / 开头且是 Windows 路径（如 /C:/Users），移除开头的 /
    if (filePath.startsWith('/') && filePath.match(/^\/[a-zA-Z]:/)) {
      filePath = filePath.substring(1);
    }
    cleanUrl = `local-resource://${filePath}`;
  }

  // 防止被当成下载文件
  if (!cleanUrl.includes("response-content-type")) {
    return cleanUrl;
  }

  return cleanUrl;
}
