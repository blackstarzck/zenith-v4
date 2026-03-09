import axios, { type AxiosInstance } from 'axios';
import { Injectable } from '@nestjs/common';
import { loadEnv } from '../../common/env';

@Injectable()
export class SupabaseRestClient {
  private readonly restHttp: AxiosInstance;
  private readonly storageHttp: AxiosInstance;

  constructor() {
    const env = loadEnv();
    const sharedHeaders = {
      apikey: env.supabaseServiceKey,
      Authorization: `Bearer ${env.supabaseServiceKey}`
    } as const;

    this.restHttp = axios.create({
      baseURL: `${env.supabaseUrl}/rest/v1`,
      timeout: 2000,
      headers: {
        ...sharedHeaders,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      }
    });
    this.storageHttp = axios.create({
      baseURL: `${env.supabaseUrl}/storage/v1`,
      timeout: 4000,
      headers: sharedHeaders
    });
  }

  post(path: string, payload: unknown, signal: AbortSignal): Promise<void> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.restHttp.post(normalizedPath, payload, { signal }).then(() => undefined);
  }

  patch(path: string, payload: unknown, signal: AbortSignal): Promise<void> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.restHttp.patch(normalizedPath, payload, { signal }).then(() => undefined);
  }

  delete(path: string, signal: AbortSignal): Promise<void> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.restHttp.delete(normalizedPath, { signal }).then(() => undefined);
  }

  get<T = unknown>(path: string, signal: AbortSignal): Promise<T> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.restHttp
      .get(normalizedPath, { signal })
      .then((response) => (response.data ?? {}) as T);
  }

  getWithMeta<T = unknown>(
    path: string,
    signal: AbortSignal,
    options?: Readonly<{ countExact?: boolean }>
  ): Promise<Readonly<{ data: T; contentRange?: string }>> {
    const normalizedPath = path.replace(/^\/+/, '');
    return this.restHttp.get(normalizedPath, {
      signal,
      ...(options?.countExact ? { headers: { Prefer: 'count=exact' } } : {})
    }).then((response) => ({
      data: (response.data ?? {}) as T,
      ...(typeof response.headers['content-range'] === 'string'
        ? { contentRange: response.headers['content-range'] as string }
        : {})
    }));
  }

  uploadObject(
    bucket: string,
    objectPath: string,
    body: string,
    contentType: string,
    signal: AbortSignal
  ): Promise<void> {
    const normalizedBucket = encodeURIComponent(bucket);
    const normalizedObjectPath = objectPath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    return this.storageHttp.post(`object/${normalizedBucket}/${normalizedObjectPath}`, body, {
      signal,
      headers: {
        'Content-Type': contentType,
        'x-upsert': 'true'
      }
    }).then(() => undefined);
  }
}
