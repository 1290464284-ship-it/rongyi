import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  variant?: 'full' | 'inline';
  onError?: (error: Error) => void;
  enableGlobalErrorListener?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

let globalErrorListenersBound = false;
let globalErrorHandlers: Array<(error: Error) => void> = [];

const bindGlobalErrorListeners = () => {
  if (globalErrorListenersBound) return;

  const handleError = (event: ErrorEvent) => {
    console.error('Global error:', event.error);
    globalErrorHandlers.forEach(handler => {
      try { handler(event.error); } catch {}
    });
  };

  const handleRejection = (event: PromiseRejectionEvent) => {
    console.error('Unhandled promise rejection:', event.reason);
    globalErrorHandlers.forEach(handler => {
      try { handler(event.reason as Error); } catch {}
    });
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);
  globalErrorListenersBound = true;
};

const extractErrorMessage = (error: any): string => {
  if (typeof error === 'string') {
    return error;
  }
  if (error?.message) {
    return typeof error.message === 'string' ? error.message : JSON.stringify(error.message);
  }
  if (error?.response?.data?.message) {
    const msg = error.response.data.message;
    return typeof msg === 'string' ? msg : JSON.stringify(msg);
  }
  if (error?.statusText) {
    return error.statusText;
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
    console.error('Error Boundary caught error:', error);
    console.error('Error info:', errorInfo);
    this.setState({ errorInfo });
    this.props.onError?.(error);
  }

  componentDidMount() {
    if (this.props.enableGlobalErrorListener !== false) {
      bindGlobalErrorListeners();
      this._globalHandler = (error: Error) => {
        this.props.onError?.(error);
      };
      globalErrorHandlers.push(this._globalHandler);
    }
  }

  componentWillUnmount() {
    if (this._globalHandler) {
      globalErrorHandlers = globalErrorHandlers.filter(h => h !== this._globalHandler);
    }
  }

  private _globalHandler?: (error: Error) => void;

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


