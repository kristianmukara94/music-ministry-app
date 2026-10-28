import { createRoot } from 'react-dom/client';
import '../styles.css';
import { TvView } from './TvView';

// The TV entry: its own page (tv.html), built next to the Electron app's page, and served by the Secondary port at /tv.
createRoot(document.getElementById('root')!).render(<TvView />);
