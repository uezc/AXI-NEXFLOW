import React from 'react';
import { Activity } from 'lucide-react';

interface StatusBarProps {
  bltcyBalance: number | null;
  rhBalance: number | null;
}

const StatusBar: React.FC<StatusBarProps> = ({ bltcyBalance, rhBalance }) => {
  return (
    <div 
      className="fixed top-0 left-0 right-0 z-50 apple-panel border-b"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="px-6 py-3 flex items-center justify-between" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-apple-blue" />
            <span className="text-sm font-bold text-white">
              NEXFLOW 核心算力:
            </span>
            <span className="text-sm font-semibold text-apple-blue">
              {bltcyBalance !== null ? `${bltcyBalance} 算力点` : '--'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-apple-blue" />
            <span className="text-sm font-bold text-white">
              NEXFLOW 插件算力:
            </span>
            <span className="text-sm font-semibold text-apple-blue">
              {rhBalance !== null ? `${rhBalance} 币` : '--'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-apple-blue animate-pulse" />
          <span className="text-xs text-white/60">运行中</span>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
