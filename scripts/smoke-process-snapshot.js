'use strict';

const assert = require('node:assert/strict');
const { getEditorMemoryUsage, getProcessSnapshot, readLinuxProcSnapshot } = require('../out/system');

async function main() {
  const forceProcFallback = process.argv.includes('--proc-fallback');
  let usedProcFallback = false;
  if (forceProcFallback) {
    assert.equal(process.platform, 'linux');
    // Exercise a real command failure even if this BusyBox build supports the ps flags.
    process.env.PATH = '/dev/null';
  }

  const readSnapshot = () => getProcessSnapshot(undefined, process.platform, async () => {
    assert.ok(forceProcFallback, 'Expected the native process command to succeed');
    usedProcFallback = true;
    const snapshot = await readLinuxProcSnapshot();
    assert.ok(snapshot.split('\n').some((line) => line.startsWith(`${process.pid} `)));
    return snapshot;
  });

  const usage = await getEditorMemoryUsage(readSnapshot);
  assert.equal(usedProcFallback, forceProcFallback);
  assert.ok(usage.usedKb > 0);
  assert.ok(usage.processCount > 0);
  console.log(`Process snapshot OK on ${process.platform}${usedProcFallback ? ' via /proc' : ''}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
