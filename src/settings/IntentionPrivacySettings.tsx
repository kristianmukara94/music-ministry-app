import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Loader2, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { bridge, type VaultStatus } from '../live/bridge';

const errorText = (err: unknown) => {
  const text = err instanceof Error ? err.message : String(err);
  // Electron prefixes errors thrown in the main process; the sentence after it is the one written for the operator.
  return text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
};

const MIN = 10;
const button =
  'flex h-10 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40';
const primary = 'flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-bold uppercase text-on-accent hover:brightness-110 disabled:opacity-40';
const input = 'h-10 w-full rounded-md border border-fg/15 bg-panel-2 px-3 text-sm text-fg';

type Notice = { tone: 'ok' | 'error'; text: string } | null;
type Mode = 'idle' | 'change' | 'disable';

function Field({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
      {label}
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} className={input} />
    </label>
  );
}

/**
 * Holy Mass intention privacy: the body of every Mass Intention note is sealed in the database with a key made from a parish passphrase. Each
 * laptop enters it once; a backup or a shared database opens on any laptop that knows it, and on no other.
 */
export function IntentionPrivacySettings() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [pass, setPass] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    bridge.vault.status().then(setStatus).catch((err) => setNotice({ tone: 'error', text: errorText(err) }));
  }, []);

  const clear = () => {
    setPass('');
    setNext('');
    setConfirm('');
    setMode('idle');
  };

  const run = async (action: () => Promise<VaultStatus & { damaged?: number }>, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setStatus(result);
      clear();
      const damaged = result.damaged ? ` ${result.damaged} damaged note${result.damaged === 1 ? ' was' : 's were'} left as ${result.damaged === 1 ? 'it was' : 'they were'}.` : '';
      setNotice({ tone: 'ok', text: done + damaged });
    } catch (err) {
      setNotice({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!status) return;
    if (!status.configured) {
      if (pass.length < MIN) return setNotice({ tone: 'error', text: `The passphrase must be at least ${MIN} characters.` });
      if (pass !== confirm) return setNotice({ tone: 'error', text: 'The two passphrases do not match.' });
      return void run(() => bridge.vault.setup(pass), 'Holy Mass intention privacy is on. Existing Holy Mass intentions are now sealed.');
    }
    if (!status.unlocked) return void run(() => bridge.vault.unlock(pass), 'This laptop is unlocked.');
    if (mode === 'change') {
      if (next.length < MIN) return setNotice({ tone: 'error', text: `The new passphrase must be at least ${MIN} characters.` });
      if (next !== confirm) return setNotice({ tone: 'error', text: 'The two new passphrases do not match.' });
      return void run(() => bridge.vault.changePassphrase(pass, next), 'The passphrase is changed. Other laptops must enter the new one.');
    }
    if (mode === 'disable') return void run(() => bridge.vault.disable(pass), 'Holy Mass intention privacy is off. Holy Mass intentions are stored as plain text again.');
  };

  const state = !status ? null : !status.configured ? 'off' : status.unlocked ? 'unlocked' : 'locked';

  return (
    <section aria-labelledby="intention-privacy-heading" className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5">
      <h2 id="intention-privacy-heading" className="flex items-center gap-2 border-b border-line pb-2 text-xl font-bold tracking-tight">
        <ShieldCheck size={18} aria-hidden /> Holy Mass Intention Privacy
      </h2>
      <p className="text-sm text-muted">
        Seals the text of every Mass Intention note in the database with a parish passphrase (AES-256-GCM). Each laptop enters it once.
        Titles are not sealed, since they appear in plans and on the web planner.
      </p>

      {state === 'off' && (
        <p role="note" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-fg">
          Write the passphrase down and keep it safe. If it is lost, sealed Holy Mass intentions cannot be recovered by anyone, from this
          database or from any backup.
        </p>
      )}
      {state === 'locked' && (
        <p className="flex items-center gap-2 text-sm font-semibold text-danger">
          <Lock size={15} aria-hidden /> Locked on this laptop: Holy Mass intentions show no text and cannot be edited.
        </p>
      )}
      {state === 'unlocked' && (
        <p className="flex items-center gap-2 text-sm font-semibold text-ok">
          <LockOpen size={15} aria-hidden /> Unlocked on this laptop.
          {!status?.remembers && <span className="font-normal text-muted">Windows cannot keep the key here, so it is asked for at each start.</span>}
        </p>
      )}

      {state && (state !== 'unlocked' || mode !== 'idle') && (
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
          <Field
            label={state === 'off' ? 'New parish passphrase' : 'Parish passphrase'}
            value={pass}
            onChange={setPass}
            autoComplete={state === 'off' ? 'new-password' : 'current-password'}
          />
          {mode === 'change' && <Field label="New passphrase" value={next} onChange={setNext} autoComplete="new-password" />}
          {(state === 'off' || mode === 'change') && <Field label="Type the new passphrase again" value={confirm} onChange={setConfirm} autoComplete="new-password" />}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy || !pass} className={primary}>
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <KeyRound size={15} aria-hidden />}
              {state === 'off' ? 'Turn on privacy' : state === 'locked' ? 'Unlock' : mode === 'change' ? 'Change passphrase' : 'Turn off privacy'}
            </button>
            {mode !== 'idle' && (
              <button type="button" onClick={clear} disabled={busy} className={button}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {state === 'unlocked' && mode === 'idle' && (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => run(() => bridge.vault.lock(), 'This laptop is locked.')} disabled={busy} className={button}>
            <Lock size={15} aria-hidden /> Lock this laptop
          </button>
          <button type="button" onClick={() => setMode('change')} disabled={busy} className={button}>
            <KeyRound size={15} aria-hidden /> Change passphrase
          </button>
          <button type="button" onClick={() => setMode('disable')} disabled={busy} className={button}>
            Turn off privacy
          </button>
        </div>
      )}

      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${notice.tone === 'error' ? 'text-danger' : 'text-ok'}`}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
