import { useStore } from '../state/store';

export function StatusPanel() {
  const transport = useStore((s) => s.transport);
  const cursor = useStore((s) => s.cursor);
  const bridge = useStore((s) => s.bridge);
  const ports = useStore((s) => s.ports);
  const selectedOutPortId = useStore((s) => s.selectedOutPortId);
  const setSelectedOutPort = useStore((s) => s.setSelectedOutPort);
  const setTransport = useStore((s) => s.setTransport);
  const setCursor = useStore((s) => s.setCursor);

  const outPorts = ports.filter((p) => p.direction === 'out');

  const song = useStore((s) => s.song);
  const patterns = useStore((s) => s.patterns);
  const activePid = song.positions[transport.songPos];
  const activePattern = patterns.find((p) => p.id === activePid);

  return (
    <div className="panel" style={{ flex: '0 0 auto' }}>
      <div className="status">
        <span className="label">POS</span>
        <span className="pill">{String(transport.songPos).padStart(2, '0')}/{String(song.positions.length - 1).padStart(2, '0')}</span>

        <span className="label">PAT</span>
        <span className="pill">
          {activePattern ? `${String(activePattern.id).padStart(2, '0')} ${activePattern.name}` : '--'}
        </span>

        <span className="label">ROW</span>
        <span className="pill">{String(transport.row).padStart(2, '0')}</span>

        <span className="label">SPD</span>
        <input
          type="number"
          min={1}
          max={15}
          value={transport.speed}
          onChange={(e) => setTransport({ speed: Math.max(1, Math.min(15, Number(e.target.value))) })}
          style={{ width: '5ch' }}
        />

        <span className="label">BPM</span>
        <input
          type="number"
          min={20}
          max={255}
          value={transport.bpm}
          onChange={(e) => setTransport({ bpm: Math.max(20, Math.min(255, Number(e.target.value))) })}
          style={{ width: '6ch' }}
        />

        <span className="label">SPC</span>
        <input
          type="number"
          min={0}
          max={16}
          value={cursor.spc}
          onChange={(e) => setCursor({ spc: Math.max(0, Math.min(16, Number(e.target.value))) })}
          style={{ width: '5ch' }}
          title="Rows to advance after each note entry (0 = stay, 1 = default)"
        />

        <span className="label">OCT</span>
        <span className="pill">{cursor.octave}</span>

        <span className="label">
          <span className={`led ${cursor.editMode ? 'led--on' : ''}`} /> EDIT
        </span>
        <span className="value">{cursor.editMode ? 'ON' : 'OFF'}</span>

        <span className="label">
          <span className={`led ${bridge.connected ? 'led--on' : ''}`} /> MIDI
        </span>
        <select
          value={selectedOutPortId ?? ''}
          onChange={(e) => setSelectedOutPort(e.target.value || null)}
          style={{ minWidth: '16ch' }}
        >
          <option value="">— No output —</option>
          {outPorts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
