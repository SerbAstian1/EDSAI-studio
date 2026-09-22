import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { applyStoredTheme } from './theme.js';

// Before the first render, so a person who chose dark never sees a frame of
// light while React catches up.
applyStoredTheme();

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
