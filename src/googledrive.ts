import { requestUrl } from "obsidian";

// Google Drive API v3 client. Mirrors the conventions of googletasks.ts: every call uses
// Obsidian's requestUrl with `throw: false` and checks status manually, so a failure carries
// the path and Google's own message instead of a bare "status 400".
//
// OAuth is the SAME grant used for Google Tasks (brokered by the Cloudflare Worker). The token
// passed in here is an access_token already refreshed by ensureFreshToken() — this module never
// touches the auth flow itself, only the Drive REST surface.

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  md5Checksum?: string;
  size?: string;
  trashed?: boolean;
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
function fmtErr(text: string): string {
  try {
    const j = JSON.parse(text);
    const msg = j?.error?.message ?? j?.error_description ?? j?.error;
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

const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,md5Checksum,size,trashed";

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
    const r = await requestUrl({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
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
  const r = await requestUrl({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
  if (r.status >= 400) throw new Error(`Drive files.get(meta) failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/** Download a binary/text file's content (files.get?alt=media). Returns raw bytes. */
export async function downloadFile(token: string, fileId: string): Promise<ArrayBuffer> {
  const url = `${DRIVE}/files/${fileId}` + q({ alt: "media" });
  const r = await requestUrl({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
  if (r.status >= 400) throw new Error(`Drive files.get(media) failed: ${r.status}${fmtErr(r.text)}`);
  return r.arrayBuffer;
}

/**
 * Export a Google-native doc (Docs/Sheets/Slides) to a portable text format. This is one-way:
 * the exported text is a snapshot, and re-uploading it does NOT update the native original.
 */
export async function exportFile(token: string, fileId: string, mimeType: string): Promise<string> {
  const url = `${DRIVE}/files/${fileId}/export` + q({ mimeType });
  const r = await requestUrl({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
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
): Promise<DriveFile> {
  const boundary = `momentum-${Date.now()}`;
  const metadata: Record<string, unknown> = { name };
  if (parentId) metadata.parents = [parentId];
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n` +
    `${content}\r\n--${boundary}--`;
  const url = `${UPLOAD}/files` + q({ uploadType: "multipart", fields: FILE_FIELDS });
  const r = await requestUrl({
    url,
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
    throw: false,
  });
  if (r.status >= 400) throw new Error(`Drive files.create failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/** Overwrite an existing file's text content (media upload). Returns updated metadata. */
export async function updateTextFile(token: string, fileId: string, content: string): Promise<DriveFile> {
  const url = `${UPLOAD}/files/${fileId}` + q({ uploadType: "media", fields: FILE_FIELDS });
  const r = await requestUrl({
    url,
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain; charset=UTF-8" },
    body: content,
    throw: false,
  });
  if (r.status >= 400) throw new Error(`Drive files.update failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as DriveFile;
}

/** Move a file to the trash (soft delete — recoverable). */
export async function trashFile(token: string, fileId: string): Promise<void> {
  const url = `${DRIVE}/files/${fileId}`;
  const r = await requestUrl({
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
  const r = await requestUrl({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
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
        fields: `newStartPageToken,nextPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
        pageSize: "1000",
      });
    const r = await requestUrl({ url, headers: { Authorization: `Bearer ${token}` }, throw: false });
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
