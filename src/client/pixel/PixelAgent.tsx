import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { GRID, composeFrame, frameCount, type AgentKind, type AgentState } from './sprites';
import { useI18n } from '../i18n';

// 2-frame loops; 911 (hit) is the rapid 100ms pulse.
const FRAME_MS: Record<AgentState, number> = {
  idle: 600,
  talking: 280,
  researching: 350,
  thinking: 350,
  hit: 100,
  winner: 300,
  loser: 600,
};

/** Reusable pixel agent. Static first frame when the user prefers reduced motion. */
export const PixelAgent = memo(function PixelAgent({
  agent,
  state = 'idle',
  size = 96,
  label = true,
}: {
  agent: AgentKind;
  state?: AgentState;
  size?: number;
  label?: boolean;
}) {
  const reduce = useReducedMotion();
  const { t } = useI18n();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    if (reduce) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % frameCount(state)), FRAME_MS[state]);
    return () => clearInterval(id);
  }, [state, reduce]);

  const { pixels, palette } = useMemo(() => composeFrame(agent, state, reduce ? 0 : frame), [agent, state, frame, reduce]);
  const name = t(`agent.${agent}`);
  return (
    <figure className="relative inline-flex flex-col items-center gap-1">
      {state === 'talking' && size >= 48 && (
        <span className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 font-pixel text-[7px] tracking-wider text-white" aria-hidden>
          SPEECH
        </span>
      )}
      <svg
        viewBox={`0 0 ${GRID} ${GRID}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated' }}
        role="img"
        aria-label={`${name} (${state})`}
      >
        {pixels.map(([x, y, w, h, c], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} fill={palette[c] ?? c} />
        ))}
      </svg>
      {label && <figcaption className="font-pixel text-[9px] uppercase tracking-wider text-muted">{name}</figcaption>}
    </figure>
  );
});

const SIDE_TONE: Record<string, string> = {
  defender: 'border-defender',
  prosecutor: 'border-prosecutor',
  judge: 'border-judge',
};

/** Pixel-styled speech bubble showing REAL stored text (typed out unless reduced motion). */
export function SpeechBubble({
  agent,
  text,
  header,
  chips,
  side = 'left',
  typeMs = 18,
}: {
  agent: string;
  text: string;
  header?: ReactNode;
  chips?: ReactNode;
  side?: 'left' | 'right' | 'top';
  typeMs?: number;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce || typeMs <= 0) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const id = setInterval(() => setShown((n) => (n >= text.length ? (clearInterval(id), n) : n + 2)), typeMs);
    return () => clearInterval(id);
  }, [text, reduce, typeMs]);
  const tail = side === 'left' ? 'before:-left-2 before:top-4' : side === 'right' ? 'before:-right-2 before:top-4' : 'before:left-1/2 before:-bottom-2';
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative max-w-md border-2 bg-white px-3 py-2 text-sm leading-relaxed shadow-[3px_3px_0_0_rgba(0,0,0,0.12)] before:absolute before:h-3 before:w-3 before:rotate-45 before:border-b-2 before:border-l-2 before:bg-white before:content-[''] ${SIDE_TONE[agent] ?? 'border-ink/60'} ${tail} before:border-inherit`}
    >
      {header && <div className="mb-1 font-pixel text-[8px] uppercase tracking-wider text-muted">{header}</div>}
      <p className="whitespace-pre-wrap">
        {text.slice(0, shown)}
        {shown < text.length && <span className="opacity-40">▍</span>}
      </p>
      {chips && shown >= text.length && <div className="mt-2 flex flex-wrap gap-1">{chips}</div>}
    </motion.div>
  );
}
