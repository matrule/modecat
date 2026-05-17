# ModeCat ARexx Command Reference

This document is the **task log** for the `ADDRESS 'MODECAT'` command port.
Every command implemented in `src/engine/arexx.ts` is recorded here with its
syntax, argument types, return value, and an example.  Use this as the source
for the eventual end-user manual page.

---

## How the command port works

In an ARexx script, you first switch to the ModeCat port:

```rexx
ADDRESS 'MODECAT'
```

After that, any bare string expression is sent as a command:

```rexx
'SETBPM 140'
'SETNOTE 1 1 C-3 1 0A 00'
```

You can also build commands dynamically using ARexx's concatenation:

```rexx
row = 3
note = 'G-4'
'SETNOTE' row '1' note '2 -- --'
```

Commands that return a value set the special variable `RESULT`.
All commands set `RC` to 0 on success, or raise a runtime error on failure.

---

## Conventions

| Symbol | Meaning |
|--------|---------|
| `row`  | Row number, **1-based** |
| `chan` | Channel number, **1-based** (1–16) |
| `inst` | Instrument slot, **1-based** (1–32); 0 = "no change" |
| `idx`  | Pattern index, **0-based** |
| `pos`  | Song position, **0-based** |
| `note` | Note string: `C-3`, `C#4`, `D-0` … `B-7`, `---` (empty), `-\|-` (hold) |
| `hex`  | Two-char hex byte: `00`–`FF`, or `--` for "none/zero" |
| `RESULT` | Variable set to the command's return value |

Note names follow the OctaMED convention: `C-`, `C#`, `D-`, `D#`, `E-`, `F-`,
`F#`, `G-`, `G#`, `A-`, `A#`, `B-` followed by octave digit 0–7.

---

## Query commands

These commands set `RESULT` to the requested value and return immediately.
They do not modify the song model.

### GETBPM
```
GETBPM
```
Returns the current BPM (20–255) as a decimal string.

**Example:**
```rexx
'GETBPM'
SAY 'Current BPM: ' || RESULT
```

---

### GETSPEED
```
GETSPEED
```
Returns the current speed (ticks-per-row, 1–15).

---

### GETPATTERNCOUNT
```
GETPATTERNCOUNT
```
Returns the total number of patterns in the project.

---

### GETCURRENTPATTERN
```
GETCURRENTPATTERN
```
Returns the 0-based index of the currently active pattern, or `-1` if none.

---

### GETPATTERNLENGTH
```
GETPATTERNLENGTH
```
Returns the number of rows in the currently active pattern.

---

### GETSONGLEN
```
GETSONGLEN
```
Returns the number of entries in the song position list.

---

### GETSONGPOS
```
GETSONGPOS
```
Returns the current playback/cursor song position (0-based).

---

### GETPATTERNID
```
GETPATTERNID idx
```
Returns the internal pattern ID at 0-based index `idx`.
(IDs are stable; indices shift when patterns are inserted/deleted.)

---

### GETNOTE
```
GETNOTE row chan
```
Returns the note string (e.g. `C-3`, `---`, `-|-`) at the given 1-based
row and channel in the active pattern.

**Example:**
```rexx
'GETNOTE 1 1'
SAY 'Row 1, Chan 1: ' || RESULT
```

---

### GETINST
```
GETINST row chan
```
Returns the instrument number (1-based) at the given cell, or `0` if none.

---

### GETINSTNAME
```
GETINSTNAME inst
```
Returns the name string of instrument slot `inst` (1-based).

---

## Transport commands

### SETBPM
```
SETBPM bpm
```
Sets the project BPM.  Clamped to 20–255.  Returns the new BPM value.

**Example:**
```rexx
'SETBPM 160'
```

---

### SETSPEED
```
SETSPEED speed
```
Sets ticks-per-row.  Clamped to 1–15.  Returns the new speed value.

---

## Pattern management

### ADDPATTERN
```
ADDPATTERN [name]
```
Appends a new 64-row pattern.  Optional `name` renames it immediately.
Sets `RESULT` to the new pattern's 0-based index.

**Example — add four drum patterns:**
```rexx
ADDRESS 'MODECAT'
DO i = 1 TO 4
  'ADDPATTERN DRUM' i
  SAY 'Added pattern index ' || RESULT
END
```

---

### SELECTPATTERN
```
SELECTPATTERN idx
```
Makes the pattern at 0-based `idx` the active pattern.
If the pattern is not already in the song, it is appended automatically.
Returns the index.

---

### SETPATTERNLENGTH
```
SETPATTERNLENGTH rows
```
Resizes the active pattern to `rows` rows (1–3200).
Returns the new length.

---

### RENAMEPATTERN
```
RENAMEPATTERN name
```
Renames the active pattern.  `name` may contain spaces.
Returns the new name.

---

### CLEARPATTERN
```
CLEARPATTERN
```
Clears (empties) every cell in the active pattern.
Returns the number of cells cleared (`rows × channels`).

---

### CLEARTRACK
```
CLEARTRACK chan
```
Clears every cell in channel `chan` (1-based) of the active pattern.
Returns the number of rows cleared.

---

## Song sequencing

### APPENDSONG
```
APPENDSONG idx
```
Appends pattern at 0-based `idx` to the end of the song position list.
Returns the new song position (0-based) that was created.

**Example — build a verse–chorus–verse structure:**
```rexx
ADDRESS 'MODECAT'
DO i = 1 TO 2
  'APPENDSONG 0'   /* verse */
  'APPENDSONG 1'   /* chorus */
END
'APPENDSONG 0'     /* outro verse */
```

---

### INSERTSONG
```
INSERTSONG pos idx
```
Inserts pattern `idx` (0-based) at song position `pos` (0-based), shifting
existing entries rightward.  Returns `pos`.

---

### REMOVESONG
```
REMOVESONG pos
```
Removes the song entry at 0-based position `pos`.  Returns `pos`.

---

### CLEARSONG
```
CLEARSONG
```
Removes all entries from the song position list.
Returns the number of positions that were removed.

---

## Note / cell editing

### SETNOTE
```
SETNOTE row chan note inst cmd data
```
Sets a complete cell in the active pattern.

| Arg | Type | Notes |
|-----|------|-------|
| `row` | integer | 1-based |
| `chan` | integer | 1-based |
| `note` | note string or MIDI# | `C-3`, `---`, `-\|-`, or 0–127 |
| `inst` | integer | 1-based, 0 = no instrument |
| `cmd` | hex | Effect command byte, or `--` |
| `data` | hex | Effect data byte, or `--` |

Returns a space-separated echo of the resolved values.

**Example — pentatonic arpeggio over 8 rows:**
```rexx
ADDRESS 'MODECAT'
notes.1 = 'C-3'
notes.2 = 'D-3'
notes.3 = 'E-3'
notes.4 = 'G-3'
notes.5 = 'A-3'
notes.6 = 'C-4'
notes.7 = 'D-4'
notes.8 = 'E-4'
DO row = 1 TO 8
  'SETNOTE' row '1' notes.row '1 -- --'
END
```

**Example — classic hi-hat every-other-row pattern:**
```rexx
ADDRESS 'MODECAT'
DO row = 1 TO 32
  IF row // 2 = 0 THEN
    'SETNOTE' row '2 A-3 3 -- --'
END
```

---

### CLEARNOTE
```
CLEARNOTE row chan
```
Empties the cell at the given 1-based row and channel.

---

### SETNOTEONLY
```
SETNOTEONLY row chan note
```
Sets only the note field of a cell, leaving instrument and effects unchanged.

---

### SETINST
```
SETINST row chan inst
```
Sets only the instrument field (1-based) of a cell, leaving note and effects
unchanged.

---

### SETFX
```
SETFX row chan cmd data
```
Sets only the effect fields of a cell.  Both `cmd` and `data` are hex bytes
or `--` for zero.

---

## Instrument commands

### SETINSTNAME
```
SETINSTNAME inst name
```
Renames instrument slot `inst` (1-based).  `name` may contain spaces.
Returns the new name.

**Example:**
```rexx
ADDRESS 'MODECAT'
DO i = 1 TO 8
  'SETINSTNAME' i 'DRUM ' || i
END
```

---

## ARexx language quick-reference

### Variables
```rexx
x = 42
name = 'kick drum'
```
Uninitialised variables evaluate to their own name in uppercase (REXX rule §5.1).

### Arithmetic
```rexx
result = (bpm * 2) + offset
half = rows // 2    /* integer division */
mod  = row  %  4    /* modulo */
```

### String operations
```rexx
msg = 'Note: ' || notename    /* explicit concat, no space */
msg = 'Note:' notename        /* space concat (blank = one space) */
SAY LENGTH(notename)
SAY SUBSTR(notename, 1, 1)    /* first character */
SAY UPPER(notename)
```

### DO loops
```rexx
DO row = 1 TO 64 BY 2        /* odd rows only */
  /* ... */
END

DO WHILE count < 16
  count = count + 1
END

DO FOREVER
  IF done = 1 THEN LEAVE
END
```

### Conditionals
```rexx
IF row // 4 = 0 THEN
  'SETNOTE' row '1 C-3 1 -- --'
ELSE DO
  'SETNOTE' row '1 --- 0 -- --'
END
```

### PARSE
```rexx
info = 'C-3 1 0A FF'
PARSE VAR info note inst cmd data
SAY 'Note=' || note || ' Inst=' || inst
```

### Built-in functions
`LENGTH(s)` `WORD(s,n)` `WORDS(s)` `SUBSTR(s,start[,len])`
`LEFT(s,n)` `RIGHT(s,n)` `STRIP(s)` `UPPER(s)` `LOWER(s)`
`ABS(n)` `MAX(a,b,…)` `MIN(a,b,…)` `TRUNC(n)` `FORMAT(n,dec)`
`COPIES(s,n)` `REVERSE(s)` `POS(needle,haystack)` `LASTPOS(needle,haystack)`
`D2C(n)` `C2D(s)`

---

## Full example — auto-drum generator (Autodrum-style)

Generates a 16-row drum pattern with kick on 1/5/9/13, snare on 5/13,
hi-hat every even row, and a random-ish cymbal.

```rexx
/* autodrum.mcat — ModeCat ARexx drum generator */
/* Instruments: 1=Kick  2=Snare  3=HiHat  4=Cymbal */

ADDRESS 'MODECAT'

/* Add a fresh pattern and select it */
'ADDPATTERN DRUMS'
drumPat = RESULT
'SELECTPATTERN' drumPat
'SETPATTERNLENGTH 16'
'CLEARPATTERN'

/* Kick: rows 1, 5, 9, 13 */
DO i = 0 TO 3
  row = (i * 4) + 1
  'SETNOTE' row '1 C-3 1 -- --'
END

/* Snare: rows 5, 13 */
'SETNOTE 5  2 C-3 2 -- --'
'SETNOTE 13 2 C-3 2 -- --'

/* Hi-hat: every even row */
DO row = 2 TO 16 BY 2
  'SETNOTE' row '3 C-3 3 -- --'
END

/* Cymbal: row 9 */
'SETNOTE 9 4 C-3 4 -- --'

SAY 'Autodrum pattern written to pattern index ' || drumPat
```

---

*Generated by ModeCat ARexx interpreter — engine/arexx.ts*
*Last updated: 2026-05-17*
