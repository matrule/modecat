# ARexx Scripting

ModeCat includes an ARexx-compatible scripting engine that lets you automate song construction, generate patterns algorithmically, and batch-edit your project. Scripts are written in REXX syntax and executed inside the **Script Editor** window.

## Opening the Script Editor

Go to **Windows → Script Editor** (or use the menu bar). Paste or type your script, then click **Run**.

## Addressing the command port

Every script must begin by switching to the ModeCat port:

```rexx
ADDRESS 'MODECAT'
```

After that, any bare string expression is sent as a command:

```rexx
'SETBPM 140'
'SETNOTE 1 1 C-3 1 0A 00'
```

Results are returned in the special variable `RESULT`. All commands set `RC` to `0` on success.

## Conventions

| Symbol | Meaning |
|--------|---------|
| `row` | Row number, **1-based** |
| `chan` | Channel number, **1-based** (1–16) |
| `inst` | Instrument slot, **1-based** (1–32); `0` = no change |
| `idx` | Pattern index, **0-based** |
| `pos` | Song position, **0-based** |
| `note` | `C-3`, `C#4`, `---` (empty), `-\|-` (hold) |
| `hex` | Two-char hex: `00`–`FF`, or `--` for none |

---

## Query commands

### GETBPM / GETSPEED

```rexx
'GETBPM'       /* returns current BPM as a string */
'GETSPEED'     /* returns ticks-per-row */
```

### GETPATTERNCOUNT / GETCURRENTPATTERN / GETPATTERNLENGTH

```rexx
'GETPATTERNCOUNT'      /* total number of patterns */
'GETCURRENTPATTERN'    /* 0-based index of active pattern, or -1 */
'GETPATTERNLENGTH'     /* rows in active pattern */
```

### GETSONGLEN / GETSONGPOS

```rexx
'GETSONGLEN'   /* entries in the song position list */
'GETSONGPOS'   /* current playback/cursor position */
```

### GETNOTE / GETINST / GETINSTNAME

```rexx
'GETNOTE 1 1'          /* note string at row 1, chan 1 */
'GETINST 4 2'          /* instrument number at row 4, chan 2 */
'GETINSTNAME 3'        /* name of instrument slot 3 */
```

---

## Transport commands

```rexx
'SETBPM 160'     /* set BPM (20–255) */
'SETSPEED 4'     /* set ticks-per-row (1–15) */
```

---

## Pattern management

```rexx
'ADDPATTERN VERSE'        /* append new pattern, returns index */
'SELECTPATTERN 2'         /* make pattern 2 the active pattern */
'SETPATTERNLENGTH 32'     /* resize active pattern to 32 rows */
'RENAMEPATTERN My Loop'   /* rename active pattern */
'CLEARPATTERN'            /* empty all cells in active pattern */
'CLEARTRACK 3'            /* clear all cells in channel 3 */
```

---

## Song sequencing

```rexx
'APPENDSONG 0'       /* append pattern 0 to song list */
'INSERTSONG 2 1'     /* insert pattern 1 at song position 2 */
'REMOVESONG 3'       /* remove song entry at position 3 */
'CLEARSONG'          /* remove all song entries */
```

---

## Note and cell editing

### SETNOTE

```rexx
'SETNOTE row chan note inst cmd data'
```

Sets a complete cell. `cmd` and `data` are hex bytes or `--`.

```rexx
'SETNOTE 1 1 C-3 1 0C 64'   /* C-3, instrument 1, volume 100 */
'SETNOTE 5 2 --- 0 -- --'   /* clear note, keep instrument */
```

### Other cell commands

```rexx
'CLEARNOTE 3 1'          /* empty cell at row 3, chan 1 */
'SETNOTEONLY 2 1 G-4'   /* change only the note field */
'SETINST 2 1 3'          /* change only the instrument field */
'SETFX 4 2 0A 10'        /* change only the effect fields */
```

### SETINSTNAME

```rexx
'SETINSTNAME 1 Kick'   /* rename instrument slot 1 */
```

---

## Example — pentatonic arpeggio

```rexx
ADDRESS 'MODECAT'

notes.1 = 'C-3' ;  notes.2 = 'D-3' ;  notes.3 = 'E-3'
notes.4 = 'G-3' ;  notes.5 = 'A-3' ;  notes.6 = 'C-4'
notes.7 = 'D-4' ;  notes.8 = 'E-4'

DO row = 1 TO 8
  'SETNOTE' row '1' notes.row '1 -- --'
END
```

## Example — auto-drum generator

Generates a 16-row pattern with kick, snare, hi-hat, and cymbal:

```rexx
ADDRESS 'MODECAT'

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

SAY 'Done. Pattern index: ' || drumPat
```

---

## ARexx language quick reference

### Variables and arithmetic

```rexx
x = 42
name = 'snare'
result = (bpm * 2) + offset
mod = row // 4      /* modulo */
half = rows % 2     /* integer division */
```

### String operations

```rexx
msg = 'Note: ' || notename       /* concat, no space */
msg = 'Note:' notename           /* concat with one space */
SAY LENGTH(notename)
SAY SUBSTR(notename, 1, 1)
SAY UPPER(notename)
```

### Loops and conditionals

```rexx
DO row = 1 TO 64 BY 2
  /* odd rows */
END

DO WHILE count < 16
  count = count + 1
END

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
```

### Useful built-in functions

`LENGTH(s)` · `WORD(s,n)` · `WORDS(s)` · `SUBSTR(s,start[,len])` · `LEFT(s,n)` · `RIGHT(s,n)` · `STRIP(s)` · `UPPER(s)` · `LOWER(s)` · `ABS(n)` · `MAX(a,b,…)` · `MIN(a,b,…)` · `TRUNC(n)` · `COPIES(s,n)` · `REVERSE(s)` · `POS(needle,haystack)`
