import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import StatusBar from './components/StatusBar';
import Settings from './components/Settings';
import ActivationView from './components/ActivationView';
import AdminActivationGenerator from './components/AdminActivationGenerator';
import SplashScreen from './components/SplashScreen';
import Projects from './components/Projects';
import Workspace from './components/Workspace';
import { ErrorBoundary } from './components/ErrorBoundary';

const App: React.FC = () => {
  const [bltcyBalance, setBltcyBalance] = useState<number | null>(null);
  const [rhBalance, setRhBalance] = useState<number | null>(null);
  const [isElectronReady, setIsElectronReady] = useState(false);
  const [isActivated, setIsActivated] = useState(false);
  const [checkingActivation, setCheckingActivation] = useState(true);
  /** 激活后先显示片头，片头结束后再延迟 300ms 进主界面 */
  const [showSplash, setShowSplash] = useState(false);
  const [showMainUI, setShowMainUI] = useState(false);

  // 检查 electronAPI 是否可用和激活状态（延迟首帧再发 IPC，避免与 Chromium WidgetHost 时序冲突导致崩溃）
  useEffect(() => {
    let mounted = true;
    const checkElectronAPI = async () => {
      if (typeof window === 'undefined' || !window.electronAPI) return false;
      if (!mounted) return true;
      setIsElectronReady(true);
      try {
        const status = await window.electronAPI.checkActivation();
        if (mounted) setIsActivated(!!status?.activated);
      } catch (error) {
        console.error('检查激活状态失败:', error);
        if (mounted) setIsActivated(false);
      } finally {
        if (mounted) setCheckingActivation(false);
      }
      return true;
    };

    const retryTimerRef = { current: 0 as ReturnType<typeof setTimeout> };
    const tryOnce = () => {
      if (!mounted) return;
      if (typeof window !== 'undefined' && window.electronAPI) {
        checkElectronAPI();
        return;
      }
      retryTimerRef.current = window.setTimeout(tryOnce, 100);
    };
    // 延后首帧再发起 IPC，减少 "Message rejected by blink.mojom.WidgetHost" 及渲染进程崩溃
    const startTimer = window.setTimeout(() => {
      if (!mounted) return;
      tryOnce();
    }, 200);

    // 若 5 秒后仍未就绪则停止 loading，避免一直卡在“正在检查激活状态”
    const fallbackTimer = window.setTimeout(() => {
      if (!mounted) return;
      if (window.electronAPI) return;
      clearTimeout(retryTimerRef.current);
      setCheckingActivation(false);
      setIsElectronReady(false);
      setIsActivated(false);
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(startTimer);
      clearTimeout(retryTimerRef.current);
      clearTimeout(fallbackTimer);
    };
  }, []);

  // 查询所有余额
  const queryAllBalances = async () => {
    if (!window.electronAPI) {
      console.warn('electronAPI 未就绪');
      return;
    }

    try {
      const balances = await window.electronAPI.queryAllBalances();
      setBltcyBalance(balances.bltcy);
      setRhBalance(balances.rh);
    } catch (error) {
      console.error('查询余额失败:', error);
      // 即使失败也继续渲染UI
    }
  };

  useEffect(() => {
    if (!isElectronReady) {
      return;
    }

    // 不自动查询余额，只在保存 API Key 后通过事件更新
    // 监听余额更新事件（由保存 API Key 时触发）
    try {
      window.electronAPI.onBalanceUpdated((data) => {
        if (data.type === 'bltcy') {
          setBltcyBalance(data.balance);
        } else if (data.type === 'rh') {
          setRhBalance(data.balance);
        }
      });
    } catch (error) {
      console.error('设置余额更新监听失败:', error);
    }

    // 清理监听器
    return () => {
      try {
        if (window.electronAPI) {
          window.electronAPI.removeBalanceUpdatedListener();
        }
      } catch (error) {
        console.error('清理监听器失败:', error);
      }
    };
  }, [isElectronReady]);

  // F11 切换全屏/窗口模式（覆盖浏览器默认行为）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'F11') return;
      e.preventDefault();
      e.stopPropagation();
      if (window.electronAPI?.toggleFullscreen) {
        window.electronAPI.toggleFullscreen().catch((err) => {
          console.error('切换全屏失败:', err);
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 激活后先显示片头，不直接进主界面
  useEffect(() => {
    if (!isActivated) {
      setShowSplash(false);
      setShowMainUI(false);
      return;
    }
    setShowSplash(true);
  }, [isActivated]);

  // 如果正在检查激活状态，显示加载
  if (checkingActivation) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-apple-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60">正在检查激活状态...</p>
        </div>
      </div>
    );
  }

  // 主界面：带路由（/admin 无需激活即可访问）
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppRouter
          isActivated={isActivated}
          setIsActivated={setIsActivated}
          showSplash={showSplash}
          setShowSplash={setShowSplash}
          showMainUI={showMainUI}
          setShowMainUI={setShowMainUI}
          bltcyBalance={bltcyBalance}
          rhBalance={rhBalance}
        />
      </HashRouter>
    </ErrorBoundary>
  );
};

/** 根据路由与激活状态渲染：/admin 直接显示生成器，其余未激活显示激活页，已激活先片头再主应用 */
const AppRouter: React.FC<{
  isActivated: boolean;
  setIsActivated: (v: boolean) => void;
  showSplash: boolean;
  setShowSplash: (v: boolean) => void;
  showMainUI: boolean;
  setShowMainUI: (v: boolean) => void;
  bltcyBalance: number | null;
  rhBalance: number | null;
}> = ({ isActivated, setIsActivated, showSplash, setShowSplash, showMainUI, setShowMainUI, bltcyBalance, rhBalance }) => {
  const location = useLocation();
  const isAdmin = location.pathname === '/admin';

  if (isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<AdminActivationGenerator />} />
      </Routes>
    );
  }

  if (!isActivated) {
    return <ActivationView onActivated={() => setIsActivated(true)} />;
  }

  // 激活后先显示片头，片头结束后再延迟 300ms 进主界面
  if (showSplash) {
    return (
      <SplashScreen
        onFinish={() => {
          setShowSplash(false);
          window.setTimeout(() => setShowMainUI(true), 300);
        }}
      />
    );
  }

  if (!showMainUI) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-apple-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60">加载中...</p>
        </div>
      </div>
    );
  }

  const goBackToSplash = React.useCallback(() => {
    setShowMainUI(false);
    setShowSplash(true);
  }, []);

  return (
    <Routes>
      <Route path="/workspace/:projectId" element={
        <ErrorBoundary><Workspace /></ErrorBoundary>
      } />
      <Route
        path="/"
        element={
          <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            <StatusBar bltcyBalance={bltcyBalance} rhBalance={rhBalance} />
            <div style={{ paddingTop: '60px' }}>
              <SettingsWithNavigate onBackToSplash={goBackToSplash} />
            </div>
          </div>
        }
      />
      <Route
        path="/settings"
        element={
          <div className="min-h-screen bg-black">
            <StatusBar bltcyBalance={bltcyBalance} rhBalance={rhBalance} />
            <div style={{ paddingTop: '60px' }}>
              <SettingsWithNavigate onBackToSplash={goBackToSplash} />
            </div>
          </div>
        }
      />
      <Route
        path="/projects"
        element={
          <div className="min-h-screen bg-black">
            <StatusBar bltcyBalance={bltcyBalance} rhBalance={rhBalance} />
            <div style={{ paddingTop: '60px' }}>
              <ProjectsWithNavigate />
            </div>
          </div>
        }
      />
    </Routes>
  );
};

// Settings 组件包装器（用于导航）
const SettingsWithNavigate: React.FC<{ onBackToSplash?: () => void }> = ({ onBackToSplash }) => {
  const navigate = useNavigate();
  return (
    <Settings
      onSaveSuccess={() => navigate('/projects')}
      onBackToSplash={onBackToSplash}
    />
  );
};

// Projects 组件包装器（用于导航）
const ProjectsWithNavigate: React.FC = () => {
  const navigate = useNavigate();
  return <Projects onBack={() => navigate('/settings')} />;
};

export default App;
