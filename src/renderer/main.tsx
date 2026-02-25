import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// 全局错误处理：捕获并忽略 dragEvent 相关错误（来自 React Flow 内部，不影响功能）
if (typeof window !== 'undefined') {
  const originalError = console.error;
  console.error = (...args: any[]) => {
    // 过滤掉 dragEvent 相关的 ReferenceError（来自 React Flow 内部）
    const errorMessage = args.join(' ');
    if (errorMessage.includes('dragEvent is not defined') || 
        errorMessage.includes('ReferenceError: dragEvent')) {
      // 静默忽略，不影响功能
      return;
    }
    originalError.apply(console, args);
  };

  // 未捕获错误与未处理的 Promise 拒绝：打印到控制台，便于排查渲染进程崩溃
  window.onerror = (message, source, lineno, colno, error) => {
    originalError('[渲染进程] 未捕获错误:', message, source, lineno, colno, error);
    return false; // 继续默认行为，便于 DevTools 显示
  };
  window.addEventListener('unhandledrejection', (event) => {
    originalError('[渲染进程] 未处理的 Promise 拒绝:', event.reason);
  });
}

// 开发环境关闭 StrictMode，避免双挂载/双 effect 与 Chromium 时序冲突导致 WidgetHost 报错及渲染进程崩溃
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  process.env.NODE_ENV === 'development' ? (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  ) : (
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
);
