import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Unexpected error occurred',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, errorMessage: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#04070E] px-4 text-slate-100">
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-[#0F172A] p-5 text-center shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/15 text-rose-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="mt-3 text-base font-bold text-white">
              应用遇到异常 · Application Error
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              系统已拦截异常以保护您的钱包数据。请刷新页面重试。
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-4 text-xs font-bold text-[#070B14] hover:bg-amber-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>刷新重试 · Reload</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
