// Config for the SEPARATE Google Drive OAuth broker worker — DERIVED from drive-domain.json,
// a file distinct from app-domain.json (which drives the PRODUCTION Tasks worker + plugin).
// One data file per broker means this worker's host and the plugin's DRIVE_WORKER_BASE can
// never drift, and a Drive host change never touches the Tasks worker or its users.
//
// Google project: Obsidian-GDrive (Testing) — scope: drive only.
// Client type: Web application. The redirect URI below MUST be registered on that client.
import config from "../../drive-domain.json";

const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
if (typeof config.driveAuthHost !== "string" || !HOST_PATTERN.test(config.driveAuthHost)) {
  throw new Error('drive-domain.json: "driveAuthHost" must be a bare lowercase hostname');
}

/** The Drive broker's own host (custom domain on the user's Cloudflare zone, Universal SSL). */
export const AUTH_HOST = config.driveAuthHost;

/**
 * The redirect_uri Google sees — a FIXED constant. /auth and /exchange must send this exact
 * string, or Google answers redirect_uri_mismatch. Register it verbatim on the Obsidian-GDrive
 * Web client's "Authorized redirect URIs".
 */
export const CANONICAL_REDIRECT_URI = `https://${AUTH_HOST}/callback`;
