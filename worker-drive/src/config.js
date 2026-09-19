// Config for the SEPARATE Google Drive OAuth broker worker. This is intentionally NOT derived
// from ../../app-domain.json (that file drives the PRODUCTION Tasks worker + plugin). Keeping
// this worker's host self-contained is what guarantees the Tasks worker and its 1800 users are
// never touched by Drive changes.
//
// Google project: Obsidian-GDrive (Testing) — scopes tasks + drive.
// Client type: Web application. The redirect URI below MUST be registered on that client.

/** The Drive broker's own host (custom domain on the user's Cloudflare zone, Universal SSL). */
export const AUTH_HOST = "momentumlife-drive.jnagase.com";

/**
 * The redirect_uri Google sees — a FIXED constant. /auth and /exchange must send this exact
 * string, or Google answers redirect_uri_mismatch. Register it verbatim on the Obsidian-GDrive
 * Web client's "Authorized redirect URIs".
 */
export const CANONICAL_REDIRECT_URI = `https://${AUTH_HOST}/callback`;
