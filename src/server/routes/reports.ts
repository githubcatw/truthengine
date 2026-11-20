// PDF reports (PART 16, Phase 4) built with the open-source PDFKit library.
// Fonts are embedded (Noto Sans: Latin, Cyrillic, Armenian) so Armenian renders correctly.
import { createRequire } from 'node:module';
import path from 'node:path';
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { assertCanRead } from '../access';
import { requireAuth } from '../auth';
import { AppError } from '../errors';
import { handler, rateLimit } from '../http';
import { C, col } from '../pipeline/store';
import type { Language } from '../../shared/schemas';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, rateLimit);

const require = createRequire(import.meta.url);
const fontDir = (pkg: string) => path.join(path.dirname(require.resolve(`${pkg}/index.css`)), 'files');
const FONTS = {
  latin: path.join(fontDir('@fontsource/noto-sans'), 'noto-sans-latin-400-normal.woff'),
  latinBold: path.join(fontDir('@fontsource/noto-sans'), 'noto-sans-latin-700-normal.woff'),
  cyr: path.join(fontDir('@fontsource/noto-sans'), 'noto-sans-cyrillic-400-normal.woff'),
  cyrBold: path.join(fontDir('@fontsource/noto-sans'), 'noto-sans-cyrillic-700-normal.woff'),
  arm: path.join(fontDir('@fontsource/noto-sans-armenian'), 'noto-sans-armenian-armenian-400-normal.woff'),
  armBold: path.join(fontDir('@fontsource/noto-sans-armenian'), 'noto-sans-armenian-armenian-700-normal.woff'),
};

type Script = 'latin' | 'cyr' | 'arm';
const scriptOf = (ch: string): Script => {
  const c = ch.codePointAt(0)!;
  if ((c >= 0x0530 && c <= 0x058f) || (c >= 0xfb13 && c <= 0xfb17)) return 'arm';
  if (c >= 0x0400 && c <= 0x04ff) return 'cyr';
  return 'latin';
};

/** Splits text into same-script runs; neutral characters (spaces, digits, punctuation) join the current run. */
export function scriptRuns(text: string): Array<{ script: Script; text: string }> {
  const runs: Array<{ script: Script; text: string }> = [];
  for (const ch of text) {
    const s = /[\p{L}]/u.test(ch) ? scriptOf(ch) : (runs.at(-1)?.script ?? 'latin');
    const last = runs.at(-1);
    if (last && last.script === s) last.text += ch;
    else runs.push({ script: s, text: ch });
  }
  return runs;
}

const LABELS: Record<Language, Record<string, string>> = {
  en: { id: 'Verification ID', date: 'Generated', topic: 'Topic', verdict: 'Verdict', basis: 'Basis', judge: 'Judge ruling', choose: 'I choose the', because: 'because', defender: 'Defender', prosecutor: 'Prosecutor', evidence: 'Evidence', audit: 'Document Quality and Citation Audit', limitations: 'Limitations', strength: 'Evidence strength', disclaimer: 'AI-assisted verification, not official certification. Read the sources yourself.', final: 'Final position', args: 'Arguments' },
  hy: { id: 'Ստուգման ID', date: 'Ստեղծվել է', topic: 'Թեմա', verdict: 'Դատավճիռ', basis: 'Հիմք', judge: 'Դատավորի որոշումը', choose: 'Ես ընտրում եմ', because: 'որովհետև', defender: 'Պաշտպան', prosecutor: 'Մեղադրող', evidence: 'Ապացույցներ', audit: 'Փաստաթղթի որակի և մեջբերումների աուդիտ', limitations: 'Սահմանափակումներ', strength: 'Ապացույցների ուժը', disclaimer: 'ԱԲ-ի օգնությամբ ստուգում, ոչ թե պաշտոնական հավաստագրում։ Ինքդ կարդա աղբյուրները։', final: 'Վերջնական դիրքորոշում', args: 'Փաստարկներ' },
  ru: { id: 'ID проверки', date: 'Создано', topic: 'Тема', verdict: 'Вердикт', basis: 'Основание', judge: 'Решение судьи', choose: 'Я выбираю сторону', because: 'потому что', defender: 'Защитник', prosecutor: 'Обвинитель', evidence: 'Доказательства', audit: 'Аудит качества документа и цитат', limitations: 'Ограничения', strength: 'Сила доказательств', disclaimer: 'Проверка с помощью ИИ, а не официальная сертификация. Читайте источники сами.', final: 'Итоговая позиция', args: 'Аргументы' },
};
const VERDICT: Record<Language, Record<string, string>> = { en: { CORRECT: 'CORRECT', WRONG: 'WRONG' }, hy: { CORRECT: 'ՃԻՇՏ', WRONG: 'ՍԽԱԼ' }, ru: { CORRECT: 'ВЕРНО', WRONG: 'НЕВЕРНО' } };
const BASIS: Record<Language, Record<string, string>> = {
  en: { established: 'The evidence establishes the claim as worded.', contradicted: 'The evidence contradicts the claim.', material_error: 'A key detail of the claim is wrong.', not_established: 'The claim could not be established as accurate. This does not mean the opposite is true.' },
  hy: { established: 'Ապացույցները հաստատում են պնդումն այնպես, ինչպես այն ձևակերպված է։', contradicted: 'Ապացույցները հերքում են պնդումը։', material_error: 'Պնդման կարևոր մանրամասնը սխալ է։', not_established: 'Պնդումը հնարավոր չեղավ հաստատել որպես ճշգրիտ։ Սա չի նշանակում, որ հակառակն է ճիշտ։' },
  ru: { established: 'Доказательства подтверждают утверждение в его формулировке.', contradicted: 'Доказательства опровергают утверждение.', material_error: 'Ключевая деталь утверждения ошибочна.', not_established: 'Утверждение не удалось подтвердить как точное. Это не означает, что верно обратное.' },
};
const PROV: Record<string, string> = {
  quote_verified: 'Verified excerpt (found in retrieved content)',
  fetched: 'Retrieved source (excerpt not verified)',
  search_metadata_only: 'Search snippet (not a verified quotation)',
  retrieval_failed: 'Retrieval failed (not verified)',
};

reportsRouter.get(
  '/:file',
  handler(async (req, res) => {
    const claimId = req.params.file!.replace(/\.pdf$/, '');
    const claimSnap = await col(C.claims).doc(claimId).get();
    const claim = claimSnap.data();
    const job = claim ? (await col(C.jobs).doc(claim.jobId).get()).data() : null;
    await assertCanRead(claim && job ? { userId: claim.userId, classroomId: job.classroomId } : null, req.user!);
    const [decisionSnap, evidenceSnap, messagesSnap, findingsSnap] = await Promise.all([
      col(C.decisions).doc(`${claimId}_judge`).get(),
      col(C.evidence).where('claimId', '==', claimId).get(),
      col(C.messages).where('claimId', '==', claimId).get(),
      col(C.qualityFindings).where('submissionId', '==', claim!.submissionId).get(),
    ]);
    const d = decisionSnap.data();
    if (!d) throw new AppError('NOT_FOUND', 'No verdict exists for this claim.');
    const lang: Language = req.user!.preferredLanguage;
    const L = LABELS[lang];

    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `TruthEngine ${claimId}`, Producer: 'TruthEngine Classroom' } });
    for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, file);
    const write = (text: string, opts: { size?: number; bold?: boolean; color?: string; gap?: number } = {}) => {
      const runs = scriptRuns(text);
      doc.fontSize(opts.size ?? 10).fillColor(opts.color ?? '#23262B');
      runs.forEach((r, i) => {
        doc.font(`${r.script}${opts.bold ? 'Bold' : ''}`).text(r.text, { continued: i < runs.length - 1 });
      });
      if (opts.gap) doc.moveDown(opts.gap);
    };
    const heading = (s: string) => {
      doc.moveDown(0.8);
      write(s, { size: 13, bold: true, gap: 0.3 });
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="truthengine-${claimId}.pdf"`);
    doc.pipe(res);

    write('TRUTHENGINE CLASSROOM', { size: 9, bold: true, color: '#1F3A5F' });
    write("Don't Just Trust AI. Verify It.", { size: 8, color: '#6B6F76', gap: 0.8 });
    write(`${L.id}: ${claimId}`, { size: 8, color: '#6B6F76' });
    write(`${L.date}: ${new Date().toISOString()} · ${new Date(d.createdAtMs).toISOString()}`, { size: 8, color: '#6B6F76', gap: 0.6 });
    write(L.topic, { size: 9, color: '#6B6F76' });
    write(claim!.normalizedText, { size: 14, bold: true, gap: 0.5 });
    write(`${L.verdict}: ${VERDICT[lang][d.verdict]}`, { size: 16, bold: true, color: d.verdict === 'CORRECT' ? '#2F6B45' : '#A23B35' });
    write(`${L.basis}: ${BASIS[lang][d.verdictBasis]}`, { gap: 0.2 });
    write(`${L.strength}: ${d.evidenceStrength}`, { gap: 0.2 });

    heading(L.judge);
    write(`${L.choose} ${d.winner === 'DEFENDER' ? L.defender : L.prosecutor} ${L.because} ${d.reasoning}`, { gap: 0.4 });
    for (const s of d.whatWasEstablished) write(`+ ${s}`);
    for (const s of d.whatWasNotEstablished) write(`− ${s}`);
    write(d.studentConclusion, { gap: 0.3 });

    const messages = messagesSnap.docs.map((m) => m.data()).sort((a, b) => a.order - b.order);
    for (const side of ['defender', 'prosecutor'] as const) {
      heading(side === 'defender' ? L.defender : L.prosecutor);
      const args = messages.filter((m) => m.agentType === side && m.messageType === 'argument');
      if (args.length) write(`${L.args}:`, { bold: true });
      for (const a of args) write(`${a.argumentId}: ${a.content} [${a.referencedEvidenceIds.join(', ')}]${a.unsupportedAssertion ? ' (unsupported — ignored)' : ''}`);
      const fin = messages.filter((m) => m.agentType === side && m.messageType === 'final_position').at(-1);
      if (fin) write(`${L.final}: ${fin.content}`, { gap: 0.2 });
    }

    heading(L.evidence);
    const evidence = evidenceSnap.docs.map((e) => e.data()).sort((a, b) => String(a.evidenceId).localeCompare(String(b.evidenceId), undefined, { numeric: true }));
    for (const e of evidence) {
      write(`[${e.evidenceId}] ${e.sourceTitle ?? e.domain}${e.sourceOrganization ? ` — ${e.sourceOrganization}` : ''}`, { bold: true });
      write(`${PROV[e.provenanceStatus]}${e.failureReason ? ` (${e.failureReason})` : ''} · ${e.retrievalDate}`, { size: 8, color: '#6B6F76' });
      write(e.sourceUrl, { size: 8, color: '#1F3A5F' });
      if (e.excerpt) write(`“${e.excerpt}”`, { size: 9 });
      doc.moveDown(0.4);
    }

    const findings = findingsSnap.docs.map((f) => f.data());
    if (findings.length) {
      heading(L.audit);
      for (const f of findings) {
        write(`${f.label} (${f.severity})`, { bold: true });
        write(`“${f.passage}”`, { size: 9 });
        write(`${f.explanation} — ${f.check.performed}: ${f.check.result}`, { size: 8, color: '#6B6F76', gap: 0.3 });
      }
    }

    if (d.limitations.length) {
      heading(L.limitations);
      for (const l of d.limitations) write(`• ${l}`);
    }
    doc.moveDown(1.2);
    write(L.disclaimer, { size: 9, bold: true, color: '#6B6F76' });
    doc.end();
    await new Promise((r) => res.on('finish', r));
  }),
);
