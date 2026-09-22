import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DRIVE_PROTOCOL_ACTION, DRIVE_WORKER_BASE } from "../src/driveAuth";

// =====================================================================================
// Feature: google-drive-isolated-rollout
//
// Regression guard for the 0.7.2 incident: Drive must NEVER share scope, worker, deep-link or
// token with Tasks. These assertions fail loudly in CI the moment the two flows start to bleed
// into each other — which is exactly what widened the Tasks consent screen last time.
// =====================================================================================

const tasksWorker = readFileSync("worker/src/index.js", "utf8");
const driveWorker = readFileSync("worker-drive/src/index.js", "utf8");
const driveConfig = readFileSync("worker-drive/src/config.js", "utf8");

const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

describe("Tasks and Drive OAuth scopes never cross", () => {
  it("the Tasks worker requests ONLY the tasks scope", () => {
    expect(tasksWorker).toContain(TASKS_SCOPE);
    expect(tasksWorker).not.toContain(DRIVE_SCOPE); // ← the exact 0.7.2 mistake
  });

  it("the Drive worker requests ONLY the drive scope", () => {
    expect(driveWorker).toContain(DRIVE_SCOPE);
    expect(driveWorker).not.toContain(TASKS_SCOPE);
  });
});

describe("Tasks and Drive deep-links never cross", () => {
  it("the Tasks worker deep-links obsidian://momentum-google", () => {
    expect(tasksWorker).toContain("obsidian://momentum-google");
    expect(tasksWorker).not.toContain("obsidian://momentum-drive");
  });

  it("the Drive worker deep-links obsidian://momentum-drive only", () => {
    expect(driveWorker).toContain("obsidian://momentum-drive");
    expect(driveWorker).not.toContain("obsidian://momentum-google");
  });

  it("the plugin's Drive protocol action matches the Drive worker's deep-link", () => {
    expect(DRIVE_PROTOCOL_ACTION).toBe("momentum-drive");
    expect(driveWorker).toContain(`obsidian://${DRIVE_PROTOCOL_ACTION}`);
  });
});

describe("Drive broker host is self-contained and consistent", () => {
  it("the Drive worker config reads drive-domain.json, never app-domain.json (Tasks' file)", () => {
    // The Tasks worker derives its host from app-domain.json; the Drive worker derives from its
    // OWN drive-domain.json, so a Drive host change can never touch the Tasks redirect.
    expect(driveConfig).toContain("drive-domain.json");
    expect(driveConfig).not.toMatch(/from\s+["'][^"']*app-domain\.json["']/); // no import of Tasks' file
  });

  it("plugin DRIVE_WORKER_BASE and worker both derive from the same drive-domain.json host", () => {
    const dom = JSON.parse(readFileSync("drive-domain.json", "utf8")) as { driveAuthHost: string };
    expect(DRIVE_WORKER_BASE).toBe(`https://${dom.driveAuthHost}`);
    // The worker's redirect is that same host + /callback (guards plugin↔worker drift).
    expect(driveConfig).toContain("`https://${AUTH_HOST}/callback`");
  });
});
