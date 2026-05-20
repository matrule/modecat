// CloudProjectsDialog — list, open, and delete cloud projects.
// Opened from Project → Cloud → Open from Cloud…

import { useEffect, useState } from 'react';
import cloud, { type CloudProject } from '../lib/cloud';
import { importSongFile } from '../state/persist';
import { useStore } from '../state/store';

interface Props {
  onClose: () => void;
}

export function CloudProjectsDialog({ onClose }: Props) {
  const [projects, setProjects]   = useState<CloudProject[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState<string | null>(null);
  const [deleting, setDeleting]   = useState<string | null>(null);

  useEffect(() => {
    cloud.listProjects()
      .then(setProjects)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function openProject(id: string) {
    try {
      setError(null);
      const { data } = await cloud.loadProject(id);
      importSongFile(data);
      onClose();
    } catch (e) {
      setError(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function deleteProject(id: string, title: string) {
    if (!confirm(`Delete "${title}" from the cloud? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await cloud.deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      // Clear cloudId from current song if it matched
      const s = useStore.getState();
      if (s.meta.cloudId === id) s.setMeta({ cloudId: undefined });
    } catch (e) {
      setError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(null);
    }
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1200,
    background: 'rgba(0,0,30,0.70)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const dialog: React.CSSProperties = {
    background: '#000022', border: '2px solid #0055AA',
    width: 560, maxWidth: '92vw', maxHeight: '80vh',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#AADDFF',
  };
  const titleBar: React.CSSProperties = {
    background: '#0055AA', color: '#fff',
    padding: '0.25rem 0.6rem',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexShrink: 0,
  };
  const body: React.CSSProperties = {
    padding: '0.5rem', overflowY: 'auto', flex: 1,
  };
  const row: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 5ch 14ch 4ch',
    gap: '0.4rem',
    alignItems: 'center',
    padding: '0.3rem 0.4rem',
    borderBottom: '1px solid #001144',
    cursor: 'pointer',
  };

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div style={dialog} onMouseDown={(e) => e.stopPropagation()}>

        <div style={titleBar}>
          <span>Cloud Projects</span>
          <button type="button" className="x" style={{ color: '#fff' }} onClick={onClose}>×</button>
        </div>

        <div style={body}>
          {loading && <div style={{ padding: '1rem', opacity: 0.6 }}>Loading…</div>}
          {error   && <div style={{ color: '#FF6666', padding: '0.4rem' }}>{error}</div>}

          {!loading && projects.length === 0 && !error && (
            <div style={{ padding: '1rem', opacity: 0.5 }}>No cloud projects yet.</div>
          )}

          {/* Header */}
          {projects.length > 0 && (
            <div style={{ ...row, cursor: 'default', opacity: 0.5, fontSize: '0.7rem', borderBottom: '1px solid #0055AA' }}>
              <span>TITLE</span>
              <span style={{ textAlign: 'right' }}>BPM</span>
              <span style={{ textAlign: 'right' }}>UPDATED</span>
              <span />
            </div>
          )}

          {projects.map((p) => (
            <div
              key={p.id}
              style={row}
              onClick={() => openProject(p.id)}
              title={`Open "${p.title}"`}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#001133')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.title || '(untitled)'}
              </span>
              <span style={{ textAlign: 'right', color: '#FF8800' }}>
                {p.bpm ?? '—'}
              </span>
              <span style={{ textAlign: 'right', color: '#556688', fontSize: '0.7rem' }}>
                {new Date(p.updated_at).toLocaleDateString()}
              </span>
              <button
                type="button"
                className="x"
                disabled={deleting === p.id}
                title="Delete from cloud"
                onClick={(e) => { e.stopPropagation(); deleteProject(p.id, p.title); }}
                style={{ color: '#FF4444', opacity: deleting === p.id ? 0.4 : 0.7 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div style={{ padding: '0.3rem 0.5rem', borderTop: '1px solid #001144', flexShrink: 0 }}>
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
