import { useStore } from '../state/store';

const MENUS = ['Project', 'Edit', 'Block', 'Instrument', 'Settings', 'MIDI', 'Help'];

export function TitleBar() {
  const meta = useStore((s) => s.meta);
  const transport = useStore((s) => s.transport);
  const bridge = useStore((s) => s.bridge);

  return (
    <>
      <div className="modecat__title">
        <span className="left">ModeCat Web 4.0</span>
        <span className="mid">
          {meta.title} · {meta.author}
        </span>
        <span className="right">
          {transport.playing ? '▶ PLAYING' : '■ STOPPED'} ·{' '}
          {bridge.connected ? 'MIDI ONLINE' : 'MIDI OFFLINE'}
        </span>
      </div>
      <div className="modecat__menubar">
        {MENUS.map((m) => (
          <button key={m} className="menu" type="button" tabIndex={-1}>
            {m}
          </button>
        ))}
      </div>
    </>
  );
}
