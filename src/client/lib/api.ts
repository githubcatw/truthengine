import { auth } from './firebase';
import type { ApiErrorCode } from '../../shared/schemas';

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode | 'NETWORK',
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Set by the i18n provider so API errors are shown in the interface language. */
let translateError: ((code: string, serverMessage: string) => string) | null = null;
export function setErrorTranslator(fn: typeof translateError) {
  translateError = fn;
}
const localized = (code: string, message: string) => (translateError ? translateError(code, message) : message);

async function token(): Promise<string | null> {
  return auth?.currentUser ? auth.currentUser.getIdToken() : null;
}

export async function api<T = any>(method: string, path: string, body?: unknown, init?: { raw?: BodyInit; headers?: Record<string, string> }): Promise<T> {
  const t = await token();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
      body: init?.raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError('NETWORK', localized('NETWORK', 'Could not reach the server.'), 0);
  }
  if (res.headers.get('content-type')?.includes('application/pdf')) return (await res.blob()) as T;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (e.g. a proxy error page): treat as a server error.
    data = null;
  }
  if (!res.ok) {
    const code = data?.error?.code ?? 'INTERNAL';
    throw new ApiError(code, localized(code, data?.error?.message ?? `Request failed (${res.status})`), res.status);
  }
  return data as T;
}

export const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
