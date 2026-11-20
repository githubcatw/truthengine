import '../polyfills';
// Content Extractor (PART 7.1 / 8.1): explicit handling per format. Never adds
// content that is not in the file; unreadable pages are recorded, not omitted.
import { OcrOutputSchema } from '../../shared/agents';
import { callStructured } from '../ai/structured';
import { getGeminiClient } from '../ai/gemini';
import { OCR } from '../agents/prompts';
import { MAX_OUTPUT_TOKENS, MODELS, TEMPERATURE, USAGE_LIMITS, readGeminiKey } from '../config';
import { AppError } from '../errors';

export type DetectedType = 'pdf' | 'docx' | 'txt' | 'png' | 'jpeg' | 'webp';

export interface ExtractedPage {
  pageNumber: number;
  status: 'extracted' | 'ocr' | 'failed' | 'skipped';
  method: 'native_text' | 'gemini_ocr' | 'docx' | 'plain_text' | 'none';
  text: string;
  warning: string | null;
}

export interface Extraction {
  pages: ExtractedPage[];
  warnings: string[];
  detectedLanguage: string | null;
  aiCalls: number;
}

const MIME: Record<DetectedType, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
export const mimeOf = (t: DetectedType) => MIME[t];

/** Detects the real type from magic bytes; the declared type must agree. */
export function detectType(buf: Buffer, declared: string, fileName: string): DetectedType {
  const head = buf.subarray(0, 16);
  const ascii = head.toString('latin1');
  let detected: DetectedType | null = null;
  if (ascii.startsWith('%PDF')) detected = 'pdf';
  else if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') detected = 'png';
  else if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) detected = 'jpeg';
  else if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') detected = 'webp';
  else if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) detected = /\.docx$/i.test(fileName) || declared.includes('wordprocessingml') ? 'docx' : null;
  else {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
      if (declared.startsWith('text/plain') || /\.txt$/i.test(fileName)) detected = 'txt';
    } catch {
      detected = null;
    }
  }
  if (!detected) throw new AppError('UNSUPPORTED_FILE', 'Unsupported or unrecognised file. Upload a PDF, DOCX, TXT, PNG, JPG or WEBP file.');
  const declaredOk =
    !declared ||
    declared === 'application/octet-stream' ||
    declared === MIME[detected] ||
    (detected === 'jpeg' && declared === 'image/jpg') ||
    (detected === 'txt' && declared.startsWith('text/plain'));
  if (!declaredOk) throw new AppError('UNSUPPORTED_FILE', 'The file content does not match its declared type.');
  return detected;
}

async function ocr(data: Buffer, mimeType: string, pageNumbers: number[]) {
  const { value, aiCalls } = await callStructured({
    client: getGeminiClient(),
    schema: OcrOutputSchema,
    model: MODELS.fast,
    systemInstruction: OCR,
    prompt: `Transcribe ${mimeType === 'application/pdf' ? `pages ${pageNumbers.join(', ')} of the attached PDF` : 'the attached image (page 1)'}. Return one entry per requested page.`,
    inline: [{ mimeType, data: data.toString('base64') }],
    temperature: TEMPERATURE.extraction,
    maxOutputTokens: MAX_OUTPUT_TOKENS.ocr,
    postValidate: (v) => {
      const got = new Set(v.pages.map((p) => p.pageNumber));
      const missing = pageNumbers.filter((n) => !got.has(n));
      return missing.length ? `Return an entry for every requested page; missing: ${missing.join(', ')}` : null;
    },
  });
  return { value, aiCalls };
}

const OCR_UNAVAILABLE = 'This page has no extractable text and OCR is unavailable because the Gemini API key is not configured.';

export async function extractContent(buf: Buffer, type: DetectedType): Promise<Extraction> {
  const warnings: string[] = [];
  let aiCalls = 0;

  if (type === 'txt') {
    return { pages: [{ pageNumber: 1, status: 'extracted', method: 'plain_text', text: new TextDecoder('utf-8').decode(buf), warning: null }], warnings, detectedLanguage: null, aiCalls };
  }

  if (type === 'docx') {
    try {
      const mammoth = await import('mammoth');
      const { value, messages } = await mammoth.extractRawText({ buffer: buf });
      for (const m of messages.slice(0, 5)) warnings.push(`DOCX: ${m.message}`);
      if (!value.trim()) throw new Error('empty');
      return { pages: [{ pageNumber: 1, status: 'extracted', method: 'docx', text: value, warning: null }], warnings, detectedLanguage: null, aiCalls };
    } catch (err) {
      if (/password|encrypt/i.test(String((err as Error)?.message))) throw new AppError('ENCRYPTED_FILE', 'This document is password-protected. Upload an unprotected copy.');
      throw new AppError('CORRUPTED_FILE', 'The DOCX file could not be read. It may be corrupted.');
    }
  }

  if (type === 'png' || type === 'jpeg' || type === 'webp') {
    if (!readGeminiKey()) {
      return { pages: [{ pageNumber: 1, status: 'failed', method: 'none', text: '', warning: OCR_UNAVAILABLE }], warnings: [OCR_UNAVAILABLE], detectedLanguage: null, aiCalls };
    }
    const { value, aiCalls: n } = await ocr(buf, MIME[type], [1]);
    const p = value.pages.find((x) => x.pageNumber === 1)!;
    return {
      pages: [{ pageNumber: 1, status: p.readable && p.text.trim() ? 'ocr' : 'failed', method: 'gemini_ocr', text: p.text, warning: p.warning }],
      warnings: p.warning ? [p.warning] : [],
      detectedLanguage: value.detectedLanguage,
      aiCalls: n,
    };
  }

  // PDF: native text per page; pages without text are scanned candidates for OCR.
  const { getDocumentProxy } = await import('unpdf');
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'PasswordException' || /password/i.test(String((err as Error)?.message))) {
      throw new AppError('ENCRYPTED_FILE', 'This PDF is password-protected or encrypted. Upload an unprotected copy.');
    }
    throw new AppError('CORRUPTED_FILE', 'The PDF could not be opened. It may be corrupted.');
  }
  const total = pdf.numPages;
  const limit = Math.min(total, USAGE_LIMITS.maxDocumentPages);
  if (total > limit) warnings.push(`Only the first ${limit} of ${total} pages were processed (page limit).`);
  const pages: ExtractedPage[] = [];
  for (let n = 1; n <= total; n++) {
    if (n > limit) {
      pages.push({ pageNumber: n, status: 'skipped', method: 'none', text: '', warning: 'Not processed: page limit reached.' });
      continue;
    }
    try {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((i) => ('str' in i ? `${i.str}${i.hasEOL ? '\n' : ''}` : ''))
        .join('')
        .replace(/[ \t]+/g, ' ')
        .trim();
      pages.push({ pageNumber: n, status: text.length >= 20 ? 'extracted' : 'failed', method: text.length >= 20 ? 'native_text' : 'none', text, warning: null });
    } catch {
      pages.push({ pageNumber: n, status: 'failed', method: 'none', text: '', warning: 'This page could not be parsed.' });
    }
  }

  const needOcr = pages.filter((p) => p.status === 'failed' && p.warning === null).map((p) => p.pageNumber);
  if (needOcr.length) {
    if (!readGeminiKey()) {
      for (const p of pages) if (needOcr.includes(p.pageNumber)) p.warning = OCR_UNAVAILABLE;
      warnings.push(OCR_UNAVAILABLE);
    } else {
      const allowed = needOcr.slice(0, USAGE_LIMITS.maxOcrPages);
      const over = needOcr.slice(USAGE_LIMITS.maxOcrPages);
      for (const p of pages) if (over.includes(p.pageNumber)) p.warning = 'Scanned page not read: OCR page limit reached.';
      if (over.length) warnings.push(`${over.length} scanned page(s) were not read because of the OCR page limit.`);
      if (allowed.length) {
        const { value, aiCalls: n } = await ocr(buf, 'application/pdf', allowed);
        aiCalls += n;
        for (const r of value.pages) {
          const p = pages.find((x) => x.pageNumber === r.pageNumber && allowed.includes(x.pageNumber));
          if (!p) continue;
          if (r.readable && r.text.trim()) Object.assign(p, { status: 'ocr', method: 'gemini_ocr', text: r.text, warning: r.warning });
          else Object.assign(p, { status: 'failed', method: 'gemini_ocr', warning: r.warning ?? 'The page could not be read.' });
        }
      }
    }
  }
  for (const p of pages) if (p.status === 'failed' && !p.warning) p.warning = 'The page could not be read.';
  const failed = pages.filter((p) => p.status === 'failed').length;
  if (failed) warnings.push(`${failed} page(s) could not be read; their content is not included.`);
  return { pages, warnings, detectedLanguage: null, aiCalls };
}
