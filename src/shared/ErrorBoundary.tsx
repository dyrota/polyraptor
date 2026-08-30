import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  hasError: boolean;
}

// Cheap defense-in-depth around any result-rendering area that now receives
// genuinely unpredictable data for the first time (a custom problem's or
// algorithm's trace) -- a rendering bug there shouldn't take down the whole
// panel. React error boundaries must be class components; there is no hook
// equivalent.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('polyraptor: caught a rendering error', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <div className="error-boundary-fallback">Something went wrong rendering this result.</div>;
    }
    return this.props.children;
  }
}
