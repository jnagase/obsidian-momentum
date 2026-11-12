// Single source of truth for the Google HEALTH relay's host — a SEPARATE file from app-domain.json
// (Tasks) and drive-domain.json (Drive), read by both the plugin and worker-health/src/config.js,
// so the two can never drift. Never hardcode the host in a .ts file: derive it here.
import config from "../health-domain.json";

/** A hostname: lowercase labels separated by dots, no scheme, port, path or trailing slash. */
const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export interface HealthDomainConfig { healthRelayHost: string; }

/** Fails loudly at load if the config is malformed, instead of yielding a broken OAuth URL. */
export function validateHealthDomain(cfg: HealthDomainConfig): void {
  if (typeof cfg.healthRelayHost !== "string" || !HOST_PATTERN.test(cfg.healthRelayHost)) {
    throw new Error(`health-domain.json: "healthRelayHost" must be a bare lowercase hostname, got ${JSON.stringify(cfg.healthRelayHost)}`);
  }
}

validateHealthDomain(config);

/** Host serving the Google Health relay Worker (momentum-google-health). */
export const HEALTH_RELAY_HOST = config.healthRelayHost;
/**
 * The redirect_uri every user registers on THEIR OWN Google OAuth client. Sent verbatim in the
 * consent URL and in the token exchange — Google answers redirect_uri_mismatch on any difference.
 */
export const HEALTH_REDIRECT_URI = `https://${HEALTH_RELAY_HOST}/callback`;
