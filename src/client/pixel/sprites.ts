// Original pixel-art agent sprites, defined as editable data arrays on a 32x32
// grid. Each sprite = shared base character (a small screen-faced assistant)
// + a costume overlay + state/frame modifiers. No external assets.

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
  screen: '#DDE7E6',
  eye: '#1F3A5F',
  mouth: '#1F3A5F',
  body: '#8A929B',
  limb: '#5E656D',
  accent: '#C9A227',
  white: '#FFFFFF',
  shadow: '#00000022',
};

/** The shared assistant character (head screen, antenna, body, arms, legs). */
export const BASE: Px[] = [
  [10, 30, 12, 1, 'shadow'],
  [15, 3, 2, 3, 'frame'],
  [14, 1, 4, 2, 'accent'],
  // head: rounded screen
  [9, 6, 14, 1, 'frame'],
  [8, 7, 16, 10, 'frame'],
  [9, 17, 14, 1, 'frame'],
  [9, 7, 14, 10, 'screen'],
  // neck + body
  [14, 18, 4, 1, 'limb'],
  [10, 19, 12, 9, 'body'],
  // arms
  [7, 20, 3, 6, 'limb'],
  [22, 20, 3, 6, 'limb'],
  // legs
  [11, 28, 3, 2, 'limb'],
  [18, 28, 3, 2, 'limb'],
];

export interface Costume {
  palette: Record<string, string>;
  /** Drawn behind the base (capes, backpacks). */
  back: Px[];
  /** Drawn over the base (clothes, hats, visors). */
  front: Px[];
  /** Hand-held props; moved with the arms in some states. */
  props: Px[];
}

export const COSTUMES: Record<AgentKind, Costume> = {
  content_extractor: {
    palette: { body: '#F4F4F1', coat: '#D7D8D3', visor: '#5FB3C1', beam: '#9ED9E3', tool: '#4A4F55' },
    back: [],
    front: [
      [9, 9, 14, 3, 'visor'],
      [10, 19, 1, 9, 'coat'],
      [21, 19, 1, 9, 'coat'],
      [15, 20, 2, 8, 'coat'],
      [12, 22, 2, 1, 'tool'],
    ],
    props: [
      [24, 21, 4, 3, 'tool'],
      [28, 21, 1, 1, 'beam'],
      [29, 20, 1, 1, 'beam'],
      [29, 22, 1, 1, 'beam'],
      [30, 19, 1, 1, 'beam'],
      [30, 23, 1, 1, 'beam'],
    ],
  },
  quality_auditor: {
    palette: { body: '#6E7B8B', badge: '#C9A227', lens: '#B8D4E3', rim: '#3A3F45', pen: '#B5432F', sheet: '#FFFFFF', ink: '#6B6F76' },
    back: [],
    front: [
      [12, 21, 3, 3, 'badge'],
      [17, 8, 5, 1, 'rim'],
      [17, 13, 5, 1, 'rim'],
      [16, 9, 1, 4, 'rim'],
      [22, 9, 1, 4, 'rim'],
      [17, 9, 5, 4, 'lens'],
    ],
    props: [
      [4, 19, 1, 6, 'pen'],
      [4, 25, 1, 1, 'rim'],
      [25, 19, 5, 7, 'sheet'],
      [26, 20, 3, 1, 'ink'],
      [26, 22, 3, 1, 'ink'],
      [26, 24, 2, 1, 'pen'],
    ],
  },
  claim_extractor: {
    palette: { body: '#5B6B5D', shade: '#3F8F5A', shadeDark: '#2E6B43', marker: '#E8D44D', cap: '#2B2E33', paper: '#FFFFFF', line: '#9AA0A6' },
    back: [],
    front: [
      [7, 5, 18, 2, 'shade'],
      [9, 4, 14, 1, 'shadeDark'],
      [12, 19, 8, 1, 'shadeDark'],
    ],
    props: [
      [4, 18, 2, 6, 'marker'],
      [4, 17, 2, 1, 'cap'],
      [25, 20, 6, 8, 'paper'],
      [26, 22, 4, 1, 'line'],
      [26, 24, 4, 1, 'marker'],
      [26, 26, 3, 1, 'line'],
    ],
  },
  researcher: {
    palette: { body: '#8C7A55', hat: '#B59A63', hatBand: '#6B5634', pack: '#6B5634', strap: '#4A3B24', lens: '#B8D4E3', rim: '#3A3F45', book1: '#1F3A5F', book2: '#A4492F', book3: '#2F6B45' },
    back: [[6, 19, 4, 8, 'pack']],
    front: [
      [6, 6, 20, 1, 'hat'],
      [10, 2, 12, 4, 'hat'],
      [10, 5, 12, 1, 'hatBand'],
      [12, 19, 1, 9, 'strap'],
      [19, 19, 1, 9, 'strap'],
    ],
    props: [
      [25, 18, 4, 4, 'rim'],
      [26, 19, 2, 2, 'lens'],
      [26, 22, 1, 3, 'rim'],
      [1, 24, 6, 2, 'book1'],
      [2, 22, 5, 2, 'book2'],
      [1, 20, 6, 2, 'book3'],
    ],
  },
  defender: {
    palette: { body: '#B9C2CA', plate: '#8D98A3', cape: '#1E6E78', capeDark: '#155159', shield: '#1E6E78', shieldRim: '#C9A227', check: '#FFFFFF', limb: '#8D98A3' },
    back: [
      [6, 19, 2, 10, 'cape'],
      [24, 19, 2, 10, 'cape'],
      [8, 27, 16, 2, 'capeDark'],
    ],
    front: [
      [10, 19, 12, 2, 'plate'],
      [15, 21, 2, 7, 'plate'],
      [8, 6, 16, 1, 'plate'],
    ],
    props: [
      [2, 18, 7, 9, 'shieldRim'],
      [3, 19, 5, 7, 'shield'],
      [3, 22, 1, 1, 'check'],
      [4, 23, 1, 1, 'check'],
      [5, 22, 1, 1, 'check'],
      [6, 21, 1, 1, 'check'],
      [7, 20, 1, 1, 'check'],
    ],
  },
  prosecutor: {
    palette: { body: '#A4492F', collar: '#7D3522', belt: '#4A2A1E', hat: '#5A3A2C', hatBand: '#2B2E33', lens: '#B8D4E3', rim: '#3A3F45', card: '#FFFFFF', cardInk: '#A4492F' },
    back: [],
    front: [
      [6, 6, 20, 1, 'hat'],
      [10, 2, 12, 4, 'hat'],
      [10, 5, 12, 1, 'hatBand'],
      [10, 19, 4, 3, 'collar'],
      [18, 19, 4, 3, 'collar'],
      [10, 24, 12, 1, 'belt'],
      [15, 22, 2, 1, 'collar'],
      [15, 26, 2, 1, 'collar'],
    ],
    props: [
      [1, 18, 5, 5, 'rim'],
      [2, 19, 3, 3, 'lens'],
      [5, 23, 2, 2, 'rim'],
      [25, 17, 6, 7, 'card'],
      [27, 18, 2, 3, 'cardInk'],
      [27, 22, 2, 1, 'cardInk'],
    ],
  },
  judge: {
    palette: { body: '#202226', robeLine: '#3A3D43', wig: '#F2F2EE', wigShade: '#CFCFC8', gavel: '#6B4A2E', gavelHead: '#4A331F', scale: '#C9A227', limb: '#202226' },
    back: [],
    front: [
      [6, 7, 3, 11, 'wig'],
      [23, 7, 3, 11, 'wig'],
      [8, 4, 16, 3, 'wig'],
      [7, 9, 2, 1, 'wigShade'],
      [7, 12, 2, 1, 'wigShade'],
      [7, 15, 2, 1, 'wigShade'],
      [23, 9, 2, 1, 'wigShade'],
      [23, 12, 2, 1, 'wigShade'],
      [23, 15, 2, 1, 'wigShade'],
      [15, 19, 2, 9, 'robeLine'],
      [13, 19, 6, 1, 'wig'],
    ],
    props: [
      [25, 17, 1, 7, 'gavel'],
      [23, 16, 5, 3, 'gavelHead'],
      [3, 19, 1, 6, 'scale'],
      [1, 19, 5, 1, 'scale'],
      [1, 20, 1, 2, 'scale'],
      [5, 20, 1, 2, 'scale'],
      [0, 22, 3, 1, 'scale'],
      [4, 22, 3, 1, 'scale'],
    ],
  },
  pedagogue: {
    palette: { body: '#7A3B4B', button: '#E9D8B4', capTop: '#2B2E33', tassel: '#C9A227', book: '#1F3A5F', page: '#FFFFFF', pointer: '#8C6A43' },
    back: [],
    front: [
      [7, 3, 18, 2, 'capTop'],
      [11, 5, 10, 1, 'capTop'],
      [23, 5, 1, 4, 'tassel'],
      [15, 20, 1, 1, 'button'],
      [15, 23, 1, 1, 'button'],
      [15, 26, 1, 1, 'button'],
      [10, 19, 3, 2, 'button'],
      [19, 19, 3, 2, 'button'],
    ],
    props: [
      [0, 21, 8, 5, 'book'],
      [1, 22, 3, 3, 'page'],
      [4, 22, 3, 3, 'page'],
      [25, 13, 1, 10, 'pointer'],
      [26, 12, 1, 2, 'pointer'],
    ],
  },
};

/** Face variants per state; each state has 2–4 frames. */
const EYES = {
  open: [[12, 10, 2, 3, 'eye'], [18, 10, 2, 3, 'eye']] as Px[],
  blink: [[12, 12, 2, 1, 'eye'], [18, 12, 2, 1, 'eye']] as Px[],
  side: [[13, 10, 2, 3, 'eye'], [19, 10, 2, 3, 'eye']] as Px[],
  up: [[12, 9, 2, 2, 'eye'], [18, 9, 2, 2, 'eye']] as Px[],
  x: [[12, 10, 1, 1, 'eye'], [13, 11, 1, 1, 'eye'], [12, 12, 1, 1, 'eye'], [14, 10, 1, 1, 'eye'], [14, 12, 1, 1, 'eye'], [18, 10, 1, 1, 'eye'], [19, 11, 1, 1, 'eye'], [18, 12, 1, 1, 'eye'], [20, 10, 1, 1, 'eye'], [20, 12, 1, 1, 'eye']] as Px[],
  happy: [[12, 11, 2, 1, 'eye'], [11, 12, 1, 1, 'eye'], [14, 12, 1, 1, 'eye'], [18, 11, 2, 1, 'eye'], [17, 12, 1, 1, 'eye'], [20, 12, 1, 1, 'eye']] as Px[],
  down: [[12, 12, 2, 2, 'eye'], [18, 12, 2, 2, 'eye']] as Px[],
};
const MOUTH = {
  line: [[13, 14, 6, 1, 'mouth']] as Px[],
  open: [[14, 14, 4, 2, 'mouth']] as Px[],
  wide: [[13, 14, 6, 2, 'mouth']] as Px[],
  smile: [[12, 14, 1, 1, 'mouth'], [13, 15, 6, 1, 'mouth'], [19, 14, 1, 1, 'mouth']] as Px[],
  sad: [[12, 15, 1, 1, 'mouth'], [13, 14, 6, 1, 'mouth'], [19, 15, 1, 1, 'mouth']] as Px[],
  o: [[15, 14, 2, 2, 'mouth']] as Px[],
};

interface FrameSpec {
  eyes: Px[];
  mouth: Px[];
  dx?: number;
  dy?: number;
  /** Raise the arms and props (winner). */
  armsUp?: boolean;
  extra?: Px[];
}

export const STATE_FRAMES: Record<AgentState, FrameSpec[]> = {
  idle: [
    { eyes: EYES.open, mouth: MOUTH.line },
    { eyes: EYES.open, mouth: MOUTH.line },
    { eyes: EYES.blink, mouth: MOUTH.line },
  ],
  researching: [
    { eyes: EYES.side, mouth: MOUTH.line },
    { eyes: EYES.side, mouth: MOUTH.o, dy: -1 },
    { eyes: EYES.open, mouth: MOUTH.line },
  ],
  talking: [
    { eyes: EYES.open, mouth: MOUTH.open },
    { eyes: EYES.open, mouth: MOUTH.line },
    { eyes: EYES.open, mouth: MOUTH.wide },
    { eyes: EYES.blink, mouth: MOUTH.line },
  ],
  thinking: [
    { eyes: EYES.up, mouth: MOUTH.line, extra: [[24, 3, 1, 1, 'eye']] },
    { eyes: EYES.up, mouth: MOUTH.line, extra: [[24, 3, 1, 1, 'eye'], [26, 2, 1, 1, 'eye']] },
    { eyes: EYES.up, mouth: MOUTH.line, extra: [[24, 3, 1, 1, 'eye'], [26, 2, 1, 1, 'eye'], [28, 1, 1, 1, 'eye']] },
  ],
  hit: [
    { eyes: EYES.x, mouth: MOUTH.o, dx: -1 },
    { eyes: EYES.x, mouth: MOUTH.o, dx: 1 },
  ],
  winner: [
    { eyes: EYES.happy, mouth: MOUTH.smile, armsUp: true, extra: [[4, 4, 1, 1, 'accent'], [27, 6, 1, 1, 'accent']] },
    { eyes: EYES.happy, mouth: MOUTH.smile, armsUp: true, dy: -1, extra: [[5, 2, 1, 1, 'accent'], [26, 3, 1, 1, 'accent']] },
  ],
  loser: [
    { eyes: EYES.down, mouth: MOUTH.sad, dy: 1 },
    { eyes: EYES.blink, mouth: MOUTH.sad, dy: 1 },
  ],
};

export function frameCount(state: AgentState): number {
  return STATE_FRAMES[state].length;
}

/** Composes the pixel list for one frame. */
export function composeFrame(agent: AgentKind, state: AgentState, frame: number): { pixels: Px[]; palette: Record<string, string> } {
  const costume = COSTUMES[agent];
  const spec = STATE_FRAMES[state][frame % STATE_FRAMES[state].length]!;
  const palette = { ...BASE_PALETTE, ...costume.palette };
  const lift = (p: Px): Px => (spec.armsUp && p[1] >= 17 && (p[0] < 10 || p[0] > 21) ? [p[0], p[1] - 5, p[2], p[3], p[4]] : p);
  const base = BASE.map((p) => (spec.armsUp && (p === BASE[9] || p === BASE[10]) ? ([p[0], p[1] - 5, p[2], p[3], p[4]] as Px) : p));
  const move = (p: Px): Px => [p[0] + (spec.dx ?? 0), p[1] + (p[4] === 'shadow' ? 0 : (spec.dy ?? 0)), p[2], p[3], p[4]];
  // Clip to the grid so state offsets (hit, loser) never draw outside it.
  const clip = (p: Px): Px | null => {
    const x0 = Math.max(0, p[0]);
    const y0 = Math.max(0, p[1]);
    const x1 = Math.min(GRID, p[0] + p[2]);
    const y1 = Math.min(GRID, p[1] + p[3]);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0, p[4]] : null;
  };
  const pixels = [...costume.back, ...base, ...costume.front, ...costume.props.map(lift), ...spec.eyes, ...spec.mouth, ...(spec.extra ?? [])]
    .map(move)
    .map(clip)
    .filter((p): p is Px => p !== null);
  return { pixels, palette };
}
