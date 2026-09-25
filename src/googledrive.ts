import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

// Google Drive API v3 client. Mirrors the conventions of googletasks.ts: every call uses
// Obsidian's requestUrl with `throw: false` and checks status manually, so a failure carries
// the path and Google's own message instead of a bare "status 400".
//
// OAuth is the SAME grant used for Google Tasks (brokered by the Cloudflare Worker). The token
// passed in here is an access_token already refreshed by ensureFreshToken() — this module never
// touches the auth flow itself, only the Drive REST surface.

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

/** Max automatic retries on a transient Drive failure (429 rate-limit / 5xx). */
const DRIVE_MAX_RETRIES = 4;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => { window.setTimeout(resolve, ms); });

/**
 * requestUrl with retry + exponential backoff (and jitter) on transient failures — 429 (rate
 * limit) and 5xx. Honours a `Retry-After` header when present. Always uses `throw:false` so the
 * caller keeps its existing status-based error handling; after the retries are exhausted the last
 * response is returned unchanged. Drive rate-limits readily on a large-vault sync, so this turns a
 * burst of hard failures into a brief wait.
 */
async function driveRequest(params: RequestUrlParam): Promise<RequestUrlResponse> {
  for (let attempt = 0; ; attempt++) {
    const r = await requestUrl({ ...params, throw: false });
    const transient = r.status === 429 || (r.status >= 500 && r.status <= 599);
    if (!transient || attempt >= DRIVE_MAX_RETRIES) return r;
    const retryAfterRaw = r.headers?.["retry-after"] ?? r.headers?.["Retry-After"];
    const retryAfterMs = Number(retryAfterRaw) > 0 ? Number(retryAfterRaw) * 1000 : 0;
    const backoff = retryAfterMs || Math.min(1000 * 2 ** attempt, 16000);
    await sleep(backoff + Math.floor(Math.random() * 300));
  }
}

/**
 * Thrown by listChanges when the stored change cursor (startPageToken) is no longer valid
 * (expired / too old — Google answers 400). The sync engine catches this and reseeds the cursor
 * via a full reconciliation instead of aborting, so no data is lost.
 */
export class InvalidDriveCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDriveCursorError";
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  md5Checksum?: string;
  size?: string;
  trashed?: boolean;
  /** App-private key/value metadata (invisible to the user, per-app). We store a stable logical
   *  identity here (`momentumPath`) so a file renamed/moved on Drive is still recognised as the
   *  same file instead of becoming a duplicate. */
  appProperties?: Record<string, string>;
}

/** A page of change records from the Changes API. */
export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: DriveFile;
}

/** MIME type prefix for Google-native docs (Docs/Sheets/Slides) — these need export, not download. */
export const GOOGLE_NATIVE_PREFIX = "application/vnd.google-apps.";

/** Best export target for each Google-native type: Doc→Markdown, Sheet→CSV, Slides→plain text. */
export const EXPORT_MIME: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "text/markdown", ext: "md" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "csv" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: "txt" },
};

/** Google's error message, prefixed for appending to a thrown message. */
interface GoogleErrorBody { error?: { message?: string } | string; error_description?: string }
function fmtErr(text: string): string {
  try {
    const j = JSON.parse(text) as GoogleErrorBody;
    const errObj = typeof j.error === "object" ? j.error : undefined;
    const errStr = typeof j.error === "string" ? j.error : undefined;
    const msg = errObj?.message ?? j.error_description ?? errStr;
    return msg ? ` — ${msg}` : "";
  } catch {
    return "";
  }
}

function q(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,md5Checksum,size,trashed,appProperties";

/**
 * List files/folders. Pass a folderId to list that folder's children (navigation), or a raw
 * `query` for advanced filters. Paginates internally and returns the full set.
 */
export async function listFiles(
  token: string,
  opts: { folderId?: string; query?: string } = {},
): Promise<DriveFile[]> {
  const clauses: string[] = ["trashed = false"];
  if (opts.folderId) clauses.push(`'${opts.folderId}' in parents`);
  if (opts.query) clauses.push(opts.query);
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url =
      `${DRIVE}/files` +
      q({
        q: clauses.join(" and "),
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: "1000",
        spaces: "drive",
        pageToken,
      });
    const r = await driveRequest({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
    if (r.status >= 400) throw new Error(`Drive files.list failed: ${r.status}${fmtErr(r.text)}`);
    const j = r.json as { files?: DriveFile[]; nextPageToken?: string };
    if (j.files) out.push(...j.files);
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

/** Metadata for one file. */
export async function getFileMeta(token: string, fileId: string): Promise<DriveFile> {
  const url = `${DRIVE}/files/${fileId}` + q({ fields: FILE_FIELDS });
  const r = await driveRequest({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
  if (r.status >= 400) throw new Error(`Drive files.get(meta) failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/** Download a binary/text file's content (files.get?alt=media). Returns raw bytes. */
export async function downloadFile(token: string, fileId: string): Promise<ArrayBuffer> {
  const url = `${DRIVE}/files/${fileId}` + q({ alt: "media" });
  const r = await driveRequest({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
  if (r.status >= 400) throw new Error(`Drive files.get(media) failed: ${r.status}${fmtErr(r.text)}`);
  return r.arrayBuffer;
}

/**
 * Export a Google-native doc (Docs/Sheets/Slides) to a portable text format. This is one-way:
 * the exported text is a snapshot, and re-uploading it does NOT update the native original.
 */
export async function exportFile(token: string, fileId: string, mimeType: string): Promise<string> {
  const url = `${DRIVE}/files/${fileId}/export` + q({ mimeType });
  const r = await driveRequest({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
  if (r.status >= 400) throw new Error(`Drive files.export failed: ${r.status}${fmtErr(r.text)}`);
  return r.text;
}

/**
 * Create a new file with text content in the given parent folder (multipart upload).
 * Returns the created file's metadata.
 */
export async function createTextFile(
  token: string,
  name: string,
  content: string,
  parentId?: string,
  appProperties?: Record<string, string>,
): Promise<DriveFile> {
  const boundary = `momentum-${Date.now()}`;
  const metadata: Record<string, unknown> = { name };
  if (parentId) metadata.parents = [parentId];
  if (appProperties) metadata.appProperties = appProperties;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n` +
    `${content}\r\n--${boundary}--`;
  const url = `${UPLOAD}/files` + q({ uploadType: "multipart", fields: FILE_FIELDS });
  const r = await driveRequest({
    url,
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
    throw: false,
  });
  if (r.status >= 400) throw new Error(`Drive files.create failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/** Escape a value for use inside a Drive query string literal ('...'). */
function escapeQueryValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Create a subfolder under `parentId` (or My Drive root when omitted) and return its metadata.
 * Used to mirror the vault's folder tree on Drive when syncing subfolders / the whole vault.
 */
export async function createFolder(token: string, name: string, parentId?: string): Promise<DriveFile> {
  const metadata: Record<string, unknown> = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) metadata.parents = [parentId];
  const url = `${DRIVE}/files` + q({ fields: FILE_FIELDS });
  const r = await driveRequest({
    url,
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
    throw: false,
  });
  if (r.status >= 400) throw new Error(`Drive folder.create failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/**
 * Find a direct child folder named `name` under `parentId` (root when omitted). Returns its id,
 * or undefined if there's no such folder. Used to resolve an existing folder before creating one.
 */
export async function findChildFolder(token: string, name: string, parentId: string): Promise<string | undefined> {
  const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeQueryValue(name)}'`;
  const matches = await listFiles(token, { folderId: parentId, query });
  return matches.find((f) => isFolder(f))?.id;
}

/** Overwrite an existing file's text content (media upload). Returns updated metadata. */
export async function updateTextFile(token: string, fileId: string, content: string): Promise<DriveFile> {
  const url = `${UPLOAD}/files/${fileId}` + q({ uploadType: "media", fields: FILE_FIELDS });
  const r = await driveRequest({
    url,
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain; charset=UTF-8" },
    body: content,
    throw: false,
  });
  if (r.status >= 400) throw new Error(`Drive files.update failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/**
 * Set (merge) app-private properties on a file — a metadata-only PATCH. Used to stamp the stable
 * `momentumPath` identity on files (including ones created before this feature existed, lazily).
 * Returns updated metadata.
 */
export async function setAppProperties(token: string, fileId: string, appProperties: Record<string, string>): Promise<DriveFile> {
  const url = `${DRIVE}/files/${fileId}` + q({ fields: FILE_FIELDS });
  const r = await driveRequest({
    url,
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ appProperties }),
    throw: false,
  });
  if (r.status >= 400) throw new Error(`Drive files.setAppProperties failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/** Best-effort MIME type from a file name (for binary uploads). */
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", pdf: "application/pdf", zip: "application/zip", mp3: "audio/mpeg",
  mp4: "video/mp4", mov: "video/quicktime", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export function mimeForName(name: string): string {
  const i = name.lastIndexOf(".");
  const ext = i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Build a multipart/related body (metadata JSON + raw bytes) as a single ArrayBuffer. */
function multipartBinaryBody(metadata: Record<string, unknown>, mime: string, data: ArrayBuffer, boundary: string): ArrayBuffer {
  const enc = new TextEncoder();
  const pre = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const post = enc.encode(`\r\n--${boundary}--`);
  const bytes = new Uint8Array(pre.length + data.byteLength + post.length);
  bytes.set(pre, 0);
  bytes.set(new Uint8Array(data), pre.length);
  bytes.set(post, pre.length + data.byteLength);
  return bytes.buffer;
}

/** Create a new binary file (multipart upload, raw bytes). Returns the created metadata. */
export async function createBinaryFile(token: string, name: string, data: ArrayBuffer, parentId?: string, appProperties?: Record<string, string>): Promise<DriveFile> {
  const boundary = `momentum-${Date.now()}`;
  const metadata: Record<string, unknown> = { name };
  if (parentId) metadata.parents = [parentId];
  if (appProperties) metadata.appProperties = appProperties;
  const url = `${UPLOAD}/files` + q({ uploadType: "multipart", fields: FILE_FIELDS });
  const r = await driveRequest({
    url, method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBinaryBody(metadata, mimeForName(name), data, boundary),
    throw: false,
  });
  if (r.status >= 400) throw new Error(`Drive files.create(binary) failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/** Overwrite an existing file's binary content (media upload). Returns updated metadata. */
export async function updateBinaryFile(token: string, fileId: string, data: ArrayBuffer, name: string): Promise<DriveFile> {
  const url = `${UPLOAD}/files/${fileId}` + q({ uploadType: "media", fields: FILE_FIELDS });
  const r = await driveRequest({
    url, method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeForName(name) },
    body: data,
    throw: false,
  });
  if (r.status >= 400) throw new Error(`Drive files.update(binary) failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/** Move a file to the trash (soft delete — recoverable). */
export async function trashFile(token: string, fileId: string): Promise<void> {
  const url = `${DRIVE}/files/${fileId}`;
  const r = await driveRequest({
    url,
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
    throw: false,
  });
  if (r.status >= 400 && r.status !== 404) throw new Error(`Drive trash failed: ${r.status}${fmtErr(r.text)}`);
}

// ---- Changes API: efficient server-side delta detection --------------------------------

/** Get the current change cursor ("synced up to here"). Store it; pass it to listChanges next. */
export async function getStartPageToken(token: string): Promise<string> {
  const url = `${DRIVE}/changes/startPageToken`;
  const r = await driveRequest({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
  if (r.status >= 400) throw new Error(`Drive changes.getStartPageToken failed: ${r.status}${fmtErr(r.text)}`);
  return (r.json as { startPageToken: string }).startPageToken;
}

/**
 * List changes since `pageToken`. Returns the changes plus the token to use next time
 * (`newStartPageToken`). Includes removals (deletions) natively.
 */
export async function listChanges(
  token: string,
  pageToken: string,
): Promise<{ changes: DriveChange[]; newStartPageToken: string }> {
  const changes: DriveChange[] = [];
  let cursor = pageToken;
  for (;;) {
    const url =
      `${DRIVE}/changes` +
      q({
        pageToken: cursor,
        spaces: "drive",
        includeRemoved: "true",
        // Don't restrict to My Drive: a removal we must observe can arrive on a file the user
        // moved out or that was shared — restricting would silently drop those removal events.
        restrictToMyDrive: "false",
        fields: `newStartPageToken,nextPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
        pageSize: "1000",
      });
    const r = await driveRequest({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
    // A 400 here almost always means the stored page token expired/became invalid. Signal it
    // distinctly so the engine can reseed the cursor with a full reconciliation (no data loss).
    if (r.status === 400) throw new InvalidDriveCursorError(`Drive changes.list rejected the cursor: 400${fmtErr(r.text)}`);
    if (r.status >= 400) throw new Error(`Drive changes.list failed: ${r.status}${fmtErr(r.text)}`);
    const j = r.json as {
      changes?: DriveChange[];
      nextPageToken?: string;
      newStartPageToken?: string;
    };
    if (j.changes) changes.push(...j.changes);
    if (j.nextPageToken) {
      cursor = j.nextPageToken;
      continue;
    }
    return { changes, newStartPageToken: j.newStartPageToken ?? cursor };
  }
}

/** True if a file is a Google-native doc (needs export, cannot be downloaded directly). */
export function isGoogleNative(f: DriveFile): boolean {
  return f.mimeType.startsWith(GOOGLE_NATIVE_PREFIX);
}

/** True if the folder mimeType. */
export function isFolder(f: DriveFile): boolean {
  return f.mimeType === "application/vnd.google-apps.folder";
}
