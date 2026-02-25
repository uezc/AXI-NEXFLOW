import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary 组件
 * 捕获子组件树中的 JavaScript 错误，防止整个应用崩溃
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // 更新 state 使下一次渲染能够显示降级后的 UI
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 记录错误信息
    console.error('[ErrorBoundary] 捕获到错误:', error);
    console.error('[ErrorBoundary] 错误信息:', errorInfo);
    
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // 如果提供了自定义 fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 默认错误 UI
      return (
        <div className="flex items-center justify-center w-full h-full bg-black/50 p-8">
          <div className="bg-[#1C1C1E] rounded-2xl p-6 max-w-md w-full border border-red-500/50">
            <h2 className="text-xl font-bold text-red-400 mb-4">⚠️ 组件渲染错误</h2>
            <p className="text-white/80 text-sm mb-4">
              某个组件发生了错误，但应用仍在运行。您可以继续使用其他功能。
            </p>
            {this.state.error && (
              <details className="mb-4">
                <summary className="text-white/60 text-xs cursor-pointer mb-2">
                  错误详情（点击展开）
                </summary>
                <pre className="text-xs text-red-300 bg-black/30 p-2 rounded overflow-auto max-h-32">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
