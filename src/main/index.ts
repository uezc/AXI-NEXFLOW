// 必须在所有其他导入之前加载环境变量
// 使用 import 'dotenv/config' 会自动加载 .env 文件
import 'dotenv/config';

import { app, BrowserWindow, ipcMain, dialog, shell, protocol, clipboard } from 'electron';

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import http from 'http';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import express from 'express';
import AdmZip from 'adm-zip';
import { store } from './services/store.js';
import { getBLTCYBalance, getRHBalance } from './services/balance.js';
import { activateLicense, checkLicenseStatus, generateActivationCode } from './services/licenseManager.js';
import { runMatting } from './services/matting.js';
import { runWatermarkRemoval } from './services/watermarkRemoval.js';
import { aiCore } from './ai/AICore.js';
import { registerProvider } from './ai/Registry.js';
import { ChatProvider } from './ai/providers/ChatProvider.js';
import { ImageProvider } from './ai/providers/ImageProvider.js';
import { VideoProvider } from './ai/providers/VideoProvider.js';
import { AudioProvider } from './ai/providers/AudioProvider.js';
import { migrateProjectFolders, migrateNameBasedFoldersToIdBased, migrateProjectsFromUserDataToAppDir, removeOrphanedProjects, getProjectFolderPath, getProjectOriginalFolderPath, getProjectsBasePath, getProjectFolderPathSync, sanitizeProjectName, isLocalResourcePathAllowed } from './utils/projectFolderHelper.js';
import { getAverageDuration, recordTaskHistory, TaskType } from './services/taskHistory.js';

// 【解决黑屏】保留 disableHardwareAcceleration；允许软件光栅化以便在无 GPU 时仍能出图
app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-software-rasterizer'); // 注释后允许软件光栅化，解决黑屏
app.disableHardwareAcceleration();
//app.commandLine.appendSwitch('use-gl', 'angle');
//app.commandLine.appendSwitch('use-angle', 'd3d11');
// app.commandLine.appendSwitch('in-process-gpu'); // 已注释，避免黑屏/崩溃
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let statsServer: http.Server | null = null;
/** 仅在有 did-finish-load 后为 true，避免向未就绪的渲染进程发送消息触发 WidgetHost 报错 */
let rendererReady = false;

function createWindow() {
  rendererReady = false;
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  const preloadDir = path.join(__dirname, '../preload');
  const preloadPathJs = path.join(preloadDir, 'index.js');
  const preloadPathMjs = path.join(preloadDir, 'index.mjs');
  const preloadPath = fs.existsSync(preloadPathJs)
    ? preloadPathJs
    : fs.existsSync(preloadPathMjs)
      ? preloadPathMjs
      : preloadPathJs;

  const buildDir = app.isPackaged ? path.join(app.getAppPath(), 'build') : path.join(process.cwd(), 'build');
  const iconPath =
    (['icon.ico', 'icon.png', 'icon.jpg'] as const)
      .map((name) => path.join(buildDir, name))
      .find((p) => fs.existsSync(p)) ?? path.join(buildDir, 'icon.ico');
  const iconOpt = fs.existsSync(iconPath) ? { icon: iconPath } : {};

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    transparent: false,
    backgroundColor: '#000000',
    ...iconOpt,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      autoplayPolicy: 'no-user-gesture-required',
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      // 隐藏原生菜单栏（File/Edit/View...）
      mainWindow.setMenuBarVisibility(false);
      mainWindow.removeMenu();
      // 启动即全屏（双保险，避免个别平台忽略初始 fullscreen 配置）
      if (!mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(true);
      }
      mainWindow.show();
    }
  });

  // 设置 Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' http://localhost:5173 https: http:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "media-src 'self' https://midjourney-plus.oss-us-west-1.aliyuncs.com https: http: file: data: blob: local-resource:; " +
          "img-src * 'self' data: blob: file: https: http: local-resource:; " +
          "connect-src 'self' https: http: local-resource:;"
        ],
      },
    });
  });

  // 唯一 did-finish-load：统一设置 rendererReady，开发环境可在此打开 DevTools（按需取消注释）
  mainWindow.webContents.once('did-finish-load', () => {
    rendererReady = true;
    if (isDev && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      // mainWindow.webContents.openDevTools();
    }
  });
  mainWindow.on('closed', () => {
    rendererReady = false;
    aiCore.setMainWindow(null);
    mainWindow = null;
  });
  if (isDev) {
    loadViteDevServer();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // 页面加载失败时打印详情，便于排查白屏/崩溃
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[主进程] did-fail-load:', { errorCode, errorDescription, validatedURL });
  });
  // 渲染进程崩溃时置位并弹窗，提供重新加载选项
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererReady = false;
    const msg = `reason: ${details.reason}\nexitCode: ${details.exitCode}\n\n可能原因：3D 视角或大量图片导致显存/内存压力，建议减少画布上的图片节点或关闭部分 3D 预览。`;
    console.error('[主进程] 渲染进程已退出:', msg);
    dialog.showMessageBox(mainWindow!, {
      type: 'error',
      title: '渲染进程崩溃',
      message: msg,
      buttons: ['重新加载', '关闭'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0 && mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents?.reload();
        } catch (_e) {
          // 崩溃后 webContents 可能不可用，忽略
        }
      }
    }).catch(() => {});
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[主进程] 渲染进程未响应');
  });
  mainWindow.webContents.on('responsive', () => {
    console.warn('[主进程] 渲染进程恢复响应');
  });

  // 设置 AICore 的主窗口引用
  aiCore.setMainWindow(mainWindow);
}

function checkViteServerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:5173', { timeout: 1000 }, (res) => {
      resolve(true);
      res.resume();
    });
    req.on('error', () => { resolve(false); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function loadViteDevServer(retryCount = 0) {
  if (!mainWindow) return;
  const viteUrl = 'http://localhost:5173';
  const maxRetries = 60;
  if (retryCount >= maxRetries) {
    console.error('[主进程] 达到最大重试次数，停止尝试连接 Vite 服务器');
    const errorHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NEXFLOW V2 - 连接失败</title></head><body style="font-family:sans-serif;padding:2rem"><h1>无法连接到 Vite 服务器</h1><p>请确保已执行 npm run dev 并等待 Vite 就绪。</p></body></html>';
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
    return;
  }
  const isReady = await checkViteServerReady();
  if (isReady) {
    mainWindow.loadURL(viteUrl);
    console.log('✅ Vite 服务器已就绪，加载开发服务器');
  } else {
    setTimeout(() => { loadViteDevServer(retryCount + 1); }, 1000);
  }
}

// 在应用启动前注册协议权限（必须在 app.whenReady 之前调用）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-resource',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

// 注册 local-resource 协议处理器
function registerLocalResourceProtocol() {
  protocol.handle('local-resource', (request) => {
    try {
      // 移除协议头，支持多个斜杠
      let filePath = request.url.replace(/^local-resource:\/\/+/, '');
      
      // 移除查询参数
      if (filePath.includes('?')) {
        filePath = filePath.split('?')[0];
      }
      
      // 移除前导斜杠，避免 /c/Users 或 //c/Users 无法被识别为 Windows 盘符
      filePath = filePath.replace(/^\/+/, '');
      
      // 修复 Windows 盘符：local-resource://e/Users/... 或 local-resource://c/Users/... 还原为 E:/Users、C:/Users
      if (filePath.match(/^[a-zA-Z]\//)) {
        filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
      }
      
      // 使用 decodeURIComponent 解码请求 URL，解决中文项目名（如「十大」）乱码
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        // 整体解码失败时按段解码（避免部分编码导致整体失败）
        const parts = filePath.split('/');
        filePath = parts.map((part, index) => {
          if (!part) return part;
          if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
          try {
            return decodeURIComponent(part);
          } catch {
            if (part.includes('%')) {
              try {
                return part.replace(/%([0-9A-F]{2})/gi, (_, hex) =>
                  String.fromCharCode(parseInt(hex, 16))
                );
              } catch {
                return part;
              }
            }
            return part;
          }
        }).join('/');
      }
      
      // 若解码后仍含 %，再按段解码一次
      if (filePath.includes('%')) {
        const parts = filePath.split('/');
        filePath = parts.map((part, index) => {
          if (!part || !part.includes('%')) return part;
          if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
          try {
            return decodeURIComponent(part);
          } catch {
            return part;
          }
        }).join('/');
      }
      
      // 不再对每次请求打印路径解码，避免终端被刷屏、启动后“没正常显示”；出错时会在下方 403/404 等日志中体现

      // 再次确保：以 / 开头的 Windows 路径去掉前导斜杠
      if (filePath.match(/^\/[a-zA-Z]:/)) {
        filePath = filePath.substring(1);
      }

      // 使用 path.normalize 处理最终路径（..、.、分隔符等）
      // 注意：path.normalize 在 Windows 上会将正斜杠转换为反斜杠，这对于文件系统是正确的
      // 此时路径应该已经完全解码，不应该再包含 %xx 编码
      let normalizedPath = path.normalize(filePath);
      
      // 如果规范化后仍然包含编码字符（说明之前的解码没有完全成功），再次尝试解码
      if (normalizedPath.includes('%')) {
        console.warn('[local-resource] 规范化后路径仍包含编码字符，尝试再次解码:', normalizedPath);
        // 将反斜杠临时转换为正斜杠，以便分割
        const tempPath = normalizedPath.replace(/\\/g, '/');
        const tempParts = tempPath.split('/');
        const redecodedParts = tempParts.map((part) => {
          if (!part || !part.includes('%')) return part;
          try {
            return decodeURIComponent(part);
          } catch {
            return part;
          }
        });
        const redecodedPath = redecodedParts.join('/');
        normalizedPath = path.normalize(redecodedPath);
        console.log('[local-resource] 重新解码后的路径:', normalizedPath);
      }
      
      // 如果是相对路径，转换为绝对路径（基于 userData）
      if (!path.isAbsolute(normalizedPath)) {
        const userDataPath = app.getPath('userData');
        normalizedPath = path.resolve(userDataPath, normalizedPath);
      }
      
      // 用 pathToFileURL + fileURLToPath 得到解码后的真实路径（pathname 含 %XX 会导致 404）
      try {
        const fileUrl = pathToFileURL(normalizedPath);
        normalizedPath = fileURLToPath(fileUrl);
      } catch (urlError) {
        console.warn('[local-resource] pathToFileURL/fileURLToPath 失败，使用原始路径:', urlError);
      }
      
      const userDataPath = app.getPath('userData');
      const normalizedUserData = path.normalize(userDataPath);
      const projectsBase = path.normalize(getProjectsBasePath());
      const defaultProjectsPath = path.normalize(path.join(process.cwd(), 'projects'));
      // 允许的根目录：userData、当前配置的项目根目录、应用运行目录下的 projects、用户常用目录
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
      // Windows：若未命中常用目录，允许任意盘符下的 Users\<用户名>\（与文件选择器可选范围一致）
      if (!isAllowed && process.platform === 'win32' && /^[a-zA-Z]:[\\/]Users[\\/][^\\/]+/.test(normalizedPath)) {
        isAllowed = true;
      }
      // Windows：允许任意盘符下的项目结构路径（如 E:\我的项目NEXFLOW\project-xxx\assets），避免项目在其它盘时 403 导致图片/视频不显示
      if (!isAllowed && process.platform === 'win32' && path.isAbsolute(normalizedPath)) {
        const normalizedSlash = normalizedPath.replace(/\\/g, '/');
        if (/\/project-[^/]+\//.test(normalizedSlash) || /\/assets\//.test(normalizedSlash)) {
          isAllowed = true;
        }
      }
      if (!isAllowed) {
        console.error('[local-resource] 访问路径超出允许范围:', {
          requested: normalizedPath,
          allowed: allowedRoots,
          original: filePath,
          url: request.url
        });
        return new Response('Forbidden', { status: 403 });
      }

      // 检查文件是否存在
      if (!fs.existsSync(normalizedPath)) {
        console.error('[local-resource] 文件不存在:', {
          path: normalizedPath,
          original: filePath,
          url: request.url,
          decoded: filePath,
          // 尝试列出目录内容（如果路径是目录）
          parentDir: path.dirname(normalizedPath),
          parentExists: fs.existsSync(path.dirname(normalizedPath)),
        });
        
        // 如果父目录存在，尝试列出其内容（用于调试）
        const parentDir = path.dirname(normalizedPath);
        if (fs.existsSync(parentDir)) {
          try {
            const files = fs.readdirSync(parentDir);
            console.log('[local-resource] 父目录内容:', {
              parentDir,
              files: files.slice(0, 10), // 只显示前10个文件
            });
          } catch (err) {
            console.warn('[local-resource] 无法读取父目录:', err);
          }
        }
        
        return new Response('Not Found', { status: 404 });
      }

      // 检查是否是文件
      const stats = fs.statSync(normalizedPath);
      if (!stats.isFile()) {
        console.error('[local-resource] 路径不是文件:', normalizedPath);
        return new Response('Bad Request', { status: 400 });
      }

      // 检查文件大小（空文件可能导致播放问题）
      if (stats.size === 0) {
        console.error('[local-resource] 文件为空:', {
          path: normalizedPath,
          size: stats.size
        });
        return new Response('File is empty', { status: 400 });
      }

      const fileSize = stats.size;
      const ext = path.extname(normalizedPath).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.mp4') mimeType = 'video/mp4';
      else if (ext === '.webm') mimeType = 'video/webm';
      else if (ext === '.mov') mimeType = 'video/quicktime';
      else if (ext === '.avi') mimeType = 'video/x-msvideo';
      else if (ext === '.mkv') mimeType = 'video/x-matroska';
      else if (ext === '.m4v') mimeType = 'video/x-m4v';
      else if (ext === '.mp3') mimeType = 'audio/mpeg';
      else if (ext === '.wav') mimeType = 'audio/wav';
      else if (ext === '.ogg') mimeType = 'audio/ogg';
      else if (ext === '.m4a') mimeType = 'audio/mp4';
      else if (ext === '.aac') mimeType = 'audio/aac';

      // 解析 Range 请求（视频/音频播放器会按需请求字节范围，不支持会导致只播放几秒或 PIPELINE_ERROR_DECODE）
      const rangeHeader = request.headers.get('Range') || request.headers.get('range');
      let start = 0;
      let end = fileSize - 1;
      let isRangeRequest = false;
      if (rangeHeader && rangeHeader.startsWith('bytes=')) {
        const part = rangeHeader.slice(6).trim();
        const dash = part.indexOf('-');
        if (dash !== -1) {
          const startStr = part.slice(0, dash).trim();
          const endStr = part.slice(dash + 1).trim();
          start = startStr ? Math.max(0, parseInt(startStr, 10)) : 0;
          end = endStr ? Math.min(fileSize - 1, parseInt(endStr, 10)) : fileSize - 1;
          if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end) {
            isRangeRequest = true;
          }
        }
      }

      let fileBuffer: Buffer;
      try {
        if (isRangeRequest) {
          const length = end - start + 1;
          const fd = fs.openSync(normalizedPath, 'r');
          try {
            fileBuffer = Buffer.alloc(length);
            fs.readSync(fd, fileBuffer, 0, length, start);
          } finally {
            fs.closeSync(fd);
          }
        } else {
          fileBuffer = fs.readFileSync(normalizedPath);
        }
      } catch (readError: any) {
        console.error('[local-resource] 读取文件失败:', {
          path: normalizedPath,
          error: readError.message,
          code: readError.code
        });
        return new Response('Read Error', { status: 500 });
      }

      const uint8Array = new Uint8Array(fileBuffer);
      const contentLength = fileBuffer.length;
      const headers: Record<string, string> = {
        'Content-Type': mimeType,
        'Content-Length': contentLength.toString(),
        'Accept-Ranges': 'bytes',
      };
      if (isRangeRequest) {
        headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
        return new Response(uint8Array, { status: 206, headers });
      }
      return new Response(uint8Array, { status: 200, headers });
    } catch (error: any) {
      console.error('[local-resource] 处理请求失败:', {
        error: error.message,
        stack: error.stack,
        url: request.url
      });
      return new Response('Internal Server Error', { status: 500 });
    }
  });
}

/**
 * 启动统计 API 服务器
 */
function startStatsServer(): void {
  const app = express();
  app.use(express.json());

  // CORS 支持
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // 获取平均时长接口
  app.get('/api/stats/avg-duration/:taskType', (req, res) => {
    try {
      const taskType = req.params.taskType as TaskType;
      if (!['llm', 'image', 'video'].includes(taskType)) {
        return res.status(400).json({ error: 'Invalid task type. Must be llm, image, or video' });
      }
      const avgDuration = getAverageDuration(taskType, 10);
      res.json({ taskType, avgDuration });
    } catch (error: any) {
      console.error('[StatsServer] 获取平均时长失败:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // 记录任务历史接口（可选，主要用于调试）
  app.post('/api/stats/record', (req, res) => {
    try {
      const { taskType, duration, success } = req.body;
      if (!taskType || typeof duration !== 'number') {
        return res.status(400).json({ error: 'Invalid request body' });
      }
      recordTaskHistory(taskType as TaskType, duration, success !== false);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[StatsServer] 记录任务历史失败:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  const PORT = 3001;
  statsServer = app.listen(PORT, () => {
    console.log(`[StatsServer] 统计 API 服务器已启动，端口: ${PORT}`);
  });

  statsServer.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[StatsServer] 端口 ${PORT} 已被占用，尝试使用其他端口`);
      // 可以尝试其他端口，但为了简单起见，这里只记录警告
    } else {
      console.error('[StatsServer] 服务器错误:', error);
    }
  });
}

type ProjectRecord = { id: string; name: string; date: string; createdAt: number; lastModified: number };

/** 导入时重写节点中的 local-resource 路径，使其指向新项目目录 */
function rewriteAssetPathsForImport(
  nodes: any[],
  assetRelativePaths: Set<string>,
  newProjectFolderPath: string
): { nodes: any[] } {
  let newBase = newProjectFolderPath.replace(/\\/g, '/');
  if (newBase.match(/^\/[a-zA-Z]:/)) newBase = newBase.substring(1);
  const rewriteUrl = (url: string): string => {
    if (!url || typeof url !== 'string' || !url.startsWith('local-resource://')) return url;
    let pathPart = url.replace(/^local-resource:\/\/+/, '');
    try { pathPart = decodeURIComponent(pathPart); } catch { /* ignore */ }
    const assetsIdx = pathPart.toLowerCase().indexOf('assets/');
    if (assetsIdx === -1) return url;
    const afterAssets = pathPart.substring(assetsIdx + 7);
    const normalized = afterAssets.replace(/\\/g, '/');
    if (!assetRelativePaths.has(normalized)) return url;
    return `local-resource://${newBase}/assets/${normalized}`;
  };
  return {
    nodes: nodes.map((node) => {
      const data = node.data || {};
      const updates: Record<string, any> = {};
      if (data.outputImage) updates.outputImage = rewriteUrl(data.outputImage);
      if (data.outputVideo) updates.outputVideo = rewriteUrl(data.outputVideo);
      if (data.outputAudio) updates.outputAudio = rewriteUrl(data.outputAudio);
      if (data.avatar) updates.avatar = rewriteUrl(data.avatar);
      if (Array.isArray(data.inputImages)) updates.inputImages = data.inputImages.map((u: string) => rewriteUrl(u));
      if (data.referenceVideoUrl) updates.referenceVideoUrl = rewriteUrl(data.referenceVideoUrl);
      if (data.referenceAudioUrl) updates.referenceAudioUrl = rewriteUrl(data.referenceAudioUrl);
      if (Object.keys(updates).length === 0) return node;
      return { ...node, data: { ...data, ...updates } };
    }),
  };
}

/**
 * 从 .nexflow 文件路径导入项目到当前 store 与项目目录，用于“导入”和“首次运行注入默认项目”。
 */
function importProjectFromNexflowPath(filePath: string): { project: ProjectRecord; cardBackground?: string } | null {
  const fileExt = path.extname(filePath).toLowerCase();
  if (fileExt !== '.nexflow' && fileExt !== '.zip') return null;
  if (!fs.existsSync(filePath)) return null;
  const zip = new AdmZip(filePath);
  const zipEntries = zip.getEntries();
  const dataEntry = zipEntries.find((entry: any) => entry.entryName === 'data.json');
  if (!dataEntry) return null;
  const importData = JSON.parse(dataEntry.getData().toString('utf-8'));
  const projectName = importData.projectName || path.basename(filePath, path.extname(filePath));
  const projects = (store.get('projects') as ProjectRecord[]) || [];
  let finalProjectName = projectName;
  let counter = 1;
  while (projects.some((p) => p.name === finalProjectName)) {
    finalProjectName = `${projectName} (${counter})`;
    counter++;
  }
  const now = Date.now();
  const newProject: ProjectRecord = {
    id: `project-${now}`,
    name: finalProjectName,
    date: new Date(now).toISOString().split('T')[0],
    createdAt: importData.createdAt || now,
    lastModified: now,
  };
  const basePath = getProjectsBasePath();
  const projectFolderPath = path.join(basePath, sanitizeProjectName(newProject.id));
  if (!fs.existsSync(projectFolderPath)) fs.mkdirSync(projectFolderPath, { recursive: true });
  const assetRelativePaths = new Set<string>();
  let cardBackground: string | undefined;
  for (const entry of zipEntries) {
    const entryName = entry.entryName;
    if (entry.isDirectory) continue;
    if (entryName === 'card-bg.txt') {
      cardBackground = entry.getData().toString('utf-8').trim() || undefined;
      continue;
    }
    if (entryName.startsWith('assets/')) {
      assetRelativePaths.add(entryName.substring('assets/'.length));
    }
  }
  // 将 outputImage 等 local-resource 路径重写为新项目目录，解决导入后图片加载失败
  const rewritten = rewriteAssetPathsForImport(importData.nodes || [], assetRelativePaths, projectFolderPath);
  for (const entry of zipEntries) {
    const entryName = entry.entryName;
    if (entry.isDirectory) continue;
    if (entryName === 'card-bg.txt') continue;
    if (entryName === 'data.json') {
      fs.writeFileSync(
        path.join(projectFolderPath, 'data.json'),
        JSON.stringify({ nodes: rewritten.nodes, edges: importData.edges || [] }, null, 2),
        'utf-8'
      );
      continue;
    }
    if (entryName === 'metadata.json') {
      fs.writeFileSync(path.join(projectFolderPath, 'metadata.json'), entry.getData(), 'utf-8');
      continue;
    }
    if (entryName.startsWith('assets/')) {
      const relativePath = entryName.substring('assets/'.length);
      const targetPath = path.join(projectFolderPath, 'assets', relativePath);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetPath, entry.getData());
    }
  }
  projects.push(newProject);
  store.set('projects', projects);
  return { project: newProject, cardBackground };
}

/** 安装包内默认 LLM 人设 JSON 路径（打包后从 extraResources 复制到 resources） */
function getDefaultLLMPersonasPath(): string {
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'default-llm-personas.json');
  }
  return path.join(app.getAppPath(), 'resources', 'default-llm-personas.json');
}

// 安装包首次运行：保留草稿；不注入默认项目；片头与 LLM 人设从安装包内默认资源注入；API Key 与授权清空以显示激活页
// 重装检测：exe 修改时间变化视为重装，强制清空任务、激活、API Key（因 userData 可能保留导致 packagedAppHasRun 仍为 true）
function applyFirstRunAfterInstall() {
  const lastVersion = store.get('lastLaunchedVersion') as string | undefined;
  const currentVersion = app.getVersion();

  let shouldClearSensitive = false;
  if (app.isPackaged) {
    const lastExeMtime = store.get('lastExeMtime') as number | undefined;
    let currentExeMtime: number;
    try {
      currentExeMtime = fs.statSync(process.execPath).mtimeMs;
    } catch {
      currentExeMtime = 0;
    }
    if (lastExeMtime !== undefined && currentExeMtime !== lastExeMtime) {
      shouldClearSensitive = true;
      console.log('[重装检测] exe mtime 变化，视为重装，将清空任务、激活、API Key');
    }
    store.set('lastExeMtime', currentExeMtime);
  }

  // 安装包首次运行或重装：清除授权与 API Key，确保激活码、核心算力、插件算力均为空，需用户重新配置
  if ((app.isPackaged && !store.get('packagedAppHasRun')) || shouldClearSensitive) {
    try {
      const licensePath = path.join(getUserDataPath(), 'license.json');
      if (fs.existsSync(licensePath)) {
        fs.unlinkSync(licensePath);
        console.log('[首次运行] 已清除旧授权文件');
      }
    } catch (e) {
      console.warn('[首次运行] 清除旧授权文件失败:', e);
    }
    store.set('license_info_encrypted', '');
    store.set('bltcyApiKey', '');
    store.set('runningHubApiKey', '');
    store.set('tasks', []); // 任务历史列表置空
    store.set('packagedAppHasRun', true);
    console.log('[首次运行] 已清空激活码、核心算力、插件算力、任务列表');
  }

  if (lastVersion === undefined) {
    store.set('tasks', []);
    store.set('bltcyApiKey', '');
    store.set('runningHubApiKey', '');
    store.set('lastLaunchedVersion', currentVersion);
    // 安装包安装时不保留/注入默认项目，用户项目列表为空
    const personas = store.get('globalLLMPersonas') as Array<{ id: string; name: string; content: string }> | undefined;
    if (!personas || personas.length === 0) {
      const defaultPath = getDefaultLLMPersonasPath();
      if (fs.existsSync(defaultPath)) {
        try {
          const raw = fs.readFileSync(defaultPath, 'utf-8');
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 0) {
            store.set('globalLLMPersonas', arr);
            console.log('[首次运行] 已注入默认 LLM 人设:', arr.length, '条');
          }
        } catch (e) {
          console.warn('[首次运行] 读取默认 LLM 人设失败:', e);
        }
      }
    }
    console.log('[首次运行] 片头资源、LLM 人设已按需注入');
  } else {
    store.set('lastLaunchedVersion', currentVersion);
  }
}

// 应用启动
app.whenReady().then(() => {
  // 不再删除 Chromium 内部目录（GPUCache、Cache），否则会导致 Gpu Cache Creation failed 与渲染进程 exitCode -2147483645。仅清理自定义缓存（如项目临时目录、缩略图）时使用 app 自有路径。
  applyFirstRunAfterInstall();

  // 注册 local-resource 协议
  registerLocalResourceProtocol();

  // 从 C 盘 userData/projects 迁移到安装目录（或自定义路径）下的 projects
  migrateProjectsFromUserDataToAppDir();
  // 迁移旧的项目ID文件夹到统一按 ID 的路径
  migrateProjectFolders();
  // 将按“项目名”的旧文件夹迁到按“项目 ID”，使卡片名称仅作显示、路径不变
  migrateNameBasedFoldersToIdBased();
  // 清理孤立项目（重装后安装目录被删、userData 仍保留旧列表导致的空项目）
  removeOrphanedProjects();

  // 任务列表：启动时自动清理失败、卡住、无内容、本地文件已删除的无效任务
  try {
    const tasks = store.get('tasks') || [];
    if (tasks.length > 0) filterInvalidTasks(tasks);
  } catch (e) {
    console.warn('[启动] 任务列表清理失败:', e);
  }

  // 注册 AI Providers
  registerProvider(new ChatProvider());
  registerProvider(new ImageProvider());
  registerProvider(new VideoProvider());
  registerProvider(new AudioProvider());

  // 启动统计 API 服务器
  startStatsServer();

  // 开发环境：强制删除 GPUCache 后再创建窗口，减少旧缓存导致的崩溃
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    try {
      const userData = app.getPath('userData');
      const gpuCacheDir = path.join(userData, 'GPUCache');
      if (fs.existsSync(gpuCacheDir)) {
        fs.rmSync(gpuCacheDir, { recursive: true, force: true });
        console.log('[主进程] 开发环境已删除 GPUCache:', gpuCacheDir);
      }
    } catch (e) {
      console.warn('[主进程] 删除 GPUCache 失败:', e);
    }
  }

  // 创建窗口
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 关闭统计服务器
    if (statsServer) {
      statsServer.close();
      statsServer = null;
    }
    app.quit();
  }
});

// ==================== IPC Handlers ====================

// 激活码管理（精简版：NXF-SERIAL-ENCODED_EXPIRE-SIGN + license.json）
const getUserDataPath = () => app.getPath('userData');

ipcMain.handle('validate-activation', async (_, activationCode: string) => {
  const activateResult = activateLicense(activationCode, getUserDataPath());
  return {
    valid: activateResult.valid,
    message: activateResult.message,
    expireAt: activateResult.expireAt,
    errorCode: activateResult.errorCode,
    level: activateResult.valid ? 'PRO' : undefined,
  };
});

ipcMain.handle('check-activation', () => {
  const check = checkLicenseStatus(getUserDataPath());
  const activated = check.status === 'VALID';
  return {
    activated,
    status: check.status,
    activationCode: check.activationCode ?? '',
    expireAt: check.expireAt,
    message: check.message,
    level: activated ? 'PRO' : undefined,
  };
});

/** 主应用读取当前授权（VALID 视为 PRO，用于抠图/去水印等） */
ipcMain.handle('get-license-info', () => {
  const check = checkLicenseStatus(getUserDataPath());
  return { level: check.status === 'VALID' ? 'PRO' : null };
});

/** 管理员：生成激活码并写入剪贴板 */
ipcMain.handle('generate-activation-code', (_, days: number) => {
  const code = generateActivationCode(typeof days === 'number' ? days : 30);
  clipboard.writeText(code);
  return { code };
});

// 片头视频：开发时用项目下的 splash-videos，打包后优先用 userData/splash-videos，为空则从安装包内复制默认资源
const SPLASH_VIDEO_EXT = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const SPLASH_AUDIO_EXT = ['.mp3'];

/** 安装包内自带的片头资源目录（打包时由 extraResources 复制到 resources/splash-videos） */
function getBundledSplashVideosDir(): string {
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'splash-videos');
  }
  return path.join(app.getAppPath(), 'resources', 'splash-videos');
}

function getSplashVideosDir(): string {
  const dir = app.isPackaged
    ? path.join(getUserDataPath(), 'splash-videos')
    : path.join(app.getAppPath(), 'splash-videos');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error('[splash] 创建片头视频目录失败:', e);
    }
  }
  return dir;
}

/** 将安装包内的默认片头资源复制到 userData/splash-videos（仅当目标为空时执行一次） */
function copyBundledSplashVideosIfNeeded(userDir: string): void {
  const bundled = getBundledSplashVideosDir();
  if (!fs.existsSync(bundled)) return;
  const existing = fs.readdirSync(userDir);
  const hasMedia = existing.some(
    (n) =>
      SPLASH_VIDEO_EXT.includes(path.extname(n).toLowerCase()) ||
      SPLASH_AUDIO_EXT.includes(path.extname(n).toLowerCase()) ||
      ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(n).toLowerCase())
  );
  if (hasMedia) return;
  try {
    const names = fs.readdirSync(bundled);
    const isMedia = (name: string) => {
      const ext = path.extname(name).toLowerCase();
      return (
        SPLASH_VIDEO_EXT.includes(ext) ||
        SPLASH_AUDIO_EXT.includes(ext) ||
        ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)
      );
    };
    for (const n of names) {
      if (!isMedia(n)) continue;
      const src = path.join(bundled, n);
      if (!fs.statSync(src).isFile()) continue;
      const dest = path.join(userDir, n);
      fs.copyFileSync(src, dest);
      console.log('[splash] 已复制默认片头资源:', n);
    }
  } catch (e) {
    console.warn('[splash] 复制默认片头资源失败:', e);
  }
}

function readSplashMediaFromDir(dir: string): { urls: string[]; logoUrl: string | null; musicUrl: string | null } {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const videos = names
    .filter((n) => SPLASH_VIDEO_EXT.includes(path.extname(n).toLowerCase()))
    .sort()
    .map((n) => pathToFileURL(path.join(dir, n)).href);
  const logoExt = ['.png', '.jpg', '.jpeg', '.webp'];
  let logoName: string | undefined = ['logo.png', 'logo.jpg', 'logo.webp'].find((n) => names.includes(n));
  if (!logoName) {
    logoName = names.find((n) => logoExt.includes(path.extname(n).toLowerCase()) && !SPLASH_VIDEO_EXT.includes(path.extname(n).toLowerCase()));
  }
  const logoUrl = logoName ? pathToFileURL(path.join(dir, logoName)).href : null;
  const audioNames = names.filter((n) => SPLASH_AUDIO_EXT.includes(path.extname(n).toLowerCase())).sort();
  const musicName = ['bgm.mp3', 'music.mp3'].find((n) => names.includes(n)) ?? audioNames[0];
  const musicUrl = musicName ? pathToFileURL(path.join(dir, musicName)).href : null;
  return { urls: videos, logoUrl, musicUrl };
}

ipcMain.handle('get-splash-videos', async () => {
  const dir = getSplashVideosDir();
  if (app.isPackaged) copyBundledSplashVideosIfNeeded(dir);
  try {
    const result = readSplashMediaFromDir(dir);
    const hasAnyMedia = result.urls.length > 0 || result.logoUrl || result.musicUrl;
    if (!hasAnyMedia && app.isPackaged) {
      const bundled = getBundledSplashVideosDir();
      if (fs.existsSync(bundled)) {
        const bundledResult = readSplashMediaFromDir(bundled);
        if (bundledResult.urls.length > 0 || bundledResult.logoUrl || bundledResult.musicUrl) {
          return { folderPath: dir, ...bundledResult };
        }
      }
    }
    return { folderPath: dir, ...result };
  } catch (e) {
    console.error('[splash] 读取片头视频目录失败:', e);
    return { folderPath: dir, urls: [], logoUrl: null, musicUrl: null };
  }
});
ipcMain.handle('open-splash-folder', () => {
  const dir = getSplashVideosDir();
  if (fs.existsSync(dir)) shell.openPath(dir);
});

// 安全向渲染进程发送消息（避免窗口已关闭/渲染帧已销毁或未就绪时报错）
function safeSendToRenderer(channel: string, ...args: any[]) {
  if (!rendererReady || !mainWindow?.webContents || mainWindow.isDestroyed()) return;
  try {
    if (mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send(channel, ...args);
  } catch (_err) {
    // 忽略 Render frame was disposed、Message rejected by WidgetHost 等
  }
}

// API Key 管理
ipcMain.handle('save-bltcy-api-key', async (_, apiKey: string) => {
  store.set('bltcyApiKey', apiKey);
  try {
    const balance = await getBLTCYBalance(true);
    safeSendToRenderer('balance-updated', { type: 'bltcy', balance });
  } catch (error) {
    console.error('查询 BLTCY 余额失败:', error);
  }
  return { success: true };
});

ipcMain.handle('save-rh-api-key', async (_, apiKey: string) => {
  store.set('runningHubApiKey', apiKey);
  try {
    const balance = await getRHBalance(true);
    safeSendToRenderer('balance-updated', { type: 'rh', balance });
  } catch (error) {
    console.error('查询 RH 余额失败:', error);
  }
  return { success: true };
});

ipcMain.handle('get-bltcy-api-key', () => {
  return store.get('bltcyApiKey') as string || '';
});

ipcMain.handle('get-rh-api-key', () => {
  return store.get('runningHubApiKey') as string || '';
});

// 余额查询
ipcMain.handle('query-bltcy-balance', async (_, force?: boolean) => {
  const balance = await getBLTCYBalance(force);
  safeSendToRenderer('balance-updated', { type: 'bltcy', balance });
  return balance;
});

ipcMain.handle('query-rh-balance', async (_, force?: boolean) => {
  const balance = await getRHBalance(force);
  safeSendToRenderer('balance-updated', { type: 'rh', balance });
  return balance;
});

ipcMain.handle('query-all-balances', async (_, force?: boolean) => {
  const [bltcy, rh] = await Promise.all([
    getBLTCYBalance(force),
    getRHBalance(force),
  ]);
  safeSendToRenderer('balance-updated', { type: 'bltcy', balance: bltcy });
  safeSendToRenderer('balance-updated', { type: 'rh', balance: rh });
  return { bltcy, rh };
});

// 项目管理
ipcMain.handle('get-projects', () => {
  return store.get('projects') || [];
});

ipcMain.handle('create-project', async (_, name: string) => {
  const projects = (store.get('projects') || []) as Array<{
    id: string;
    name: string;
    date: string;
    createdAt: number;
    lastModified: number;
  }>;
  
  const newProject = {
    id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    date: new Date().toLocaleDateString('zh-CN'),
    createdAt: Date.now(),
    lastModified: Date.now(),
  };
  
  projects.push(newProject);
  store.set('projects', projects);

  const projectDir = getProjectFolderPathSync(newProject.id);
  if (projectDir) {
    fs.mkdirSync(projectDir, { recursive: true });
    const assetsDir = path.join(projectDir, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  }

  return newProject;
});

ipcMain.handle('update-project', async (_, projectId: string, name: string) => {
  const projects = (store.get('projects') || []) as Array<{
    id: string;
    name: string;
    date: string;
    createdAt: number;
    lastModified: number;
  }>;
  
  const index = projects.findIndex((p) => p.id === projectId);
  if (index !== -1) {
    // 仅更新卡片显示名称，不重命名磁盘路径（路径固定为 projectId）
    projects[index].name = name;
    projects[index].lastModified = Date.now();
    store.set('projects', projects);
    return projects[index];
  }
  throw new Error('项目不存在');
});

ipcMain.handle('delete-project', async (_, projectId: string) => {
  const projects = (store.get('projects') || []) as Array<{
    id: string;
    name: string;
    date: string;
    createdAt: number;
    lastModified: number;
  }>;
  const project = projects.find((p) => p.id === projectId);
  const projectDir = project ? getProjectFolderPathSync(projectId) : null;
  const filtered = projects.filter((p) => p.id !== projectId);
  store.set('projects', filtered);

  if (projectDir && fs.existsSync(projectDir)) {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch (e) {
      console.error('[delete-project] 删除项目文件夹失败:', e);
    }
  }

  // 清理引用该项目的任务（任务列表全局存储，删除项目后需同步移除失效任务）
  try {
    const projectFolderName = projectDir ? path.basename(projectDir) : '';
    if (!projectFolderName) return { success: true };

    const tasks = (store.get('tasks') || []) as Array<{ imageUrl?: string; videoUrl?: string; audioUrl?: string; localFilePath?: string }>;
    const filteredTasks = tasks.filter((t) => {
      const urls = [t.imageUrl, t.videoUrl, t.audioUrl, t.localFilePath].filter(Boolean) as string[];
      for (const u of urls) {
        const normalized = String(u).replace(/\\/g, '/').toLowerCase();
        if (normalized.includes(projectFolderName.toLowerCase())) return false; // 移除：引用已删项目
      }
      return true; // 保留
    });
    if (filteredTasks.length !== tasks.length) {
      store.set('tasks', filteredTasks);
      console.log(`[delete-project] 已清理 ${tasks.length - filteredTasks.length} 个关联任务`);
    }
  } catch (e) {
    console.error('[delete-project] 清理关联任务失败:', e);
  }

  return { success: true };
});

// 项目数据（节点和边）：仅持久化 nodes/edges，不删除项目文件夹内任何图片/视频文件
ipcMain.handle('save-project-data', async (_, projectId: string, nodes: any[], edges: any[]) => {
  const projectFolderPath = await getProjectFolderPath(projectId);
  
  if (!projectFolderPath) {
    throw new Error('项目不存在');
  }
  
  if (!fs.existsSync(projectFolderPath)) {
    fs.mkdirSync(projectFolderPath, { recursive: true });
  }
  
  // 确保 assets 子文件夹存在
  const assetsDir = path.join(projectFolderPath, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  
  const dataPath = path.join(projectFolderPath, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({ nodes, edges }, null, 2), 'utf-8');
  return { success: true };
});

ipcMain.handle('load-project-data', async (_, projectId: string) => {
  const projectFolderPath = await getProjectFolderPath(projectId);
  
  if (!projectFolderPath) {
    return { nodes: [], edges: [] };
  }
  
  const dataPath = path.join(projectFolderPath, 'data.json');
  if (!fs.existsSync(dataPath)) {
    return { nodes: [], edges: [] };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    return { nodes: data.nodes || [], edges: data.edges || [] };
  } catch (error) {
    console.error('加载项目数据失败:', error);
    return { nodes: [], edges: [] };
  }
});

// 将本地文件复制到项目 assets（拖拽到画布的图片/视频/音频持久化到项目，避免 OSS 过期或原路径失效导致“图片加载失败”）
ipcMain.handle('copy-file-to-project-assets', async (_, projectId: string | undefined, sourceFilePath: string) => {
  const normalized = (sourceFilePath || '').trim().replace(/^file:\/\/\/?/i, '');
  if (!normalized) {
    throw new Error('源文件路径为空');
  }
  if (!isLocalResourcePathAllowed(normalized)) {
    throw new Error('源路径不在允许访问的目录内');
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    throw new Error('源文件不存在或不是文件');
  }
  let saveDir: string;
  if (projectId) {
    const projectFolderPath = await getProjectFolderPath(projectId);
    if (!projectFolderPath) {
      throw new Error('项目不存在');
    }
    saveDir = path.join(projectFolderPath, 'assets');
  } else {
    saveDir = path.join(app.getPath('userData'), 'assets');
  }
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }
  const ext = path.extname(normalized) || '.bin';
  const base = path.basename(normalized, ext);
  const safeBase = base.replace(/[<>:"/\\|?*]/g, '_').slice(0, 32) || 'file';
  const fileName = `dropped-${Date.now()}-${safeBase}${ext}`;
  const destPath = path.join(saveDir, fileName);
  fs.copyFileSync(normalized, destPath);
  const savedPath = destPath.replace(/\\/g, '/');
  return { savedPath };
});

// 将拖入的文件内容（无 path 时由渲染进程读取后传入）写入项目 assets，保证「先保存到项目再读取」
ipcMain.handle('save-dropped-file-buffer-to-project-assets', async (_, projectId: string | undefined, fileName: string, buffer: ArrayBuffer) => {
  const name = (fileName || 'dropped').replace(/[<>:"/\\|?*]/g, '_').slice(0, 64) || 'dropped';
  const ext = path.extname(name) || '';
  const base = ext ? name.slice(0, -ext.length) : name;
  const safeBase = base.slice(0, 32) || 'file';
  let saveDir: string;
  if (projectId) {
    const projectFolderPath = await getProjectFolderPath(projectId);
    if (!projectFolderPath) {
      throw new Error('项目不存在');
    }
    saveDir = path.join(projectFolderPath, 'assets');
  } else {
    saveDir = path.join(app.getPath('userData'), 'assets');
  }
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }
  const destFileName = `dropped-${Date.now()}-${safeBase}${ext || '.bin'}`;
  const destPath = path.join(saveDir, destFileName);
  fs.writeFileSync(destPath, Buffer.from(buffer));
  const savedPath = destPath.replace(/\\/g, '/');
  return { savedPath };
});

// 导出项目
ipcMain.handle('export-project', async (_, projectId: string, cardBgDataUrl?: string) => {
  // 导出时使用原始路径（中文路径），确保导出功能正常
  const projectFolderPath = getProjectOriginalFolderPath(projectId);
  
  if (!projectFolderPath) {
    throw new Error('项目不存在');
  }
  
  const dataPath = path.join(projectFolderPath, 'data.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error('项目数据文件不存在');
  }
  
  try {
    const projectData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const projects = (store.get('projects') as Array<{
      id: string;
      name: string;
      date: string;
      createdAt: number;
      lastModified: number;
    }>) || [];
    
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      throw new Error('项目信息不存在');
    }
    
    // 构建导出数据（包含项目信息和节点/边数据）
    const exportData = {
      version: '1.0',
      projectName: project.name,
      projectId: project.id,
      createdAt: project.createdAt,
      lastModified: project.lastModified,
      nodes: projectData.nodes || [],
      edges: projectData.edges || [],
    };
    
    // 打开保存对话框
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '导出项目',
      defaultPath: `${project.name}.nexflow`,
      filters: [
        { name: 'NEXFLOW 项目文件', extensions: ['nexflow'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    
    // 创建 ZIP 文件
    const zip = new AdmZip();
    
    // 添加 data.json
    zip.addFile('data.json', Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8'));
    
    // 添加 metadata.json（如果存在）
    const metadataPath = path.join(projectFolderPath, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      const metadataContent = fs.readFileSync(metadataPath, 'utf-8');
      zip.addFile('metadata.json', Buffer.from(metadataContent, 'utf-8'));
    }
    // 添加项目卡片背景图（data URL，由渲染进程传入）
    if (cardBgDataUrl && typeof cardBgDataUrl === 'string' && cardBgDataUrl.trim()) {
      zip.addFile('card-bg.txt', Buffer.from(cardBgDataUrl.trim(), 'utf-8'));
    }
    // 添加 assets 文件夹中的所有文件（text、image、video、声音文件）
    const assetsPath = path.join(projectFolderPath, 'assets');
    if (fs.existsSync(assetsPath)) {
      const addDirectoryToZip = (dirPath: string, zipPath: string = '') => {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stats = fs.statSync(filePath);
          const zipFilePath = zipPath ? `${zipPath}/${file}` : file;
          
          if (stats.isDirectory()) {
            // 递归添加子目录
            addDirectoryToZip(filePath, zipFilePath);
          } else {
            // 添加文件（支持 .txt, .png, .jpg, .jpeg, .webp, .mp4, .webm, .mov, .mp3, .wav, .ogg 等）
            const ext = path.extname(file).toLowerCase();
            const supportedExtensions = ['.txt', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.aac', '.m4a'];
            if (supportedExtensions.includes(ext)) {
              const fileContent = fs.readFileSync(filePath);
              zip.addFile(`assets/${zipFilePath}`, fileContent);
              console.log(`[导出] 添加文件: assets/${zipFilePath}`);
            }
          }
        }
      };
      
      addDirectoryToZip(assetsPath);
    }
    
    // 保存 ZIP 文件
    zip.writeZip(result.filePath);
    console.log(`[导出] 项目已导出到: ${result.filePath}`);
    
    return { success: true, filePath: result.filePath };
  } catch (error: any) {
    console.error('导出项目失败:', error);
    throw new Error(`导出项目失败: ${error.message}`);
  }
});

// 导入项目
ipcMain.handle('import-project', async () => {
  try {
    // 打开文件选择对话框
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '导入项目',
      filters: [
        { name: 'NEXFLOW 项目文件', extensions: ['nexflow', 'json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    
    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true };
    }
    
    const filePath = result.filePaths[0];
    const fileExt = path.extname(filePath).toLowerCase();

    if (fileExt === '.nexflow' || fileExt === '.zip') {
      const imported = importProjectFromNexflowPath(filePath);
      if (!imported) throw new Error('ZIP 文件中缺少 data.json 或格式无效');
      return { success: true, project: imported.project, cardBackground: imported.cardBackground };
    }

    let importData: any;
    // JSON 文件：向后兼容旧格式
    {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      importData = JSON.parse(fileContent);
      
      // 验证数据格式
      if (!importData.nodes || !importData.edges) {
        throw new Error('无效的项目文件格式');
      }
      
      // 获取项目名称（优先使用导入数据中的项目名，否则使用文件名）
      let projectName = importData.projectName || path.basename(filePath, path.extname(filePath));
      
      // 如果项目名已存在，添加后缀
      const projects = (store.get('projects') as Array<{
        id: string;
        name: string;
        date: string;
        createdAt: number;
        lastModified: number;
      }>) || [];
      
      let finalProjectName = projectName;
      let counter = 1;
      while (projects.some((p) => p.name === finalProjectName)) {
        finalProjectName = `${projectName} (${counter})`;
        counter++;
      }
      
      // 创建新项目
      const now = Date.now();
      const newProject = {
        id: `project-${now}`,
        name: finalProjectName,
        date: new Date(now).toISOString().split('T')[0],
        createdAt: importData.createdAt || now,
        lastModified: now,
      };
      
      projects.push(newProject);
      store.set('projects', projects);

      const basePath = getProjectsBasePath();
      const projectFolderPath = path.join(basePath, sanitizeProjectName(newProject.id));
      if (!fs.existsSync(projectFolderPath)) {
        fs.mkdirSync(projectFolderPath, { recursive: true });
      }
      const dataPath = path.join(projectFolderPath, 'data.json');
      fs.writeFileSync(
        dataPath,
        JSON.stringify(
          {
            nodes: importData.nodes || [],
            edges: importData.edges || [],
          },
          null,
          2
        ),
        'utf-8'
      );
      
      return { success: true, project: newProject };
    }
  } catch (error: any) {
    console.error('导入项目失败:', error);
    throw new Error(`导入项目失败: ${error.message}`);
  }
});

// AI 调用（统一规范化 nodeId，避免前后端匹配失败）
ipcMain.handle('ai:invoke', async (_, params: any) => {
  const normalized = {
    ...params,
    nodeId: params?.nodeId != null ? String(params.nodeId).trim() : '',
  };
  return await aiCore.invoke(normalized);
});

// 窗口操作
ipcMain.handle('resize-window', (_, width: number, height: number) => {
  if (mainWindow) {
    mainWindow.setSize(width, height);
  }
  return { success: true };
});

ipcMain.handle('quit-app', () => {
  app.quit();
  return { success: true };
});

ipcMain.handle('toggle-fullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, isFullScreen: false };
  }
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return { success: true, isFullScreen: next };
});

// 全局 LLM 人设管理
ipcMain.handle('get-global-llm-personas', () => {
  return store.get('globalLLMPersonas') || [];
});

ipcMain.handle('save-global-llm-persona', (_, persona: { id: string; name: string; content: string }) => {
  const personas = (store.get('globalLLMPersonas') || []) as Array<{
    id: string;
    name: string;
    content: string;
  }>;
  
  const index = personas.findIndex((p) => p.id === persona.id);
  if (index !== -1) {
    personas[index] = persona;
  } else {
    personas.push(persona);
  }
  
  store.set('globalLLMPersonas', personas);
  return persona;
});

ipcMain.handle('update-global-llm-personas', (_, personas: Array<{ id: string; name: string; content: string }>) => {
  store.set('globalLLMPersonas', personas);
  return { success: true };
});

ipcMain.handle('delete-global-llm-persona', (_, personaId: string) => {
  const personas = (store.get('globalLLMPersonas') || []) as Array<{
    id: string;
    name: string;
    content: string;
  }>;
  
  const filtered = personas.filter((p) => p.id !== personaId);
  store.set('globalLLMPersonas', filtered);
  return { success: true };
});

// 选择自定义保存路径
ipcMain.handle('select-save-path', async () => {
  try {
    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' };
    }
    
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择保存路径',
      properties: ['openDirectory'],
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, error: '用户取消选择' };
    }
    
    const selectedPath = result.filePaths[0];
    store.set('customSavePath', selectedPath);
    return { success: true, path: selectedPath };
  } catch (error) {
    console.error('选择保存路径失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 自动保存视频到本地
ipcMain.handle('auto-save-video', async (_, videoUrl: string, nodeTitle: string, projectId?: string) => {
  try {
    // 如果是 local-resource:// 或 file:// URL，说明已经保存到本地，直接返回路径
    if (videoUrl.startsWith('local-resource://')) {
      const localPath = videoUrl.replace('local-resource://', '');
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    
    if (videoUrl.startsWith('file://')) {
      const localPath = videoUrl.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep);
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    
    // 使用 userData 作为基础目录
    const baseDir = app.getPath('userData');
    let projectDir: string;
    
    if (projectId) {
      const projectFolderPath = await getProjectFolderPath(projectId);
      if (projectFolderPath) {
        projectDir = projectFolderPath;
      } else {
        console.warn(`[自动保存视频] 项目不存在: ${projectId}，保存到 assets 文件夹`);
        projectDir = path.join(baseDir, 'assets');
      }
    } else {
      projectDir = path.join(baseDir, 'assets');
    }
    
    // 确保项目文件夹存在
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    
    // 确保 assets 子文件夹存在
    const assetsDir = path.join(projectDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    
    // 生成文件名，保存到 assets 文件夹
    const timestamp = Date.now();
    const sanitizedTitle = nodeTitle.replace(/[<>:"/\\|?*]/g, '_');
    const filePath = path.join(assetsDir, `${sanitizedTitle}-${timestamp}.mp4`);
    
    // 下载视频
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 300000,
      proxy: false,
    });
    
    // 保存到本地
    fs.writeFileSync(filePath, Buffer.from(response.data));
    
    // 确保文件完全写入
    try {
      const fd = fs.openSync(filePath, 'r+');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (syncError) {
      console.warn('[自动保存视频] 文件同步失败，但文件已保存:', syncError);
    }
    
    console.log(`视频已自动保存: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    console.error('自动保存视频失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 自动保存图片到本地
ipcMain.handle('auto-save-image', async (_, imageUrl: string, nodeTitle: string, projectId?: string) => {
  try {
    // 如果是 local-resource:// 或 file:// URL，说明已经保存到本地，直接返回路径
    if (imageUrl.startsWith('local-resource://')) {
      const localPath = imageUrl.replace('local-resource://', '');
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    
    if (imageUrl.startsWith('file://')) {
      const localPath = imageUrl.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep);
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    
    // 使用 userData 作为基础目录
    const baseDir = app.getPath('userData');
    let projectDir: string;
    
    if (projectId) {
      const projectFolderPath = await getProjectFolderPath(projectId);
      if (projectFolderPath) {
        projectDir = projectFolderPath;
      } else {
        console.warn(`[自动保存图片] 项目不存在: ${projectId}，保存到 assets 文件夹`);
        projectDir = path.join(baseDir, 'assets');
      }
    } else {
      projectDir = path.join(baseDir, 'assets');
    }
    
    // 确保项目文件夹存在
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    
    // 确保 assets 子文件夹存在
    const assetsDir = path.join(projectDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    
    // 生成文件名，保存到 assets 文件夹
    const timestamp = Date.now();
    const sanitizedTitle = nodeTitle.replace(/[<>:"/\\|?*]/g, '_');
    const filePath = path.join(assetsDir, `${sanitizedTitle}-${timestamp}.png`);
    
    // 下载图片
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      proxy: false,
    });
    
    // 保存到本地
    fs.writeFileSync(filePath, Buffer.from(response.data));
    
    console.log(`图片已自动保存: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    console.error('自动保存图片失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 自动保存音频到本地（生成的歌曲等）。文件名优先使用 preferredFileName（如歌曲名），否则用 nodeTitle
ipcMain.handle('auto-save-audio', async (_, audioUrl: string, preferredFileName: string, projectId?: string) => {
  try {
    if (audioUrl.startsWith('local-resource://')) {
      const localPath = audioUrl.replace('local-resource://', '').replace(/\//g, path.sep);
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }
    if (audioUrl.startsWith('file://')) {
      const localPath = audioUrl.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep);
      if (fs.existsSync(localPath)) {
        return { success: true, filePath: localPath };
      }
    }

    const baseDir = app.getPath('userData');
    let projectDir: string;
    if (projectId) {
      const projectFolderPath = await getProjectFolderPath(projectId);
      projectDir = projectFolderPath ? projectFolderPath : path.join(baseDir, 'assets');
    } else {
      projectDir = path.join(baseDir, 'assets');
    }
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    const assetsDir = path.join(projectDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const baseName = (preferredFileName || 'audio').replace(/[<>:"/\\|?*]/g, '_').trim() || 'audio';
    const filePath = path.join(assetsDir, `${baseName}-${timestamp}.mp3`);

    const response = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      proxy: false,
    });
    fs.writeFileSync(filePath, Buffer.from(response.data));
    try {
      const fd = fs.openSync(filePath, 'r+');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (e) {
      // ignore
    }
    console.log(`音频已自动保存: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    console.error('自动保存音频失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 下载图片（手动选择保存位置）
ipcMain.handle('download-image', async (_, imageUrl: string, nodeTitle: string) => {
  try {
    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' };
    }
    
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存图片',
      defaultPath: `${nodeTitle}.png`,
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      ],
    });
    
    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消保存' };
    }
    
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      proxy: false,
    });
    
    fs.writeFileSync(result.filePath, Buffer.from(response.data));
    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error('下载图片失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 下载视频（手动选择保存位置）
ipcMain.handle('download-video', async (_, videoUrl: string, nodeTitle: string) => {
  try {
    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' };
    }
    
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存视频',
      defaultPath: `${nodeTitle}.mp4`,
      filters: [
        { name: '视频', extensions: ['mp4', 'webm', 'mov'] },
      ],
    });
    
    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消保存' };
    }
    
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 300000,
      proxy: false,
    });
    
    fs.writeFileSync(result.filePath, Buffer.from(response.data));
    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error('下载视频失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 打开文件
ipcMain.handle('open-file', async (_, filePath: string) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    console.error('打开文件失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 选择参考音文件（用于 Index-TTS2.0 等）
ipcMain.handle('show-open-audio-dialog', async () => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return { success: false, filePath: undefined, error: '窗口未就绪' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择参考音文件',
    properties: ['openFile'],
    filters: [
      { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return { success: false, filePath: undefined };
  let filePath = path.normalize(result.filePaths[0]).replace(/\\/g, '/');
  if (process.platform === 'win32' && filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
  return { success: true, filePath };
});

// 选择视频文件（与 AudioNode 上传参考音一致的 IPC 方案）
ipcMain.handle('show-open-video-dialog', async () => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return { success: false, filePath: undefined, error: '窗口未就绪' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件',
    properties: ['openFile'],
    filters: [
      { name: '视频', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return { success: false, filePath: undefined };
  let filePath = path.normalize(result.filePaths[0]).replace(/\\/g, '/');
  if (process.platform === 'win32' && filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
  return { success: true, filePath };
});

// 检查文件是否存在（用于播放器预检查）
// 项目路径 IPC 处理器（统一使用 projects/[项目名]，无软链接）
ipcMain.handle('ensure-project-mapping', async (_, projectId: string) => {
  return await getProjectFolderPath(projectId);
});

ipcMain.handle('get-project-mapped-path', async (_, projectId: string) => {
  return await getProjectFolderPath(projectId);
});

ipcMain.handle('get-project-original-path', (_, projectId: string) => {
  return getProjectOriginalFolderPath(projectId);
});

ipcMain.handle('get-project-base-path', () => {
  return getProjectsBasePath();
});

ipcMain.handle('set-project-base-path', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(win || null, {
    title: '选择项目保存位置',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { success: false, path: '' };
  }
  const chosen = path.normalize(result.filePaths[0]);
  store.set('customProjectPath', chosen);
  return { success: true, path: chosen };
});

ipcMain.handle('check-file-exists', async (_, filePath: string) => {
  try {
    // 处理 local-resource:// 路径（使用与协议处理器相同的逻辑）
    let normalizedPath = filePath;
    if (filePath.startsWith('local-resource://')) {
      let decodedPath = filePath.replace(/^local-resource:\/\/+/, '');
      
      // URL 解码（处理中文字符等）- 使用与协议处理器相同的逻辑
      try {
        decodedPath = decodeURIComponent(decodedPath);
      } catch (e) {
        // 如果直接解码失败，尝试分段解码
        try {
          const parts = decodedPath.split('/');
          const decodedParts = parts.map((part) => {
            if (!part) return part;
            try {
              return decodeURIComponent(part);
            } catch {
              try {
                return decodeURIComponent(decodeURIComponent(part));
              } catch {
                // 如果包含 % 但解码失败，尝试手动解码
                if (part.includes('%')) {
                  try {
                    return part.replace(/%([0-9A-F]{2})/gi, (match, hex) => {
                      try {
                        return String.fromCharCode(parseInt(hex, 16));
                      } catch {
                        return match;
                      }
                    });
                  } catch {
                    return part;
                  }
                }
                return part;
              }
            }
          });
          decodedPath = decodedParts.join('/');
        } catch (e2) {
          console.warn('[check-file-exists] URL 解码失败，使用原始路径:', decodedPath);
        }
      }

      // 如果路径像 "c/Users"，修正为 "C:/Users"
      if (decodedPath.match(/^[a-zA-Z]\//)) {
        decodedPath = decodedPath[0].toUpperCase() + ':' + decodedPath.substring(1);
      }
      
      // 如果路径以 / 开头且是 Windows 路径（如 /C:/Users），移除开头的 /
      if (decodedPath.match(/^\/[a-zA-Z]:/)) {
        decodedPath = decodedPath.substring(1);
      }

      normalizedPath = path.normalize(decodedPath);
      
      // 如果是相对路径，转换为绝对路径
      if (!path.isAbsolute(normalizedPath)) {
        const userDataPath = app.getPath('userData');
        normalizedPath = path.resolve(userDataPath, normalizedPath);
      }
      
      // 使用 pathToFileURL 进行标准化处理（与协议处理器一致）
      try {
        const fileUrl = pathToFileURL(normalizedPath);
        let urlPath = fileUrl.pathname;
        if (process.platform === 'win32') {
          if (urlPath.startsWith('/')) {
            urlPath = urlPath.substring(1);
          }
          normalizedPath = urlPath.replace(/\//g, '\\');
        } else {
          normalizedPath = urlPath;
        }
      } catch (urlError) {
        // 如果 pathToFileURL 失败，使用原始路径
        console.warn('[check-file-exists] pathToFileURL 处理失败，使用原始路径:', urlError);
      }
    }
    
    // 检查文件是否存在且可读
    const exists = fs.existsSync(normalizedPath);
    if (!exists) {
      console.log('[check-file-exists] 文件不存在:', normalizedPath);
      return { exists: false, path: normalizedPath };
    }
    
    // 检查是否是文件
    const stats = fs.statSync(normalizedPath);
    const isFile = stats.isFile();
    const size = stats.size;
    
    if (!isFile) {
      console.log('[check-file-exists] 路径不是文件:', normalizedPath);
      return { exists: false, path: normalizedPath };
    }
    
    if (size === 0) {
      console.log('[check-file-exists] 文件为空:', normalizedPath);
      return { exists: true, path: normalizedPath, size: 0, readable: false };
    }
    
    return { 
      exists: true, 
      path: normalizedPath,
      size: size,
      readable: true
    };
  } catch (error: any) {
    console.error('[check-file-exists] 检查文件失败:', error);
    return { 
      exists: false, 
      error: error.message 
    };
  }
});

// 在文件管理器中显示文件
ipcMain.handle('show-item-in-folder', async (_, filePath: string) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('显示文件失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 获取用户数据路径
ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData');
});

// 打开路径（文件夹或文件）
ipcMain.handle('open-path', async (_, pathToOpen: string) => {
  try {
    // 如果路径不存在，尝试创建目录
    if (!fs.existsSync(pathToOpen)) {
      try {
        fs.mkdirSync(pathToOpen, { recursive: true });
      } catch (mkdirError) {
        // 如果创建失败，可能是文件路径，继续尝试打开
      }
    }
    
    await shell.openPath(pathToOpen);
    return { success: true };
  } catch (error) {
    console.error('打开路径失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// 角色管理
ipcMain.handle('get-characters', () => {
  return store.get('characters') || [];
});

ipcMain.handle('create-character', async (_, nickname: string, name: string, avatar: string, roleId?: string) => {
  const characters = (store.get('characters') || []) as Array<{
    id: string;
    nickname: string;
    name: string;
    avatar: string;
    roleId?: string;
    createdAt: number;
    localAvatarPath?: string; // 本地头像路径
  }>;
  
  // 如果头像 URL 是远程 URL，自动下载到本地
  let finalAvatar = avatar;
  let localAvatarPath: string | undefined;
  
  if (avatar && !avatar.startsWith('local-resource://') && !avatar.startsWith('data:') && !avatar.startsWith('file://')) {
    try {
      const { autoDownloadResource } = await import('./utils/resourceDownloader.js');
      const userDataPath = app.getPath('userData');
      const avatarsDir = path.join(userDataPath, 'avatars');
      
      // 确保 avatars 目录存在
      if (!fs.existsSync(avatarsDir)) {
        fs.mkdirSync(avatarsDir, { recursive: true });
      }
      
      // 下载头像到 avatars 文件夹（不使用项目ID，因为角色是全局的）
      const localPath = await autoDownloadResource(avatar, 'image', {
        nodeId: `character-${Date.now()}`,
        nodeTitle: nickname || name,
        projectId: undefined, // 角色头像不使用项目ID，保存到全局 avatars
      });
      
      if (localPath) {
        // 将本地路径转换为 local-resource:// URL
        let normalizedPath = localPath.replace(/\\/g, '/');
        if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
          normalizedPath = normalizedPath.substring(1);
        }
        finalAvatar = `local-resource://${normalizedPath}`;
        localAvatarPath = localPath;
        console.log(`[角色创建] 头像已下载到本地: ${localPath}`);
      }
    } catch (error) {
      console.error('[角色创建] 下载头像失败，使用原始 URL:', error);
    }
  }
  
  const newCharacter = {
    id: `character-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    nickname,
    name,
    avatar: finalAvatar,
    localAvatarPath,
    roleId: roleId || undefined,
    createdAt: Date.now(),
  };
  
  characters.push(newCharacter);
  store.set('characters', characters);
  return newCharacter;
});

ipcMain.handle('update-character', async (_, characterId: string, updates: { nickname?: string; name?: string; avatar?: string; roleId?: string }) => {
  const characters = (store.get('characters') || []) as Array<{
    id: string;
    nickname: string;
    name: string;
    avatar: string;
    roleId?: string;
    createdAt: number;
    localAvatarPath?: string; // 本地头像路径
  }>;
  
  const index = characters.findIndex((c) => c.id === characterId);
  if (index !== -1) {
    const character = characters[index];
    let finalUpdates: { nickname?: string; name?: string; avatar?: string; roleId?: string; localAvatarPath?: string } = { ...updates };
    
    // 如果更新了头像 URL 且是远程 URL，自动下载到本地
    if (updates.avatar && !updates.avatar.startsWith('local-resource://') && !updates.avatar.startsWith('data:') && !updates.avatar.startsWith('file://')) {
      try {
        const { autoDownloadResource } = await import('./utils/resourceDownloader.js');
        const userDataPath = app.getPath('userData');
        const avatarsDir = path.join(userDataPath, 'avatars');
        
        // 确保 avatars 目录存在
        if (!fs.existsSync(avatarsDir)) {
          fs.mkdirSync(avatarsDir, { recursive: true });
        }
        
        // 下载头像到 avatars 文件夹
        const localPath = await autoDownloadResource(updates.avatar, 'image', {
          nodeId: characterId,
          nodeTitle: updates.nickname || character.nickname || character.name,
          projectId: undefined, // 角色头像不使用项目ID，保存到全局 avatars
        });
        
        if (localPath) {
          // 将本地路径转换为 local-resource:// URL
          let normalizedPath = localPath.replace(/\\/g, '/');
          if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
            normalizedPath = normalizedPath.substring(1);
          }
          finalUpdates.avatar = `local-resource://${normalizedPath}`;
          finalUpdates.localAvatarPath = localPath;
          console.log(`[角色更新] 头像已下载到本地: ${localPath}`);
        }
      } catch (error) {
        console.error('[角色更新] 下载头像失败，使用原始 URL:', error);
      }
    }
    
    characters[index] = { ...character, ...finalUpdates };
    store.set('characters', characters);
    return characters[index];
  }
  throw new Error('角色不存在');
});

ipcMain.handle('delete-character', (_, characterId: string) => {
  const characters = (store.get('characters') || []) as Array<{
    id: string;
    nickname: string;
    name: string;
    avatar: string;
    roleId?: string;
    createdAt: number;
    localAvatarPath?: string;
  }>;
  
  const filtered = characters.filter((c) => c.id !== characterId);
  store.set('characters', filtered);
  return { success: true };
});

// 清理无效的头像 URL
ipcMain.handle('clear-invalid-avatar-url', (_, characterId: string, invalidUrl: string) => {
  const characters = (store.get('characters') || []) as Array<{
    id: string;
    nickname: string;
    name: string;
    avatar: string;
    roleId?: string;
    createdAt: number;
    localAvatarPath?: string;
  }>;
  
  const character = characters.find((c) => c.id === characterId);
  if (character && character.avatar === invalidUrl) {
    // 如果当前头像 URL 就是无效的 URL，清空它
    character.avatar = '';
    character.localAvatarPath = undefined;
    store.set('characters', characters);
    console.log(`[清理无效头像] 角色 ${characterId} 的头像 URL 已清空`);
    return { success: true };
  }
  return { success: false, message: '角色不存在或头像 URL 不匹配' };
});

// 上传本地视频到 OSS（用于角色创建模块）
ipcMain.handle('upload-local-video-to-oss', async (_, localVideoPath: string) => {
  try {
    const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
    const videoProvider = new VideoProvider();
    
    console.log('[上传本地视频到OSS] 开始处理本地视频路径:', localVideoPath);
    
    const ossUrl = await videoProvider.uploadLocalVideoToOSS(localVideoPath);
    
    console.log('[上传本地视频到OSS] 上传成功，OSS URL:', ossUrl);
    return { success: true, url: ossUrl };
  } catch (error: any) {
    console.error('[上传本地视频到OSS] 上传失败:', error);
    return {
      success: false,
      error: error.message || '上传失败',
    };
  }
});

// 上传本地音频到 OSS（用于声音模块连接下一声音模块时，将参考音上传后回传 URL 到参考音输入框）
ipcMain.handle('upload-local-audio-to-oss', async (_, localAudioPath: string) => {
  try {
    const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
    const videoProvider = new VideoProvider();
    const ossUrl = await videoProvider.uploadLocalAudioToOSS(localAudioPath);
    console.log('[上传本地音频到OSS] 上传成功，OSS URL:', ossUrl);
    return { success: true, url: ossUrl };
  } catch (error: any) {
    console.error('[上传本地音频到OSS] 上传失败:', error);
    return { success: false, error: error.message || '上传失败' };
  }
});

// 上传图片到 OSS（接收 base64 图片数据）
ipcMain.handle('upload-image-to-oss', async (_, imageData: string) => {
  try {
    const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
    const videoProvider = new VideoProvider();
    
    console.log('[上传图片到OSS] 开始处理图片数据，长度:', imageData.length);
    
    // 处理 base64 数据 URL（data:image/png;base64,...）
    let imageBuffer: Buffer;
    let mimeType = 'image/png';
    
    if (imageData.startsWith('data:')) {
      // 提取 MIME 类型和 base64 数据
      const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches || matches.length < 3) {
        throw new Error('无效的 base64 图片数据');
      }
      mimeType = matches[1] || 'image/png';
      const base64Data = matches[2];
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
      // 如果是 HTTP URL，下载图片
      const response = await axios.get(imageData, { responseType: 'arraybuffer' });
      imageBuffer = Buffer.from(response.data);
      // 从响应头获取 MIME 类型
      const contentType = response.headers['content-type'];
      if (contentType) {
        mimeType = contentType;
      }
    } else {
      throw new Error('不支持的图片数据格式');
    }
    
    // 使用 VideoProvider 的 getOSSClient 方法获取 OSS 客户端（通过反射访问私有方法）
    const getOSSClient = (videoProvider as any).getOSSClient;
    if (!getOSSClient || typeof getOSSClient !== 'function') {
      throw new Error('OSS 客户端方法未找到');
    }
    const ossClient = getOSSClient.call(videoProvider);
    if (!ossClient) {
      throw new Error('OSS 客户端未找到');
    }
    
    // 生成文件名
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).slice(-5);
    const fileExt = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'png';
    const objectName = `uploads/${timestamp}-${randomStr}.${fileExt}`;
    
    console.log(`[上传图片到OSS] 开始上传图片到 OSS，文件名: ${objectName}`);
    
    // 上传文件
    const result = await ossClient.put(objectName, imageBuffer, {
      mime: mimeType,
    });
    
    const publicUrl = result.url;
    console.log(`[上传图片到OSS] 图片上传成功，公网 URL: ${publicUrl}`);
    
    return { success: true, url: publicUrl };
  } catch (error: any) {
    console.error('[上传图片到OSS] 上传失败:', error);
    return {
      success: false,
      error: error.message || '上传失败',
    };
  }
});

// 上传视频到 OSS
ipcMain.handle('upload-video-to-oss', async (_, videoUrl: string) => {
  try {
    const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
    const videoProvider = new VideoProvider();
    
    console.log('[上传视频到OSS] 开始处理视频 URL:', videoUrl);
    
    let videoBuffer: Buffer;
    let mimeType = 'video/mp4';
    
    // 处理不同的视频 URL 格式
    if (videoUrl.startsWith('local-resource://') || videoUrl.startsWith('file://')) {
      let filePath: string;
      
      if (videoUrl.startsWith('local-resource://')) {
        filePath = videoUrl.replace(/^local-resource:\/\//, '');
        filePath = decodeURIComponent(filePath);
        // 处理 Windows 路径格式（c/Users -> C:/Users）
        if (filePath.match(/^[a-zA-Z]\//)) {
          filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        }
        // 处理 /C:/ 格式（移除开头的 /）
        if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
          filePath = filePath.substring(1);
        }
      } else {
        filePath = videoUrl.replace(/^file:\/\//, '');
        if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
          filePath = filePath.substring(1);
        }
        filePath = decodeURIComponent(filePath);
      }
      
      const userDataPath = app.getPath('userData');
      const projectsBase = getProjectsBasePath();
      const normalizedFilePath = path.normalize(filePath);
      const allowedRoots = [
        path.normalize(userDataPath),
        path.normalize(projectsBase),
        path.normalize(app.getPath('home')),
        path.normalize(app.getPath('desktop')),
        path.normalize(app.getPath('documents')),
        path.normalize(app.getPath('downloads')),
        path.normalize(app.getPath('videos')),
        path.normalize(app.getPath('pictures')),
      ];
      const allowed = allowedRoots.some((root) => {
        const r = root.replace(/[/\\]+$/, '');
        const p = normalizedFilePath;
        if (process.platform === 'win32') {
          return p.toLowerCase().startsWith(r.toLowerCase() + path.sep) || p.toLowerCase().startsWith(r.toLowerCase() + '/') || p.toLowerCase() === r.toLowerCase();
        }
        return p.startsWith(r + path.sep) || p.startsWith(r + '/') || p === r;
      });
      if (!allowed) {
        throw new Error(`访问路径超出允许范围，请将视频放在用户目录、桌面、文档、下载或项目目录下: ${filePath}`);
      }
      if (!fs.existsSync(normalizedFilePath)) {
        throw new Error(`文件不存在: ${normalizedFilePath}`);
      }
      videoBuffer = await fs.promises.readFile(normalizedFilePath);
      
      // 根据文件扩展名确定 MIME 类型
      const ext = path.extname(normalizedFilePath).toLowerCase();
      if (ext === '.webm') {
        mimeType = 'video/webm';
      } else if (ext === '.mov') {
        mimeType = 'video/quicktime';
      } else if (ext === '.avi') {
        mimeType = 'video/x-msvideo';
      } else if (ext === '.mkv') {
        mimeType = 'video/x-matroska';
      }
      
      console.log('[上传视频到OSS] 从本地文件读取视频，大小:', videoBuffer.length, 'bytes');
    } else if (videoUrl.startsWith('data:video/')) {
      // Base64 数据 URL
      const base64Match = videoUrl.match(/^data:video\/([^;]+);base64,(.+)$/);
      if (!base64Match) {
        throw new Error('无效的 Base64 视频数据 URL');
      }
      const [, videoMimeType, base64Data] = base64Match;
      mimeType = `video/${videoMimeType}`;
      videoBuffer = Buffer.from(base64Data, 'base64');
      console.log('[上传视频到OSS] 从 Base64 数据读取视频，大小:', videoBuffer.length, 'bytes');
    } else if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      // 下载远程视频
      console.log('[上传视频到OSS] 开始下载远程视频:', videoUrl);
      const axios = (await import('axios')).default;
      const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
      videoBuffer = Buffer.from(response.data);
      
      // 尝试从 Content-Type 获取 MIME 类型
      const contentType = response.headers['content-type'];
      if (contentType && contentType.startsWith('video/')) {
        mimeType = contentType;
      }
      
      console.log('[上传视频到OSS] 远程视频下载完成，大小:', videoBuffer.length, 'bytes');
    } else {
      throw new Error(`不支持的视频 URL 格式: ${videoUrl.substring(0, 50)}`);
    }
    
    // 上传到 OSS
    console.log('[上传视频到OSS] 开始上传到 OSS，MIME 类型:', mimeType);
    const ossUrl = await videoProvider.uploadVideoToOSS(videoBuffer, mimeType);
    
    console.log('[上传视频到OSS] 上传成功，OSS URL:', ossUrl);
    return { success: true, url: ossUrl };
  } catch (error: any) {
    console.error('[上传视频到OSS] 上传失败:', error);
    return {
      success: false,
      error: error.message || '上传失败',
    };
  }
});

// 上传角色视频
ipcMain.handle('upload-character-video', async (_, videoUrl: string, timestamp?: string) => {
  const runningHubApiKey = store.get('runningHubApiKey') as string;
  if (!runningHubApiKey) {
    throw new Error('插件算力 API Key 未配置，请在设置中配置插件算力 API KEY');
  }

  // 专门处理 Electron 传过来的各种奇葩路径格式
  function sanitizePath(inputPath: string) {
    let p = inputPath.replace('local-resource://', '');
    // 如果是 /C:/ 这种格式，去掉开头的斜杠
    if (p.startsWith('/') && p.charAt(2) === ':') {
      p = p.substring(1);
    }
    // 转换为当前系统的标准分隔符
    return path.normalize(p);
  }

  try {
    let finalVideoUrl: string;
    
    // 检查 videoUrl 是否是公网 URL
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      // 已经是公网 URL，直接使用
      finalVideoUrl = videoUrl;
      console.log('[角色视频上传] 使用公网 URL:', finalVideoUrl);
    } else {
      // 不是公网 URL，需要上传到 OSS
      console.log('[角色视频上传] 检测到非公网 URL，开始上传到 OSS:', videoUrl);
      
      // 调用 uploadLocalVideoToOSS 上传到 OSS
      const { VideoProvider } = await import('./ai/providers/VideoProvider.js');
      const videoProvider = new VideoProvider();
      
      // 处理路径格式
      let localPath = videoUrl;
      if (videoUrl.startsWith('local-resource://')) {
        localPath = videoUrl.replace(/^local-resource:\/\//, '');
        localPath = decodeURIComponent(localPath);
        if (localPath.match(/^[a-zA-Z]\//)) {
          localPath = localPath[0].toUpperCase() + ':' + localPath.substring(1);
        }
      } else if (videoUrl.startsWith('file://')) {
        localPath = videoUrl.replace(/^file:\/\//, '');
        if (localPath.startsWith('/') && localPath.length > 1 && localPath[2] === ':') {
          localPath = localPath.substring(1);
        }
        localPath = decodeURIComponent(localPath);
      }
      
      // 使用路径漂白函数处理路径
      const sanitizedPath = sanitizePath(localPath);
      
      // 上传到 OSS
      finalVideoUrl = await videoProvider.uploadLocalVideoToOSS(sanitizedPath);
      console.log('[角色视频上传] 上传到 OSS 成功，OSS URL:', finalVideoUrl);
    }

    // 解析时间戳（格式：1,3 -> startTime: "1.3"）
    // 1,3 表示视频的1-3秒中出现的角色，转换为 startTime: "1.3"
    let startTimeStr = '1.3'; // 默认值
    if (timestamp && timestamp.trim()) {
      const parts = timestamp.split(',');
      if (parts.length === 2) {
        const start = parseFloat(parts[0].trim());
        const end = parseFloat(parts[1].trim());
        if (!isNaN(start) && !isNaN(end)) {
          // 将 "1,3" 转换为 "1.3"（开始时间.结束时间）
          startTimeStr = `${start}.${end}`;
        }
      } else {
        // 如果格式不正确，尝试直接使用
        const parsed = parseFloat(timestamp.trim());
        if (!isNaN(parsed)) {
          startTimeStr = parsed.toString();
        }
      }
    }

    // 构建请求体
    const requestBody = {
      videoUrl: finalVideoUrl,
      startTime: startTimeStr,
    };

    console.log('[角色视频上传] 最终提交给API的URL:', finalVideoUrl);
    console.log('[角色视频上传] 请求体:', JSON.stringify(requestBody, null, 2));

    // 提交上传任务
    const submitResponse = await axios.post(
      'https://www.runninghub.cn/openapi/v2/rhart-video-s/sora-upload-character',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${runningHubApiKey}`,
        },
      }
    );

    if (submitResponse.status !== 200) {
      throw new Error(`提交失败: ${submitResponse.status} - ${submitResponse.statusText}`);
    }

    const submitResult = submitResponse.data;
    const taskId = submitResult.taskId;

    if (!taskId) {
      throw new Error('未获取到任务ID');
    }

    // 轮询任务状态
    const queryUrl = 'https://www.runninghub.cn/openapi/v2/query';
    const startTime = Date.now();
    const timeout = 10 * 60 * 1000;

    while (true) {
      if (Date.now() - startTime > timeout) {
        throw new Error('上传超时，请稍后重试');
      }

      try {
        const queryResponse = await axios.post(
          queryUrl,
          { taskId },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${runningHubApiKey}`,
            },
          }
        );

        if (queryResponse.status !== 200) {
          throw new Error(`查询失败: ${queryResponse.status}`);
        }

        const queryResult = queryResponse.data;
        const status = queryResult.status;

        // 添加调试日志
        console.log('[角色视频上传] 查询响应状态:', status);
        console.log('[角色视频上传] 完整响应数据:', JSON.stringify(queryResult, null, 2));

        if (status === 'SUCCESS') {
          // 首先尝试从 results 数组中获取 URL
          if (queryResult.results && queryResult.results.length > 0) {
            const result = queryResult.results[0];
            console.log('[角色视频上传] 结果对象:', JSON.stringify(result, null, 2));
            
            // 尝试多种可能的字段名
            const url = result.url || 
                       result.videoUrl || 
                       result.fileUrl || 
                       result.downloadUrl ||
                       result.video_url ||
                       result.file_url ||
                       result.download_url;
            
            // 提取 roleId（从 result.text 中提取）
            let roleId: string | undefined;
            if (result.text && typeof result.text === 'string') {
              roleId = result.text.trim();
              console.log('[角色视频上传] 提取到 roleId:', roleId);
            } else if (result.roleId) {
              roleId = result.roleId;
              console.log('[角色视频上传] 从 roleId 字段提取:', roleId);
            }
            
            if (url) {
              console.log('[角色视频上传] 找到 URL:', url);
              return { success: true, url, roleId: roleId || undefined };
            }
            
            // 如果 results[0] 中没有 URL，检查是否整个 result 就是一个 URL 字符串
            if (typeof result === 'string' && (result.startsWith('http://') || result.startsWith('https://'))) {
              console.log('[角色视频上传] 结果本身就是 URL:', result);
              return { success: true, url: result, roleId: roleId || undefined };
            }
            
            // 如果只有 roleId 没有 URL，也返回成功（URL 可能是可选的）
            if (roleId) {
              console.log('[角色视频上传] 找到 roleId 但未找到 URL，返回 roleId:', roleId);
              return { success: true, url: '', roleId };
            }
            
            console.error('[角色视频上传] 结果对象中没有找到 URL 或 roleId 字段');
            console.error('[角色视频上传] 结果对象的所有字段:', Object.keys(result));
            throw new Error('上传成功但未获取到 URL 或 roleId');
          } 
          
          // 如果 results 为空，尝试直接从 queryResult 中获取 URL
          const directUrl = queryResult.url || 
                           queryResult.videoUrl || 
                           queryResult.fileUrl || 
                           queryResult.downloadUrl ||
                           queryResult.video_url ||
                           queryResult.file_url ||
                           queryResult.download_url;
          
          // 尝试从 queryResult 中提取 roleId
          let roleId: string | undefined;
          if (queryResult.text && typeof queryResult.text === 'string') {
            roleId = queryResult.text.trim();
            console.log('[角色视频上传] 从 queryResult.text 提取到 roleId:', roleId);
          } else if (queryResult.roleId) {
            roleId = queryResult.roleId;
            console.log('[角色视频上传] 从 queryResult.roleId 提取:', roleId);
          }
          
          if (directUrl) {
            console.log('[角色视频上传] 从 queryResult 直接获取到 URL:', directUrl);
            return { success: true, url: directUrl, roleId: roleId || undefined };
          }
          
          // 如果 queryResult 本身就是一个 URL 字符串
          if (typeof queryResult === 'string' && (queryResult.startsWith('http://') || queryResult.startsWith('https://'))) {
            console.log('[角色视频上传] queryResult 本身就是 URL:', queryResult);
            return { success: true, url: queryResult, roleId: roleId || undefined };
          }
          
          // 如果只有 roleId 没有 URL，也返回成功
          if (roleId) {
            console.log('[角色视频上传] 找到 roleId 但未找到 URL，返回 roleId:', roleId);
            return { success: true, url: '', roleId };
          }
          
          console.error('[角色视频上传] 未找到任何 URL 或 roleId 字段');
          console.error('[角色视频上传] queryResult 的所有字段:', Object.keys(queryResult));
          throw new Error('上传成功但未获取到结果');
        } else if (status === 'FAILED' || status === 'FAILURE') {
          const errorMessage = queryResult.errorMessage || queryResult.error || '上传失败';
          const errorCode = queryResult.errorCode || '';
          throw new Error(errorCode ? `[错误码: ${errorCode}] ${errorMessage}` : errorMessage);
        } else if (status === 'QUEUED' || status === 'RUNNING') {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        } else {
          throw new Error(`未知状态: ${status}`);
        }
      } catch (error: any) {
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message?.includes('socket hang up')) {
          console.log('[角色视频上传] 网络错误，5秒后重试...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        throw error;
      }
    }
  } catch (error: any) {
    console.error('[角色视频上传] 失败:', error);
    throw error;
  }
});

// 上传图片到 runninghub 并获取 view URL（用于 sora-2 图生视频）
ipcMain.handle('upload-image-to-runninghub', async (_, imageUrl: string) => {
  const runningHubApiKey = store.get('runningHubApiKey') as string;
  if (!runningHubApiKey) {
    throw new Error('插件算力 API Key 未配置，请在设置中配置插件算力 API KEY');
  }

  try {
    // 如果已经是 runninghub view URL，直接返回
    if (imageUrl.includes('www.runninghub.cn/view')) {
      return { success: true, url: imageUrl };
    }

    // 修复数据源：准备图片 Buffer
    let imageBuffer: Buffer;
    let mimeType = 'image/png';
    let filename = 'image.png';

    if (imageUrl.startsWith('data:')) {
      // 如果输入是 data:image/...;base64，使用 Buffer.from(base64Data, 'base64') 将其转换为二进制 Buffer
      console.log('[图片上传] 检测到 data URL，转换为 Buffer');
      const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!base64Match) {
        throw new Error('无效的 data URL 格式');
      }
      
      const [, imageType, base64Data] = base64Match;
      mimeType = `image/${imageType}`;
      filename = `image.${imageType === 'jpeg' ? 'jpg' : imageType}`;
      
      // 不要直接把 Base64 字符串作为 URL 发送，转换为 Buffer
      imageBuffer = Buffer.from(base64Data, 'base64');
      console.log('[图片上传] data URL 已转换为 Buffer，大小:', imageBuffer.length, 'bytes');
    } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
      // 本地文件：读取文件
      let filePath: string;
      
      if (imageUrl.startsWith('local-resource://')) {
        filePath = imageUrl.replace(/^local-resource:\/\//, '');
        filePath = decodeURIComponent(filePath);
        
        if (filePath.match(/^[a-zA-Z]\//)) {
          filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        }
      } else {
        filePath = imageUrl.replace(/^file:\/\//, '');
        if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
          filePath = filePath.substring(1);
        }
        filePath = decodeURIComponent(filePath);
      }
      
      const userDataPath = app.getPath('userData');
      const projectsBase = getProjectsBasePath();
      const normalizedFilePath = path.normalize(filePath);
      const normalizedUserData = path.normalize(userDataPath);
      const normalizedProjectsBase = path.normalize(projectsBase);
      const allowed = normalizedFilePath.startsWith(normalizedUserData) || normalizedFilePath.startsWith(normalizedProjectsBase);
      if (!allowed) {
        throw new Error(`访问路径超出允许范围: ${filePath}`);
      }
      if (!fs.existsSync(normalizedFilePath)) {
        throw new Error(`文件不存在: ${normalizedFilePath}`);
      }
      imageBuffer = fs.readFileSync(normalizedFilePath);
      const fileExt = path.extname(normalizedFilePath).toLowerCase();
      if (fileExt === '.jpg' || fileExt === '.jpeg') {
        mimeType = 'image/jpeg';
        filename = 'image.jpg';
      } else if (fileExt === '.png') {
        mimeType = 'image/png';
        filename = 'image.png';
      } else if (fileExt === '.webp') {
        mimeType = 'image/webp';
        filename = 'image.webp';
      }
      console.log('[图片上传] 本地文件已读取，大小:', imageBuffer.length, 'bytes');
    } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      // HTTP/HTTPS URL：下载图片
      console.log('[图片上传] 检测到 HTTP/HTTPS URL，开始下载...');
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      imageBuffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/png';
      mimeType = contentType;
      filename = `image.${contentType.includes('jpeg') ? 'jpg' : contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'png'}`;
      console.log('[图片上传] HTTP 图片已下载，大小:', imageBuffer.length, 'bytes');
    } else {
      throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
    }

    // 完善上传逻辑：使用 FormData 封装图片 Buffer
    const form = new FormData();
    form.append('file', imageBuffer, {
      filename: filename,
      contentType: mimeType,
    });

    // 检查并确保上传的 API 完整路径
    const uploadEndpoint = 'https://www.runninghub.cn/openapi/v2/rhart-video-s/upload-image';
    
    // 必须在 Header 中携带正确的 Rh-Comfy-Auth 和 Rh-Identify
    // 注意：这些参数可能需要从 API Key 或其他来源获取
    // 目前先使用 API Key 作为 Authorization
    const headers: any = {
      ...form.getHeaders(),
      'Authorization': `Bearer ${runningHubApiKey}`,
    };
    
    // TODO: 如果 API 需要 Rh-Comfy-Auth 和 Rh-Identify，需要从 API Key 或其他来源获取
    // 暂时先不添加，等待实际 API 响应确认

    console.log('[图片上传] 开始提交上传任务，使用 FormData，文件大小:', imageBuffer.length, 'bytes');
    
    let submitResponse;
    try {
      submitResponse = await axios.post(uploadEndpoint, form, { headers });
      console.log('[图片上传] 提交响应状态:', submitResponse.status);
      console.log('[图片上传] 提交响应数据:', JSON.stringify(submitResponse.data, null, 2));
    } catch (error: any) {
      // 增加容错：如果接口返回失败，打印出 response.data 的全文
      console.error('[图片上传] 提交请求失败');
      console.error('[图片上传] 错误状态码:', error.response?.status);
      console.error('[图片上传] 错误响应数据全文:', JSON.stringify(error.response?.data || error.message, null, 2));
      console.error('[图片上传] 错误响应 headers:', JSON.stringify(error.response?.headers, null, 2));
      
      if (error.response?.status === 404) {
        throw new Error('图片上传 API 端点不存在（404）。请检查 API 文档确认正确的端点路径。');
      } else if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error('API Key 无效或已过期，请检查插件算力 API Key 配置');
      } else {
        const errorData = error.response?.data || {};
        const errorMsg = errorData.message || errorData.error || errorData.errorMessage || error.message || '未知错误';
        throw new Error(`图片上传失败: ${error.response?.status || error.code || '未知错误'} - ${errorMsg}`);
      }
    }

    if (submitResponse.status !== 200) {
      // 增加容错：打印非 200 响应数据
      console.error('[图片上传] 非 200 状态码，响应数据:', JSON.stringify(submitResponse.data, null, 2));
      throw new Error(`提交失败: ${submitResponse.status} - ${submitResponse.statusText}`);
    }

    const submitResult = submitResponse.data;
    // 增加容错：打印完整的响应数据
    console.log('[图片上传] 完整响应数据（用于调试）:', JSON.stringify(submitResult, null, 2));
    
    // 检查响应格式：可能直接返回 URL，也可能返回 taskId
    if (submitResult.url && (submitResult.url.startsWith('http://') || submitResult.url.startsWith('https://'))) {
      console.log('[图片上传] API 直接返回了 URL:', submitResult.url);
      // 返回格式：确保成功后返回的 JSON 包含 filename
      return { success: true, url: submitResult.url, filename: submitResult.filename };
    }
    
    // 尝试多种可能的字段名获取 taskId
    const taskId = submitResult.taskId || 
                   submitResult.task_id || 
                   submitResult.data?.taskId ||
                   submitResult.data?.task_id ||
                   submitResult.result?.taskId ||
                   submitResult.result?.task_id;

    if (!taskId) {
      // 增加容错：打印完整的响应数据（错误路径）
      console.error('[图片上传] API 响应格式不正确，未找到 taskId');
      console.error('[图片上传] 完整响应数据（错误路径）:', JSON.stringify(submitResult, null, 2));
      console.error('[图片上传] 响应字段列表:', Object.keys(submitResult));
      
      // 检查是否有错误信息
      if (submitResult.error || submitResult.errorMessage || submitResult.message) {
        const errorMsg = submitResult.error || submitResult.errorMessage || submitResult.message;
        throw new Error(`图片上传失败: ${errorMsg}`);
      }
      
      // 如果响应中有其他有用信息，尝试提取
      if (submitResult.code !== undefined && submitResult.code !== 0) {
        throw new Error(`图片上传失败: 错误码 ${submitResult.code}, 消息: ${submitResult.message || submitResult.msg || '未知错误'}`);
      }
      
      throw new Error('未获取到任务ID，API 响应格式可能不正确。响应数据已记录到控制台，请检查 API 文档确认正确的端点。');
    }

    // 轮询任务状态
    const queryUrl = 'https://www.runninghub.cn/openapi/v2/query';
    const startTime = Date.now();
    const timeout = 10 * 60 * 1000; // 10分钟超时

    while (true) {
      if (Date.now() - startTime > timeout) {
        throw new Error('上传超时，请稍后重试');
      }

      try {
        const queryResponse = await axios.post(
          queryUrl,
          { taskId },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${runningHubApiKey}`,
            },
          }
        );

        if (queryResponse.status !== 200) {
          throw new Error(`查询失败: ${queryResponse.status}`);
        }

        const queryResult = queryResponse.data;
        const status = queryResult.status;

        if (status === 'SUCCESS') {
          // 上传成功，返回结果
          if (queryResult.results && queryResult.results.length > 0) {
            const result = queryResult.results[0];
            const resultUrl = result.url;
            
            // 如果返回的 URL 已经是完整的 view URL，直接使用
            if (resultUrl && typeof resultUrl === 'string' && resultUrl.includes('www.runninghub.cn/view')) {
              console.log('[图片上传] 返回完整的 view URL:', resultUrl);
              // 返回格式：确保成功后返回的 JSON 包含 filename
              return { success: true, url: resultUrl, filename: result.filename };
            }
            
            // 返回格式：确保成功后返回的 JSON 包含 filename，以便前端 VideoInputPanel 拼接出正确的 view?filename=... 地址
            const filename = result.filename || resultUrl;
            if (filename) {
              // 尝试从返回结果中提取 Rh-Comfy-Auth 和 Rh-Identify
              let rhComfyAuth: string | undefined;
              let rhIdentify: string | undefined;
              
              // 如果返回的 URL 中包含这些参数，提取它们
              if (typeof resultUrl === 'string' && resultUrl.includes('Rh-Comfy-Auth=')) {
                try {
                  const urlObj = new URL(resultUrl);
                  rhComfyAuth = urlObj.searchParams.get('Rh-Comfy-Auth') || undefined;
                  rhIdentify = urlObj.searchParams.get('Rh-Identify') || undefined;
                } catch (e) {
                  console.warn('[图片上传] 解析返回 URL 参数失败:', e);
                }
              }
              
              // 从响应中获取
              if (!rhComfyAuth) {
                rhComfyAuth = result.rhComfyAuth || result.auth || result['Rh-Comfy-Auth'];
              }
              if (!rhIdentify) {
                rhIdentify = result.rhIdentify || result.identify || result['Rh-Identify'];
              }
              
              // 构建 view URL
              const viewUrl = `https://www.runninghub.cn/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${rhComfyAuth ? `&Rh-Comfy-Auth=${encodeURIComponent(rhComfyAuth)}` : ''}${rhIdentify ? `&Rh-Identify=${encodeURIComponent(rhIdentify)}` : ''}&rand=${Math.random()}`;
              console.log('[图片上传] 构建的 view URL:', viewUrl);
              return { success: true, url: viewUrl, filename: filename };
            }
            throw new Error('上传成功但未获取到 filename 或 URL');
          } else {
            throw new Error('上传成功但未获取到结果');
          }
        } else if (status === 'FAILED' || status === 'FAILURE') {
          // 增加容错：打印失败响应数据
          console.error('[图片上传] 任务失败，完整响应数据:', JSON.stringify(queryResult, null, 2));
          const errorMessage = queryResult.errorMessage || queryResult.error || '上传失败';
          const errorCode = queryResult.errorCode || '';
          throw new Error(errorCode ? `[错误码: ${errorCode}] ${errorMessage}` : errorMessage);
        } else if (status === 'QUEUED' || status === 'RUNNING') {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        } else {
          throw new Error(`未知状态: ${status}`);
        }
      } catch (error: any) {
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message?.includes('socket hang up')) {
          console.log('[图片上传] 网络错误，5秒后重试...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        throw error;
      }
    }
  } catch (error: any) {
    console.error('[图片上传] 失败:', error);
    throw error;
  }
});

// 抠图：先将图片上传到 OSS 得到公网 URL，再调用 matting 工作流；仅有效授权可用
ipcMain.handle('image-matting', async (_, imageUrl: string) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('抠图功能需要有效授权，请先激活');
  }

  const runningHubApiKey = store.get('runningHubApiKey') as string;
  if (!runningHubApiKey) {
    throw new Error('请先在设置中配置插件算力 API Key');
  }

  try {
    const { buffer, mimeType } = await resolveImageToBufferForOSS(imageUrl);
    const videoProvider = new VideoProvider();
    const publicImageUrl = await videoProvider.uploadImageToOSS(buffer, mimeType);
    const result = await runMatting(runningHubApiKey, publicImageUrl);
    if (result.success) {
      return { success: true, imageUrl: result.imageUrl };
    }
    throw new Error(result.message);
  } catch (err: any) {
    console.error('[抠图]', err);
    throw err;
  }
});

/** 将图片地址解析为 Buffer + MIME（抠图/去水印共用） */
function resolveImageToBufferForOSS(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!imageUrl || !imageUrl.trim()) return Promise.reject(new Error('图片地址为空'));
  const url = imageUrl.trim();

  if (url.startsWith('data:image/')) {
    const matches = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches || matches.length < 3) return Promise.reject(new Error('无效的 Base64 图片数据'));
    const mimeType = (matches[1] || 'image/png').trim();
    const buffer = Buffer.from(matches[2], 'base64');
    return Promise.resolve({ buffer, mimeType });
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return axios.get(url, { responseType: 'arraybuffer', timeout: 60000, proxy: false }).then((response) => {
      const buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'];
      const mimeType = (typeof contentType === 'string' && contentType.split(';')[0].trim()) || 'image/png';
      return { buffer, mimeType };
    });
  }

  if (url.startsWith('local-resource://') || url.startsWith('file://')) {
    let filePath = url.startsWith('local-resource://') ? url.replace(/^local-resource:\/\//, '') : url.replace(/^file:\/\//, '');
    filePath = decodeURIComponent(filePath.replace(/\//g, path.sep));
    if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
    if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    const normalized = path.normalize(filePath);
    if (!fs.existsSync(normalized)) return Promise.reject(new Error('本地图片文件不存在'));
    const buffer = fs.readFileSync(normalized);
    const ext = path.extname(normalized).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    return Promise.resolve({ buffer, mimeType });
  }

  return Promise.reject(new Error('不支持的图片格式，请使用网络链接、Base64 或本地路径'));
}

// 去水印：先上传 OSS 得到公网 URL，再调用 AI 应用；仅有效授权可用
ipcMain.handle('image-watermark-removal', async (_, imageUrl: string) => {
  const check = checkLicenseStatus(getUserDataPath());
  if (check.status !== 'VALID') {
    throw new Error('去水印功能需要有效授权，请先激活');
  }

  const runningHubApiKey = store.get('runningHubApiKey') as string;
  if (!runningHubApiKey) {
    throw new Error('请先在设置中配置插件算力 API Key');
  }

  try {
    const { buffer, mimeType } = await resolveImageToBufferForOSS(imageUrl);
    const videoProvider = new VideoProvider();
    const publicImageUrl = await videoProvider.uploadImageToOSS(buffer, mimeType);
    const result = await runWatermarkRemoval(runningHubApiKey, publicImageUrl);
    if (result.success) {
      return { success: true, imageUrl: result.imageUrl };
    }
    throw new Error(result.message);
  } catch (err: any) {
    console.error('[去水印]', err);
    throw err;
  }
});

function toLocalFilePath(url: string | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  let raw: string;
  if (u.startsWith('local-resource://')) {
    raw = u.replace(/^local-resource:\/\/+/, '');
  } else if (u.startsWith('file:///') || u.startsWith('file://')) {
    raw = u.replace(/^file:\/\/+/, '');
  } else {
    return null;
  }
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  // Windows: file:///C:/path → /C:/path，需去掉首位斜杠
  if (raw.match(/^\/[a-zA-Z]:/)) raw = raw.slice(1);
  return raw.replace(/\//g, path.sep);
}

/** 过滤掉失败任务和无法正常显示的任务，并持久化清理后的列表 */
function filterInvalidTasks(tasks: any[]): any[] {
  const STUCK_PROCESSING_MS = 30 * 60 * 1000; // 超过 30 分钟仍在 processing 视为卡住
  const now = Date.now();
  const valid = tasks.filter((t) => {
    const hasOutput = !!(t.imageUrl || t.videoUrl || t.audioUrl || t.localFilePath);
    if (t.status === 'error') return false; // 失败任务
    if (t.status === 'processing') {
      const age = now - (t.createdAt || 0);
      if (age > STUCK_PROCESSING_MS) return false; // 卡住的 processing
    }
    if (t.status === 'success') {
      if (!hasOutput) return false; // 成功但无任何可展示内容
      // 检查本地文件是否存在：若输出指向本地路径但文件已删除，则无法正常显示，移除
      const urls = [t.imageUrl, t.videoUrl, t.audioUrl, t.localFilePath].filter(Boolean) as string[];
      for (const u of urls) {
        const localPath = toLocalFilePath(u);
        if (localPath && !fs.existsSync(localPath)) return false;
      }
    }
    // 无状态且无输出：旧数据或异常记录，无法正常显示
    if ((t.status === undefined || t.status === null) && !hasOutput) return false;
    return true;
  });
  const removed = tasks.length - valid.length;
  if (removed > 0) {
    store.set('tasks', valid);
    console.log(`[任务列表] 已自动清理 ${removed} 个无效任务（失败/卡住/无内容/本地文件已删除）`);
  }
  return valid;
}

// 任务列表管理
ipcMain.handle('save-tasks', (_, tasks: any[]) => {
  try {
    const filtered = filterInvalidTasks(tasks);
    store.set('tasks', filtered);
    return { success: true, tasks: filtered };
  } catch (error: any) {
    console.error('[任务列表] 保存失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-tasks', () => {
  try {
    const tasks = store.get('tasks') || [];
    const filtered = filterInvalidTasks(tasks);
    return { success: true, tasks: filtered };
  } catch (error: any) {
    console.error('[任务列表] 加载失败:', error);
    return { success: false, error: error.message, tasks: [] };
  }
});
