import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type AppEnv = Readonly<{
  supabaseUrl: string;
  supabaseServiceKey: string;
  port: number;
}>;

function hydrateProcessEnvFromDotenv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env')
  ];

  for (const file of candidates) {
    if (!existsSync(file)) {
      continue;
    }
    const content = readFileSync(file, 'utf8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }
      const idx = trimmed.indexOf('=');
      if (idx <= 0) {
        return;
      }
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    });
  }
}

export function loadEnv(): AppEnv {
  hydrateProcessEnvFromDotenv();

  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseServiceKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    '';
  const port = Number(process.env.API_PORT ?? 4000);

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required');
  }
  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required');
  }
  if (supabaseServiceKey.startsWith('sb_publishable_')) {
    throw new Error(
      'Supabase service key is invalid: publishable key detected. Use SUPABASE_SECRET_KEY (sb_secret_...) or SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return {
    supabaseUrl,
    supabaseServiceKey,
    port
  };
}
