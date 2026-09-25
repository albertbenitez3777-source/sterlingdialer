import { Component,type ErrorInfo,type ReactNode } from 'react';

type Props = { name: string; resetKey?: string; children: ReactNode };
type State = { failed: boolean };

/** A view failure must not unmount another module's ongoing conversation. */
export class ModuleBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Do not log component props, which can include private session/contact data.
    console.error(`Federal One: ${this.props.name} could not render.`);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="glass-card" role="alert" aria-label={`${this.props.name} unavailable`}>
      <p>{this.props.name} could not load. Other sections remain available.</p>
      <button className="secondary-button" onClick={() => this.setState({ failed: false })}>
        Retry {this.props.name.toLowerCase()}
      </button>
    </section>;
  }
}
