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

  get(path: string, signal: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.http
      .get(normalizedPath, { signal })
      .then((response) => (response.data ?? {}) as Readonly<Record<string, unknown>>);
  }
}
