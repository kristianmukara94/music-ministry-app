import { OperatorApp } from './operator/OperatorApp';
import { LowerThirdView } from './output/LowerThirdView';
import { ProjectorView } from './output/ProjectorView';
import { PdfConverter } from './announcements/PdfConverter';
import { VideoThumbnailer } from './media/VideoThumbnailer';

// Each Electron window loads the same bundle; the hash picks its role.
// The browser source is served at /lower-third, with no hash, so the path picks that role.
const route = window.location.hash.replace(/^#\/?/, '') || (window.location.pathname === '/lower-third' ? 'lower-third' : 'operator');

export function App() {
  switch (route) {
    case 'projector':
      return <ProjectorView />;
    case 'preview':
      return <ProjectorView mirror />;
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
