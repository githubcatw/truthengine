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
    throw new ApiError('NETWORK', 'Could not reach the server.', 0);
  }
  if (res.headers.get('content-type')?.includes('application/pdf')) return (await res.blob()) as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error?.code ?? 'INTERNAL', data?.error?.message ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
