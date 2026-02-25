import { contextBridge, ipcRenderer } from 'electron';

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 激活码管理
  validateActivation: (activationCode: string) => ipcRenderer.invoke('validate-activation', activationCode),
  checkActivation: () => ipcRenderer.invoke('check-activation'),
  getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),
  generateActivationCode: (days: number) => ipcRenderer.invoke('generate-activation-code', days),

  // API Key 管理
  saveBLTCYApiKey: (apiKey: string) => ipcRenderer.invoke('save-bltcy-api-key', apiKey),
  saveRHApiKey: (apiKey: string) => ipcRenderer.invoke('save-rh-api-key', apiKey),
  getBLTCYApiKey: () => ipcRenderer.invoke('get-bltcy-api-key'),
  getRHApiKey: () => ipcRenderer.invoke('get-rh-api-key'),

  // 余额查询（支持强制刷新参数）
  queryBLTCYBalance: (force?: boolean) => ipcRenderer.invoke('query-bltcy-balance', force),
  queryRHBalance: (force?: boolean) => ipcRenderer.invoke('query-rh-balance', force),
  queryAllBalances: (force?: boolean) => ipcRenderer.invoke('query-all-balances', force),

  // 监听余额更新
  onBalanceUpdated: (callback: (data: { type: 'bltcy' | 'rh'; balance: number | null }) => void) => {
    ipcRenderer.on('balance-updated', (_, data) => callback(data));
  },

  // 移除监听器
  removeBalanceUpdatedListener: () => {
    ipcRenderer.removeAllListeners('balance-updated');
  },

  // 项目管理
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (name: string) => ipcRenderer.invoke('create-project', name),
  updateProject: (projectId: string, name: string) => ipcRenderer.invoke('update-project', projectId, name),
  deleteProject: (projectId: string) => ipcRenderer.invoke('delete-project', projectId),

  // 项目数据（节点和边）
  saveProjectData: (projectId: string, nodes: any[], edges: any[]) => ipcRenderer.invoke('save-project-data', projectId, nodes, edges),
  loadProjectData: (projectId: string) => ipcRenderer.invoke('load-project-data', projectId),
  copyFileToProjectAssets: (projectId: string | undefined, sourceFilePath: string) => ipcRenderer.invoke('copy-file-to-project-assets', projectId, sourceFilePath),
  saveDroppedFileBufferToProjectAssets: (projectId: string | undefined, fileName: string, buffer: ArrayBuffer) => ipcRenderer.invoke('save-dropped-file-buffer-to-project-assets', projectId, fileName, buffer),

  // 项目导入导出
  exportProject: (projectId: string, cardBgDataUrl?: string) => ipcRenderer.invoke('export-project', projectId, cardBgDataUrl),
  importProject: () => ipcRenderer.invoke('import-project'),

  // AI 调用
  invokeAI: (params: { modelId: string; nodeId: string; input: any }) => ipcRenderer.invoke('ai:invoke', params),
  
  // AI 状态更新监听（支持多个监听器，每个组件独立管理）
  onAIStatusUpdate: (callback: (packet: { nodeId: string; status: string; payload?: any }) => void) => {
    const handler = (_: any, packet: { nodeId: string; status: string; payload?: any }) => {
      // 调试日志：记录所有收到的状态更新，包括 payload 详情
      const hasPayload = !!packet.payload;
      const hasText = !!(packet.payload as any)?.text;
      const hasLocalPath = !!(packet.payload as any)?.localPath;
      const textLength = (packet.payload as any)?.text?.length || 0;
      const localPath = (packet.payload as any)?.localPath || 'none';
      console.log(`[preload] 收到状态更新: nodeId=${packet.nodeId}, status=${packet.status}, hasPayload=${hasPayload}, hasText=${hasText}, textLength=${textLength}, hasLocalPath=${hasLocalPath}, localPath=${localPath}`);
      
      // 如果 payload 存在，记录所有 keys
      if (packet.payload) {
        const payloadKeys = Object.keys(packet.payload);
        console.log(`[preload] payload keys: ${payloadKeys.join(', ')}`);
        
        // 特别检查 text 和 localPath
        if (packet.status === 'SUCCESS') {
          console.log(`[preload] SUCCESS 状态详情:`, {
            nodeId: packet.nodeId,
            hasText: hasText,
            textLength: textLength,
            hasLocalPath: hasLocalPath,
            localPath: localPath,
            payloadKeys: payloadKeys,
          });
        }
      }
      
      callback(packet);
    };
    ipcRenderer.on('ai:status-update', handler);
    console.log(`[preload] 注册新的 AI 状态更新监听器，当前监听器数量: ${ipcRenderer.listenerCount('ai:status-update')}`);
    // 返回清理函数，允许移除单个监听器
    return () => {
      ipcRenderer.removeListener('ai:status-update', handler);
      console.log(`[preload] 移除 AI 状态更新监听器，剩余监听器数量: ${ipcRenderer.listenerCount('ai:status-update')}`);
    };
  },
  
  // 移除 AI 状态更新监听（保留以兼容旧代码，但建议使用 onAIStatusUpdate 返回的清理函数）
  removeAIStatusUpdateListener: () => {
    ipcRenderer.removeAllListeners('ai:status-update');
  },

  // 窗口操作
  resizeWindow: (width: number, height: number) => ipcRenderer.invoke('resize-window', width, height),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),

  // 全局 LLM 人设管理
  getGlobalLLMPersonas: () => ipcRenderer.invoke('get-global-llm-personas'),
  saveGlobalLLMPersona: (persona: { id: string; name: string; content: string }) => ipcRenderer.invoke('save-global-llm-persona', persona),
  updateGlobalLLMPersonas: (personas: Array<{ id: string; name: string; content: string }>) => ipcRenderer.invoke('update-global-llm-personas', personas),
  deleteGlobalLLMPersona: (personaId: string) => ipcRenderer.invoke('delete-global-llm-persona', personaId),

  // 选择自定义保存路径
  selectSavePath: () => ipcRenderer.invoke('select-save-path'),
  
  // 自动保存图片（生成完成后自动调用）
  autoSaveImage: (imageUrl: string, nodeTitle: string, projectId?: string) => ipcRenderer.invoke('auto-save-image', imageUrl, nodeTitle, projectId),
  
  // 自动保存视频（生成完成后自动调用）
  autoSaveVideo: (videoUrl: string, nodeTitle: string, projectId?: string) => ipcRenderer.invoke('auto-save-video', videoUrl, nodeTitle, projectId),
  // 自动保存音频（生成完成后自动调用，preferredFileName 如歌曲名用于保存文件名）
  autoSaveAudio: (audioUrl: string, preferredFileName: string, projectId?: string) => ipcRenderer.invoke('auto-save-audio', audioUrl, preferredFileName, projectId),
  // 下载图片（手动选择保存位置）
  downloadImage: (imageUrl: string, nodeTitle: string) => ipcRenderer.invoke('download-image', imageUrl, nodeTitle),
  
  // 下载视频（手动选择保存位置）
  downloadVideo: (videoUrl: string, nodeTitle: string) => ipcRenderer.invoke('download-video', videoUrl, nodeTitle),
  
  // 打开文件
  openFile: (filePath: string) => ipcRenderer.invoke('open-file', filePath),
  
  // 选择参考音文件（Index-TTS2.0 等）
  showOpenAudioDialog: () => ipcRenderer.invoke('show-open-audio-dialog'),
  // 选择视频文件（与 AudioNode 一致的 IPC 方案）
  showOpenVideoDialog: () => ipcRenderer.invoke('show-open-video-dialog'),
  // 在文件管理器中显示文件（打开文件所在的文件夹并选中文件）
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),
  
  // 获取用户数据路径
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  
  // 打开路径（文件夹或文件）
  openPath: (pathToOpen: string) => ipcRenderer.invoke('open-path', pathToOpen),

  // 角色管理
  getCharacters: () => ipcRenderer.invoke('get-characters'),
  uploadCharacterVideo: (videoUrl: string, timestamp?: string) => ipcRenderer.invoke('upload-character-video', videoUrl, timestamp),
  createCharacter: (nickname: string, name: string, avatar: string, roleId?: string) => ipcRenderer.invoke('create-character', nickname, name, avatar, roleId),
  updateCharacter: (characterId: string, updates: { nickname?: string; name?: string; avatar?: string; roleId?: string }) => ipcRenderer.invoke('update-character', characterId, updates),
  deleteCharacter: (characterId: string) => ipcRenderer.invoke('delete-character', characterId),
  clearInvalidAvatarUrl: (characterId: string, invalidUrl: string) => ipcRenderer.invoke('clear-invalid-avatar-url', characterId, invalidUrl),

  // 上传视频到 OSS
  uploadVideoToOSS: (videoUrl: string) => ipcRenderer.invoke('upload-video-to-oss', videoUrl),
  
  // 上传本地视频到 OSS（用于角色创建模块）
  uploadLocalVideoToOSS: (localVideoPath: string) => ipcRenderer.invoke('upload-local-video-to-oss', localVideoPath),
  // 上传本地音频到 OSS（用于声音模块连接时，参考音上传后回传 URL）
  uploadLocalAudioToOSS: (localAudioPath: string) => ipcRenderer.invoke('upload-local-audio-to-oss', localAudioPath),

  // 上传图片到 runninghub（用于 sora-2 图生视频）
  uploadImageToRunningHub: (imageUrl: string) => ipcRenderer.invoke('upload-image-to-runninghub', imageUrl),
  imageMatting: (imageUrl: string) => ipcRenderer.invoke('image-matting', imageUrl),
  imageWatermarkRemoval: (imageUrl: string) => ipcRenderer.invoke('image-watermark-removal', imageUrl),
  
  // 上传图片到 OSS（接收 base64 图片数据）
  uploadImageToOSS: (imageData: string) => ipcRenderer.invoke('upload-image-to-oss', imageData),

  // 任务列表管理
  saveTasks: (tasks: any[]) => ipcRenderer.invoke('save-tasks', tasks),
  loadTasks: () => ipcRenderer.invoke('load-tasks'),

  // 检查文件是否存在（用于播放器预检查）
  checkFileExists: (filePath: string) => ipcRenderer.invoke('check-file-exists', filePath),
  
  // 项目路径（统一为 projects/[项目名]，支持自定义根目录）
  ensureProjectMapping: (projectId: string) => ipcRenderer.invoke('ensure-project-mapping', projectId),
  getProjectMappedPath: (projectId: string) => ipcRenderer.invoke('get-project-mapped-path', projectId),
  getProjectOriginalPath: (projectId: string) => ipcRenderer.invoke('get-project-original-path', projectId),
  getProjectBasePath: () => ipcRenderer.invoke('get-project-base-path'),
  setProjectBasePath: () => ipcRenderer.invoke('set-project-base-path') as Promise<{ success: boolean; path: string }>,

  // 片头视频（splash-videos 文件夹）
  getSplashVideos: () => ipcRenderer.invoke('get-splash-videos') as Promise<{ folderPath: string; urls: string[]; logoUrl: string | null; musicUrl: string | null }>,
  openSplashFolder: () => ipcRenderer.invoke('open-splash-folder'),
});
