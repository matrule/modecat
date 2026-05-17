/**
 * Built-in drum kit definitions for ModeCat.
 *
 * Each kit maps to a set of voices (name, sample URL, default MIDI note).
 * Sample files live in /public/samples/<kit>/  and are served as static assets.
 *
 * Licence: TR-808 samples — CC0 1.0 Universal (public domain)
 *   Source: github.com/tr-808-soundbank  Fischer TR-808 sample pack
 */

export interface KitVoice {
  /** Human-readable voice name shown in the Drum Editor. */
  name: string;
  /** Path relative to the app root, e.g. /samples/808/BD.WAV */
  sampleUrl: string;
  /**
   * MIDI note the sample plays at its "natural" pitch.
   * 36 = C-2 (standard kick / GM convention), 38 = D-2 (snare), etc.
   * All 808 samples are typically triggered at C-3 (48) for unity pitch,
   * but leaving as 48 means the drum editor fires at defaultNote 48 too.
   */
  defaultNote: number;
  /** Suppress note-off so samples ring out naturally (one-shot). */
  oneShot: boolean;
}

export interface DrumKit {
  id: string;
  name: string;
  /** Short credit line shown in the UI. */
  credit: string;
  voices: KitVoice[];
}

// ── TR-808 (Fischer CC0 sample pack) ─────────────────────────────────────────

const TR808: DrumKit = {
  id: 'tr808',
  name: 'TR-808',
  credit: 'CC0 · Fischer TR-808 pack',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/808/BD.WAV', defaultNote: 48, oneShot: true  },
    { name: 'SNARE',      sampleUrl: '/samples/808/SD.WAV', defaultNote: 48, oneShot: true  },
    { name: 'CLOSED HH',  sampleUrl: '/samples/808/CH.WAV', defaultNote: 48, oneShot: true  },
    { name: 'OPEN HH',    sampleUrl: '/samples/808/OH.WAV', defaultNote: 48, oneShot: true  },
    { name: 'HIGH TOM',   sampleUrl: '/samples/808/HT.WAV', defaultNote: 48, oneShot: true  },
    { name: 'MID TOM',    sampleUrl: '/samples/808/MT.WAV', defaultNote: 48, oneShot: true  },
    { name: 'LOW TOM',    sampleUrl: '/samples/808/LT.WAV', defaultNote: 48, oneShot: true  },
    { name: 'CLAP',       sampleUrl: '/samples/808/CP.WAV', defaultNote: 48, oneShot: true  },
    // Bonus voices (beyond the default 8; user can expand voice count later)
    { name: 'RIM SHOT',   sampleUrl: '/samples/808/RS.WAV', defaultNote: 48, oneShot: true  },
    { name: 'COWBELL',    sampleUrl: '/samples/808/CB.WAV', defaultNote: 48, oneShot: true  },
    { name: 'CYMBAL',     sampleUrl: '/samples/808/CY.WAV', defaultNote: 48, oneShot: true  },
    { name: 'CLAVES',     sampleUrl: '/samples/808/CL.WAV', defaultNote: 48, oneShot: true  },
    { name: 'MARACAS',    sampleUrl: '/samples/808/MA.WAV', defaultNote: 48, oneShot: true  },
  ],
};

// ── Roland TR-909 (Rob Roy Recordings, Hyperreal.org) ────────────────────────
// 160-sample set recorded 1995. Free to copy/distribute, not for profit.
// Mid-point variants: BD tune7/atk-max/dec7, SD tune7/tone7/snappy7, etc.

const TR909: DrumKit = {
  id: 'tr909',
  name: 'TR-909',
  credit: 'Rob Roy Recordings · Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/tr909/BT7A0D7.WAV',   defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/tr909/ST7T7S7.WAV',   defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/tr909/HHCD4.WAV',     defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/tr909/HHOD4.WAV',     defaultNote: 48, oneShot: true },
    { name: 'HIGH TOM',   sampleUrl: '/samples/tr909/HT7D7.WAV',     defaultNote: 48, oneShot: true },
    { name: 'MID TOM',    sampleUrl: '/samples/tr909/MT7D7.WAV',     defaultNote: 48, oneShot: true },
    { name: 'LOW TOM',    sampleUrl: '/samples/tr909/LT7D7.WAV',     defaultNote: 48, oneShot: true },
    { name: 'CLAP',       sampleUrl: '/samples/tr909/HANDCLP1.WAV',  defaultNote: 48, oneShot: true },
    { name: 'RIM SHOT',   sampleUrl: '/samples/tr909/RIM127.WAV',    defaultNote: 48, oneShot: true },
    { name: 'CRASH',      sampleUrl: '/samples/tr909/CSHD4.WAV',     defaultNote: 48, oneShot: true },
    { name: 'RIDE',       sampleUrl: '/samples/tr909/RIDED4.WAV',    defaultNote: 48, oneShot: true },
  ],
};

// ── Roland CR-8000 (community samples, Hyperreal.org) ────────────────────────
//
// 13-voice mono 44.1 kHz WAV set by Ed Vargo, August 1995.
// Source: machines.hyperreal.org — community archive, freely shared.

const CR8000: DrumKit = {
  id: 'cr8000',
  name: 'CR-8000',
  credit: 'Ed Vargo · Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/cr8000/CR8KBASS.WAV', defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/cr8000/CR8KSNAR.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/cr8000/CR8KCHAT.WAV', defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/cr8000/CR8KOHAT.WAV', defaultNote: 48, oneShot: true },
    { name: 'HIGH TOM',   sampleUrl: '/samples/cr8000/CR8KHITM.WAV', defaultNote: 48, oneShot: true },
    { name: 'LOW TOM',    sampleUrl: '/samples/cr8000/CR8KLOTM.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLAP',       sampleUrl: '/samples/cr8000/CR8KCLAP.WAV', defaultNote: 48, oneShot: true },
    { name: 'RIM SHOT',   sampleUrl: '/samples/cr8000/CR8KRIM.WAV',  defaultNote: 48, oneShot: true },
    { name: 'COWBELL',    sampleUrl: '/samples/cr8000/CR8KCOWB.WAV', defaultNote: 48, oneShot: true },
    { name: 'CYMBAL',     sampleUrl: '/samples/cr8000/CR8KCYMB.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLAVE',      sampleUrl: '/samples/cr8000/CR8KCLAV.WAV', defaultNote: 48, oneShot: true },
    { name: 'MID CONGA',  sampleUrl: '/samples/cr8000/CR8KMCNG.WAV', defaultNote: 48, oneShot: true },
    { name: 'LOW CONGA',  sampleUrl: '/samples/cr8000/CR8KLCNG.WAV', defaultNote: 48, oneShot: true },
  ],
};

// ── Boss DR-110 (Ed Vargo, Hyperreal.org) ─────────────────────────────────────
// 6 voices, mono 44.1 kHz, June 1995.

const DR110: DrumKit = {
  id: 'dr110',
  name: 'DR-110',
  credit: 'Ed Vargo · Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/dr110/DR110KIK.WAV', defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/dr110/DR110SNR.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/dr110/DR110CHT.WAV', defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/dr110/DR110OHT.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLAP',       sampleUrl: '/samples/dr110/DR110CLP.WAV', defaultNote: 48, oneShot: true },
    { name: 'CYMBAL',     sampleUrl: '/samples/dr110/DR110CYM.WAV', defaultNote: 48, oneShot: true },
  ],
};

// ── Boss DR-220 (Hyperreal.org) ───────────────────────────────────────────────
// 11 voices.

const DR220: DrumKit = {
  id: 'dr220',
  name: 'DR-220',
  credit: 'Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/dr220/DR220A_BD.wav',  defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/dr220/DR220A_SD.wav',  defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/dr220/DR220A_CH.wav',  defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/dr220/DR220A_OH.wav',  defaultNote: 48, oneShot: true },
    { name: 'HIGH TOM',   sampleUrl: '/samples/dr220/DR220A_HT.wav',  defaultNote: 48, oneShot: true },
    { name: 'MID TOM',    sampleUrl: '/samples/dr220/DR220A_MT.wav',  defaultNote: 48, oneShot: true },
    { name: 'LOW TOM',    sampleUrl: '/samples/dr220/DR220A_LT.wav',  defaultNote: 48, oneShot: true },
    { name: 'RIM SHOT',   sampleUrl: '/samples/dr220/DR220A_RIM.wav', defaultNote: 48, oneShot: true },
    { name: 'HAND CLAP',  sampleUrl: '/samples/dr220/DR220A_HCP.wav', defaultNote: 48, oneShot: true },
    { name: 'CRASH',      sampleUrl: '/samples/dr220/DR220A_CCY.wav', defaultNote: 48, oneShot: true },
    { name: 'RIDE',       sampleUrl: '/samples/dr220/DR220A_RCY.wav', defaultNote: 48, oneShot: true },
  ],
};

// ── Boss DR-55 (Ed Vargo, Hyperreal.org) ──────────────────────────────────────
// 4 voices.

const DR55: DrumKit = {
  id: 'dr55',
  name: 'DR-55',
  credit: 'Ed Vargo · Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/dr55/DR55KICK.WAV', defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/dr55/DR55SNAR.WAV', defaultNote: 48, oneShot: true },
    { name: 'HI HAT',     sampleUrl: '/samples/dr55/DR55HAT.WAV',  defaultNote: 48, oneShot: true },
    { name: 'RIM SHOT',   sampleUrl: '/samples/dr55/DR55RIM.WAV',  defaultNote: 48, oneShot: true },
  ],
};

// ── Korg KPR-77 (Ed Vargo, Hyperreal.org) ────────────────────────────────────
// 8 voices.

const KPR77: DrumKit = {
  id: 'kpr77',
  name: 'KPR-77',
  credit: 'Ed Vargo · Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/kpr77/KPRKICK.WAV',  defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/kpr77/KPRSNARE.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/kpr77/KPRCLHH.WAV',  defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/kpr77/KPROPHH.WAV',  defaultNote: 48, oneShot: true },
    { name: 'HIGH TOM',   sampleUrl: '/samples/kpr77/KPRHITOM.WAV', defaultNote: 48, oneShot: true },
    { name: 'LOW TOM',    sampleUrl: '/samples/kpr77/KPRLOTOM.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLAPS',      sampleUrl: '/samples/kpr77/KPRCLAPS.WAV', defaultNote: 48, oneShot: true },
    { name: 'CYMBAL',     sampleUrl: '/samples/kpr77/KPRCYMBL.WAV', defaultNote: 48, oneShot: true },
  ],
};

// ── Korg KR-55 (Ed Vargo, Hyperreal.org) ─────────────────────────────────────
// 10 voices.

const KR55: DrumKit = {
  id: 'kr55',
  name: 'KR-55',
  credit: 'Ed Vargo · Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/kr55/KR55KICK.WAV', defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/kr55/KR55SNAR.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/kr55/KR55CHAT.WAV', defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/kr55/KR55OHAT.WAV', defaultNote: 48, oneShot: true },
    { name: 'TOM',        sampleUrl: '/samples/kr55/KR55TOM.WAV',  defaultNote: 48, oneShot: true },
    { name: 'CYMBAL',     sampleUrl: '/samples/kr55/KR55CYMB.WAV', defaultNote: 48, oneShot: true },
    { name: 'RIM SHOT',   sampleUrl: '/samples/kr55/KR55RIM.WAV',  defaultNote: 48, oneShot: true },
    { name: 'CONGA',      sampleUrl: '/samples/kr55/KR55CNGA.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLAVE',      sampleUrl: '/samples/kr55/KR55CLAV.WAV', defaultNote: 48, oneShot: true },
    { name: 'COWBELL',    sampleUrl: '/samples/kr55/KR55COWB.WAV', defaultNote: 48, oneShot: true },
  ],
};

// ── Yamaha MR-10 (Hyperreal.org) ──────────────────────────────────────────────
// 11 voices including brush and shaker.

const MR10: DrumKit = {
  id: 'mr10',
  name: 'MR-10',
  credit: 'Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/mr10/kick1.wav',   defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/mr10/snare.wav',   defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/mr10/chihat.wav',  defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/mr10/ohihat.wav',  defaultNote: 48, oneShot: true },
    { name: 'HIGH TOM',   sampleUrl: '/samples/mr10/hitom.wav',   defaultNote: 48, oneShot: true },
    { name: 'MID TOM',    sampleUrl: '/samples/mr10/midtom.wav',  defaultNote: 48, oneShot: true },
    { name: 'LOW TOM',    sampleUrl: '/samples/mr10/lowtom.wav',  defaultNote: 48, oneShot: true },
    { name: 'CYMBAL',     sampleUrl: '/samples/mr10/cymbal.wav',  defaultNote: 48, oneShot: true },
    { name: 'SHAKER',     sampleUrl: '/samples/mr10/shaker.wav',  defaultNote: 48, oneShot: true },
    { name: 'BRUSH',      sampleUrl: '/samples/mr10/brush.wav',   defaultNote: 48, oneShot: true },
    { name: 'KICK 2',     sampleUrl: '/samples/mr10/kick2.wav',   defaultNote: 48, oneShot: true },
  ],
};

// ── Univox Micro-Rhythmer 12 (Rob Williams, Hyperreal.org) ───────────────────
// 4 individual voices (BD layered with CH by source machine).

const UNIVOX: DrumKit = {
  id: 'univox',
  name: 'Micro-Rhythmer',
  credit: 'Rob Williams · Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/univox/UNIVOXBD.WAV', defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/univox/UNIVOXSD.WAV', defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/univox/UNIVOXCH.WAV', defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/univox/UNIVOXOH.WAV', defaultNote: 48, oneShot: true },
  ],
};

// ── Roland TR-707 (Hyperreal.org) ─────────────────────────────────────────────
// 15 voices. Public domain per readme.

const TR707: DrumKit = {
  id: 'tr707',
  name: 'TR-707',
  credit: 'Hyperreal.org · public domain',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/tr707/BassDrum1.wav', defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/tr707/Snare1.wav',    defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/tr707/HhC.wav',       defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/tr707/HhO.wav',       defaultNote: 48, oneShot: true },
    { name: 'HIGH TOM',   sampleUrl: '/samples/tr707/HiTom.wav',     defaultNote: 48, oneShot: true },
    { name: 'MID TOM',    sampleUrl: '/samples/tr707/MedTom.wav',    defaultNote: 48, oneShot: true },
    { name: 'LOW TOM',    sampleUrl: '/samples/tr707/LowTom.wav',    defaultNote: 48, oneShot: true },
    { name: 'HAND CLAP',  sampleUrl: '/samples/tr707/HandClap.wav',  defaultNote: 48, oneShot: true },
    { name: 'RIM SHOT',   sampleUrl: '/samples/tr707/RimShot.wav',   defaultNote: 48, oneShot: true },
    { name: 'CRASH',      sampleUrl: '/samples/tr707/Crash.wav',     defaultNote: 48, oneShot: true },
    { name: 'RIDE',       sampleUrl: '/samples/tr707/Ride.wav',      defaultNote: 48, oneShot: true },
    { name: 'COWBELL',    sampleUrl: '/samples/tr707/CowBell.wav',   defaultNote: 48, oneShot: true },
    { name: 'TAMBOURINE', sampleUrl: '/samples/tr707/Tamb.wav',      defaultNote: 48, oneShot: true },
  ],
};

// ── Yamaha RX-21 (Hyperreal.org) ──────────────────────────────────────────────
// 9 voices.

const RX21: DrumKit = {
  id: 'rx21',
  name: 'RX-21',
  credit: 'Hyperreal.org',
  voices: [
    { name: 'BASS DRUM',  sampleUrl: '/samples/rx21/KIRX21.WAV',   defaultNote: 48, oneShot: true },
    { name: 'SNARE',      sampleUrl: '/samples/rx21/SNRX21.WAV',   defaultNote: 48, oneShot: true },
    { name: 'CLOSED HH',  sampleUrl: '/samples/rx21/HCRX21.WAV',   defaultNote: 48, oneShot: true },
    { name: 'OPEN HH',    sampleUrl: '/samples/rx21/HORX21.WAV',   defaultNote: 48, oneShot: true },
    { name: 'CLAPS',      sampleUrl: '/samples/rx21/CLRX21.WAV',   defaultNote: 48, oneShot: true },
    { name: 'CRASH',      sampleUrl: '/samples/rx21/CCRX21.WAV',   defaultNote: 48, oneShot: true },
    { name: 'HIGH TOM',   sampleUrl: '/samples/rx21/TMRX211.WAV',  defaultNote: 48, oneShot: true },
    { name: 'MID TOM',    sampleUrl: '/samples/rx21/TMRX212.WAV',  defaultNote: 48, oneShot: true },
    { name: 'LOW TOM',    sampleUrl: '/samples/rx21/TMRX213.WAV',  defaultNote: 48, oneShot: true },
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const DRUM_KITS: DrumKit[] = [
  TR808,
  TR909,
  TR707,
  CR8000,
  DR110,
  DR220,
  DR55,
  KPR77,
  KR55,
  MR10,
  UNIVOX,
  RX21,
];

export function kitById(id: string): DrumKit | undefined {
  return DRUM_KITS.find((k) => k.id === id);
}
