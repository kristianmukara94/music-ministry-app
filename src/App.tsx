import { Suspense } from 'react';
// First, for every window: the modules that listen from the moment they are imported.
import './system/everyWindow';
import { lazyView } from './system/lazyView';
import { OperatorApp } from './operator/OperatorApp';
import { LowerThirdView } from './output/LowerThirdView';
import { ProjectorView } from './output/ProjectorView';
import { CastStageView } from './output/CastStageView';
import { MirrorWindow } from './output/MirrorWindow';
import { PdfConverter } from './announcements/PdfConverter';
import { VideoThumbnailer } from './media/VideoThumbnailer';
import { FailoverOverlay } from './output/FailoverOverlay';

// Each Electron window loads the same bundle; the hash picks its role.
// The browser source is served at /lower-third, with no hash, so the path picks that role.
const route = window.location.hash.replace(/^#\/?/, '') || (window.location.pathname === '/lower-third' ? 'lower-third' : 'operator');

// The slide editor window: `#/editor/<slide id>`.
const editorSlide = /^editor\/(\d+)$/.exec(route);

// The editor is a window of its own, opened on demand. The output windows stay in the first file: they must be up the moment they open.
const EditorWindow = lazyView(() => import('./golive/EditorWindow').then((m) => m.EditorWindow));

export function App() {
  if (editorSlide) {
    return (
      <Suspense fallback={null}>
        <EditorWindow slideId={Number(editorSlide[1])} />
      </Suspense>
    );
  }
  switch (route) {
    case 'projector':
      return <ProjectorView />;
    case 'preview':
      return <MirrorWindow />;
    // Nearby TV Cast renders these two in hidden 1920x1080 windows and sends them to TVs as pictures (electron/tv-cast-manager.js).
    case 'cast-projector':
      return <ProjectorView />;
    case 'cast-stage':
      return <CastStageView />;
    // The sanctuary failover surface: a hidden window kept over the projector by the watchdog (electron/watchdog.js).
    case 'failover':
      return <FailoverOverlay />;
    case 'lower-third':
      return <LowerThirdView />;
    case 'pdf-converter':
      return <PdfConverter />;
    case 'thumbnailer':
      return <VideoThumbnailer />;
    default:
      return <OperatorApp />;
  }
}
