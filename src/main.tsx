import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/modecat.css';
import cloud from './lib/cloud';

// Initialise cloud before React renders.
// Handles the mc_token / mc_refresh params from the cross-domain auth redirect
// and establishes a Supabase session (or picks up the persisted one).
cloud.init().catch((err) => console.warn('cloud.init failed:', err));

const root = document.getElementById('root');
if (!root) {
  throw new Error('No #root element');
}
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
