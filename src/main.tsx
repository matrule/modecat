import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/modecat.css';
import cloud from './lib/cloud';
import { importSongFile } from './state/persist';
import { useStore } from './state/store';

// Apply a pending new-project title set by the "New" menu action before reload.
const pendingTitle = sessionStorage.getItem('mc_new_project_title');
if (pendingTitle) {
  sessionStorage.removeItem('mc_new_project_title');
  useStore.getState().setMeta({ title: pendingTitle, author: '' });
}

// Initialise cloud before React renders.
// Handles the mc_token / mc_refresh / mc_project params from the cross-domain
// auth redirect and establishes a Supabase session (or picks up the persisted one).
// If the account platform passed mc_project, auto-load that project once signed in.
cloud.init().then(() => {
  const projectId = cloud.getRequestedProjectId();
  if (projectId && cloud.isConnected()) {
    cloud.loadProject(projectId)
      .then(({ data }) => importSongFile(data))
      .catch((err) => console.warn('cloud: auto-load project failed:', err));
  }
}).catch((err) => console.warn('cloud.init failed:', err));

const root = document.getElementById('root');
if (!root) {
  throw new Error('No #root element');
}
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
