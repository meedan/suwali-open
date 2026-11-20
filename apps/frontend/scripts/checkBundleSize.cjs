#!/usr/bin/env node
// filepath: apps/frontend/scripts/checkBundleSize.js

const fs = require('fs');
const path = require('path');
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

const maxBytes = parseInt(process.argv[2] || process.env.MAX_BUNDLE_SIZE, 10) || 3500000 // default 3.5 MB

const assetsDir = path.resolve(__dirname, '../dist/assets');

let failed = false;

async function walk(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- ent.name comes from readdir() on our own build output (dist/assets), not remote input
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(full);
    } else if (ent.isFile()) {
      if (path.extname(ent.name).toLowerCase() === '.map') continue; // skip source maps

      const { size } = await fs.promises.stat(full);
      if (size > maxBytes) {
        console.error(
          `✗ ${path.relative(process.cwd(), full)} is ${size} bytes > ${maxBytes}`
        );
        failed = true;
      } else if (verbose) {
        console.log(`✓ ${path.relative(process.cwd(), full)}: ${size} bytes`);
      }
    }
  }

  if (failed) {
    console.error(`✗ Bundle size check failed: some files exceed ${maxBytes} bytes`);
  }
}

(async () => {
  try {
    await walk(assetsDir);
    if (failed) process.exit(1);
    console.log(`✓ Bundle size check passed: all assets are under ${maxBytes} bytes`);
  } catch (err) {
    console.error('Error checking bundle size', err);
    process.exit(1);
  }
})();
