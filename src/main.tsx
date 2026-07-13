import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './app/style.css';
import './app/pareto-rail-dark.css';
import { App } from './app/App';
import { installDevErrorOverlay } from './ui/dev-error-overlay';

if (import.meta.env.DEV) installDevErrorOverlay();

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
document.body.classList.remove('booting');
