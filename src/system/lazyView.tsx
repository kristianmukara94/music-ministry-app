// A page of the app whose code is read when it is first opened (or earlier, while the console is idle). Once its code is in, it renders
// directly: no blank frame on the way.
import { Component, lazy, useState, type ComponentType, type ReactNode } from 'react';

export interface LazyView<P extends object> {
  (props: P): ReactNode;
  /** Reads the page's code now, so opening it later is immediate. */
  preload: () => Promise<unknown>;
}

export function lazyView<P extends object>(load: () => Promise<ComponentType<P>>): LazyView<P> {
  let loaded: ComponentType<P> | null = null;
  const preload = () =>
    load().then((component) => {
      loaded = component;
      return { default: component };
    });
  const Deferred = lazy(preload) as unknown as ComponentType<P>;
  function View(props: P) {
    // Chosen once for this mount: changing the component type later would remount the page and lose what is on it.
    const [Page] = useState<ComponentType<P>>(() => loaded ?? Deferred);
    return <Page {...props} />;
  }
  View.preload = () => (loaded ? Promise.resolve() : preload());
  return View;
}

/** The dark space a page appears in while its code is read: the canvas behind it shows through, so nothing flashes. */
export function ViewLoading() {
  return <div className="flex-1" aria-busy="true" />;
}

interface BoundaryProps {
  /** Changing it (the operator opens another page) clears the failure. */
  resetKey: string;
  message: string;
  reloadLabel: string;
  children: ReactNode;
}

/**
 * Keeps one page's failure to that page. The top bar, the sidebar and everything on air carry on; the main process holds the live state, so
 * reloading the console changes nothing on the screens.
 */
export class ViewBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[view] this page stopped:', error);
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="m-5 rounded-xl border border-danger/60 bg-panel p-6">
        <p className="text-sm text-fg">{this.props.message}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-on-accent">
          {this.props.reloadLabel}
        </button>
      </div>
    );
  }
}
