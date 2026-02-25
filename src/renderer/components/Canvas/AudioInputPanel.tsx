import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Play } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { getAudioPrice } from '../../utils/priceCalc';

// 音频模型选项
const audioModelOptions = [
  { value: 'speech-2.8-hd', label: 'MiniMax 2.8 HD' },
  { value: 'index-tts2', label: 'Index-TTS 2.0' },
  { value: 'rhart-song', label: 'SUNO v5' },
];

interface AudioInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  text: string;
  model?: string;
  voiceId: string;
  speed: number;
  volume: number;
  pitch: number;
  emotion?: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
  referenceAudioUrl?: string;
  /** 全能写歌：歌曲名 / 风格描述 / 歌词 */
  songName?: string;
  styleDesc?: string;
  lyrics?: string;
  projectId?: string;
  onStart?: () => void;
  onErrorTask?: (message: string) => void;
  onTextChange: (value: string) => void;
  onModelChange?: (value: string) => void;
  onVoiceIdChange: (value: string) => void;
  onSpeedChange: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onPitchChange: (value: number) => void;
  onEmotionChange?: (value: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral' | undefined) => void;
  onReferenceAudioUrlChange?: (value: string) => void;
  onSongNameChange?: (value: string) => void;
  onStyleDescChange?: (value: string) => void;
  onLyricsChange?: (value: string) => void;
  onOutputAudioChange: (audioUrl: string, originalUrl?: string) => void;
}

// 声音选项（根据 API 文档，显示中文翻译）
const voiceOptions = [
  { value: 'Wise_Woman', label: '智慧女性' },
  { value: 'Friendly_Person', label: '友好的人' },
  { value: 'Inspirational_girl', label: '励志女孩' },
  { value: 'Deep_Voice_Man', label: '深沉男声' },
  { value: 'Calm_Woman', label: '冷静女性' },
  { value: 'Casual_Guy', label: '随性男孩' },
  { value: 'Lively_Girl', label: '活泼女孩' },
  { value: 'Patient_Man', label: '耐心男性' },
  { value: 'Young_Knight', label: '年轻骑士' },
  { value: 'Determined_Man', label: '坚定男性' },
  { value: 'Lovely_Girl', label: '可爱女孩' },
  { value: 'Decent_Boy', label: '体面男孩' },
  { value: 'Imposing_Manner', label: '威严风格' },
  { value: 'Elegant_Man', label: '优雅男性' },
  { value: 'Abbess', label: '女修道院长' },
  { value: 'Sweet_Girl_2', label: '甜美女孩' },
  { value: 'Exuberant_Girl', label: '热情女孩' },
];

// 情感选项
const emotionOptions = [
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'fearful', label: '恐惧' },
  { value: 'disgusted', label: '厌恶' },
  { value: 'surprised', label: '惊讶' },
  { value: 'neutral', label: '中性' },
];

const AudioInputPanel: React.FC<AudioInputPanelProps> = ({
  nodeId,
  isDarkMode,
  text,
  model = 'speech-2.8-hd',
  voiceId,
  speed,
  volume,
  pitch,
  emotion,
  referenceAudioUrl = '',
  songName = '',
  styleDesc = '',
  lyrics = '',
  projectId,
  onStart,
  onErrorTask,
  onTextChange,
  onModelChange,
  onVoiceIdChange,
  onSpeedChange,
  onVolumeChange,
  onPitchChange,
  onEmotionChange,
  onReferenceAudioUrlChange,
  onSongNameChange,
  onStyleDescChange,
  onLyricsChange,
  onOutputAudioChange,
}) => {
  const isIndexTts2 = model === 'index-tts2';
  const isRhartSong = model === 'rhart-song';
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // AI Hook
  const { status: aiStatus, execute: executeAI } = useAI({
    nodeId,
    modelId: 'audio',
    onStatusUpdate: (packet) => {
      // 处理状态更新
      if (packet.status === 'SUCCESS') {
        // SUCCESS 状态：更新输出音频
        const audioUrl = packet.payload?.url || packet.payload?.audioUrl;
        const originalUrl = packet.payload?.originalAudioUrl;
        
        if (audioUrl) {
          onOutputAudioChange(audioUrl, originalUrl);
        }
      } else if (packet.status === 'ERROR') {
        // 错误处理
        const errorMessage = packet.payload?.error || '音频生成失败';
        if (onErrorTask) {
          onErrorTask(errorMessage);
        }
      }
    },
    onComplete: (result) => {
      // 优先使用 localPath（如果存在）
      const localPath = result?.localPath;
      let audioUrl = result?.url || result?.audioUrl;
      
      if (localPath) {
        let filePath = localPath.replace(/\\/g, '/');
        if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
        else if (filePath.match(/^[a-zA-Z]:\//)) filePath = filePath[0].toUpperCase() + filePath.substring(1);
        if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
        audioUrl = `local-resource://${filePath}`;
        console.log('[AudioInputPanel] onComplete 使用本地路径:', localPath, '->', audioUrl);
      }
      
      if (audioUrl) {
        const originalUrl = result?.originalAudioUrl;
        onOutputAudioChange(audioUrl, originalUrl);
      }
    },
    onError: (error) => {
      console.error('音频生成失败:', error);
      
      // 检测余额不足错误
      const errorMessage = typeof error === 'string' ? error : (error?.message || String(error));
      const isQuotaError = errorMessage.includes('quota is not enough') || 
                          errorMessage.includes('remain quota') ||
                          errorMessage.includes('余额不足');
      
      if (isQuotaError) {
        // 显示余额不足弹窗
        alert('余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。');
      }
      
      if (onErrorTask) {
        onErrorTask(error);
      }
    },
  });

  // 执行音频生成
  const handleExecute = useCallback(async () => {
    if (isRhartSong) {
      if (!(songName ?? '').trim() || !(styleDesc ?? '').trim() || !(lyrics ?? '').trim()) return;
    } else if (!text.trim()) {
      return;
    }

    onStart?.();

    try {
      const requestParams: any = {
        model,
        text: (text || '').trim(),
        enable_base64_output: false,
        english_normalization: false,
      };
      if (isRhartSong) {
        requestParams.songName = (songName ?? '').trim();
        requestParams.styleDesc = (styleDesc ?? '').trim();
        requestParams.lyrics = (lyrics ?? '').trim();
      } else if (isIndexTts2) {
        let refUrl = (referenceAudioUrl || '').trim();
        if (refUrl.startsWith('local-resource://') || refUrl.startsWith('file://')) {
          refUrl = refUrl.replace(/%5C/gi, '/').replace(/^local-resource:\/\/+/, 'local-resource://').replace(/^file:\/\/+/, 'file://');
        }
        requestParams.referenceAudioUrl = refUrl;
      } else {
        requestParams.voice_id = voiceId;
        requestParams.speed = Math.max(0.5, Math.min(2, speed));
        requestParams.volume = Math.max(0.1, Math.min(10, volume));
        requestParams.pitch = Math.max(-12, Math.min(12, pitch));
        if (emotion) requestParams.emotion = emotion;
      }
      if (projectId) requestParams.projectId = projectId;
      await executeAI(requestParams);
    } catch (error) {
      console.error('音频生成失败:', error);
    }
  }, [text, model, isIndexTts2, isRhartSong, songName, styleDesc, lyrics, referenceAudioUrl, voiceId, speed, volume, pitch, emotion, executeAI, onStart, projectId]);

  const isRunDisabled =
    aiStatus === 'PROCESSING' ||
    (isRhartSong
      ? !(songName ?? '').trim() || !(styleDesc ?? '').trim() || !(lyrics ?? '').trim()
      : !text.trim() || (isIndexTts2 && !(referenceAudioUrl || '').trim()));

  return (
    <div 
      className={`${isDarkMode ? 'bg-[#1C1C1E]' : 'bg-gray-200/90 backdrop-blur-md'} rounded-2xl border-2 border-green-500 p-4 transform transition-all duration-300 ease-out h-full flex flex-col overflow-hidden`}
      style={!isDarkMode ? {
        background: 'rgba(229, 231, 235, 0.9)',
        backdropFilter: 'blur(12px) saturate(150%)',
        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
      } : {}}
    >
      {/* 顶部控制栏 */}
      <div className={`flex items-center justify-between mb-3 flex-shrink-0 gap-3 ${isDarkMode ? 'border-b border-gray-700/30 pb-3' : 'border-b border-gray-300/30 pb-3'}`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <label className={`text-xs font-medium whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
              模型:
            </label>
            <select
              value={model}
              onChange={(e) => onModelChange?.(e.target.value)}
              className={`px-2 py-1.5 rounded-lg text-xs min-w-[140px] ${
                isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
              } outline-none focus:ring-2 focus:ring-green-500/50`}
              title="选择音频模型"
              aria-label="选择音频模型"
            >
              {audioModelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {!isIndexTts2 && !isRhartSong && (
            <>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className={`text-xs font-medium whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>声音:</label>
                <select
                  value={voiceId}
                  onChange={(e) => onVoiceIdChange(e.target.value)}
                  className={`px-2 py-1.5 rounded-lg text-xs min-w-[100px] ${isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'} outline-none focus:ring-2 focus:ring-green-500/50`}
                  title="选择声音"
                  aria-label="选择声音"
                >
                  {voiceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {onEmotionChange && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <label className={`text-xs font-medium whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>情感:</label>
                  <select
                    value={emotion || ''}
                    onChange={(e) => onEmotionChange(e.target.value as any || undefined)}
                    className={`px-2 py-1.5 rounded-lg text-xs min-w-[80px] ${isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'} outline-none focus:ring-2 focus:ring-green-500/50`}
                  >
                    <option value="">无</option>
                    {emotionOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          {isIndexTts2 && onReferenceAudioUrlChange && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <label className={`text-xs font-medium whitespace-nowrap ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>参考音:</label>
              <input
                type="text"
                value={referenceAudioUrl}
                onChange={(e) => onReferenceAudioUrlChange(e.target.value)}
                placeholder="粘贴 URL 或点击右侧选择本地文件"
                title="参考音：粘贴公网 URL 或选择本地音频文件"
                aria-label="参考音 URL 或本地路径"
                className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs ${
                  isDarkMode ? 'bg-black/30 text-white border border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border border-gray-300 placeholder:text-gray-500'
                } outline-none focus:ring-2 focus:ring-green-500/50`}
              />
              <button
                type="button"
                onClick={async () => {
                  if (typeof window.electronAPI?.showOpenAudioDialog !== 'function') return;
                  const res = await window.electronAPI.showOpenAudioDialog();
                  if (res.success && res.filePath) {
                    let path = res.filePath.replace(/\\/g, '/');
                    if (path.match(/^[a-zA-Z]\//)) path = path[0].toUpperCase() + ':' + path.substring(1);
                    else if (path.match(/^[a-zA-Z]:\//)) path = path[0].toUpperCase() + path.substring(1);
                    onReferenceAudioUrlChange(`local-resource://${path}`);
                  }
                }}
                title="选择本地参考音文件（MP3/WAV 等）"
                aria-label="选择参考音文件"
                className={`px-2 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 ${isDarkMode ? 'bg-black/30 text-white border border-gray-600/50 hover:bg-gray-700/50' : 'bg-white border border-gray-300 hover:bg-gray-100'} outline-none focus:ring-2 focus:ring-green-500/50`}
              >
                选择文件
              </button>
            </div>
          )}
        </div>

        {/* 右侧：价格 + 运行按钮（与图片模块一致：价格在左、按钮在右） */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {(() => {
            const price = model ? getAudioPrice(model) : null;
            if (price == null) return null;
            return (
              <span
                className={`text-xs font-medium px-2 py-1 rounded ${
                  isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
                }`}
                title="单次生成预估价格"
              >
                ¥{price.toFixed(1)}/次
              </span>
            );
          })()}
          <button
            onClick={handleExecute}
            disabled={isRunDisabled}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all duration-200 ${
              isRunDisabled
                ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
                : aiStatus === 'PROCESSING'
                  ? 'bg-green-500 text-white'
                  : 'bg-green-500 text-white hover:bg-green-600 shadow-md shadow-green-500/30'
            }`}
            title="生成音频"
          >
            {aiStatus === 'PROCESSING' ? (
              <>
                <div className={`w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin`} />
                生成中
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                生成音频
              </>
            )}
          </button>
        </div>
      </div>

      {/* 主要内容区域 - 左右分栏布局 */}
      <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
        {/* 左侧：文本内容 或 全能写歌（左：歌曲名+风格描述，右：歌词） */}
        {isRhartSong ? (
          <div className="flex-1 min-w-0 min-h-0 flex gap-4 overflow-hidden">
            <div className="w-52 flex-shrink-0 flex flex-col gap-3 overflow-auto custom-scrollbar">
              <div className="flex flex-col flex-shrink-0">
                <label className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>歌曲名</label>
                <input
                  type="text"
                  value={songName}
                  onChange={(e) => onSongNameChange?.(e.target.value)}
                  placeholder="例如：告白气球"
                  className={`w-full px-3 py-2 rounded-lg text-sm border ${
                    isDarkMode ? 'bg-black/30 text-white border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border-gray-300 placeholder:text-gray-500'
                  } outline-none focus:ring-2 focus:ring-green-500/30`}
                  style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
                />
              </div>
              <div className="flex flex-col flex-shrink-0">
                <label className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>风格描述</label>
                <input
                  type="text"
                  value={styleDesc}
                  onChange={(e) => onStyleDescChange?.(e.target.value)}
                  placeholder="例如：流行音乐，男声，90年代歌曲，慢速"
                  className={`w-full px-3 py-2 rounded-lg text-sm border ${
                    isDarkMode ? 'bg-black/30 text-white border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border-gray-300 placeholder:text-gray-500'
                  } outline-none focus:ring-2 focus:ring-green-500/30`}
                  style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
                />
              </div>
            </div>
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              <label className={`text-xs font-medium mb-1 flex-shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>歌词</label>
              <textarea
                value={lyrics}
                onChange={(e) => onLyricsChange?.(e.target.value)}
                placeholder="写入完整歌词..."
                className={`w-full flex-1 min-h-0 custom-scrollbar resize-none rounded-lg p-3 text-sm border ${
                  isDarkMode ? 'bg-black/30 text-white border-gray-600/50 placeholder:text-white/40' : 'bg-white/90 text-gray-900 border-gray-300 placeholder:text-gray-500'
                } outline-none focus:ring-2 focus:ring-green-500/30`}
                style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
              />
            </div>
          </div>
        ) : (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <label className={`text-xs font-medium mb-2 flex-shrink-0 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
            文本内容
          </label>
          <textarea
            ref={textInputRef}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            className={`w-full flex-1 custom-scrollbar bg-transparent resize-none outline-none text-sm rounded-lg p-3 border ${
              isDarkMode 
                ? 'text-white placeholder:text-white/40 border-gray-600/50 focus:border-green-500/50' 
                : 'text-gray-900 placeholder:text-gray-500 border-gray-300/50 focus:border-green-500/50'
            } focus:ring-2 focus:ring-green-500/30`}
            placeholder="输入要转换为语音的文本..."
            style={{ caretColor: isDarkMode ? '#0A84FF' : '#22c55e' }}
            title="文本输入框"
          />
        </div>
        )}

        {/* 右侧：语速/音量/音调（仅语音合成模型） */}
        {!isIndexTts2 && !isRhartSong && (
            <div className="w-48 flex-shrink-0 flex flex-col gap-4">
            <div className="flex flex-col">
              <label className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                语速: <span className="font-semibold">{speed.toFixed(1)}</span>
              </label>
              <input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={(e) => onSpeedChange(parseFloat(e.target.value))} className="w-full h-2 bg-gray-600/30 rounded-lg appearance-none cursor-pointer accent-green-500" title={`语速: ${speed.toFixed(1)}`} aria-label="语速" />
            </div>
            <div className="flex flex-col">
              <label className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                音量: <span className="font-semibold">{volume.toFixed(1)}</span>
              </label>
              <input type="range" min="0.1" max="10" step="0.1" value={volume} onChange={(e) => onVolumeChange(parseFloat(e.target.value))} className="w-full h-2 bg-gray-600/30 rounded-lg appearance-none cursor-pointer accent-green-500" title={`音量: ${volume.toFixed(1)}`} aria-label="音量" />
            </div>
            <div className="flex flex-col">
              <label className={`text-xs font-medium mb-2 ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
                音调: <span className="font-semibold">{pitch > 0 ? '+' : ''}{pitch}</span>
              </label>
              <input type="range" min="-12" max="12" step="1" value={pitch} onChange={(e) => onPitchChange(parseInt(e.target.value))} className="w-full h-2 bg-gray-600/30 rounded-lg appearance-none cursor-pointer accent-green-500" title={`音调: ${pitch > 0 ? '+' : ''}${pitch}`} aria-label="音调" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioInputPanel;
