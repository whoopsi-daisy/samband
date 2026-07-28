'use client';

import { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <main id="main-content">
          <div className="empty">
            <p className="empty-title">Något gick fel</p>
            <p className="empty-text">Ett oväntat fel uppstod. Försök ladda om sidan.</p>
            <div className="empty-actions">
              <button onClick={this.handleRetry} className="btn">
                Försök igen
              </button>
              <button onClick={() => window.location.reload()} className="btn-quiet">
                Ladda om sidan
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
