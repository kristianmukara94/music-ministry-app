import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, X } from 'lucide-react';
import { bridge } from './bridge';
import { refreshLicense } from './license';
import { formatSetupKey, isCompleteSetupKey, plainErrorText } from '../../shared/cloud-device.js';

/** Renews the church's license with a new setup key. The key lives only in this dialog's state and is sent once. */
export function RenewLicenseDialog({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const renew = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await bridge.cloud.renewLicense(key);
      await refreshLicense();
      onClose();
    } catch (err) {
      setError(plainErrorText(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => !busy && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="renew-license-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={renew}
        className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-accent/40 bg-surface p-6 shadow-2xl"
      >
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-accent/40 bg-accent/15 text-accent">
              <KeyRound size={20} aria-hidden />
            </span>
            <h2 id="renew-license-title" className="text-lg font-bold tracking-tight text-fg">
              Renew license
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-md border border-fg/20 text-muted hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg/80">Enter the new 12-character setup key. It renews the license for every laptop linked to this church.</span>
          <input
            autoFocus
            value={key}
            onChange={(e) => setKey(formatSetupKey(e.target.value))}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            aria-label="Setup key"
            className="h-11 rounded-md border border-fg/15 bg-panel-2 px-3 text-center font-mono text-lg tracking-widest uppercase outline-none focus:border-accent"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 px-4 text-xs font-bold tracking-wider text-muted uppercase hover:text-fg">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !isCompleteSetupKey(key)}
            className="h-10 rounded-md bg-accent px-5 text-xs font-bold tracking-wider text-on-accent uppercase hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Renewing…' : 'Renew'}
          </button>
        </div>
      </form>
    </div>
  );
}
