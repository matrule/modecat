# Range Operations

Range operations let you select a rectangular region of the pattern grid and apply batch edits to everything inside it. Most operations are available on the **Range** toolbar that appears when a selection is active.

## Making a selection

Hold `Shift` and press an arrow key to extend the selection from the cursor position. Or click and drag across the pattern grid. The selected region is highlighted. Press `Esc` to deselect.

## Available operations

### Cut, Copy, Paste

| Key | Action |
|-----|--------|
| `Ctrl+X` | Cut — copy to clipboard, clear cells |
| `Ctrl+C` | Copy — copy to clipboard |
| `Ctrl+V` | Paste — insert at cursor |

The clipboard preserves the exact shape of the selection. Pasting a block that extends beyond the pattern boundary wraps to the beginning of the block.

### Transpose

Shifts every note in the selection up or down by a number of semitones without changing instruments or effects.

- **Transpose +1** — one semitone up
- **Transpose −1** — one semitone down
- **Transpose +12** — one octave up
- **Transpose −12** — one octave down

Attempting to transpose above `B-7` or below `C-0` clamps to the boundary.

### Volume fade

Applies a linear volume ramp across the selection. You specify the start and end volume; ModeCat inserts `0C` commands on each row to interpolate between them. Existing effect commands in the selection are overwritten.

### Echo

Copies notes from the selection and re-enters them offset by a specified number of rows, with a lower volume. Useful for quick delay effects without a dedicated effect command.

### Pitch slide fill

Fills the CMD/DATA fields of selected cells with incremental `01` (slide up) or `02` (slide down) commands, creating a smooth pitch ramp across the block.

### Note change

Replaces every occurrence of a specific note value in the selection with a different note. Instrument and effect fields are preserved.

### Note exchange

Swaps all occurrences of one note with another note and vice versa throughout the selection.

### Spread

Distributes the notes in the selection evenly across the selected rows, removing gaps between non-empty cells.

### Command fill

Fills every non-empty row in the selection with a specified effect command and data value. Useful for applying a volume or slide to an entire phrase in one step.

## Tips

- Range operations do not affect cells that are entirely empty (all fields blank) unless explicitly specified.
- Undo (`Ctrl+Z`) reverses any range operation.
- Selections can span multiple channels.
