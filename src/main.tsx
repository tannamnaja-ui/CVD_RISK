import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Sarabun bundled with the app (no Google Fonts request), so it also works without internet
import '@fontsource/sarabun/400.css';
import '@fontsource/sarabun/600.css';
import '@fontsource/sarabun/700.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
