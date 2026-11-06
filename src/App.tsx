import { OperatorApp } from './operator/OperatorApp';
import { LowerThirdView } from './output/LowerThirdView';
import { ProjectorView } from './output/ProjectorView';
import { MirrorWindow } from './output/MirrorWindow';
import { PdfConverter } from './announcements/PdfConverter';
import { VideoThumbnailer } from './media/VideoThumbnailer';
import { EditorWindow } from './golive/EditorWindow';

// Each Electron window loads the same bundle; the hash picks its role.
// The browser source is served at /lower-third, with no hash, so the path picks that role.
const route = window.location.hash.replace(/^#\/?/, '') || (window.location.pathname === '/lower-third' ? 'lower-third' : 'operator');

// The slide editor window: `#/editor/<slide id>`.
const editorSlide = /^editor\/(\d+)$/.exec(route);

export function App() {
  if (editorSlide) return <EditorWindow slideId={Number(editorSlide[1])} />;
  switch (route) {
    case 'projector':
      return <ProjectorView />;
    case 'preview':
      return <MirrorWindow />;
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
