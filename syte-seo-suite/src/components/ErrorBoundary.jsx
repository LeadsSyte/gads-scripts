import React from 'react';

// Catches render-time crashes in any subtree so a single broken module
// doesn't blank out the whole app. Shows the error with a stack trace
// and a "Retry" button that re-mounts the children.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || '', error, info);
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <div style={{ padding: 24, maxWidth: 900 }}>
        <div className="card" style={{ borderColor: 'var(--red)', padding: 18 }}>
          <h2 style={{ margin: 0, color: 'var(--red)', fontSize: 16 }}>
            {this.props.label ? this.props.label + ' crashed' : 'Something went wrong'}
          </h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            The rest of the app is still usable — click another module in the sidebar, or hit Retry to try this one again.
          </div>
          <pre style={{
            marginTop: 12,
            padding: 12,
            background: '#0d0e11',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 11,
            lineHeight: 1.5,
            color: '#ff8a8a',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap'
          }}>
{String(error?.message || error)}
{error?.stack ? '\n\n' + error.stack : ''}
{info?.componentStack ? '\n\nComponent stack:' + info.componentStack : ''}
          </pre>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="primary" onClick={this.reset}>Retry</button>
            <button onClick={() => window.location.reload()}>Reload Page</button>
          </div>
        </div>
      </div>
    );
  }
}
