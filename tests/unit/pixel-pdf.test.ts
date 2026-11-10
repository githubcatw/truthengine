import { describe, expect, it } from 'vitest';
import { COSTUMES, GRID, STATE_FRAMES, composeFrame, type AgentKind, type AgentState } from '../../src/client/pixel/sprites';
import { scriptRuns } from '../../src/server/routes/reports';

const AGENTS = Object.keys(COSTUMES) as AgentKind[];
const STATES = Object.keys(STATE_FRAMES) as AgentState[];

describe('pixel sprites', () => {
  it('defines all eight agents and seven states with 2–4 frames each', () => {
    expect(AGENTS).toHaveLength(8);
    expect(STATES.sort()).toEqual(['hit', 'idle', 'loser', 'researching', 'talking', 'thinking', 'winner']);
    for (const s of STATES) expect(STATE_FRAMES[s].length).toBeGreaterThanOrEqual(2), expect(STATE_FRAMES[s].length).toBeLessThanOrEqual(4);
  });
  it('every frame stays on the 32x32 grid and uses defined colours', () => {
    for (const a of AGENTS)
      for (const s of STATES)
        for (let f = 0; f < STATE_FRAMES[s].length; f++) {
          const { pixels, palette } = composeFrame(a, s, f);
          for (const [x, y, w, h, c] of pixels) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(x + w).toBeLessThanOrEqual(GRID);
            expect(y + h).toBeLessThanOrEqual(GRID);
            expect(palette[c], `${a}/${s}: ${c}`).toBeTruthy();
          }
        }
  });
  it('costumes are distinct per agent', () => {
    const sigs = AGENTS.map((a) => JSON.stringify(COSTUMES[a]));
    expect(new Set(sigs).size).toBe(AGENTS.length);
  });
});

describe('PDF script runs', () => {
  it('splits Armenian, Cyrillic and Latin text so each gets an embedded font', () => {
    const runs = scriptRuns('Verdict: ՃԻՇՏ — Тема 1');
    expect(runs.map((r) => r.script)).toEqual(['latin', 'arm', 'cyr']);
    expect(runs.map((r) => r.text).join('')).toBe('Verdict: ՃԻՇՏ — Тема 1');
  });
});
