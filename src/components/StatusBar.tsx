// StatusBar — slim bar at the bottom of the app.
// Shows cloud account status and MIDI bridge connectivity.

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import cloud from '../lib/cloud';
import { useStore } from '../state/store';

export function StatusBar() {
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const bridgeConnected = useStore((s) => s.bridge.connected);

  useEffect(() => cloud.onAuthChange(setCloudUser), []);

  const cloudLabel = cloudUser
    ? `☁ ${cloudUser.user_metadata?.full_name ?? cloudUser.email ?? 'connected'}`
    : '☁ not signed in';

  const midiLabel = bridgeConnected ? '⬤ MIDI bridge' : '○ MIDI bridge';

  return (
    <div className="statusbar">
      <span className={`statusbar__item ${cloudUser ? 'statusbar__item--on' : 'statusbar__item--off'}`}>
        {cloudLabel}
      </span>
      <span className="statusbar__sep">|</span>
      <span className={`statusbar__item ${bridgeConnected ? 'statusbar__item--on' : 'statusbar__item--off'}`}>
        {midiLabel}
      </span>
    </div>
  );
}
