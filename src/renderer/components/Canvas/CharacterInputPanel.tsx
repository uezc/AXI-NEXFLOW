import React, { useState, useRef, useCallback } from 'react';
import { Play, Link } from 'lucide-react';

interface CharacterInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  videoUrl: string;
  nickname: string;
  timestamp: string;
  isConnected?: boolean; // 是否有输入连线（从video模块）
  projectId?: string;
  onVideoUrlChange: (value: string) => void;
  onNicknameChange: (value: string) => void;
  onTimestampChange: (value: string) => void;
  onCreateCharacter: () => void;
  isUploading?: boolean; // 是否正在上传
  needsUpload?: boolean; // 是否需要上传（检测到本地视频但未上传）
  localVideoPath?: string; // 本地视频路径（用于上传）
  onConfirmUpload?: () => void; // 确认上传回调
}

const CharacterInputPanel: React.FC<CharacterInputPanelProps> = ({
  nodeId,
  isDarkMode,
  videoUrl,
  nickname,
  timestamp,
  isConnected = false,
  projectId,
  onVideoUrlChange,
  onNicknameChange,
  onTimestampChange,
  onCreateCharacter,
  isUploading = false,
  needsUpload = false,
  localVideoPath,
  onConfirmUpload,
}) => {
  const [error, setError] = useState<string | null>(null);

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

  // 处理创建角色
  const handleCreate = () => {
    if (!videoUrl.trim()) {
      setError('请输入视频URL或连接视频模块');
      return;
    }

    if (timestamp.trim() && !validateTimestamp(timestamp)) {
      setError('时间戳格式错误，格式应为：1,3（表示1-3秒，范围差值1-3秒）');
      return;
    }

    setError(null);
    onCreateCharacter();
  };

  return (
    <div 
      className={`${isDarkMode ? 'bg-[#1C1C1E]' : 'bg-gray-200/90 backdrop-blur-md'} rounded-2xl border-2 border-green-500 p-3 transform transition-all duration-300 ease-out h-full flex flex-col overflow-hidden`}
    >
      <div className="flex-1 overflow-y-auto space-y-3">
        {/* 视频对接状态 */}
        {isConnected && videoUrl && !needsUpload && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
            isDarkMode ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-green-100 text-green-700 border border-green-300'
          }`}>
            <Link className="w-3.5 h-3.5" />
            <span>[视频对接]</span>
          </div>
        )}

        {/* 需要上传提示 */}
        {needsUpload && !isUploading && (
          <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs ${
            isDarkMode ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-yellow-100 text-yellow-700 border border-yellow-300'
          }`}>
            <div className="flex items-center gap-2">
              <Link className="w-3.5 h-3.5" />
              <span>检测到本地视频，需要上传到云端</span>
            </div>
            {onConfirmUpload && (
              <button
                onClick={onConfirmUpload}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  isDarkMode
                    ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                    : 'bg-yellow-500 hover:bg-yellow-600 text-white'
                }`}
              >
                确认上传视频
              </button>
            )}
          </div>
        )}

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
            onChange={(e) => onNicknameChange(e.target.value)}
            placeholder="输入备注角色名(可选)"
            className={`w-full px-3 py-2 rounded-lg text-sm border ${
              isDarkMode
                ? 'bg-black/30 text-white border-white/20 placeholder-white/40'
                : 'bg-white/90 text-gray-900 border-gray-300 placeholder-gray-500'
            } focus:outline-none focus:ring-2 focus:ring-apple-blue`}
          />
        </div>

        {/* 视频URL */}
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${
            isDarkMode ? 'text-white/80' : 'text-gray-700'
          }`}>
            视频URL
          </label>
          <div className="relative">
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => {
                onVideoUrlChange(e.target.value);
                setError(null);
              }}
              placeholder={isUploading ? "正在上传视频至云端..." : "输入视频URL或连接视频模块"}
              disabled={isConnected || isUploading}
              className={`w-full px-3 py-2 rounded-lg text-sm border ${
                isDarkMode
                  ? 'bg-black/30 text-white border-white/20 placeholder-white/40'
                  : 'bg-white/90 text-gray-900 border-gray-300 placeholder-gray-500'
              } focus:outline-none focus:ring-2 focus:ring-apple-blue disabled:opacity-50 disabled:cursor-not-allowed`}
            />
            {isUploading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </div>
          {isUploading && (
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
              正在上传视频至云端...
            </p>
          )}
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
            onChange={(e) => {
              onTimestampChange(e.target.value);
              setError(null);
            }}
            placeholder="格式: 1,3 (表示1-3秒,范围差值1-3秒)"
            className={`w-full px-3 py-2 rounded-lg text-sm border ${
              isDarkMode
                ? 'bg-black/30 text-white border-white/20 placeholder-white/40'
                : 'bg-white/90 text-gray-900 border-gray-300 placeholder-gray-500'
            } focus:outline-none focus:ring-2 focus:ring-apple-blue`}
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
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 pt-3 border-t border-white/10">
        <button
          onClick={handleCreate}
          disabled={!videoUrl.trim() || isUploading || needsUpload}
          className={`w-full px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-center gap-2 ${
            isDarkMode
              ? (isUploading || needsUpload)
                ? 'bg-gray-600 text-white/60 border border-gray-500 cursor-not-allowed'
                : 'bg-apple-blue hover:bg-apple-blue/80 text-white border border-apple-blue'
              : (isUploading || needsUpload)
                ? 'bg-gray-400 text-gray-600 border border-gray-300 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isUploading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>正在上传视频至云端...</span>
            </>
          ) : needsUpload ? (
            <>
              <span>请先确认上传视频</span>
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
  );
};

export default CharacterInputPanel;
