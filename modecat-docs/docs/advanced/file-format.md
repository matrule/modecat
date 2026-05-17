# File Format

ModeCat saves projects as plain JSON with the extension `.modecat.json`. The format is human-readable and version-stamped, so it's easy to inspect, diff, or generate programmatically.

## Loading and saving

Use **File → Save** (or `Ctrl+S`) to download the current project. Use **File → Load** to open a `.modecat.json` file. Both operations work entirely in the browser — nothing is uploaded anywhere.

## Top-level schema

```jsonc
{
  "format": "modecat",        // always this string
  "version": 2,               // format version
  "meta": { ... },
  "song": { ... },
  "patterns": [ ... ],
  "instruments": [ ... ],
  "transport": { ... },
  "mutes": [ ... ]
}
```

## `meta`

```jsonc
{
  "title": "My Track",
  "author": "Mat"
}
```

Both fields are free-form strings. Neither is required.

## `transport`

```jsonc
{
  "bpm": 125,    // beats per minute (20–255)
  "speed": 6     // ticks per row (1–15)
}
```

## `song`

```jsonc
{
  "positions": [1, 2, 2, 3],  // pattern IDs in playback order
  "sectionMarkers": [
    { "pos": 0, "label": "Intro" },
    { "pos": 4, "label": "Verse" }
  ]
}
```

`positions` is an ordered array of pattern IDs (not indices — IDs are stable across insertions/deletions). The same pattern can appear multiple times. `sectionMarkers` is optional.

## `patterns`

```jsonc
[
  {
    "id": 1,
    "name": "INTRO",
    "rows": [
      [
        // 16 cells — one per channel
        { "note": "C-3", "inst": 1, "cmd": "0C", "data": "64" },
        { "note": "---", "inst": 0, "cmd": "--", "data": "--" },
        // ... 14 more channels
      ],
      // ... up to 64 rows
    ]
  }
]
```

Each `rows` entry is an array of exactly 16 cell objects. A cell with all defaults (`note: "---", inst: 0, cmd: "--", data: "--"`) is stored as `null` to keep file sizes small. When reading, treat `null` cells as empty.

### Cell fields

| Field | Type | Values |
|-------|------|--------|
| `note` | string | `C-0`–`B-7`, `---` (empty), `-\|-` (hold) |
| `inst` | integer | 1–32, or 0 for none |
| `cmd` | string | Two-char hex (`00`–`FF`) or `--` |
| `data` | string | Two-char hex (`00`–`FF`) or `--` |

## `instruments`

An array of exactly 32 entries, one per slot. Unused slots have `kind: "empty"`.

### Empty slot

```jsonc
{ "kind": "empty", "name": "--" }
```

### MIDI instrument

```jsonc
{
  "kind": "midi",
  "name": "Bass Synth",
  "channel": 0,        // MIDI channel, 0-indexed (0–15)
  "program": 38,       // GM program number (-1 = no program change)
  "velocity": 100,     // default velocity (0–127)
  "lengthRows": 4      // note-off after this many rows
}
```

### Synth instrument

```jsonc
{
  "kind": "synth",
  "name": "Sine",
  "waveform": "<base64-encoded Float32Array>",  // 32 samples, one cycle
  "attackMs": 5,
  "holdMs": 500,
  "decayMs": 50,
  "sustainLevel": 0.8,
  "releaseMs": 100
}
```

The `waveform` field encodes the raw bytes of a 32-element `Float32Array` as base64. Each sample is in the range −1.0 to 1.0.

### Sample instrument

```jsonc
{
  "kind": "sample",
  "name": "Kick 01",
  "pcm": "<base64-encoded Float32Array>",  // mono, any length
  "sampleRate": 44100,
  "loopEnabled": false,
  "loopStart": 0,     // sample index
  "loopEnd": 88199    // sample index (inclusive)
}
```

`pcm` is the raw bytes of a mono `Float32Array` encoded as base64. Multi-channel audio is downmixed to mono on load.

### Hybrid instrument

A hybrid instrument combines a synth oscillator with a sample layer:

```jsonc
{
  "kind": "hybrid",
  "name": "Pluck",
  "waveform": "...",
  "pcm": "...",
  "sampleRate": 44100,
  "attackMs": 1,
  "releaseMs": 200,
  "loopEnabled": false,
  "loopStart": 0,
  "loopEnd": 0
}
```

## `mutes`

An array of 16 booleans, one per channel. `true` means the channel is muted.

```jsonc
[false, false, true, false, false, false, false, false,
 false, false, false, false, false, false, false, false]
```

## Version history

| Version | Changes |
|---------|---------|
| `1` | Initial format (`octomed` format string) |
| `2` | Renamed to `modecat`; added `sectionMarkers`; `loopStart`/`loopEnd` initialised to full sample range on load |

## Generating files programmatically

Because the format is plain JSON, you can generate `.modecat.json` files from any language. The minimum viable file is:

```json
{
  "format": "modecat",
  "version": 2,
  "meta": { "title": "Generated", "author": "" },
  "song": { "positions": [1], "sectionMarkers": [] },
  "patterns": [
    {
      "id": 1,
      "name": "BLOCK 1",
      "rows": []
    }
  ],
  "instruments": [
    { "kind": "empty", "name": "--" }
  ],
  "transport": { "bpm": 120, "speed": 6 },
  "mutes": [false,false,false,false,false,false,false,false,
            false,false,false,false,false,false,false,false]
}
```

Empty rows are filled with `null` cells when loaded. ModeCat will accept a `rows` array of any length up to the configured pattern maximum.
