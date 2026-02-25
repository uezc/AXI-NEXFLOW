import React, { useState, useEffect, useCallback } from 'react';
import { User, Copy, Check, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

interface Character {
  id: string;
  nickname: string;
  name: string;
  avatar: string;
  roleId?: string;
  createdAt: number;
  localAvatarPath?: string; // 本地头像路径
}

interface CharacterListProps {
  isDarkMode: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelectCharacter?: (character: Character) => void;
  refreshTrigger?: number; // 外部触发刷新的计数器
}

const CharacterList: React.FC<CharacterListProps> = ({
  isDarkMode,
  isCollapsed,
  onToggleCollapse,
  onSelectCharacter,
  refreshTrigger,
}) => {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedRoleId, setCopiedRoleId] = useState<string | null>(null);

  // 加载角色列表
  const loadCharacters = useCallback(async () => {
    try {
      if (window.electronAPI) {
        const chars = await window.electronAPI.getCharacters();
        // 按创建时间倒序排序（最新的在前）
        const sortedChars = chars.sort((a, b) => b.createdAt - a.createdAt);
        setCharacters(sortedChars);
      }
    } catch (error) {
      console.error('加载角色列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters, refreshTrigger]); // 当 refreshTrigger 变化时也刷新

  // 定期刷新（作为备用机制）
  useEffect(() => {
    const interval = setInterval(() => {
      loadCharacters();
    }, 5000); // 每5秒刷新一次（降低频率，避免过度请求）
    
    return () => clearInterval(interval);
  }, [loadCharacters]);

  // 复制角色ID
  const handleCopyRoleId = useCallback(async (roleId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const roleIdText = `@${roleId}`;
    try {
      await navigator.clipboard.writeText(roleIdText);
      setCopiedRoleId(roleId);
      setTimeout(() => setCopiedRoleId(null), 2000);
    } catch (error) {
      console.error('复制失败:', error);
      // 降级方案
      const textArea = document.createElement('textarea');
      textArea.value = roleIdText;
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
  }, []);

  // 删除角色
  const handleDelete = useCallback(async (characterId: string, e: React.MouseEvent) => {
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
  }, [loadCharacters]);

  // 点击角色卡片
  const handleCharacterClick = useCallback((character: Character) => {
    if (onSelectCharacter) {
      onSelectCharacter(character);
    }
  }, [onSelectCharacter]);

  if (loading) {
    return (
      <div className={`h-full flex items-center justify-center ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
        <div className="text-sm">加载中...</div>
      </div>
    );
  }

  // 收起状态：只显示图标
  if (isCollapsed) {
    return (
      <div className={`h-full w-12 flex flex-col items-center py-4 border-r ${
        isDarkMode ? 'apple-panel border-white/10' : 'apple-panel-light border-gray-300/30'
      }`}>
        <button
          onClick={onToggleCollapse}
          className={`p-2 rounded hover:bg-white/10 transition-colors ${
            isDarkMode ? 'text-white/60 hover:text-white' : 'text-gray-600 hover:text-gray-900'
          }`}
          title="展开角色列表"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        <div className="flex-1 flex items-center justify-center mt-4">
          <User className={`w-6 h-6 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`} />
        </div>
        <div className={`text-xs mt-2 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
          {characters.length}
        </div>
      </div>
    );
  }

  // 展开状态：显示完整列表
  return (
    <div className={`h-full w-[280px] flex flex-col border-r ${
      isDarkMode ? 'apple-panel border-white/10' : 'apple-panel-light border-gray-300/30'
    }`}>
      {/* 头部 */}
      <div className={`p-4 border-b flex items-center justify-between flex-shrink-0 ${
        isDarkMode ? 'border-white/10' : 'border-gray-300/30'
      }`}>
        <h3 className={`text-sm font-bold ${
          isDarkMode ? 'text-white' : 'text-gray-900'
        }`}>
          角色列表
        </h3>
        <button
          onClick={onToggleCollapse}
          className={`p-1.5 rounded hover:bg-white/10 transition-colors ${
            isDarkMode ? 'text-white/60 hover:text-white' : 'text-gray-600 hover:text-gray-900'
          }`}
          title="收起角色列表"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* 角色列表 */}
      <div className="flex-1 overflow-y-auto p-3">
        {characters.length === 0 ? (
          <div className={`text-sm text-center py-8 ${
            isDarkMode ? 'text-white/60' : 'text-gray-600'
          }`}>
            暂无角色
          </div>
        ) : (
          <div className="space-y-2">
            {characters.map((character) => {
              // 空值保护：确保 character 存在且有效
              if (!character || !character.id) {
                return null;
              }
              
              return (
              <div
                key={character.id}
                onClick={() => handleCharacterClick(character)}
                className={`group relative flex items-center p-3 rounded-lg cursor-pointer transition-all ${
                  isDarkMode
                    ? 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-blue-500'
                    : 'bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-blue-400'
                }`}
              >
                {/* 角色头像 */}
                <div className="flex-shrink-0">
                  {character?.avatar ? (
                    <img
                      src={
                        // 优先使用本地路径（local-resource:// 或 localAvatarPath）
                        character.localAvatarPath
                          ? `local-resource://${character.localAvatarPath.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (match) => match.substring(1))}`
                          : character.avatar.startsWith('local-resource://')
                          ? character.avatar
                          : character.avatar
                      }
                      alt={character?.nickname || character?.name || '角色'}
                      className="w-12 h-12 rounded-full object-cover border-2 border-zinc-600"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        const src = target.src;
                        
                        // 立即显示占位符，不再重试
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                          // 显示首字母圆圈或默认图标
                          const displayName = character?.nickname || character?.name || '?';
                          const firstLetter = displayName.charAt(0).toUpperCase();
                          
                          parent.innerHTML = `<div class="w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-600 ${
                            isDarkMode ? 'bg-blue-500/20' : 'bg-blue-100'
                          }"><span class="text-sm font-bold ${
                            isDarkMode ? 'text-blue-300' : 'text-blue-700'
                          }">${firstLetter}</span></div>`;
                        }
                        
                        // 通知主进程清理无效的 avatarUrl（仅在远程 URL 失败时）
                        if (src && !src.startsWith('local-resource://') && !src.startsWith('data:')) {
                          console.log(`[CharacterList] 头像加载失败，通知主进程清理无效 URL:`, src);
                          if (window.electronAPI?.clearInvalidAvatarUrl) {
                            window.electronAPI.clearInvalidAvatarUrl(character.id, src).catch((err: any) => {
                              console.error('[CharacterList] 清理无效头像 URL 失败:', err);
                            });
                          }
                        }
                      }}
                    />
                  ) : (
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-600 ${
                      isDarkMode ? 'bg-white/10' : 'bg-gray-200/50'
                    }`}>
                      {character?.nickname || character?.name ? (
                        <span className={`text-sm font-bold ${
                          isDarkMode ? 'text-white/60' : 'text-gray-600'
                        }`}>
                          {(character.nickname || character.name).charAt(0).toUpperCase()}
                        </span>
                      ) : (
                        <User className={`w-6 h-6 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`} />
                      )}
                    </div>
                  )}
                </div>

                  {/* 角色信息 */}
                <div className="ml-3 flex-1 min-w-0">
                  {/* 角色昵称 */}
                  <div className={`text-sm font-bold truncate ${
                    isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                    {character?.nickname || character?.name || '未命名角色'}
                  </div>
                  
                  {/* 角色ID及复制按钮 */}
                  {character?.roleId ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`text-xs truncate font-mono ${
                        isDarkMode ? 'text-zinc-400' : 'text-gray-500'
                      }`}>
                        @{character.roleId}
                      </span>
                      <button
                        onClick={(e) => handleCopyRoleId(character.roleId!, e)}
                        className={`p-0.5 rounded hover:bg-white/20 transition-colors flex-shrink-0 ${
                          copiedRoleId === character.roleId
                            ? isDarkMode ? 'text-green-400' : 'text-green-600'
                            : isDarkMode ? 'text-white/60 hover:text-white' : 'text-gray-400 hover:text-gray-700'
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
                  ) : (
                    <div className={`text-xs mt-1 ${
                      isDarkMode ? 'text-white/40' : 'text-gray-400'
                    }`}>
                      未设置角色ID
                    </div>
                  )}
                </div>

                {/* 删除按钮（悬停时显示） */}
                {character?.id && (
                  <button
                    onClick={(e) => handleDelete(character.id, e)}
                    className={`opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-500/20 transition-all flex-shrink-0 ${
                      isDarkMode ? 'text-white/60 hover:text-red-400' : 'text-gray-400 hover:text-red-600'
                    }`}
                    title="删除角色"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CharacterList;
