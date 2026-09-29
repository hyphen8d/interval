// INTERVAL -- the key table. One list, read by three things: page 199 (the
// help page), index.html's screen-reader summary, and tests/keys.test.mjs,
// which presses every key listed here and fails if any of them changes
// nothing. SIGNAL's lesson: a legend that is maintained separately from the
// handler drifts from it, and the drift is a key that clicks and does nothing.

export const KEYS = [
  { id: 'digits', keys: '0-9', label: 'KEY A PAGE NUMBER' },
  { id: 'updown', keys: 'UP/DOWN', label: 'NEXT OR PREVIOUS PAGE' },
  { id: 'leftright', keys: 'LEFT/RIGHT', label: 'STEP THROUGH SUBPAGES' },
  { id: 'fastext', keys: 'F1-F4', label: 'THE FOUR COLOURED LINKS' },
  { id: 'index', keys: 'I', label: 'INDEX, PAGE 100' },
  { id: 'hold', keys: 'H', label: 'HOLD THE PAGE OR SECTION' },
  { id: 'colour', keys: 'C', label: 'COLOUR / B&W / MONITOR' },
  { id: 'cycle', keys: 'N', label: 'CYCLE THROUGH THE SECTIONS' },
  { id: 'fullscreen', keys: 'F', label: 'FULL SCREEN' },
  { id: 'cancel', keys: 'ESC', label: 'CLEAR A HALF-KEYED NUMBER' },
  { id: 'power', keys: 'P', label: 'SWITCH THE SET ON OR OFF' },
]

/** For keyboards where F1-F4 need a modifier (Macs and most laptops, where
 *  the top row is media keys unless fn is held): Shift+1..4 does the same.
 *  Listed here so the help page and the handler agree. */
export const FASTEXT_ALT = 'SHIFT+1-4'

/** Header messages: what the service-name slot says, briefly, when a
 *  control changes something that has no other place to show. */
export const HEADER_MSG_MS = 1600

/** Colour modes, in [C] order. `phosphor` is the CRT tint; `palette` picks
 *  the teletext colours or their greys. MONITOR is teletext on a green
 *  screen -- a BBC Micro's Mode 7 on a monochrome monitor, which is how a
 *  lot of people first met this character set -- and the one that looks
 *  most like SIGNAL. */
export const COLOUR_MODES = [
  { key: 'colour', label: 'COLOUR', phosphor: 'colour', mono: false },
  { key: 'bw', label: 'B&W SET', phosphor: 'bw', mono: true },
  { key: 'monitor', label: 'MONITOR', phosphor: 'monitor', mono: true },
]
