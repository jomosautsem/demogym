import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    // @ts-ignore
    this.setState({ errorInfo });
  }

  public render(): ReactNode {
    // @ts-ignore
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white p-8 flex flex-col items-center justify-center font-mono text-center z-[99999] relative">
          <div className="border-2 border-red-600 bg-red-900/20 p-6 rounded-lg max-w-2xl">
            <h1 className="text-3xl font-bold text-red-500 mb-4">¡ALERTA DE SISTEMA!</h1>
            <p className="text-xl mb-4">La aplicación ha detectado un error crítico.</p>
            
            <div className="bg-black/50 p-4 rounded text-left overflow-auto max-h-60 border border-zinc-700 mb-6">
              {/* @ts-ignore */}
              <p className="text-red-400 font-bold mb-2">Error: {this.state.error?.toString()}</p>
              <pre className="text-xs text-zinc-500 whitespace-pre-wrap">
                {/* @ts-ignore */}
                {this.state.errorInfo?.componentStack}
              </pre>
            </div>

            <button
              onClick={() => {
                  sessionStorage.clear();
                  window.location.reload();
              }}
              className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-6 rounded uppercase tracking-widest"
            >
              Reiniciar Sistema (Hard Reset)
            </button>
          </div>
        </div>
      );
    }

    // @ts-ignore
    return this.props.children;
  }
}

export default ErrorBoundary;