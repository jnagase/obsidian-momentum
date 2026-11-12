import { requestUrl } from "obsidian";
import { googleError } from "./healthAuth";
import { chunkRange, ymdToCivil } from "./healthTransforms";

// Thin Google Health API v4 client (read-only). Every call uses `throw: false` and folds Google's
// error body into the message, so a failure in the debug log says WHAT Google refused.

const BASE = "https://health.googleapis.com/v4/users/me/dataTypes";
/** Safety ceiling on pagination, so a runaway nextPageToken can never loop forever. */
const MAX_PAGES = 50;

export class HealthApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HealthApiError";
  }
}

/**
 * List every data point of `dataType` matching `filter` (AIP-160, e.g.
 * `exercise.interval.civil_start_time >= "2026-11-01"`), following nextPageToken.
 */
export async function listDataPoints(token: string, dataType: string, filter: string, pageSize = 1000, maxPages = MAX_PAGES): Promise<unknown[]> {
  const out: unknown[] = [];
  let pageToken = "";
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ pageSize: String(pageSize) });
    if (filter) q.set("filter", filter);
    if (pageToken) q.set("pageToken", pageToken);
    const r = await requestUrl({
      url: `${BASE}/${dataType}/dataPoints?${q.toString()}`,
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      throw: false,
    });
    if (r.status >= 400) {
      const err = googleError(r.text);
      throw new HealthApiError(r.status, `${dataType}: ${r.status}${err ? ` — ${err}` : ""}`);
    }
    const j = (r.json ?? {}) as { dataPoints?: unknown[]; nextPageToken?: string };
    out.push(...(j.dataPoints ?? []));
    if (!j.nextPageToken) return out;
    pageToken = j.nextPageToken;
  }
  return out;
}

/**
 * Like listDataPoints but through the `:reconcile` endpoint (the docs' recommended read path for
 * sessions such as `exercise`: merges the copies of one workout seen by several sources).
 */
export async function reconcileDataPoints(token: string, dataType: string, filter: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ filter });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await requestUrl({
      url: `${BASE}/${dataType}/dataPoints:reconcile?${q.toString()}`,
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      throw: false,
    });
    if (r.status >= 400) {
      const err = googleError(r.text);
      throw new HealthApiError(r.status, `${dataType} reconcile: ${r.status}${err ? ` — ${err}` : ""}`);
    }
    const j = (r.json ?? {}) as { dataPoints?: unknown[]; nextPageToken?: string };
    out.push(...(j.dataPoints ?? []));
    if (!j.nextPageToken) return out;
    pageToken = j.nextPageToken;
  }
  return out;
}

/**
 * Daily rollup of `dataType` over [startYmd, endYmd) in the user's local calendar days. Split in
 * 14-day chunks (the tightest API limit, for total-calories/active-minutes/heart-rate).
 */
export async function dailyRollUp(token: string, dataType: string, startYmd: string, endYmd: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const [s, e] of chunkRange(startYmd, endYmd, 14)) {
    let pageToken = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const body: Record<string, unknown> = {
        range: { start: ymdToCivil(s), end: ymdToCivil(e) },
        windowSizeDays: 1,
        pageSize: 14,
      };
      if (pageToken) body.pageToken = pageToken;
      const r = await requestUrl({
        url: `${BASE}/${dataType}/dataPoints:dailyRollUp`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        throw: false,
      });
      if (r.status >= 400) {
        const err = googleError(r.text);
        throw new HealthApiError(r.status, `${dataType} rollup: ${r.status}${err ? ` — ${err}` : ""}`);
      }
      const j = (r.json ?? {}) as { rollupDataPoints?: unknown[]; nextPageToken?: string };
      out.push(...(j.rollupDataPoints ?? []));
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
  }
  return out;
}
