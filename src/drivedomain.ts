// Single source of truth for the Google DRIVE broker's host — deliberately a SEPARATE file from
// app-domain.json (which drives the Tasks broker + plugin). Keeping Drive's host in its own data
// file is what guarantees a Drive host change can never touch the verified, in-production Tasks
// flow. Never hardcode the host in any .ts file: derive it here by template, so the only literal
// lives in drive-domain.json (and in worker-drive/src/config.js, which reads the same file).
import config from "../drive-domain.json";

/** A hostname: lowercase labels separated by dots, no scheme, port, path or trailing slash. */
const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export interface DriveDomainConfig { driveAuthHost: string; }

/** Fails loudly at load if the config is malformed, instead of yielding a broken OAuth URL. */
export function validateDriveDomain(cfg: DriveDomainConfig): void {
  if (typeof cfg.driveAuthHost !== "string" || !HOST_PATTERN.test(cfg.driveAuthHost)) {
    throw new Error(`drive-domain.json: "driveAuthHost" must be a bare lowercase hostname, got ${JSON.stringify(cfg.driveAuthHost)}`);
  }
}

validateDriveDomain(config);

/** Host serving the Drive OAuth broker Worker (momentum-google-drive). */
export const DRIVE_AUTH_HOST = config.driveAuthHost;
/** Base URL of the Drive OAuth broker the plugin talks to. */
export const DRIVE_WORKER_BASE = `https://${DRIVE_AUTH_HOST}`;
/** The one redirect_uri registered in the Drive Google OAuth client. */
export const DRIVE_CANONICAL_REDIRECT_URI = `${DRIVE_WORKER_BASE}/callback`;
