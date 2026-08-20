// Stand-in for the `obsidian` package in tests.
//
// The real package ships types only and has no resolvable runtime entry, so anything under
// test that imports it (src/googletasks.ts, for instance) cannot be loaded without this.
// vitest.config.ts aliases "obsidian" here.
//
// Only the surface the tests actually exercise is implemented. Each test installs its own
// `requestUrl` behaviour through `setRequestUrl`, so the stub itself stays behaviour-free.

export interface StubRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}

export interface StubResponse {
  status: number;
  text: string;
  json?: unknown;
}

type Impl = (opts: StubRequest) => Promise<StubResponse>;

const notConfigured: Impl = () => {
  throw new Error("obsidian stub: call setRequestUrl(...) before exercising requestUrl");
};

let impl: Impl = notConfigured;

/** Installs the requestUrl behaviour for the current test. */
export function setRequestUrl(fn: Impl): void {
  impl = fn;
}

/** Restores the "not configured" guard, so a leaked call fails loudly. */
export function resetRequestUrl(): void {
  impl = notConfigured;
}

export const requestUrl = (opts: StubRequest): Promise<StubResponse> => impl(opts);

/** Notices are fire-and-forget UI; tests only need them not to throw. */
export class Notice {
  constructor(public message?: string, public duration?: number) {}
  setMessage(message: string): this {
    this.message = message;
    return this;
  }
  hide(): void {
    /* no-op */
  }
}

/**
 * Base class for the plugin's dialogs. Needed because importing a module that declares
 * `class X extends Modal` evaluates the superclass at load time — so a test that only wants a
 * constant out of such a module (CHANGELOG from whatsnew.ts) still fails without this.
 */
export class Modal {
  contentEl = { empty: () => undefined };
  constructor(public app?: unknown) {}
  open(): void {
    /* no-op */
  }
  close(): void {
    /* no-op */
  }
  onOpen(): void {
    /* no-op */
  }
  onClose(): void {
    /* no-op */
  }
}

/** Marker types the plugin imports as values in a few places. */
export class Plugin {}
export class TFile {}
export class TFolder {}
