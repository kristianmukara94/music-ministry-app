import { createRoot } from 'react-dom/client';
import './tv.css';
import { TvView } from './TvView';

// The TV entry: its own page (tv.html), built next to the Electron app's page, and served by the Secondary port at /tv. It has its own plain
// stylesheet (tv.css) and not the app's, which needs a newer browser than many Smart TVs have.
createRoot(document.getElementById('root')!).render(<TvView />);
