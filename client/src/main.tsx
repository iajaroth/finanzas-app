import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/tomorrow/500.css';
import '@fontsource/tomorrow/600.css';
import '@fontsource/tomorrow/700.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/app.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
