import { useEffect, useState, type ReactNode } from 'react';
import { Cloud, Copy, Laptop, UserPlus, WifiOff } from 'lucide-react';
import { bridge, type CloudLink, type CreatedWebUser, type NewWebUser } from '../live/bridge';
import { checkWebUser, cloudViewState, formatLinkCode, isCompleteLinkCode } from '../../shared/cloud-device.js';

const cloud = bridge.cloud;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const emptyUser: NewWebUser = { username: '', displayName: '', role: 'planner' };

const button =
  'flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-xs font-bold uppercase hover:bg-panel-2 disabled:opacity-40';
const primary =
  'flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-bold uppercase text-on-accent shadow-md hover:brightness-110 disabled:opacity-40';
const field = 'h-10 rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm outline-none focus:border-accent';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5 backdrop-blur-md">
      <h2 className="mb-4 border-b border-line pb-2 text-xl font-black uppercase condensed">{title}</h2>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

/**
 * Cloud sync: links this laptop to its church with a one-time code from the admin, and shows the link. The device token is
 * kept on this computer, encrypted by the operating system. This screen only ever receives the display fields.
 */
export function CloudSyncSettings() {
  const [link, setLink] = useState<CloudLink | null>(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [newUser, setNewUser] = useState<NewWebUser>(emptyUser);
  const [created, setCreated] = useState<CreatedWebUser | null>(null);
  const [copied, setCopied] = useState(false);

  // The temporary password lives only in this screen's state. It is cleared when the screen goes away.
  useEffect(() => () => setCreated(null), []);

  const refresh = () =>
    cloud
      .status()
      .then(setLink)
      .catch((err) => setError(errorText(err)));

  useEffect(() => {
    void refresh();
    void cloud.defaultLabel().then(setLabel).catch(() => setLabel('This computer'));
  }, []);

  if (!link) return <div className="p-6 text-sm text-muted">{error ?? 'Checking the link…'}</div>;

  const view = cloudViewState(link);
  const shownError = error ?? view.error;

  const linkThisLaptop = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await cloud.link(code, label.trim()));
      setCode('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!window.confirm('Unlink this laptop? It will stop syncing with the church until it is linked again.')) return;
    setBusy(true);
    setError(null);
    try {
      setLink(await cloud.unlink());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const newUserProblem = checkWebUser(newUser);
  const newUserTyped = newUser.username !== '' || newUser.displayName !== '';

  const addWebUser = async () => {
    setBusy(true);
    setError(null);
    try {
      setCreated(await cloud.createWebUser(newUser));
      setCopied(false);
      setNewUser(emptyUser);
      setAddingUser(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const closeCreated = () => {
    setCreated(null);
    setCopied(false);
  };

  const copyPassword = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the password and copy it by hand.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card title="Cloud sync">
        <p className="text-sm text-muted">
          Link this laptop to your church so it can share its plans and song titles with the planner on the web. Lyrics, Bible text,
          announcements and media stay on this laptop.
        </p>

        {view.kind === 'unlinked' && (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="eyebrow flex items-center gap-2">
                <Copy size={14} aria-hidden /> Link code from your admin
              </span>
              <input
                value={code}
                onChange={(e) => setCode(formatLinkCode(e.target.value))}
                placeholder="XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="link-code-help"
                className={`${field} w-48 uppercase tracking-widest`}
              />
              <span id="link-code-help" className="text-xs text-muted">
                The code works once and expires after 10 minutes.
              </span>
            </label>
            <label className="flex flex-col gap-2">
              <span className="eyebrow flex items-center gap-2">
                <Laptop size={14} aria-hidden /> Name for this laptop
              </span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} className={`${field} w-72`} />
            </label>
            <div>
              <button
                type="button"
                onClick={linkThisLaptop}
                disabled={busy || !isCompleteLinkCode(code) || label.trim() === ''}
                className={primary}
              >
                <Cloud size={15} aria-hidden /> {busy ? 'Linking…' : 'Link this laptop'}
              </button>
            </div>
          </div>
        )}

        {view.kind === 'linked' && (
          <div className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted">Church</dt>
              <dd className="font-semibold">{view.churchName || 'Not known yet'}</dd>
              <dt className="text-muted">Linked admin</dt>
              <dd>{view.adminName}</dd>
              <dt className="text-muted">This laptop</dt>
              <dd>{view.deviceLabel}</dd>
              <dt className="text-muted">Last synced</dt>
              <dd>{view.lastSynced}</dd>
            </dl>
            {view.offline && <p className="text-xs text-muted">Showing the last known link. The cloud could not be reached just now.</p>}

            {addingUser ? (
              <div className="flex flex-col gap-4 rounded-md border border-line p-4">
                <h3 className="text-sm font-bold">New web user</h3>
                <label className="flex flex-col gap-2">
                  <span className="eyebrow">Username</span>
                  <input
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    maxLength={80}
                    autoComplete="off"
                    spellCheck={false}
                    className={`${field} w-72`}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="eyebrow">Name</span>
                  <input
                    value={newUser.displayName}
                    onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                    maxLength={120}
                    className={`${field} w-72`}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="eyebrow">Role</span>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as NewWebUser['role'] })}
                    className={`${field} w-48`}
                  >
                    <option value="admin">Admin</option>
                    <option value="planner">Planner</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
                {newUserTyped && newUserProblem && <p className="text-xs text-muted">{newUserProblem}</p>}
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={addWebUser} disabled={busy || newUserProblem !== null} className={primary}>
                    <UserPlus size={15} aria-hidden /> {busy ? 'Creating…' : 'Create user'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingUser(false);
                      setNewUser(emptyUser);
                    }}
                    disabled={busy}
                    className={button}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <button type="button" onClick={() => setAddingUser(true)} disabled={busy} className={button}>
                  <UserPlus size={15} aria-hidden /> Create web user
                </button>
              </div>
            )}

            {created && (
              <div role="status" className="flex flex-col gap-3 rounded-md border border-accent p-4">
                <h3 className="text-sm font-bold">{created.username} has been added</h3>
                <p className="text-sm">
                  Temporary password:{' '}
                  <code className="select-all font-mono text-base font-bold tracking-widest">{created.temporaryPassword}</code>
                </p>
                <p className="text-xs text-muted">They must change this password the first time they sign in.</p>
                <p className="text-xs text-muted">Give this to the new user. It won't be shown again.</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={copyPassword} className={button}>
                    <Copy size={15} aria-hidden /> {copied ? 'Copied' : 'Copy password'}
                  </button>
                  <button type="button" onClick={closeCreated} className={primary}>
                    Done
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={refresh} disabled={busy} className={button}>
                Check now
              </button>
              <button type="button" onClick={unlink} disabled={busy} className={button}>
                Unlink this laptop
              </button>
            </div>
          </div>
        )}

        {shownError && (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <WifiOff size={15} className="mt-0.5 shrink-0" aria-hidden />
            {shownError}
          </p>
        )}
      </Card>
    </div>
  );
}
