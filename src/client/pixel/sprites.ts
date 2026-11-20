// Original pixel-art agent sprites as editable data arrays on a chunky 16x16 grid.
// Style: a large dark-framed screen head with slanted eyes and a small mouth,
// a compact body, and a costume per agent. Every state is a 2-frame loop.
//
// Animation modes (product naming → app state):
//   Idle → idle · Factchecking → talking (SPEECH badge) · Reasoning → researching/thinking
//   911 emergency → hit · plus winner / loser for the verdict reveal.

export type AgentKind =
  | 'content_extractor'
  | 'quality_auditor'
  | 'claim_extractor'
  | 'researcher'
  | 'defender'
  | 'prosecutor'
  | 'judge'
  | 'pedagogue';

export type AgentState = 'idle' | 'researching' | 'talking' | 'thinking' | 'hit' | 'winner' | 'loser';

/** [x, y, width, height, paletteKey] */
export type Px = readonly [number, number, number, number, string];

export const GRID = 16;

export const BASE_PALETTE: Record<string, string> = {
  frame: '#2B2E33',
  screen: '#E6EBEF',
  eye: '#1E2126',
  mouth: '#1E2126',
  alert: '#D62F3A',
  spark: '#E3A21A',
  shadow: '#00000018',
};

/** The shared screen head (chunky 16x16 style, matching the reference). */
export const HEAD: Px[] = [
  [4, 3, 8, 1, 'frame'],
  [3, 4, 10, 6, 'frame'],
  [4, 10, 8, 1, 'frame'],
  [4, 4, 8, 6, 'screen'],
];

/** Face variants (slanted eyes as in the reference sprites). */
const EYES: Record<string, Px[]> = {
  open: [[5, 6, 2, 1, 'eye'], [6, 5, 1, 1, 'eye'], [9, 6, 2, 1, 'eye'], [9, 5, 1, 1, 'eye']],
  blink: [[5, 6, 2, 1, 'eye'], [9, 6, 2, 1, 'eye']],
  up: [[5, 5, 2, 1, 'eye'], [6, 4, 1, 1, 'eye'], [9, 5, 2, 1, 'eye'], [9, 4, 1, 1, 'eye']],
  happy: [[5, 6, 1, 1, 'eye'], [6, 5, 1, 1, 'eye'], [7, 6, 1, 1, 'eye'], [9, 6, 1, 1, 'eye'], [10, 5, 1, 1, 'eye'], [11, 6, 1, 1, 'eye']],
  sad: [[5, 6, 2, 1, 'eye'], [5, 5, 1, 1, 'eye'], [9, 6, 2, 1, 'eye'], [10, 5, 1, 1, 'eye']],
  // '>' '<' squint for the 911 alert.
  x: [[5, 5, 1, 1, 'eye'], [6, 6, 1, 1, 'eye'], [5, 7, 1, 1, 'eye'], [11, 5, 1, 1, 'eye'], [10, 6, 1, 1, 'eye'], [11, 7, 1, 1, 'eye']],
};
const MOUTHS: Record<string, Px[]> = {
  small: [[7, 8, 2, 1, 'mouth']],
  open: [[7, 8, 2, 2, 'mouth']],
  smile: [[6, 8, 1, 1, 'mouth'], [7, 9, 2, 1, 'mouth'], [9, 8, 1, 1, 'mouth']],
  frown: [[6, 9, 1, 1, 'mouth'], [7, 8, 2, 1, 'mouth'], [9, 9, 1, 1, 'mouth']],
  o: [[7, 8, 2, 2, 'mouth']],
};

export interface Frame {
  /** Whole-sprite offset (bob / bounce / jitter). */
  dx?: number;
  dy?: number;
  /** Extra offset for the hand-held props only. */
  propDx?: number;
  propDy?: number;
  /** Extra offset for the "tool" layer (e.g. a highlighter that moves on its own). */
  toolDx?: number;
  toolDy?: number;
  /** Use the costume's alternate prop drawing (e.g. gavel tilted down). */
  altProps?: boolean;
  /** Offset for the costume "accents" layer (document lines, antenna light). */
  accentDy?: number;
  hideAccents?: boolean;
  eyes?: keyof typeof EYES;
  eyesDy?: number;
  mouth?: keyof typeof MOUTHS;
  extra?: Px[];
}

export interface Costume {
  palette: Record<string, string>;
  /** Behind the head (capes, wig sides, robes). */
  back: Px[];
  /** Body, legs and anything over the head (hats, visors). */
  front: Px[];
  /** Small details animated on their own (document lines, antenna light). */
  accents: Px[];
  props: Px[];
  propsAlt?: Px[];
  /** A prop that moves independently (drawn last). */
  tool?: Px[];
  /** Two frames per state; Reasoning (working) may use up to four. */
  anims: Record<'idle' | 'talking' | 'reasoning' | 'hit', Frame[]>;
}

const ALERT: Px[] = [[14, 0, 2, 2, 'alert']];

export const COSTUMES: Record<AgentKind, Costume> = {
  // 1. Defender — knight: silver helmet and armour, teal shield with a check mark.
  defender: {
    palette: { helmet: '#9AA3AD', armor: '#A9B1BB', plate: '#6E7888', leg: '#9AA3AD', teal: '#1E7A70', check: '#FFFFFF' },
    back: [[13, 7, 2, 5, 'teal']],
    front: [
      [6, 2, 4, 1, 'helmet'],
      [7, 1, 2, 1, 'helmet'],
      [4, 11, 8, 3, 'armor'],
      [6, 11, 4, 2, 'plate'],
      [5, 14, 2, 2, 'leg'],
      [9, 14, 2, 2, 'leg'],
    ],
    accents: [],
    props: [
      [1, 7, 3, 6, 'teal'],
      [1, 10, 1, 1, 'check'],
      [2, 11, 1, 1, 'check'],
      [3, 9, 1, 2, 'check'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0, mouth: 'open' }, { dy: -1 }],
      reasoning: [{ dy: 0, eyes: 'up' }, { dy: -1, eyes: 'up' }],
      hit: [{ dy: 0, eyes: 'x', extra: ALERT }, { dy: -1, eyes: 'x' }],
    },
  },

  // 2. Prosecutor — detective: wide brown hat, rust coat, red-striped "objection" card.
  prosecutor: {
    palette: { hat: '#8A3B12', brim: '#A0461A', band: '#5A2610', coat: '#B8401C', coatLight: '#D2531F', boot: '#2B2E33', card: '#FBE3E3', cardInk: '#D62F3A' },
    back: [],
    front: [
      [1, 2, 14, 1, 'brim'],
      [4, 0, 8, 1, 'hat'],
      [4, 1, 8, 1, 'band'],
      [4, 11, 8, 4, 'coat'],
      [6, 11, 4, 4, 'coatLight'],
      [5, 15, 2, 1, 'boot'],
      [9, 15, 2, 1, 'boot'],
    ],
    accents: [],
    props: [
      [13, 7, 3, 4, 'card'],
      [13, 8, 2, 1, 'cardInk'],
      [13, 10, 2, 1, 'cardInk'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1, propDx: 1 }],
      talking: [{ dy: 0, propDx: 1, mouth: 'open' }, { dy: -1, propDx: 1 }],
      reasoning: [{ dy: 0 }, { dy: -1 }],
      hit: [{ dy: 0, eyes: 'x', extra: ALERT }, { dy: -1, eyes: 'x' }],
    },
  },

  // 3. Independent Judge — white wig, black robe with white collar, raised wooden gavel.
  judge: {
    palette: { wig: '#DCE0E5', wigShade: '#B9BFC7', robe: '#1B1C1F', collar: '#FFFFFF', gavel: '#8B4513', gavelHead: '#6B3410' },
    back: [
      [3, 2, 10, 2, 'wig'],
      [2, 4, 2, 7, 'wig'],
      [12, 4, 2, 7, 'wig'],
      [2, 8, 1, 2, 'wigShade'],
      [4, 11, 8, 5, 'robe'],
    ],
    front: [
      [7, 1, 2, 1, 'wigShade'],
      [6, 11, 4, 1, 'collar'],
    ],
    accents: [],
    props: [
      [13, 5, 3, 2, 'gavelHead'],
      [14, 7, 1, 4, 'gavel'],
    ],
    // Gavel tilted down (striking / deliberating).
    propsAlt: [
      [12, 7, 3, 2, 'gavelHead'],
      [14, 9, 1, 3, 'gavel'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0, mouth: 'open' }, { dy: -1 }],
      reasoning: [{ dy: 0 }, { dy: 0, altProps: true }],
      hit: [{ dy: 0, eyes: 'x', extra: ALERT }, { dy: -1, eyes: 'x', altProps: true }],
    },
  },

  // 4. Evidence Researcher — explorer hat, magnifying glass, long brown legs.
  researcher: {
    palette: { hat: '#8C5A12', brim: '#A06A1A', band: '#5E3C0C', brown: '#7A4512', rim: '#3A3F45', lens: '#BFE0F5' },
    back: [],
    front: [
      [1, 2, 14, 1, 'brim'],
      [4, 0, 8, 1, 'hat'],
      [4, 1, 8, 1, 'band'],
      [4, 11, 1, 5, 'brown'],
      [11, 11, 1, 5, 'brown'],
    ],
    accents: [],
    props: [
      [12, 7, 3, 3, 'rim'],
      [13, 8, 1, 1, 'lens'],
      [13, 10, 1, 2, 'brown'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0 }, { dy: -1, propDx: 1 }],
      // Working: the glass sweeps from the side, over the right eye, over the left eye, and back.
      reasoning: [
        { dy: 0 },
        { dy: -1, propDx: -3, propDy: -3, eyes: 'up' },
        { dy: -1, propDx: -7, propDy: -3, eyes: 'up' },
        { dy: 0, propDx: -3, propDy: -3 },
      ],
      hit: [{ dy: 0, eyes: 'x', propDx: -1, extra: ALERT }, { dy: -1, eyes: 'x', propDx: 1, propDy: -1 }],
    },
  },

  // 5. Claim Extractor — screen-only robot with green visor, antenna light, paper and highlighter.
  claim_extractor: {
    palette: { visor: '#1F8A3A', antenna: '#9AA0A6', tip: '#F2C21B', paper: '#FFFFFF', paperEdge: '#E1E5EA', marker: '#F2C21B' },
    back: [],
    front: [
      [7, 1, 2, 2, 'antenna'],
      [3, 3, 10, 1, 'visor'],
    ],
    accents: [[7, 0, 2, 1, 'tip']],
    props: [
      [0, 8, 3, 4, 'paper'],
      [0, 11, 3, 1, 'paperEdge'],
      [0, 9, 2, 1, 'marker'],
    ],
    tool: [[13, 7, 2, 3, 'marker']],
    anims: {
      idle: [{ dy: 0 }, { dy: -1, hideAccents: true }],
      talking: [{ dy: 0, eyesDy: 0, mouth: 'open' }, { dy: -1, eyesDy: -1, hideAccents: true }],
      // Working: the highlighter travels to the paper and swipes across it while the antenna blinks.
      reasoning: [
        { dy: 0 },
        { dy: 0, toolDx: -6, toolDy: 1, hideAccents: true },
        { dy: -1, toolDx: -12, toolDy: 2 },
        { dy: -1, toolDx: -13, toolDy: 4, hideAccents: true },
      ],
      hit: [{ dy: 0, dx: -1, eyes: 'x', extra: ALERT }, { dy: -1, dx: 1, eyes: 'x', hideAccents: true }],
    },
  },

  // 6. Content Extractor — OCR specialist: antenna, cyan scanner visor, white lab coat.
  content_extractor: {
    palette: { antenna: '#9AA0A6', visor: '#4FC3E0', visorLight: '#A8E6F4', coat: '#F2F4F6', coatLine: '#D5DAE0', line: '#6E7888' },
    back: [],
    front: [
      [6, 0, 4, 1, 'antenna'],
      [7, 1, 2, 2, 'antenna'],
      [4, 5, 8, 2, 'visor'],
      [5, 5, 6, 1, 'visorLight'],
      [4, 11, 8, 5, 'coat'],
      [7, 11, 2, 5, 'coatLine'],
    ],
    // Text lines on the document pocket (they toggle and scroll while reading).
    accents: [
      [5, 12, 1, 1, 'line'],
      [5, 14, 1, 1, 'line'],
    ],
    props: [],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0 }, { dy: -1, hideAccents: true }],
      reasoning: [{ dy: 0, accentDy: 0 }, { dy: 0, accentDy: 1 }],
      hit: [{ dy: 0, eyes: 'x', extra: ALERT }, { dy: -1, eyes: 'x', accentDy: 1 }],
    },
  },

  // 7. Pedagogue — purple mortarboard with gold tassel, green cardigan, red book and pointer.
  pedagogue: {
    palette: { cap: '#3B2F8F', tassel: '#E3A21A', cardigan: '#1F7A4A', shirt: '#FFFFFF', bookFrame: '#B3261E', page: '#FFF0C8', pointer: '#C2701F' },
    back: [],
    front: [
      [2, 1, 12, 1, 'cap'],
      [5, 2, 6, 1, 'cap'],
      [13, 2, 1, 3, 'tassel'],
      [4, 11, 8, 5, 'cardigan'],
      [7, 11, 2, 5, 'shirt'],
    ],
    accents: [],
    props: [
      [0, 9, 4, 4, 'bookFrame'],
      [1, 10, 2, 2, 'page'],
      [14, 4, 1, 9, 'pointer'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0, propDy: 0, mouth: 'open' }, { dy: -1, propDy: -1 }],
      reasoning: [{ dy: 0, propDx: 0 }, { dy: -1, propDx: 1 }],
      hit: [{ dy: 0, propDy: -2, eyes: 'x', extra: ALERT }, { dy: -1, propDy: -2, eyes: 'x' }],
    },
  },

  // Citation Auditor (not in the reference set) — drawn in the same style:
  // inspector cap, monocle magnifier, gold badge, red pen and checklist.
  quality_auditor: {
    palette: { cap: '#24324A', brim: '#1A2436', body: '#5E6B7D', badge: '#E3A21A', rim: '#3A3F45', lens: '#BFE0F5', pen: '#D62F3A', sheet: '#FFFFFF', ink: '#6E7888' },
    back: [],
    front: [
      [4, 1, 8, 2, 'cap'],
      [3, 2, 6, 1, 'brim'],
      [8, 4, 4, 1, 'rim'],
      [8, 8, 4, 1, 'rim'],
      [8, 5, 1, 3, 'rim'],
      [11, 5, 1, 3, 'rim'],
      [4, 11, 8, 4, 'body'],
      [5, 12, 2, 2, 'badge'],
      [5, 15, 2, 1, 'body'],
      [9, 15, 2, 1, 'body'],
    ],
    accents: [[9, 5, 2, 1, 'lens']],
    props: [
      [1, 8, 1, 4, 'pen'],
      [13, 8, 3, 5, 'sheet'],
      [13, 9, 2, 1, 'ink'],
      [13, 11, 2, 1, 'pen'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0, mouth: 'open' }, { dy: -1 }],
      reasoning: [{ dy: 0 }, { dy: -1, propDy: -1 }],
      hit: [{ dy: 0, eyes: 'x', extra: ALERT }, { dy: -1, eyes: 'x' }],
    },
  },
};

/** Winner and loser are shared by every agent. */
const VERDICT_FRAMES: Record<'winner' | 'loser', [Frame, Frame]> = {
  winner: [
    { dy: 0, eyes: 'open', mouth: 'smile', propDy: -1, extra: [[1, 1, 1, 1, 'spark'], [14, 3, 1, 1, 'spark']] },
    { dy: -1, eyes: 'open', mouth: 'smile', propDy: -1, extra: [[2, 0, 1, 1, 'spark'], [13, 1, 1, 1, 'spark']] },
  ],
  loser: [
    { dy: 1, eyes: 'blink', mouth: 'frown' },
    { dy: 1, eyes: 'sad', mouth: 'frown' },
  ],
};

export function framesFor(agent: AgentKind, state: AgentState): Frame[] {
  if (state === 'winner' || state === 'loser') return VERDICT_FRAMES[state];
  const key = state === 'researching' || state === 'thinking' ? 'reasoning' : state;
  return COSTUMES[agent].anims[key];
}

export function frameCount(agent: AgentKind, state: AgentState): number {
  return framesFor(agent, state).length;
}

const shift = (p: Px, dx: number, dy: number): Px => [p[0] + dx, p[1] + dy, p[2], p[3], p[4]];

/** Composes the pixel list for one frame, clipped to the grid. */
export function composeFrame(agent: AgentKind, state: AgentState, frame: number): { pixels: Px[]; palette: Record<string, string> } {
  const c = COSTUMES[agent];
  const frames = framesFor(agent, state);
  const f = frames[frame % frames.length]!;
  const palette = { ...BASE_PALETTE, ...c.palette };
  const props = (f.altProps && c.propsAlt ? c.propsAlt : c.props).map((p) => shift(p, f.propDx ?? 0, f.propDy ?? 0));
  const accents = f.hideAccents ? [] : c.accents.map((p) => shift(p, 0, f.accentDy ?? 0));
  const face = [...EYES[f.eyes ?? 'open']!.map((p) => shift(p, 0, f.eyesDy ?? 0)), ...MOUTHS[f.mouth ?? 'small']!];
  const tool = (c.tool ?? []).map((p) => shift(p, f.toolDx ?? 0, f.toolDy ?? 0));
  const body = [...c.back, ...HEAD, ...c.front, ...accents, ...face, ...props, ...tool].map((p) => shift(p, f.dx ?? 0, f.dy ?? 0));
  const all: Px[] = [[4, 15, 8, 1, 'shadow'], ...body, ...(f.extra ?? [])];
  const clip = (p: Px): Px | null => {
    const x0 = Math.max(0, p[0]);
    const y0 = Math.max(0, p[1]);
    const x1 = Math.min(GRID, p[0] + p[2]);
    const y1 = Math.min(GRID, p[1] + p[3]);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0, p[4]] : null;
  };
  return { pixels: all.map(clip).filter((p): p is Px => p !== null), palette };
}
