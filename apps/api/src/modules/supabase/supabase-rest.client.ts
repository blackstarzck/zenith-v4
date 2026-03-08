import axios, { type AxiosInstance } from 'axios';
import { Injectable } from '@nestjs/common';
import { loadEnv } from '../../common/env';

@Injectable()
export class SupabaseRestClient {
  private readonly http: AxiosInstance;

  constructor() {
    const env = loadEnv();
    this.http = axios.create({
      baseURL: `${env.supabaseUrl}/rest/v1`,
      timeout: 2000,
      headers: {
        apikey: env.supabaseServiceKey,
        Authorization: `Bearer ${env.supabaseServiceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      }
    });
  }

  post(path: string, payload: unknown, signal: AbortSignal): Promise<void> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.http.post(normalizedPath, payload, { signal }).then(() => undefined);
  }

  patch(path: string, payload: unknown, signal: AbortSignal): Promise<void> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.http.patch(normalizedPath, payload, { signal }).then(() => undefined);
  }

  delete(path: string, signal: AbortSignal): Promise<void> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.http.delete(normalizedPath, { signal }).then(() => undefined);
  }

  get<T = unknown>(path: string, signal: AbortSignal): Promise<T> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.http
      .get(normalizedPath, { signal })
      .then((response) => (response.data ?? {}) as T);
  }

  getWithMeta<T = unknown>(
    path: string,
    signal: AbortSignal,
    options?: Readonly<{ countExact?: boolean }>
  ): Promise<Readonly<{ data: T; contentRange?: string }>> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.http.get(normalizedPath, {
      signal,
      ...(options?.countExact ? { headers: { Prefer: 'count=exact' } } : {})
    }).then((response) => ({
      data: (response.data ?? {}) as T,
      ...(typeof response.headers['content-range'] === 'string'
        ? { contentRange: response.headers['content-range'] as string }
        : {})
    }));
  }
}
