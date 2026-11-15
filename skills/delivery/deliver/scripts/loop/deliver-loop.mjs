// Launcher of the TypeScript deliver loop: `node scripts/loop/deliver-loop.mjs -Milestone M4 ...`.
// Checks the Node version in plain JavaScript (Node below 22.18 cannot load a .ts file and would
// fail with ERR_UNKNOWN_FILE_EXTENSION, exit 1), exits 64 with the minimum, then imports
// deliver-loop.ts. On Node >= 24, `node scripts/loop/deliver-loop.ts` works directly.
// DELIVER_LOOP_NODE_VERSION overrides the detected version (tests).
const MIN_NODE_MAJOR = 24;
const version = process.env.DELIVER_LOOP_NODE_VERSION || process.versions.node;
const major = Number.parseInt(version.replace(/^v/, ''), 10);
if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
  console.error(`deliver-loop needs Node.js ${MIN_NODE_MAJOR} or newer (found ${version}).`);
  process.exit(64);
}
await import('./deliver-loop.ts');
