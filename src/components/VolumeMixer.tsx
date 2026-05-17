/**
 * VolumeMixer — Per-channel volume faders, styled like an Amiga OctaMED mixer.
 *
 * Each channel has a vertical slider (0–100) and numeric readout.
 * Changes are applied to the sequencer's per-channel GainNode immediately
 * and persisted to the store so they survive re-mounts.
 */

import { useStore } from '../state/store';
import { CHANNELS } from '../state/types';
import type { Sequencer } from '../engine/sequencer';

const CH_NAMES = [
  'Ch 1','Ch 2','Ch 3','Ch 4','Ch 5','Ch 6','Ch 7','Ch 8',
  'Ch 9','Ch 10','Ch 11','Ch 12','Ch 13','Ch 14','Ch 15','Ch 16',
];

interface VolumeMixerProps {
  seq: Sequencer;
}

export function VolumeMixer({ seq }: VolumeMixerProps) {
  const trackVolumes  = useStore((s) => s.trackVolumes);
  const setTrackVolume = useStore((s) => s.setTrackVolume);
  const resetTrackVolumes = useStore((s) => s.resetTrackVolumes);
  const trackFlags    = useStore((s) => s.trackFlags);
  const toggleMute    = useStore((s) => s.toggleMute);
  const visibleTracks = useStore((s) => s.visibleTracks);

  const channelCount = Math.min(CHANNELS, visibleTracks);

  function handleVolume(ch: number, val: number) {
    setTrackVolume(ch, val);
    seq.setChannelVolume(ch, val);
  }

  return (
    <div className="vol-mixer">
      <div className="vol-mixer__header">
        <span className="vol-mixer__title upper">Volume Mixer</span>
        <button
          className="btn"
          type="button"
          onClick={() => {
            resetTrackVolumes();
            for (let ch = 0; ch < CHANNELS; ch++) seq.setChannelVolume(ch, 100);
          }}
          title="Reset all channels to 100"
          style={{ fontSize: '0.75rem', marginLeft: 'auto' }}
        >
          Reset All
        </button>
      </div>

      <div className="vol-mixer__channels">
        {Array.from({ length: channelCount }, (_, ch) => {
          const vol  = trackVolumes[ch] ?? 100;
          const mute = trackFlags[ch]?.mute ?? false;
          return (
            <div key={ch} className={`vol-mixer__ch${mute ? ' is-muted' : ''}`}>
              {/* Channel number */}
              <div className="vol-mixer__ch-num upper">{ch + 1}</div>

              {/* Vertical slider */}
              <div className="vol-mixer__slider-wrap">
                <input
                  type="range"
                  className="vol-mixer__slider"
                  min={0}
                  max={100}
                  step={1}
                  value={vol}
                  onChange={(e) => handleVolume(ch, Number(e.target.value))}
                  title={CH_NAMES[ch]}
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', WebkitAppearance: 'slider-vertical' } as React.CSSProperties}
                />
              </div>

              {/* Numeric readout + editable */}
              <input
                type="number"
                className="vol-mixer__vol-input"
                min={0}
                max={100}
                value={vol}
                onChange={(e) => handleVolume(ch, Math.max(0, Math.min(100, Number(e.target.value))))}
              />

              {/* Mute button */}
              <button
                className={`vol-mixer__mute-btn${mute ? ' is-active' : ''}`}
                type="button"
                title={mute ? 'Unmute' : 'Mute'}
                onClick={() => toggleMute(ch)}
              >
                M
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
