// Persisted investigation events: paginated initial load, then live updates via
// Firestore onSnapshot (owner) or polling (read-only viewers). Nothing is invented.
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { getClientFirestore } from './firebase';
import type { InvestigationEvent } from './types';
import type { T } from '../i18n';
import type { StringKey } from '../i18n/en';

export function useEvents(jobId: string | undefined, opts: { live: boolean; readOnly: boolean }) {
  const [events, setEvents] = useState<InvestigationEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    lastSeq.current = 0;
    setEvents([]);
    setLoaded(false);

    const append = (items: InvestigationEvent[]) => {
      const fresh = items.filter((e) => e.seq > lastSeq.current).sort((a, b) => a.seq - b.seq);
      if (!fresh.length) return;
      lastSeq.current = fresh[fresh.length - 1]!.seq;
      setEvents((prev) => [...prev, ...fresh]);
    };

    const fetchAll = async () => {
      for (;;) {
        const r = await api<{ items: InvestigationEvent[]; nextAfter: number | null }>('GET', `/verifications/${jobId}/events?after=${lastSeq.current}&limit=500`);
        if (cancelled) return;
        append(r.items);
        if (r.nextAfter === null) break;
      }
    };

    (async () => {
      try {
        await fetchAll();
      } finally {
        if (!cancelled) setLoaded(true);
      }
      if (cancelled || !opts.live) return;
      const fsPromise = opts.readOnly ? null : getClientFirestore();
      if (fsPromise) {
        const [firestore, { collection, onSnapshot, orderBy, query, where }] = await Promise.all([fsPromise, import('firebase/firestore')]);
        if (cancelled) return;
        // One listener per open investigation; only events after the last loaded seq.
        const q = query(collection(firestore, 'verificationJobs', jobId, 'events'), where('seq', '>', lastSeq.current), orderBy('seq'));
        unsub = onSnapshot(
          q,
          (snap) => append(snap.docChanges().filter((c) => c.type === 'added').map((c) => c.doc.data() as InvestigationEvent)),
          () => {
            // Listener refused (e.g. rules or offline): fall back to polling the API.
            poll = setInterval(() => void fetchAll().catch(() => undefined), 2500);
          },
        );
      } else {
        poll = setInterval(() => void fetchAll().catch(() => undefined), 2500);
      }
    })().catch(() => setLoaded(true));

    return () => {
      cancelled = true;
      unsub?.();
      if (poll) clearInterval(poll);
    };
    // `live` is read once per job: a job that finishes keeps its loaded events (no reset).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, opts.readOnly]);

  return { events, loaded };
}

export function stageLabel(t: T, stageKey: string | null, claimNumber?: (claimId: string) => number | null): string {
  if (!stageKey) return '';
  const [kind, claimId, step] = stageKey.split(':');
  const n = claimId && claimNumber ? claimNumber(claimId) : null;
  const prefix = n ? `${t('inv.claim', { n })} · ` : '';
  if (kind === 'debate' && step) return prefix + t(`step.${step}` as StringKey);
  const key = `stage.${kind}` as StringKey;
  return prefix + t(key);
}

/** Hostname without "www." for display. */
export function hostOf(url: string | undefined | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Localized sentence for one research-log entry, built from its stored facts.
 * Falls back to the stored English summary only for records written before details existed.
 */
export function describeResearch(d: Record<string, any>, t: T, fallback: string | null): string {
  const host = d.host ? `${d.host} — ` : '';
  switch (d.kind) {
    case 'search': {
      const n = Array.isArray(d.sites) ? d.sites.length : 0;
      return `“${d.query}” — ${n ? t(d.cached ? 'log.search.cached' : 'log.search', { n }) : t('log.search.none')}`;
    }
    case 'search_failed':
      return `“${d.query}” — ${t('log.search.failed')}`;
    case 'retrieval_failed':
      return host + t('log.failed', { reason: d.failureReason ? t(`fail.${d.failureReason}` as StringKey) : t('fail.parse_error') });
    case 'domain_limit':
      return host + t('log.domainLimit', { n: d.limit ?? 2 });
    case 'fetched':
      return host + (d.format === 'pdf' && d.pages ? t('log.fetched.pdf', { n: d.pages }) : t('log.fetched')) + (d.cached ? ` (${t('log.cached')})` : '');
    case 'rejected':
      return host + t('log.rejected', { reason: d.note || t('log.rejected.default') });
    case 'verified':
      return host + t('log.verified') + (d.location ? ` (${d.location})` : '');
    case 'not_verbatim':
      return host + t('log.notVerbatim');
    case 'stopped':
      return `${t(`log.stopped.${d.stopReason}` as StringKey)}. ${t('log.stopped.counts', { verified: d.verified, independent: d.independent })}`;
    default:
      return fallback ?? '';
  }
}

/** Extra visual parts of an event: site chips (searches) and a small source link (page actions). */
export function eventExtras(e: InvestigationEvent): { sites: string[]; url: string | null } {
  const d = e.data as Record<string, any>;
  if (e.type !== 'research_log') return { sites: [], url: null };
  return {
    sites: d.kind === 'search' && Array.isArray(d.sites) ? d.sites : [],
    url: typeof d.url === 'string' ? d.url : null,
  };
}

/** Text shown for an event; always derived from the stored event and its referenced record. */
export function describeEvent(e: InvestigationEvent, t: T, claimNumber?: (id: string) => number | null): string {
  const d = e.data as Record<string, any>;
  switch (e.type) {
    case 'stage_started':
      return `${stageLabel(t, e.stageKey, claimNumber)} — ${t('stage.status.leased')}`;
    case 'stage_retry':
      return `${stageLabel(t, e.stageKey, claimNumber)} — ${t('inv.retry')} (${d.attempt})`;
    case 'stage_completed':
      return `${stageLabel(t, e.stageKey, claimNumber)} — ${d.skipped ? t('stage.status.skipped') : t('stage.status.completed')}${typeof d.durationMs === 'number' ? ` (${(d.durationMs / 1000).toFixed(1)}s)` : ''}`;
    case 'stage_failed':
      return `${stageLabel(t, e.stageKey, claimNumber)} — ${t('stage.status.failed')}: ${d.code ? t(`error.${d.code}` as StringKey) : (e.summary ?? '')}`;
    case 'job_status': {
      if (d.status === 'paused') return t('inv.paused');
      if (d.status === 'processing') return t('inv.resumed');
      const label = t(`status.${d.status === 'confirmed' ? 'processing' : d.status}` as StringKey);
      // Confirmed claim texts are the user's own words; other summaries are server prose and are not shown.
      return d.status === 'confirmed' && e.summary ? `${label} — ${e.summary}` : label;
    }
    case 'triage_completed':
      return `${t(`triage.${d.complexityClass}` as StringKey)} · ${t(`triage.${d.timeSensitivity}` as StringKey)} · ${t(`triage.${d.debateMode}` as StringKey)} — ${e.summary ?? ''}`;
    case 'research_log':
      return describeResearch(d, t, e.summary);
    case 'quality_finding':
      return `${t(`finding.${d.kind}` as StringKey)}: ${(e.summary ?? '').split(': ').slice(1).join(': ')}`;
    case 'extraction_page': {
      const status = { extracted: 'upload.page.ok', ocr: 'upload.page.ocr', failed: 'upload.page.failed', skipped: 'upload.page.skipped' }[d.status as string] as StringKey | undefined;
      return `${t('upload.page', { n: d.pageNumber })}: ${status ? t(status) : d.status}`;
    }
    case 'evidence_saved':
      return `[${d.evidenceId}] ${d.title ?? d.domain} — ${t(`prov.${d.provenanceStatus}` as StringKey)}`;
    case 'judge_decision':
      return t('anim.chooses', { side: t(d.winner === 'DEFENDER' ? 'agent.defender' : 'agent.prosecutor'), reason: e.summary ?? '' });
    case 'debate_message': {
      const label = d.messageType === 'challenge' ? `${t('anim.challenging', { id: d.referencedArgumentIds?.[0] ?? '' })}: ` : d.messageType === 'response' ? `${t('anim.responding', { id: d.referencedArgumentIds?.[0] ?? '' })}: ` : d.argumentId ? `${d.argumentId}: ` : '';
      return `${label}${e.summary ?? ''}`;
    }
    default:
      return e.summary ?? '';
  }
}
