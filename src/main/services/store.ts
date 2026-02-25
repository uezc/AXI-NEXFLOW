import Store from 'electron-store';

/**
 * 使用 electron-store 进行本地数据存储
 * 确保 Key 和激活码等敏感信息安全存储
 */
export const store = new Store({
  name: 'nexflow-config',
  defaults: {
    // 激活状态（已废弃直接读写；以 license_info_encrypted 解密后验签为准）
    activated: false,
    activationCode: '',
    // 加密后的授权信息（防止篡改；每次启动重新验签）
    license_info_encrypted: '',
    // 激活时的机器 ID（审计预留，当前不强制绑定）
    machine_id: '',
    // BLTCY API Key
    bltcyApiKey: '',
    // RunningHub API Key
    runningHubApiKey: '',
    // 项目列表
    projects: [] as Array<{
      id: string;
      name: string;
      date: string;
      createdAt: number;
      lastModified: number;
    }>,
    // 全局 LLM 人设列表（所有 LLM 节点共享）
    globalLLMPersonas: [] as Array<{
      id: string;
      name: string;
      content: string;
    }>,
    // 角色列表
    characters: [] as Array<{
      id: string;
      nickname: string; // 角色昵称
      name: string; // 角色名字（由 AI 生成）
      avatar: string; // 角色头像 URL（由 AI 生成）
      createdAt: number; // 创建时间戳
    }>,
    // 阿里云 OSS 配置（可选，优先使用环境变量）
    ossAccessKeyId: '',
    ossAccessKeySecret: '',
    ossRegion: 'oss-cn-hongkong',
    ossBucket: 'nexflow-temp-images',
    // 任务列表
    tasks: [] as Array<{
      id: string;
      nodeId: string;
      nodeTitle: string;
      imageUrl?: string;
      videoUrl?: string;
      audioUrl?: string;
      prompt: string;
      createdAt: number;
      status?: 'success' | 'error' | 'processing';
      errorMessage?: string;
      taskType?: 'image' | 'video' | 'text' | 'audio';
      localFilePath?: string;
    }>,
    // 项目存储根路径（空则使用安装目录下的 projects）
    customProjectPath: '' as string,
    // 其他配置项
  },
});
