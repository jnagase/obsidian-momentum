import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setRequestUrl, resetRequestUrl } from "./stubs/obsidian";
import {
  listTaskLists, listTasks, createTask, updateTask, getTask, deleteTask,
  createTaskList, deleteTaskList, getDefaultTaskList,
  refreshToken, revokeGoogleToken, GTTask, GoogleToken,
} from "../src/googletasks";
import { AUTH_HOST } from "../src/appdomain";

// =====================================================================================
// Feature: google-oauth-verification
// Correctness Property 10 — A superfície de rede do plugin é fechada
//
//   ∀ sequence of plugin operations (connect, refresh, sync, revoke): every host contacted is
//   in { AUTH_HOST, oauth2.googleapis.com, tasks.googleapis.com }; every body sent to
//   tasks.googleapis.com has keys within { id, title, notes, due, status, completed }.
//
// This is the property the privacy policy rests on. The policy tells users their task data
// goes to Google and nowhere else, and that only six fields are involved — so a stray host or
// an extra field would make a public promise false, which is the fastest way to fail the OAuth
// review.
//
// Validates: Requirements 3.2, 3.3, 3.7, 3.12, 4.7
//
// AUDIT: drives the real API wrappers in src/googletasks.ts through the obsidian stub, and
// records every host and body. The static half greps the shipped source for any other network
// call, catching a host that never appears in these code paths.
// =====================================================================================

const ALLOWED_HOSTS = new Set([AUTH_HOST, "oauth2.googleapis.com", "tasks.googleapis.com"]);

/** Only these keys may reach the Google Tasks API. Anything else widens what we declared. */
const ALLOWED_TASK_KEYS = new Set(["id", "title", "notes", "due", "status", "completed"]);

interface Seen { host: string; body: string }
let seen: Seen[] = [];

beforeEach(() => {
  seen = [];
  setRequestUrl(async (opts) => {
    seen.push({ host: new URL(opts.url).hostname, body: String(opts.body ?? "") });
    return { status: 200, text: '{"items":[],"access_token":"a","expires_in":3599}', json: { items: [], access_token: "a", expires_in: 3599 } };
  });
  vi.stubGlobal("window", { setTimeout: setTimeout.bind(globalThis), clearTimeout: clearTimeout.bind(globalThis) });
});

afterEach(() => {
  resetRequestUrl();
  vi.unstubAllGlobals();
});

const tokenArb = fc.record({
  access_token: fc.string({ minLength: 10, maxLength: 30 }).map((s) => `ya29.${s.replace(/\s/g, "x")}`),
  refresh_token: fc.string({ minLength: 10, maxLength: 30 }).map((s) => `1//0e${s.replace(/\s/g, "x")}`),
  expires_at: fc.integer({ min: 0 }),
});

/** A task as the sync layer would build it, with arbitrary but valid field values. */
const taskArb: fc.Arbitrary<GTTask> = fc.record(
  {
    title: fc.string({ maxLength: 60 }),
    notes: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
    status: fc.constantFrom<"needsAction" | "completed">("needsAction", "completed"),
    due: fc.option(fc.constantFrom("2026-01-01T00:00:00.000Z", "2026-12-31T00:00:00.000Z"), { nil: undefined }),
  },
  { requiredKeys: ["title", "status"] },
);

const idArb = fc.string({ minLength: 1, maxLength: 20 }).map((s) => encodeURIComponent(s));

describe("Property 10: the plugin's network surface is closed", () => {
  it("contacts only allowed hosts, whatever the operation sequence", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, taskArb, idArb, idArb, async (token, task, listId, taskId) => {
        seen = [];
        const t = token.access_token;

        // Every network-touching operation the plugin performs.
        await listTaskLists(t);
        await getDefaultTaskList(t);
        await createTaskList(t, "board");
        await listTasks(t, listId);
        await createTask(t, listId, task);
        await updateTask(t, listId, taskId, task);
        await getTask(t, listId, taskId);
        await deleteTask(t, listId, taskId);
        await deleteTaskList(t, listId);
        await refreshToken(token as GoogleToken);
        await revokeGoogleToken(token as GoogleToken, 50);

        expect(seen.length).toBeGreaterThan(0);
        for (const { host } of seen) {
          expect(ALLOWED_HOSTS.has(host)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("sends only the declared task fields to the Tasks API", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, taskArb, idArb, idArb, async (token, task, listId, taskId) => {
        seen = [];
        const t = token.access_token;

        await createTask(t, listId, task);
        await updateTask(t, listId, taskId, task);

        const toTasksApi = seen.filter((s) => s.host === "tasks.googleapis.com" && s.body);
        expect(toTasksApi.length).toBe(2);

        for (const { body } of toTasksApi) {
          const keys = Object.keys(JSON.parse(body) as Record<string, unknown>);
          for (const key of keys) {
            expect(ALLOWED_TASK_KEYS.has(key)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------
// Static half: no OTHER host may appear anywhere in the shipped source. This catches a call
// added in a code path these tests don't drive.
// ---------------------------------------------------------------------------------------
describe("Property 10: no undeclared host anywhere in src/", () => {
  /**
   * Hosts that appear in the source WITHOUT the plugin ever sending them a request. Each is
   * listed with the reason it is not a network call, so a new entry has to be justified rather
   * than waved through.
   */
  const NOT_A_REQUEST: Record<string, string> = {
    "www.w3.org": "SVG/XML namespace URI used by createElementNS — never fetched",
    "buymeacoffee.com": "donation link rendered in settings; opened by the user, not requested",
    "myaccount.google.com": "permissions page referenced in a message so the user can visit it",
    "world.openfoodfacts.org": "the nutrition search, documented in README 'Network use & privacy'",
    "api.openfoodfacts.org": "the nutrition search, documented in README 'Network use & privacy'",
    "github.com": "repository link",
  };

  it("names no host beyond the allowed set and the justified non-request list", () => {
    const offenders: string[] = [];

    for (const file of readdirSync("src").filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join("src", file), "utf8");
      for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = match[1].toLowerCase();
        if (ALLOWED_HOSTS.has(host)) continue;
        if (host in NOT_A_REQUEST) continue;
        offenders.push(`${file}: ${host}`);
      }
    }

    // A new host here means either a genuinely new network call — which the privacy policy
    // would have to declare — or a link that belongs in NOT_A_REQUEST with a reason.
    expect(offenders).toEqual([]);
  });

  it("keeps the userinfo endpoint out of the source entirely", () => {
    // The removed fetchEmail() called it and always got 401. Its absence is what makes the
    // "tasks and task lists only" claim in the policy literally true.
    for (const file of readdirSync("src").filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join("src", file), "utf8");
      expect(text).not.toContain("oauth2/v3/userinfo");
    }
  });
});
