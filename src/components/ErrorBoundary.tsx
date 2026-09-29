import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: any;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  remountKey: number;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      remountKey: 0,
      showDetails: false
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[The Goated Farm ErrorBoundary] Uncaught render error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public componentDidUpdate(prevProps: Props) {
    // If the resetKey changed (e.g. user navigated to another screen), auto-clear the error
    if (this.props.resetKey !== undefined && prevProps.resetKey !== this.props.resetKey) {
      if (this.state.hasError) {
        this.handleRetry();
      }
    }
  }

  public handleRetry = () => {
    this.state = {
      ...this.state,
      hasError: false,
      error: null,
      errorInfo: null,
      remountKey: this.state.remountKey + 1,
      showDetails: false
    };

    try {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        remountKey: this.state.remountKey,
        showDetails: false
      });
    } catch {}

    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          id="error-boundary-screen"
          role="alert"
          className="min-h-[420px] p-6 sm:p-10 my-4 rounded-2xl bg-white border border-rose-200/90 shadow-sm flex flex-col items-center justify-center text-center max-w-lg mx-auto"
        >
          <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mb-4 shadow-2xs">
            <AlertOctagon className="w-8 h-8 stroke-[2.2]" />
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
            কিছু একটা সমস্যা হয়েছে
          </h2>
          <p className="text-sm sm:text-base text-gray-600 mt-1 font-medium">
            Something went wrong
          </p>

          <p className="text-xs sm:text-sm text-gray-500 mt-2.5 max-w-md leading-relaxed">
            এই স্ক্রিনটি লোড করার সময় একটি অপ্রত্যাশিত ত্রুটি ঘটেছে। নিচের বোতামে চাপ দিয়ে শুধুমাত্র এই স্ক্রিনটি পুনরায় লোড করুন।
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              id="btn-error-boundary-retry"
              onClick={this.handleRetry}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-sm font-bold shadow-xs transition-all active:scale-95 cursor-pointer min-h-[44px]"
            >
              <RotateCcw className="w-4 h-4 stroke-[2.5]" />
              <span>পুনরায় চেষ্টা করুন (Try Again)</span>
            </button>

            <button
              type="button"
              id="btn-error-boundary-reload"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.reload();
                }
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-semibold transition-colors cursor-pointer min-h-[44px]"
            >
              <span>পৃষ্ঠা রিফ্রেশ করুন (Reload Page)</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <React.Fragment key={this.state.remountKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
