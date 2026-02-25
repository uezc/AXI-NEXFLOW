import React, { useState, useEffect, useRef } from 'react';
import { User, Plus, Trash2, Edit2, Upload, X, Loader2, AlertTriangle, Play, Link, Copy, Check } from 'lucide-react';

interface Character {
  id: string;
  nickname: string;
  name: string;
  avatar: string;
  roleId?: string;
  createdAt: number;
}

interface CharacterStorageProps {
  isDarkMode: boolean;
  onCreateCharacter: () => void;
  onSelectCharacter?: (character: Character) => void;
}

const CharacterStorage: React.FC<CharacterStorageProps> = ({
  isDarkMode,
  onCreateCharacter,
  onSelectCharacter,
}) => {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [nickname, setNickname] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedRoleId, setCopiedRoleId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载角色列表
  const loadCharacters = async () => {
    try {
      if (window.electronAPI) {
        const chars = await window.electronAPI.getCharacters();
        setCharacters(chars);
      }
    } catch (error) {
      console.error('加载角色列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCharacters();
  }, []);

  // 删除角色
  const handleDelete = async (characterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个角色吗？')) {
      return;
    }

    try {
      if (window.electronAPI) {
        await window.electronAPI.deleteCharacter(characterId);
        await loadCharacters();
      }
    } catch (error) {
      console.error('删除角色失败:', error);
      alert('删除角色失败');
    }
  };

  // 复制角色ID
  const handleCopyRoleId = async (roleId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(roleId);
      setCopiedRoleId(roleId);
      setTimeout(() => setCopiedRoleId(null), 2000);
    } catch (error) {
      console.error('复制失败:', error);
      // 降级方案：使用 document.execCommand
      const textArea = document.createElement('textarea');
      textArea.value = roleId;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopiedRoleId(roleId);
        setTimeout(() => setCopiedRoleId(null), 2000);
      } catch (err) {
        console.error('复制失败:', err);
        alert('复制失败，请手动复制');
      }
      document.body.removeChild(textArea);
    }
  };

  // 处理头像上传
  const handleAvatarUpload = async (characterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const input = document.querySelector(`input[data-character-id="${characterId}"]`) as HTMLInputElement;
    input?.click();
  };

  // 处理头像文件选择
  const handleAvatarFileSelect = async (characterId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    // 检查文件大小（限制为 5MB）
    if (file.size > 5 * 1024 * 1024) {
      alert('图片文件大小不能超过 5MB');
      return;
    }

    try {
      // 转换为 data URL
      const reader = new FileReader();
      reader.onload = async (event) => {
        const result = event.target?.result;
        if (typeof result === 'string') {
          // 更新角色头像
          if (window.electronAPI) {
            await window.electronAPI.updateCharacter(characterId, { avatar: result });
            await loadCharacters();
          }
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('上传头像失败:', error);
      alert('上传头像失败');
    }

    // 清空 input，以便可以重复选择同一文件
    if (e.target) {
      e.target.value = '';
    }
  };

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // 检查文件类型
      if (!file.type.startsWith('video/')) {
        setError('请选择视频文件');
        return;
      }
      
      // 检查文件大小（限制为 100MB）
      if (file.size > 100 * 1024 * 1024) {
        setError('视频文件大小不能超过 100MB');
        return;
      }

      // 转换为 data URL 或使用 FileReader
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result === 'string') {
          setVideoUrl(result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // 处理视频上传按钮点击
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // 验证时间戳格式
  const validateTimestamp = (ts: string): boolean => {
    if (!ts.trim()) return true; // 可选字段
    const pattern = /^\d+,\d+$/;
    if (!pattern.test(ts)) return false;
    const [start, end] = ts.split(',').map(Number);
    if (start >= end) return false;
    const diff = end - start;
    if (diff < 1 || diff > 3) return false;
    return true;
  };

  // 创建角色
  const handleCreate = async () => {
    if (!videoUrl.trim()) {
      setError('请输入视频URL或上传视频');
      return;
    }

    if (timestamp.trim() && !validateTimestamp(timestamp)) {
      setError('时间戳格式错误，格式应为：1,3（表示1-3秒，范围差值1-3秒）');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      if (!window.electronAPI) {
        throw new Error('electronAPI 未就绪');
      }

      // 从视频中提取信息（通过AI分析视频）
      // 这里需要调用视频分析API，暂时使用默认值
      let characterName = nickname || '未命名角色';
      let characterAvatar = '';

      // TODO: 调用AI分析视频，提取角色名字和头像
      // 暂时使用昵称作为名字，头像为空
      
      // 创建角色
      await window.electronAPI.createCharacter(
        nickname || characterName,
        characterName,
        characterAvatar
      );

      // 重置表单
      setNickname('');
      setVideoUrl('');
      setTimestamp('');
      setShowCreateForm(false);
      
      // 重新加载角色列表
      await loadCharacters();
    } catch (err: any) {
      console.error('创建角色失败:', err);
      setError(err.message || '创建角色失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className={`flex-1 p-4 flex items-center justify-center ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
        <div className="text-sm">加载中...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶部显示区域 */}
      <div className={`flex-1 p-6 flex flex-col items-center justify-center ${
        isDarkMode ? 'bg-black/20' : 'bg-gray-100/30'
      }`}>
        {characters.length === 0 ? (
          <>
            {/* 默认头像图标 */}
            <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 ${
              isDarkMode ? 'bg-white/10' : 'bg-gray-200/50'
            }`}>
              <User className={`w-12 h-12 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`} />
            </div>
            <p className={`text-sm ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
              点击下方面板创建角色
            </p>
          </>
        ) : (
          <div className="w-full space-y-3 overflow-y-auto">
            {characters.map((character) => (
              <div
                key={character.id}
                onClick={() => onSelectCharacter?.(character)}
                className={`p-3 rounded-lg cursor-pointer transition-all ${
                  isDarkMode
                    ? 'bg-white/5 hover:bg-white/10 border border-white/10'
                    : 'bg-white/50 hover:bg-white/70 border border-gray-300/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* 角色头像 */}
                  <div className="flex-shrink-0">
                    {character.avatar ? (
                      <img
                        src={character.avatar}
                        alt={character.name}
                        className="w-12 h-12 rounded-full object-cover border-2 border-white/20"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.innerHTML = `<div class="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center"><User class="w-6 h-6 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}" /></div>`;
                          }
                        }}
                      />
                    ) : (
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        isDarkMode ? 'bg-white/10' : 'bg-gray-200/50'
                      }`}>
                        <User className={`w-6 h-6 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`} />
                      </div>
                    )}
                  </div>
                  
                  {/* 角色信息 */}
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium text-sm truncate ${
                      isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>
                      {character.nickname || character.name || '未命名角色'}
                    </div>
                    {character.roleId && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`text-xs truncate font-mono ${
                          isDarkMode ? 'text-white/50' : 'text-gray-500'
                        }`}>
                          ID: {character.roleId}
                        </span>
                        <button
                          onClick={(e) => handleCopyRoleId(character.roleId!, e)}
                          className={`p-0.5 rounded hover:bg-white/10 transition-colors flex-shrink-0 ${
                            isDarkMode ? 'text-white/40 hover:text-white/80' : 'text-gray-400 hover:text-gray-700'
                          }`}
                          title="复制角色ID"
                        >
                          {copiedRoleId === character.roleId ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    )}
                    {!character.roleId && (
                      <div className={`text-xs mt-0.5 ${
                        isDarkMode ? 'text-white/40' : 'text-gray-400'
                      }`}>
                        未设置角色ID
                      </div>
                    )}
                  </div>
                  
                  {/* 操作按钮 */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    <button
                      onClick={(e) => handleAvatarUpload(character.id, e)}
                      className={`p-1.5 rounded hover:bg-white/10 transition-colors ${
                        isDarkMode ? 'text-white/60 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                      }`}
                      title="上传头像"
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(character.id, e)}
                      className={`p-1.5 rounded hover:bg-white/10 transition-colors ${
                        isDarkMode ? 'text-white/60 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                      }`}
                      title="删除角色"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* 隐藏的头像上传 input（每个角色一个） */}
      {characters.map((character) => (
        <input
          key={`avatar-${character.id}`}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => handleAvatarFileSelect(character.id, e)}
          data-character-id={character.id}
        />
      ))}
      
      {/* 创建角色表单 - 始终显示在底部 */}
      <div className={`p-4 border-t flex-shrink-0 ${
        isDarkMode ? 'border-white/10 bg-black/30' : 'border-gray-300/30 bg-white/50'
      }`}>
        {!showCreateForm ? (
          <button
            onClick={() => setShowCreateForm(true)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all ${
              isDarkMode
                ? 'bg-apple-blue hover:bg-apple-blue/80 text-white border border-apple-blue'
                : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">创建角色</span>
          </button>
        ) : (
          <div className="space-y-3">
            {/* 视频URL */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${
                isDarkMode ? 'text-white/80' : 'text-gray-700'
              }`}>
                视频URL
              </label>
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="输入视频URL或连接视频模块"
                disabled={isGenerating}
                className={`w-full px-3 py-2 rounded-lg text-sm border ${
                  isDarkMode
                    ? 'bg-black/30 text-white border-white/20 placeholder-white/40'
                    : 'bg-white/90 text-gray-900 border-gray-300 placeholder-gray-500'
                } focus:outline-none focus:ring-2 focus:ring-apple-blue disabled:opacity-50`}
              />
            </div>

            {/* 角色名（可选） */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${
                isDarkMode ? 'text-white/80' : 'text-gray-700'
              }`}>
                角色名
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="输入备注角色名(可选)"
                disabled={isGenerating}
                className={`w-full px-3 py-2 rounded-lg text-sm border ${
                  isDarkMode
                    ? 'bg-black/30 text-white border-white/20 placeholder-white/40'
                    : 'bg-white/90 text-gray-900 border-gray-300 placeholder-gray-500'
                } focus:outline-none focus:ring-2 focus:ring-apple-blue disabled:opacity-50`}
              />
            </div>

            {/* 时间戳(秒) */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${
                isDarkMode ? 'text-white/80' : 'text-gray-700'
              }`}>
                时间戳(秒)
              </label>
              <input
                type="text"
                value={timestamp}
                onChange={(e) => setTimestamp(e.target.value)}
                placeholder="格式: 1,3 (表示1-3秒,范围差值1-3秒)"
                disabled={isGenerating}
                className={`w-full px-3 py-2 rounded-lg text-sm border ${
                  isDarkMode
                    ? 'bg-black/30 text-white border-white/20 placeholder-white/40'
                    : 'bg-white/90 text-gray-900 border-gray-300 placeholder-gray-500'
                } focus:outline-none focus:ring-2 focus:ring-apple-blue disabled:opacity-50`}
              />
              <p className={`text-xs mt-1 ${
                isDarkMode ? 'text-white/50' : 'text-gray-500'
              }`}>
                例如: 1,3 表示视频的1-3秒中出现的角色,范围差值最大3秒最小1秒
              </p>
            </div>

            {/* 错误信息 */}
            {error && (
              <div className={`p-2 rounded-lg text-xs ${
                isDarkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700'
              }`}>
                {error}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setNickname('');
                  setVideoUrl('');
                  setTimestamp('');
                  setError(null);
                }}
                disabled={isGenerating}
                className={`flex-1 px-3 py-2 rounded-lg text-sm transition-all ${
                  isDarkMode
                    ? 'bg-white/10 hover:bg-white/20 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                } disabled:opacity-50`}
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={isGenerating || !videoUrl.trim()}
                className={`flex-1 px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-center gap-2 ${
                  isDarkMode
                    ? 'bg-apple-blue hover:bg-apple-blue/80 text-white border border-apple-blue'
                    : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600'
                } disabled:opacity-50`}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>创建中...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>创建角色</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CharacterStorage;
