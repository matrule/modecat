import { useStore } from '../state/store';

interface Props {
  onPlay: () => void;
  onStop: () => void;
  onContinue: () => void;
  onPanic: () => void;
}

export function ButtonCluster({ onPlay, onStop, onContinue, onPanic }: Props) {
  const playing = useStore((s) => s.transport.playing);
  const recording = useStore((s) => s.transport.recording);
  const setTransport = useStore((s) => s.setTransport);
  const editMode = useStore((s) => s.cursor.editMode);
  const setEditMode = useStore((s) => s.setEditMode);
  const chordMode = useStore((s) => s.cursor.chordMode);
  const setChordMode = useStore((s) => s.setChordMode);

  return (
    <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
      <button className="btn btn--play" data-pressed={playing} onClick={onPlay} type="button" tabIndex={-1}>
        ▶ Play
      </button>
      <button className="btn" onClick={onContinue} type="button" tabIndex={-1}>
        ▶▶ Cont
      </button>
      <button className="btn" data-pressed={!playing} onClick={onStop} type="button" tabIndex={-1}>
        ■ Stop
      </button>
      <button
        className="btn btn--accent"
        data-pressed={recording}
        onClick={() => setTransport({ recording: !recording })}
        type="button"
        tabIndex={-1}
      >
        ● Rec
      </button>
      <button
        className="btn"
        data-pressed={editMode}
        onClick={() => setEditMode(!editMode)}
        type="button"
        tabIndex={-1}
      >
        Edit
      </button>
      <button
        className="btn"
        data-pressed={chordMode}
        onClick={() => setChordMode(!chordMode)}
        type="button"
        tabIndex={-1}
        title="Chord mode — notes advance horizontally (manual §CHORD ENTERING AID p.64)"
      >
        Chord
      </button>
      <button className="btn btn--danger" onClick={onPanic} type="button" tabIndex={-1}>
        ⚠ Panic
      </button>
    </div>
  );
}
