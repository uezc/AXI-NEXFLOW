import React, { useState, useRef, useEffect } from 'react';
import { X, User, Loader2 } from 'lucide-react';

interface CharacterCreatePanelProps {
  isDarkMode: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CharacterCreatePanel: React.FC<CharacterCreatePanelProps> = ({
  isDarkMode,
  onClose,
  onSuccess,
}) => {
  const [nickname, setNickname] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 生成过程中注册的 AI 状态监听器清理函数，卸载时统一移除，避免内存泄漏 */
  const aiListenerCleanupsRef = useRef<Array<(() => void) | void>>([]);

  useEffect(() => {
    return () => {
      aiListenerCleanupsRef.current.forEach((fn) => {
        try {
          if (typeof fn === 'function') fn();
        } catch (_) {}
      });
      aiListenerCleanupsRef.current = [];
    };
  }, []);

  // 生成角色（通过 AI 生成名字和头像）
  const handleGenerate = async () => {
    if (!nickname.trim()) {
      setError('请输入角色昵称');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      if (!window.electronAPI) {
        throw new Error('electronAPI 未就绪');
      }

      let characterName = nickname; // 默认使用昵称
      let characterAvatar = ''; // 默认头像

      // 使用 Promise 来等待 AI 生成结果
      const generateName = new Promise<string>((resolve) => {
        const nodeId = `character-name-${Date.now()}`;
        let nameListener: (() => void) | void;

        // 调用 LLM 生成名字
        window.electronAPI.invokeAI({
          modelId: 'llm',
          nodeId,
          input: {
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'user',
                content: `请为昵称为"${nickname}"的角色生成一个合适的名字。只返回名字，不要其他内容。`,
              },
            ],
          },
        }).catch((err) => {
          console.error('调用 LLM 失败:', err);
          resolve(nickname); // 失败时使用昵称
        });

        // 监听 LLM 结果
        nameListener = window.electronAPI.onAIStatusUpdate?.((packet) => {
          if (packet.nodeId === nodeId && packet.status === 'SUCCESS') {
            const generatedName = packet.payload?.text?.trim() || nickname;
            resolve(generatedName);
            if (nameListener) nameListener();
          }
        });
        if (nameListener) aiListenerCleanupsRef.current.push(nameListener);

        // 超时处理（10秒）
        setTimeout(() => {
          resolve(nickname);
          if (nameListener) nameListener();
        }, 10000);
      });

      // 等待名字生成
      characterName = await generateName;

      // 生成头像
      const generateAvatar = new Promise<string>((resolve) => {
        const nodeId = `character-avatar-${Date.now()}`;
        let avatarListener: (() => void) | void;

        // 调用 Image 生成头像
        window.electronAPI.invokeAI({
          modelId: 'image',
          nodeId,
          input: {
            model: 'dall-e-3',
            prompt: `一个可爱的角色头像，角色名字是"${characterName}"，风格简洁现代，适合作为头像使用`,
            size: '1024x1024',
            quality: 'standard',
            response_format: 'url',
          },
        }).catch((err) => {
          console.error('调用 Image 失败:', err);
          resolve(''); // 失败时使用空头像
        });

        // 监听 Image 结果
        avatarListener = window.electronAPI.onAIStatusUpdate?.((packet) => {
          if (packet.nodeId === nodeId && packet.status === 'SUCCESS') {
            const avatarUrl = packet.payload?.url || packet.payload?.imageUrl || '';
            resolve(avatarUrl);
            if (avatarListener) avatarListener();
          }
        });
        if (avatarListener) aiListenerCleanupsRef.current.push(avatarListener);

        // 超时处理（30秒）
        setTimeout(() => {
          resolve('');
          if (avatarListener) avatarListener();
        }, 30000);
      });

      // 等待头像生成
      characterAvatar = await generateAvatar;

      // 创建角色
      await window.electronAPI.createCharacter(
        nickname,
        characterName,
        characterAvatar
      );

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('生成角色失败:', err);
      setError(err.message || '生成角色失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg shadow-xl apple-panel">
        {/* 头部 */}
        <div className="p-4 border-b flex items-center justify-between border-white/10">
          <h2 className="text-lg font-bold text-white">
            创建角色
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 transition-colors text-white/60 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-4 space-y-4">
          {/* 角色昵称输入 */}
          <div>
            <label className="block text-sm font-medium mb-2 text-white/80">
              角色昵称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="请输入角色昵称"
              disabled={isGenerating}
              className="w-full px-3 py-2 rounded-lg border bg-black/30 text-white border-white/20 placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-apple-blue disabled:opacity-50"
            />
          </div>

          {/* 提示信息 */}
          <div className="text-xs text-white/60">
            <p>系统将自动生成角色的名字和头像</p>
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 text-red-400">
              {error}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={isGenerating}
              className="flex-1 px-4 py-2 rounded-lg transition-all bg-white/10 hover:bg-white/20 text-white disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !nickname.trim()}
              className="flex-1 px-4 py-2 rounded-lg transition-all flex items-center justify-center gap-2 bg-apple-blue hover:bg-apple-blue/80 text-white disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>生成中...</span>
                </>
              ) : (
                <>
                  <User className="w-4 h-4" />
                  <span>生成角色</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterCreatePanel;
