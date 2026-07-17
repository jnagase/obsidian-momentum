// Build-time flag injected by esbuild (see esbuild.config.mjs).
// True only in a personal local build (MOMENTUM_LOCAL=1); false in the community build,
// which then tree-shakes the local-command bridge (and its child_process import) away.
declare const MOMENTUM_LOCAL_CMD: boolean;
