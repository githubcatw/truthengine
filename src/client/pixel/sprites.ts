// Original pixel-art agent sprites as editable data arrays on a 32x32 grid.
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

export const GRID = 32;

export const BASE_PALETTE: Record<string, string> = {
  frame: '#2B2E33',
  screen: '#E6EBEF',
  eye: '#1E2126',
  mouth: '#1E2126',
  alert: '#D62F3A',
  spark: '#E3A21A',
  shadow: '#00000018',
};

/** The shared screen head. */
export const HEAD: Px[] = [
  [9, 7, 14, 1, 'frame'],
  [8, 8, 16, 11, 'frame'],
  [9, 19, 14, 1, 'frame'],
  [9, 8, 14, 11, 'screen'],
];

/** Face variants (slanted eyes as in the reference sprites). */
const EYES: Record<string, Px[]> = {
  open: [[12, 12, 2, 2, 'eye'], [14, 13, 1, 1, 'eye'], [18, 12, 2, 2, 'eye'], [17, 13, 1, 1, 'eye']],
  blink: [[12, 13, 3, 1, 'eye'], [17, 13, 3, 1, 'eye']],
  up: [[12, 11, 2, 2, 'eye'], [14, 12, 1, 1, 'eye'], [18, 11, 2, 2, 'eye'], [17, 12, 1, 1, 'eye']],
  happy: [[12, 13, 1, 1, 'eye'], [13, 12, 1, 1, 'eye'], [14, 13, 1, 1, 'eye'], [17, 13, 1, 1, 'eye'], [18, 12, 1, 1, 'eye'], [19, 13, 1, 1, 'eye']],
  sad: [[12, 13, 2, 1, 'eye'], [14, 12, 1, 1, 'eye'], [18, 13, 2, 1, 'eye'], [17, 12, 1, 1, 'eye']],
  x: [[12, 12, 1, 1, 'eye'], [14, 12, 1, 1, 'eye'], [13, 13, 1, 1, 'eye'], [12, 14, 1, 1, 'eye'], [14, 14, 1, 1, 'eye'], [17, 12, 1, 1, 'eye'], [19, 12, 1, 1, 'eye'], [18, 13, 1, 1, 'eye'], [17, 14, 1, 1, 'eye'], [19, 14, 1, 1, 'eye']],
};
const MOUTHS: Record<string, Px[]> = {
  small: [[15, 16, 2, 1, 'mouth']],
  open: [[15, 16, 2, 2, 'mouth']],
  smile: [[14, 16, 1, 1, 'mouth'], [15, 17, 2, 1, 'mouth'], [17, 16, 1, 1, 'mouth']],
  frown: [[14, 17, 1, 1, 'mouth'], [15, 16, 2, 1, 'mouth'], [17, 17, 1, 1, 'mouth']],
  o: [[15, 16, 2, 2, 'mouth']],
};

export interface Frame {
  /** Whole-sprite offset (bob / bounce / jitter). */
  dx?: number;
  dy?: number;
  /** Extra offset for the hand-held props only. */
  propDx?: number;
  propDy?: number;
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
  /** Two frames per state. */
  anims: Record<'idle' | 'talking' | 'reasoning' | 'hit', [Frame, Frame]>;
}

const ALERT: Px[] = [[27, 2, 2, 2, 'alert']];

export const COSTUMES: Record<AgentKind, Costume> = {
  // 1. Defender — knight: silver helmet and armour, teal shield with a check mark.
  defender: {
    palette: { helmet: '#9AA3AD', armor: '#A9B1BB', plate: '#6E7888', leg: '#9AA3AD', teal: '#1E7A70', check: '#FFFFFF' },
    back: [[24, 13, 3, 9, 'teal']],
    front: [
      [12, 5, 8, 2, 'helmet'],
      [14, 4, 4, 1, 'helmet'],
      [10, 20, 12, 7, 'armor'],
      [12, 21, 8, 4, 'plate'],
      [11, 27, 3, 3, 'leg'],
      [18, 27, 3, 3, 'leg'],
    ],
    accents: [],
    props: [
      [5, 13, 5, 10, 'teal'],
      [6, 18, 1, 1, 'check'],
      [7, 19, 1, 1, 'check'],
      [8, 17, 1, 2, 'check'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0, mouth: 'open' }, { dy: -1 }],
      reasoning: [{ dy: 0, eyes: 'up' }, { dy: -1, eyes: 'up' }],
      hit: [{ dy: 0, eyes: 'x', mouth: 'o', extra: ALERT }, { dy: -2, eyes: 'x', mouth: 'o' }],
    },
  },

  // 2. Prosecutor — detective: wide brown hat, rust coat, "objection" card.
  prosecutor: {
    palette: { hat: '#8A3B12', brim: '#A0461A', band: '#5A2610', coat: '#B8401C', coatLight: '#D2531F', boot: '#2B2E33', card: '#FBE3E3', cardInk: '#D62F3A' },
    back: [],
    front: [
      [5, 6, 22, 1, 'brim'],
      [10, 2, 12, 4, 'hat'],
      [10, 5, 12, 1, 'band'],
      [10, 20, 12, 8, 'coat'],
      [13, 21, 6, 7, 'coatLight'],
      [11, 28, 3, 2, 'boot'],
      [18, 28, 3, 2, 'boot'],
    ],
    accents: [],
    props: [
      [25, 15, 5, 7, 'card'],
      [26, 16, 3, 1, 'cardInk'],
      [26, 18, 3, 1, 'cardInk'],
      [27, 20, 2, 1, 'cardInk'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -2, propDx: 1 }],
      talking: [{ dy: 0, propDx: 1, mouth: 'open' }, { dy: -2, propDx: 1 }],
      reasoning: [{ dy: 0 }, { dy: -2 }],
      hit: [{ dy: 0, eyes: 'x', mouth: 'o', extra: ALERT }, { dy: -3, eyes: 'x', mouth: 'o' }],
    },
  },

  // 3. Independent Judge — white wig, black robe, raised wooden gavel.
  judge: {
    palette: { wig: '#DCE0E5', wigShade: '#B9BFC7', robe: '#1B1C1F', collar: '#FFFFFF', gavel: '#8B4513', gavelHead: '#6B3410' },
    back: [
      [6, 6, 20, 3, 'wig'],
      [5, 9, 4, 12, 'wig'],
      [23, 9, 4, 12, 'wig'],
      [5, 16, 3, 3, 'wigShade'],
      [9, 20, 14, 9, 'robe'],
    ],
    front: [
      [14, 5, 4, 1, 'wigShade'],
      [10, 9, 12, 1, 'frame'],
      [13, 20, 6, 2, 'collar'],
    ],
    accents: [],
    props: [
      [24, 12, 5, 3, 'gavelHead'],
      [26, 15, 1, 7, 'gavel'],
    ],
    // Gavel tilted down (striking / deliberating).
    propsAlt: [
      [23, 15, 5, 3, 'gavelHead'],
      [26, 18, 1, 5, 'gavel'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0, mouth: 'open' }, { dy: -2 }],
      reasoning: [{ dy: 0 }, { dy: 0, altProps: true }],
      hit: [{ dy: 0, eyes: 'x', extra: ALERT }, { dy: -2, eyes: 'x', altProps: true }],
    },
  },

  // 4. Evidence Researcher — explorer hat, magnifying glass, long brown legs.
  researcher: {
    palette: { hat: '#8C5A12', brim: '#A06A1A', band: '#5E3C0C', brown: '#7A4512', rim: '#3A3F45', lens: '#BFE0F5' },
    back: [],
    front: [
      [5, 6, 22, 1, 'brim'],
      [10, 2, 12, 4, 'hat'],
      [10, 5, 12, 1, 'band'],
      [10, 20, 2, 9, 'brown'],
      [20, 20, 2, 9, 'brown'],
    ],
    accents: [],
    props: [
      [22, 14, 6, 6, 'rim'],
      [23, 15, 4, 4, 'lens'],
      [24, 20, 2, 3, 'brown'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0, propDx: 0 }, { dy: -1, propDx: 1 }],
      // The glass moves across the eye: from the side to over the right eye.
      reasoning: [{ dy: 0 }, { dy: -1, propDx: -6, propDy: -4 }],
      hit: [{ dy: 0, eyes: 'x', propDx: -2, extra: ALERT }, { dy: -2, eyes: 'x', propDx: 2, propDy: -2 }],
    },
  },

  // 5. Claim Extractor — screen-only robot with green visor, antenna light, paper and highlighter.
  claim_extractor: {
    palette: { visor: '#1F8A3A', antenna: '#9AA0A6', tip: '#F2C21B', paper: '#FFFFFF', paperEdge: '#E1E5EA', marker: '#F2C21B' },
    back: [],
    front: [
      [15, 3, 2, 3, 'antenna'],
      [8, 6, 16, 2, 'visor'],
      [12, 20, 8, 1, 'frame'],
    ],
    accents: [[15, 2, 2, 1, 'tip']],
    props: [
      [3, 16, 6, 8, 'paper'],
      [3, 23, 6, 1, 'paperEdge'],
      [4, 18, 3, 1, 'marker'],
      [25, 13, 3, 6, 'marker'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -2, hideAccents: true }],
      talking: [{ dy: 0, eyesDy: 0, mouth: 'open' }, { dy: -1, eyesDy: -1, hideAccents: true }],
      reasoning: [{ dy: 0, accentDy: 0 }, { dy: -2, accentDy: 1 }],
      hit: [{ dy: 0, dx: -1, eyes: 'x', extra: ALERT }, { dy: -2, dx: 1, eyes: 'x', hideAccents: true }],
    },
  },

  // 6. Content Extractor — OCR specialist: antenna, cyan scanner visor, white lab coat.
  content_extractor: {
    palette: { antenna: '#9AA0A6', visor: '#4FC3E0', visorLight: '#A8E6F4', coat: '#F2F4F6', coatLine: '#D5DAE0', line: '#6E7888' },
    back: [],
    front: [
      [14, 3, 4, 1, 'antenna'],
      [15, 4, 2, 3, 'antenna'],
      [9, 11, 14, 3, 'visor'],
      [10, 11, 12, 1, 'visorLight'],
      [10, 20, 12, 9, 'coat'],
      [15, 20, 2, 9, 'coatLine'],
    ],
    // Text lines on the document pocket (they toggle and scroll while reading).
    accents: [
      [11, 22, 3, 1, 'line'],
      [11, 24, 3, 1, 'line'],
    ],
    props: [],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0 }, { dy: -1, hideAccents: true }],
      reasoning: [{ dy: 0, accentDy: 0 }, { dy: 0, accentDy: 2 }],
      hit: [{ dy: 0, eyes: 'x', extra: ALERT }, { dy: -2, eyes: 'x', accentDy: 2 }],
    },
  },

  // 7. Pedagogue — purple mortarboard with gold tassel, green cardigan, book and pointer.
  pedagogue: {
    palette: { cap: '#3B2F8F', tassel: '#E3A21A', cardigan: '#1F7A4A', shirt: '#FFFFFF', bookFrame: '#B3261E', page: '#FFF0C8', pointer: '#C2701F' },
    back: [],
    front: [
      [6, 5, 20, 2, 'cap'],
      [11, 7, 10, 1, 'cap'],
      [25, 6, 1, 5, 'tassel'],
      [10, 20, 12, 9, 'cardigan'],
      [15, 20, 2, 9, 'shirt'],
    ],
    accents: [],
    props: [
      [3, 19, 6, 7, 'bookFrame'],
      [4, 20, 4, 5, 'page'],
      [24, 11, 1, 13, 'pointer'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0, propDy: 0, mouth: 'open' }, { dy: -1, propDy: -2 }],
      reasoning: [{ dy: 0, propDx: 0 }, { dy: -1, propDx: 2 }],
      hit: [{ dy: 0, propDy: -3, eyes: 'x', extra: ALERT }, { dy: -2, propDy: -3, eyes: 'x' }],
    },
  },

  // Citation Auditor (not in the reference set) — drawn in the same style:
  // inspector cap, monocle magnifier, gold badge, red pen and checklist.
  quality_auditor: {
    palette: { cap: '#24324A', brim: '#1A2436', body: '#5E6B7D', badge: '#E3A21A', rim: '#3A3F45', lens: '#BFE0F5', pen: '#D62F3A', sheet: '#FFFFFF', ink: '#6E7888' },
    back: [],
    front: [
      [9, 4, 14, 3, 'cap'],
      [8, 6, 12, 1, 'brim'],
      [17, 10, 5, 1, 'rim'],
      [17, 15, 5, 1, 'rim'],
      [16, 11, 1, 4, 'rim'],
      [22, 11, 1, 4, 'rim'],
      [10, 20, 12, 8, 'body'],
      [12, 22, 3, 3, 'badge'],
      [11, 28, 3, 2, 'body'],
      [18, 28, 3, 2, 'body'],
    ],
    accents: [[17, 11, 5, 4, 'lens']],
    props: [
      [4, 17, 1, 7, 'pen'],
      [25, 16, 6, 8, 'sheet'],
      [26, 18, 4, 1, 'ink'],
      [26, 20, 4, 1, 'ink'],
      [26, 22, 3, 1, 'pen'],
    ],
    anims: {
      idle: [{ dy: 0 }, { dy: -1 }],
      talking: [{ dy: 0, mouth: 'open' }, { dy: -1 }],
      reasoning: [{ dy: 0 }, { dy: -1, propDy: -1 }],
      hit: [{ dy: 0, eyes: 'x', extra: ALERT }, { dy: -2, eyes: 'x' }],
    },
  },
};

/** Winner and loser are shared by every agent. */
const VERDICT_FRAMES: Record<'winner' | 'loser', [Frame, Frame]> = {
  winner: [
    { dy: 0, eyes: 'happy', mouth: 'smile', propDy: -2, extra: [[4, 3, 1, 1, 'spark'], [27, 5, 1, 1, 'spark']] },
    { dy: -2, eyes: 'happy', mouth: 'smile', propDy: -2, extra: [[5, 1, 1, 1, 'spark'], [26, 2, 1, 1, 'spark']] },
  ],
  loser: [
    { dy: 1, eyes: 'sad', mouth: 'frown' },
    { dy: 1, eyes: 'blink', mouth: 'frown' },
  ],
};

export function framesFor(agent: AgentKind, state: AgentState): [Frame, Frame] {
  if (state === 'winner' || state === 'loser') return VERDICT_FRAMES[state];
  const key = state === 'researching' || state === 'thinking' ? 'reasoning' : state;
  return COSTUMES[agent].anims[key];
}

export function frameCount(_state: AgentState): number {
  return 2;
}

const shift = (p: Px, dx: number, dy: number): Px => [p[0] + dx, p[1] + dy, p[2], p[3], p[4]];

/** Composes the pixel list for one frame, clipped to the grid. */
export function composeFrame(agent: AgentKind, state: AgentState, frame: number): { pixels: Px[]; palette: Record<string, string> } {
  const c = COSTUMES[agent];
  const f = framesFor(agent, state)[frame % 2]!;
  const palette = { ...BASE_PALETTE, ...c.palette };
  const props = (f.altProps && c.propsAlt ? c.propsAlt : c.props).map((p) => shift(p, f.propDx ?? 0, f.propDy ?? 0));
  const accents = f.hideAccents ? [] : c.accents.map((p) => shift(p, 0, f.accentDy ?? 0));
  const face = [...EYES[f.eyes ?? 'open']!.map((p) => shift(p, 0, f.eyesDy ?? 0)), ...MOUTHS[f.mouth ?? 'small']!];
  const body = [...c.back, ...HEAD, ...c.front, ...accents, ...face, ...props].map((p) => shift(p, f.dx ?? 0, f.dy ?? 0));
  const all: Px[] = [[10, 30, 12, 1, 'shadow'], ...body, ...(f.extra ?? [])];
  const clip = (p: Px): Px | null => {
    const x0 = Math.max(0, p[0]);
    const y0 = Math.max(0, p[1]);
    const x1 = Math.min(GRID, p[0] + p[2]);
    const y1 = Math.min(GRID, p[1] + p[3]);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0, p[4]] : null;
  };
  return { pixels: all.map(clip).filter((p): p is Px => p !== null), palette };
}
