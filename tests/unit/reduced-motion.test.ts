// PART 14.5 / 18: with "reduce motion" the bubble shows the full text at once (no typewriter).
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const motion = vi.hoisted(() => ({ reduce: true }));
vi.mock('framer-motion', async (orig) => ({ ...(await orig<typeof import('framer-motion')>()), useReducedMotion: () => motion.reduce }));

import { SpeechBubble } from '../../src/client/pixel/PixelAgent';

const TEXT = 'The verified excerpt states the claim directly.';

describe('reduced motion', () => {
  it('renders the whole stored text immediately when motion is reduced', () => {
    motion.reduce = true;
    expect(renderToString(createElement(SpeechBubble, { agent: 'defender', text: TEXT }))).toContain(TEXT);
  });
  it('types the text out otherwise (nothing shown on the first frame)', () => {
    motion.reduce = false;
    expect(renderToString(createElement(SpeechBubble, { agent: 'defender', text: TEXT }))).not.toContain(TEXT);
  });
});
