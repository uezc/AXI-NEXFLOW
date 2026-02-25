import React, { useState, useEffect } from 'react';
import { Save, Key, ArrowLeft } from 'lucide-react';

interface SettingsProps {
  onSaveSuccess?: () => void;
  /** 返回片头动画（由设置页左上角「返回」触发） */
  onBackToSplash?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onSaveSuccess, onBackToSplash }) => {
  const [bltcyApiKey, setBltcyApiKey] = useState('');
  const [rhApiKey, setRhApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // 加载已保存的 API Key
    let retryCount = 0;
    const maxRetries = 20; // 最多重试20次（约10秒）
    
    const loadApiKeys = async () => {
      // 检查 electronAPI 是否可用
      if (typeof window === 'undefined' || !window.electronAPI) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error('electronAPI 未就绪，已达到最大重试次数');
          return;
        }
        // 延迟重试
        setTimeout(loadApiKeys, 500);
        return;
      }

      try {
        const [bltcy, rh] = await Promise.all([
          window.electronAPI.getBLTCYApiKey(),
          window.electronAPI.getRHApiKey(),
        ]);
        setBltcyApiKey(bltcy);
        setRhApiKey(rh);
      } catch (error) {
        console.error('加载 API Key 失败:', error);
        // 即使失败也继续渲染UI
      }
    };

    loadApiKeys();
  }, []);

  const handleSave = async () => {
    if (!window.electronAPI) {
      console.error('electronAPI 未就绪，无法保存');
      return;
    }

    setSaving(true);
    setSaved(false);

    try {
      await Promise.all([
        window.electronAPI.saveBLTCYApiKey(bltcyApiKey),
        window.electronAPI.saveRHApiKey(rhApiKey),
      ]);
      setSaved(true);
      
      // 保存成功后跳转到项目管理页面
      if (onSaveSuccess) {
        setTimeout(() => {
          onSaveSuccess();
        }, 800);
      } else {
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (error) {
      console.error('保存 API Key 失败:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-black relative">
      {/* 左上角返回片头按钮 */}
      {onBackToSplash && (
        <button
          type="button"
          onClick={onBackToSplash}
          className="absolute top-4 left-4 z-10 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          aria-label="返回片头"
        >
          <ArrowLeft className="w-5 h-5" />
          返回
        </button>
      )}
      <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full mx-auto space-y-6">
      <div className="apple-panel rounded-xl p-8 space-y-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-white">设置</h2>
          <p className="text-sm text-white/60">
            配置 API 密钥以启用算力服务
          </p>
        </div>

      <div className="space-y-4">
        {/* 核心算力 API Key */}
        <div className="space-y-2">
          <label className="block text-sm font-bold text-white">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4" />
              NEXFLOW 核心算力密钥
            </div>
          </label>
          <input
            type="password"
            value={bltcyApiKey}
            onChange={(e) => setBltcyApiKey(e.target.value)}
            placeholder="请输入核心算力密钥 (用于大模型生成)"
            className="w-full px-4 py-2 apple-panel rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-apple-blue"
          />
        </div>

        {/* 插件算力 API Key */}
        <div className="space-y-2">
          <label className="block text-sm font-bold text-white">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4" />
              NEXFLOW 插件算力密钥
            </div>
          </label>
          <input
            type="password"
            value={rhApiKey}
            onChange={(e) => setRhApiKey(e.target.value)}
            placeholder="请输入插件算力密钥 (用于工作流应用)"
            className="w-full px-4 py-2 apple-panel rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-apple-blue"
          />
        </div>

        {/* 保存按钮 */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 apple-button-primary disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-all"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : saved ? '已保存' : '保存设置'}
        </button>
      </div>
      </div>
      </div>
      </div>
    </div>
  );
};

export default Settings;
