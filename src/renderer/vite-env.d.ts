/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    // 激活码管理（双重时限版：NXF-SERIAL-ENCODED_GEN-DAYS-SIGN）
    validateActivation: (activationCode: string) => Promise<{ valid: boolean; message?: string; expireAt?: number; errorCode?: 'ERR_CODE_EXPIRED' | 'ERR_TIME_ROLLBACK'; level?: 'PRO' }>;
    checkActivation: () => Promise<{ activated: boolean; status?: string; activationCode: string; expireAt?: number; message?: string; level?: 'PRO' }>;
    getLicenseInfo: () => Promise<{ level: 'PRO' | null }>;
    generateActivationCode: (days: number) => Promise<{ code: string }>;

    // API Key 管理
    saveBLTCYApiKey: (apiKey: string) => Promise<{ success: boolean }>;
    saveRHApiKey: (apiKey: string) => Promise<{ success: boolean }>;
    getBLTCYApiKey: () => Promise<string>;
    getRHApiKey: () => Promise<string>;

    // 余额查询（支持强制刷新参数）
    queryBLTCYBalance: (force?: boolean) => Promise<number | null>;
    queryRHBalance: (force?: boolean) => Promise<number | null>;
    queryAllBalances: (force?: boolean) => Promise<{ bltcy: number | null; rh: number | null }>;
    
    // 监听余额更新
    onBalanceUpdated: (callback: (data: { type: 'bltcy' | 'rh'; balance: number | null }) => void) => void;
    removeBalanceUpdatedListener: () => void;

    // 项目管理
    getProjects: () => Promise<Array<{ id: string; name: string; date: string; createdAt: number; lastModified: number }>>;
    createProject: (name: string) => Promise<{ id: string; name: string; date: string; createdAt: number; lastModified: number }>;
    updateProject: (projectId: string, name: string) => Promise<{ id: string; name: string; date: string; createdAt: number; lastModified: number }>;
    deleteProject: (projectId: string) => Promise<{ success: boolean }>;

    // 项目数据（节点和边）
    saveProjectData: (projectId: string, nodes: any[], edges: any[]) => Promise<{ success: boolean }>;
    loadProjectData: (projectId: string) => Promise<{ nodes: any[]; edges: any[]; lastModified: number }>;
    copyFileToProjectAssets: (projectId: string | undefined, sourceFilePath: string) => Promise<{ savedPath: string }>;
    saveDroppedFileBufferToProjectAssets: (projectId: string | undefined, fileName: string, buffer: ArrayBuffer) => Promise<{ savedPath: string }>;

    // 项目导入导出
    exportProject: (projectId: string, cardBgDataUrl?: string) => Promise<{ success: boolean; canceled?: boolean; filePath?: string }>;
    importProject: () => Promise<{ success: boolean; canceled?: boolean; project?: { id: string; name: string; date: string; createdAt: number; lastModified: number }; cardBackground?: string }>;

    // AI 调用
    invokeAI: (params: { modelId: string; nodeId: string; input: any }) => Promise<void>;
    
    // AI 状态更新监听（返回清理函数）
    onAIStatusUpdate: (callback: (packet: { nodeId: string; status: 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR'; payload?: { text?: string; url?: string; progress?: number; error?: string } }) => void) => (() => void) | void;
    
    // 移除 AI 状态更新监听（保留以兼容旧代码）
    removeAIStatusUpdateListener: () => void;

    // 窗口操作
    resizeWindow: (width: number, height: number) => Promise<{ success: boolean }>;
    quitApp: () => Promise<{ success: boolean }>;
    toggleFullscreen: () => Promise<{ success: boolean; isFullScreen: boolean }>;

    // 全局 LLM 人设管理
    getGlobalLLMPersonas: () => Promise<Array<{ id: string; name: string; content: string }>>;
    saveGlobalLLMPersona: (persona: { id: string; name: string; content: string }) => Promise<{ success: boolean }>;
    updateGlobalLLMPersonas: (personas: Array<{ id: string; name: string; content: string }>) => Promise<{ success: boolean }>;
    deleteGlobalLLMPersona: (personaId: string) => Promise<{ success: boolean }>;

    // 选择自定义保存路径
    selectSavePath: () => Promise<{ success: boolean; path?: string; error?: string }>;
    
    // 自动保存图片（生成完成后自动调用）
    autoSaveImage: (imageUrl: string, nodeTitle: string, projectId?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    
    // 自动保存视频（生成完成后自动调用）
    autoSaveVideo: (videoUrl: string, nodeTitle: string, projectId?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 自动保存音频（生成完成后自动调用，preferredFileName 如歌曲名用作保存文件名）
    autoSaveAudio: (audioUrl: string, preferredFileName: string, projectId?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 下载图片（手动选择保存位置）
    downloadImage: (imageUrl: string, nodeTitle: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    
    // 下载视频（手动选择保存位置）
    downloadVideo: (videoUrl: string, nodeTitle: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    
    // 打开文件
    openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    
    // 选择参考音文件（Index-TTS2.0 等）
    showOpenAudioDialog: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 选择视频文件（与 AudioNode 一致的 IPC 方案）
    showOpenVideoDialog: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
    // 在文件管理器中显示文件（打开文件所在的文件夹并选中文件）
    showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    
    // 获取用户数据路径
    getUserDataPath: () => Promise<string>;
    
    // 打开路径（文件夹或文件）
    openPath: (pathToOpen: string) => Promise<{ success: boolean; error?: string }>;

    // 项目存储根路径（自定义保存位置）
    getProjectBasePath: () => Promise<string>;
    setProjectBasePath: () => Promise<{ success: boolean; path: string }>;

    // 角色管理
    getCharacters: () => Promise<Array<{ id: string; nickname: string; name: string; avatar: string; roleId?: string; createdAt: number; localAvatarPath?: string }>>;
    uploadCharacterVideo: (videoUrl: string, timestamp?: string) => Promise<{ success: boolean; url: string; roleId?: string }>;
    createCharacter: (nickname: string, name: string, avatar: string, roleId?: string) => Promise<{ id: string; nickname: string; name: string; avatar: string; roleId?: string; createdAt: number; localAvatarPath?: string }>;
    updateCharacter: (characterId: string, updates: { nickname?: string; name?: string; avatar?: string; roleId?: string }) => Promise<{ id: string; nickname: string; name: string; avatar: string; roleId?: string; createdAt: number; localAvatarPath?: string }>;
    deleteCharacter: (characterId: string) => Promise<{ success: boolean }>;
    clearInvalidAvatarUrl: (characterId: string, invalidUrl: string) => Promise<{ success: boolean; message?: string }>;

    // 上传图片到 runninghub（用于 sora-2 图生视频）
    uploadImageToRunningHub: (imageUrl: string) => Promise<{ success: boolean; url: string }>;
    imageMatting: (imageUrl: string) => Promise<{ success: boolean; imageUrl: string }>;
    imageWatermarkRemoval: (imageUrl: string) => Promise<{ success: boolean; imageUrl: string }>;

    // 上传视频到 OSS
    uploadVideoToOSS: (videoUrl: string) => Promise<{ success: boolean; url?: string; error?: string }>;
    
    // 上传本地视频到 OSS（用于角色创建模块）
    uploadLocalVideoToOSS: (localVideoPath: string) => Promise<{ success: boolean; url?: string; error?: string }>;
    // 上传本地音频到 OSS（声音模块连接时，参考音上传后回传 URL）
    uploadLocalAudioToOSS: (localAudioPath: string) => Promise<{ success: boolean; url?: string; error?: string }>;

    // 上传图片到 OSS（接收 base64 图片数据）
    uploadImageToOSS: (imageData: string) => Promise<{ success: boolean; url?: string; error?: string }>;

    // 任务列表管理
    saveTasks: (tasks: any[]) => Promise<{ success: boolean; tasks?: any[]; error?: string }>;
    loadTasks: () => Promise<{ success: boolean; tasks?: any[]; error?: string }>;

    // 检查文件是否存在（用于播放器预检查）
    checkFileExists: (filePath: string) => Promise<{ exists: boolean; path?: string; size?: number; readable?: boolean; error?: string }>;
    
    // 项目路径映射
    ensureProjectMapping: (projectId: string) => Promise<string | null>;
    getProjectMappedPath: (projectId: string) => Promise<string | null>;
    getProjectOriginalPath: (projectId: string) => Promise<string | null>;
  };
}
