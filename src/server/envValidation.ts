import fs from 'fs';
import path from 'path';

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidationOptions {
  env?: NodeJS.ProcessEnv;
  allowListPath?: string;
  sessionSecretOverride?: string | null;
  approvedOwnerEmailsOverride?: string[] | null;
}

const INSECURE_DEFAULT_SECRETS: readonly string[] = Object.freeze([
  'the-goated-farm-session-secret-salt-2025',
  'the-goated-farm-session-secret',
  'change-this-to-a-secure-secret-key',
  'session-secret',
  'secret',
  'password',
  'default',
  '12345678901234567890123456789012',
  'abcdefghijklmnopqrstuvwxyz123456'
]);

/**
 * Validates whether a given session secret meets strict cryptographic strength:
 * - Must be non-empty string
 * - Length >= 32 characters (256 bits minimum)
 * - Must not match or contain known insecure default strings
 * - Must have adequate character entropy (at least 8 distinct characters)
 *
 * NOTE: Never prints the secret value in logs or exceptions.
 */
export function isStrongSessionSecret(secret: string | undefined | null): boolean {
  if (!secret || typeof secret !== 'string') return false;
  const trimmed = secret.trim();
  if (trimmed.length < 32) return false;

  const lower = trimmed.toLowerCase();
  for (const insecure of INSECURE_DEFAULT_SECRETS) {
    if (lower === insecure || lower.includes(insecure)) {
      return false;
    }
  }

  const uniqueChars = new Set(trimmed);
  if (uniqueChars.size < 8) return false;

  return true;
}

/**
 * Reads configured raw PIN from environment using supported aliases.
 */
export function extractRawPinFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.INITIAL_PIN?.trim() ||
    env.MASTER_PIN?.trim() ||
    env.INITIAL_MASTER_PIN?.trim() ||
    env.masterpin?.trim() ||
    env.MASTERPIN?.trim() ||
    env.PIN?.trim() ||
    env.pin?.trim() ||
    ''
  );
}

/**
 * Centralized production-environment validation mechanism.
 * Validates only genuine application requirements for production:
 * - SESSION_SECRET (must be configured and cryptographically strong)
 * - INITIAL_PIN / PIN (must be configured for secure bootstrapping)
 * - Authorized Owner Emails (must have at least one authorized owner email configured)
 * - PORT (if provided, must be a valid integer between 1 and 65535)
 *
 * CRITICAL: Under no circumstances are secret values ever printed or exposed in error messages.
 */
export function validateProductionEnvironment(options?: ValidationOptions): EnvValidationResult {
  const env = options?.env || process.env;
  const isProduction = env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  // In non-production environments (development/test), validation records informational notes
  if (!isProduction) {
    const rawPin = extractRawPinFromEnv(env);
    if (!rawPin) {
      warnings.push("INITIAL_PIN is not configured (using non-production mode).");
    }
    const envSecret = env.SESSION_SECRET?.trim();
    if (!envSecret || !isStrongSessionSecret(envSecret)) {
      warnings.push("SESSION_SECRET is not configured or weak in non-production (durable local fallback active).");
    }
    return { valid: true, errors: [], warnings };
  }

  // 1. Validate SESSION_SECRET in production
  let sessionSecret: string | null = null;
  if (options?.sessionSecretOverride !== undefined) {
    sessionSecret = options.sessionSecretOverride;
  } else {
    sessionSecret = env.SESSION_SECRET?.trim() || null;
  }

  if (!sessionSecret) {
    errors.push(
      "Missing required secret 'SESSION_SECRET'. In production, a dedicated SESSION_SECRET environment variable must be configured."
    );
  } else if (!isStrongSessionSecret(sessionSecret)) {
    errors.push(
      "Invalid secret 'SESSION_SECRET': does not meet cryptographic strength requirements (minimum 32 characters, high entropy, no known default/predictable values)."
    );
  }

  // 2. Validate INITIAL_PIN / PIN in production
  const rawPin = extractRawPinFromEnv(env);
  if (!rawPin) {
    errors.push(
      "Missing required secret 'INITIAL_PIN' (or PIN/MASTER_PIN). An initial owner PIN is required in production for secure authentication bootstrapping."
    );
  }

  // 3. Validate Authoritative Owner Allow-List in production
  let validEmailsCount = 0;
  if (options?.approvedOwnerEmailsOverride !== undefined) {
    validEmailsCount = (options.approvedOwnerEmailsOverride || []).filter(
      (e) => typeof e === 'string' && e.trim().includes('@')
    ).length;
  } else {
    const rawEmailsEnv = env.APPROVED_OWNER_EMAILS?.trim() || env.OWNER_EMAILS?.trim() || '';
    if (rawEmailsEnv) {
      const parsed = rawEmailsEnv
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0 && e.includes('@'));
      validEmailsCount = parsed.length;
    } else {
      const allowListFilePath =
        options?.allowListPath || path.resolve(process.cwd(), 'data', 'owner_allow_list.json');
      if (fs.existsSync(allowListFilePath)) {
        try {
          const raw = fs.readFileSync(allowListFilePath, 'utf8');
          const parsed = JSON.parse(raw);
          const emails = Array.isArray(parsed.authorizedOwners)
            ? parsed.authorizedOwners
            : Array.isArray(parsed.emails)
            ? parsed.emails
            : [];
          const validEmails = emails
            .map((e: any) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
            .filter((e: string) => e.length > 0 && e.includes('@'));
          validEmailsCount = validEmails.length;
        } catch {
          validEmailsCount = 0;
        }
      }
    }
  }

  if (validEmailsCount === 0) {
    errors.push(
      "No authorized owner emails configured. In production, at least one authorized owner email must be provided via 'APPROVED_OWNER_EMAILS' or in data/owner_allow_list.json."
    );
  }

  // 4. Validate PORT if specified
  if (env.PORT !== undefined && env.PORT !== '') {
    const parsedPort = Number(env.PORT);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      errors.push("Invalid configuration 'PORT': must be a valid integer between 1 and 65535.");
    }
  }

  // 5. Check optional SMTP consistency (warning only)
  const hasHost = Boolean(env.SMTP_HOST?.trim());
  const hasUser = Boolean(env.SMTP_USER?.trim());
  const hasPass = Boolean(env.SMTP_PASS?.trim());
  if ((hasHost || hasUser || hasPass) && !(hasHost && hasUser && hasPass)) {
    warnings.push("Partial SMTP configuration detected: 'SMTP_HOST', 'SMTP_USER', and 'SMTP_PASS' should all be configured together for reliable password reset delivery.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Asserts that the production environment is valid.
 * Fails startup with an Error if any required production secret or configuration is missing or invalid.
 * NEVER prints secret values.
 */
export function assertProductionEnvironmentValid(options?: ValidationOptions): void {
  const result = validateProductionEnvironment(options);
  if (!result.valid) {
    const errorDetails = result.errors.map((err) => `  - ${err}`).join('\n');
    throw new Error(
      `FATAL: Production environment validation failed:\n${errorDetails}\nRefusing to start server with missing or invalid required production configuration.`
    );
  }
}
