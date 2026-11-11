import { describe, expect, it } from 'vitest';
import { COSTUMES, GRID, composeFrame, framesFor, type AgentKind, type AgentState } from '../../src/client/pixel/sprites';
import { scriptRuns } from '../../src/server/routes/reports';

const AGENTS = Object.keys(COSTUMES) as AgentKind[];
const STATES: AgentState[] = ['idle', 'researching', 'talking', 'thinking', 'hit', 'winner', 'loser'];

describe('pixel sprites', () => {
  it('defines all eight agents with 2–4 frame loops, and consecutive frames differ', () => {
    expect(AGENTS).toHaveLength(8);
    for (const a of AGENTS)
      for (const s of STATES) {
        const n = framesFor(a, s).length;
        expect(n).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(4);
        for (let f = 0; f < n; f++) {
          expect(JSON.stringify(composeFrame(a, s, f).pixels), `${a}/${s}/${f}`).not.toBe(JSON.stringify(composeFrame(a, s, (f + 1) % n).pixels));
        }
      }
  });

  it('the researcher and claim extractor have a 4-frame working animation that moves their tool', () => {
    expect(framesFor('researcher', 'researching')).toHaveLength(4);
    expect(framesFor('claim_extractor', 'researching')).toHaveLength(4);
    const marker = (f: number) => composeFrame('claim_extractor', 'researching', f).pixels.filter((p) => p[4] === 'marker' && p[2] === 2 && p[3] === 3);
    expect(marker(0)[0]![0]).toBeGreaterThan(marker(3)[0]![0]);
  });
  it('every frame stays on the 32x32 grid and uses defined colours', () => {
    for (const a of AGENTS)
      for (const s of STATES)
        for (let f = 0; f < framesFor(a, s).length; f++) {
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
