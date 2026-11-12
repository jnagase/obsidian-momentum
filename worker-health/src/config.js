// Config for the Google Health OAuth RELAY worker — DERIVED from health-domain.json, a file
// distinct from app-domain.json (Tasks) and drive-domain.json (Drive). One data file per worker
// means this worker's host and the plugin's HEALTH_RELAY_BASE can never drift, and a change here
// never touches the Tasks or Drive brokers or their users.
//
// BYO model: there is NO Google client of ours. Each user creates their own Google Cloud project
// and OAuth client (type Web) and registers CANONICAL_REDIRECT_URI below on it.
import config from "../../health-domain.json";

const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
if (typeof config.healthRelayHost !== "string" || !HOST_PATTERN.test(config.healthRelayHost)) {
  throw new Error('health-domain.json: "healthRelayHost" must be a bare lowercase hostname');
}

/** The relay's own host (custom domain on the author's Cloudflare zone, Universal SSL). */
export const RELAY_HOST = config.healthRelayHost;

/**
 * The redirect_uri every user registers on THEIR OWN Google OAuth client, and the one the plugin
 * sends in both the consent URL and the token exchange (Google rejects any mismatch).
 */
export const CANONICAL_REDIRECT_URI = `https://${RELAY_HOST}/callback`;
