import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { errorLogger } from '@/lib/error-logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  variant?: 'full' | 'inline';
  onError?: (error: Error) => void;
  /**
   * 是否监听全局异步错误触发（triggerErrorBoundary）。
   * - false：仅捕获 React 渲染错误（用于顶层全局 boundary，避免单个路由的异步错误导致整页崩溃）
   * - true（默认）：同时监听异步错误触发（用于页面级 boundary，实现局部错误隔离）
   */
  listenToAsyncErrors?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// 全局错误触发事件，用于异步错误触发 ErrorBoundary
type ErrorTriggerHandler = (error: Error) => void;
const errorTriggerListeners: Set<ErrorTriggerHandler> = new Set();

export const triggerErrorBoundary = (error: Error) => {
  errorTriggerListeners.forEach(handler => {
    try {
      handler(error);
    } catch (e) {
      console.error('Error in error trigger handler:', e);
    }
  });
};

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (typeof err.message === 'string') {
      return err.message;
    }
    const response = err.response as Record<string, unknown> | undefined;
    const responseData = response?.data as Record<string, unknown> | undefined;
    if (responseData && typeof responseData.message === 'string') {
      return responseData.message;
    }
    if (typeof err.statusText === 'string') {
      return err.statusText;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return '未知错误';
  }
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    errorLogger.error('ErrorBoundary caught error', error, 'ErrorBoundary.componentDidCatch');
    this.setState({ errorInfo });
    this.props.onError?.(error);
  }

  componentDidMount() {
    // P0 修复：listenToAsyncErrors=false 的 boundary（如顶层全局 boundary）
    // 不注册异步错误监听，避免单个路由的异步错误导致整页崩溃
    if (this.props.listenToAsyncErrors === false) {
      return;
    }
    this._errorTriggerHandler = (error: Error) => {
      this.setState({ hasError: true, error, errorInfo: null });
      this.props.onError?.(error);
    };
    errorTriggerListeners.add(this._errorTriggerHandler);
  }

  componentWillUnmount() {
    if (this._errorTriggerHandler) {
      errorTriggerListeners.delete(this._errorTriggerHandler);
    }
  }

  private _errorTriggerHandler?: ErrorTriggerHandler;

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      const variant = this.props.variant || 'full';
      const errorMessage = extractErrorMessage(this.state.error);
      
      if (variant === 'inline') {
        return (
          <div className="flex items-center justify-center p-8 h-full">
            <Card className="w-full max-w-md">
              <CardHeader className="text-center pb-2">
                <div className="mx-auto mb-3 p-3 bg-destructive/10 rounded-full w-fit">
                  <AlertTriangle className="w-8 h-8 text-destructive" />
                </div>
                <h2 className="text-lg font-bold">页面加载失败</h2>
              </CardHeader>
              <CardContent className="text-center space-y-3">
                <p className="text-sm text-muted-foreground break-all">
                  {errorMessage}
                </p>
                <div className="flex gap-2 justify-center">
                  <Button onClick={this.handleReset} size="sm">
                    <RefreshCw className="w-4 h-4 mr-1" />
                    重试
                  </Button>
                  <PageErrorHomeButton />
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-3 bg-destructive/10 rounded-full">
                <AlertTriangle className="w-10 h-10 text-destructive" />
              </div>
              <h2 className="text-xl font-bold">页面出错了</h2>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-sm text-muted-foreground break-all">
                {errorMessage}
              </p>
              <Button onClick={this.handleReset}>
                <RefreshCw className="w-4 h-4 mr-2" />
                重新加载
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageErrorHomeButton() {
  const navigate = useNavigate();
  return (
    <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>
      <Home className="w-4 h-4 mr-1" />
      返回首页
    </Button>
  );
}
