import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render errors so the app shows a friendly screen, not a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("Erro na app:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="text-4xl">🙈</div>
          <div className="space-y-1">
            <h1 className="text-xl font-display">Algo correu mal</h1>
            <p className="text-sm text-tinta/60 dark:text-creme/60">
              A app encontrou um erro inesperado.
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
