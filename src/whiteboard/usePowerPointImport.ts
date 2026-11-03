import { useCallback, useEffect, useReducer } from 'react';
import { bridge } from '../live/bridge';
import { failureMessage, importReducer, IDLE_IMPORT, successMessage } from '../../shared/import-progress';
import { errorText } from './errors';

const api = bridge.whiteboard;

/**
 * Runs a PowerPoint import and follows its progress. `start()` opens the picker and imports; while it runs `busy` is true and `progress` holds the
 * latest report from the main process. However it ends (success, cancel, or a rejection from the main process) the bar is reset and the button is free
 * again, and `onDone` or `onFail` is told with the message to show.
 */
export function usePowerPointImport({
  folderId,
  destination,
  onDone,
  onFail,
}: {
  folderId: number | null;
  destination: string;
  /** Called after a successful import (and after a cancelled one, with a null message) so the caller can reload its list. */
  onDone: (message: string | null) => void | Promise<void>;
  onFail: (message: string) => void;
}) {
  const [state, dispatch] = useReducer(importReducer, IDLE_IMPORT);

  useEffect(() => api.onImportProgress((progress) => dispatch({ type: 'progress', progress })), []);

  const start = useCallback(async () => {
    dispatch({ type: 'start' });
    let added: number | null;
    try {
      added = await api.importPowerPoint(folderId);
    } catch (err) {
      dispatch({ type: 'fail' });
      onFail(failureMessage(errorText(err)));
      return;
    }
    dispatch({ type: 'finish' });
    await onDone(successMessage(added, destination));
  }, [folderId, destination, onDone, onFail]);

  return { busy: state.busy, progress: state.progress, start };
}
