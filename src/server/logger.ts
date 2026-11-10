// Minimal logger that redacts secrets. Never pass document text or user content here.

const SECRET_ENV_NAMES = ['GEMINI_API_KEY', 'FIREBASE_SERVICE_ACCOUNT_JSON'];

export function redact(input: string): string {
  let out = input;
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 8) out = out.split(value).join('[REDACTED]');
  }
  // Google API keys have a recognisable shape; redact any that slip through.
  return out.replace(/AIza[0-9A-Za-z_-]{35}/g, '[REDACTED]');
}

function write(level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...(meta ?? {}), ts: new Date().toISOString() });
  // eslint-disable-next-line no-console
  console[level](redact(line));
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
};
