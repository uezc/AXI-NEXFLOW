import React, { useState } from 'react';

/**
 * NEXFLOW 激活码生成器（管理员）
 * 纯黑背景、纯白文字，极简风格。图标原尺寸显示，无进度条。
 * 访问方式：应用内 Hash 路由 #/admin
 */
const AdminActivationGenerator: React.FC = () => {
  const [days, setDays] = useState(30);
  const [code, setCode] = useState('');
  const [toast, setToast] = useState('');
  const [generating, setGenerating] = useState(false);
  const [iconError, setIconError] = useState(false);

  const handleGenerate = async () => {
    if (!window.electronAPI?.generateActivationCode) {
      setToast('当前环境不支持生成');
      return;
    }
    setGenerating(true);
    setToast('');
    try {
      const { code: newCode } = await window.electronAPI.generateActivationCode(days);
      setCode(newCode);
      setToast('已复制到剪贴板');
      setTimeout(() => setToast(''), 2500);
    } catch (e) {
      setToast('生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setToast('已复制到剪贴板');
      setTimeout(() => setToast(''), 2500);
    });
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="flex justify-center mb-8">
        {!iconError ? (
          <img
            src="/icon.png"
            alt="NEXFLOW"
            onError={() => setIconError(true)}
            className="max-w-[256px] max-h-[256px] w-auto h-auto object-contain select-none"
          />
        ) : (
          <div className="w-32 h-32 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-4xl font-bold">
            N
          </div>
        )}
      </div>
      <h1 className="text-2xl font-bold text-center mb-8 tracking-wide text-white">
        NEXFLOW 激活码生成
      </h1>

      <div className="w-full max-w-md space-y-6 rounded-2xl bg-white/5 border border-white/10 p-6">
        <div>
          <label className="block text-sm text-white/80 mb-2">授权天数</label>
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 30)))}
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50"
            aria-label="授权天数"
            placeholder="30"
          />
        </div>

        <div>
          <label className="block text-sm text-white/80 mb-2">生成的激活码</label>
          <input
            readOnly
            value={code}
            placeholder="点击下方按钮生成"
            className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-white/30 font-mono text-sm"
            aria-label="生成的激活码"
          />
          {code && (
            <button
              type="button"
              onClick={handleCopy}
              className="mt-2 text-sm text-white/70 hover:text-white underline"
            >
              再次复制
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          aria-label="生成激活码并复制到剪贴板"
          className="w-full py-4 bg-white text-black font-semibold rounded-xl hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generating ? '生成中...' : '生成并复制'}
        </button>

        {toast && (
          <p className="text-center text-sm text-white/80">
            {toast}
          </p>
        )}
      </div>
    </div>
  );
};

export default AdminActivationGenerator;
