'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getEditorMemoryUsage,
  getProcessSnapshot,
  PROC_READ_BATCH_SIZE,
  readLinuxProcSnapshot,
  runCommand,
} = require('../out/system');

test('runCommand returns output from the executable', async () => {
  const output = await runCommand(process.execPath, ['-p', 'JSON.stringify("omnimem-test")']);
  assert.ok(output.includes('omnimem-test'));
});

test('runCommand rejects when command is invalid', async () => {
  await assert.rejects(async () => {
    await runCommand('non_existent_command_12345_xyz');
  });
});

test('getProcessSnapshot selects the command for Unix and Windows', async () => {
  const commands = [];
  const execute = async (command, args) => {
    commands.push([command, ...args]);
    return 'snapshot';
  };

  assert.deepEqual(await getProcessSnapshot(execute, 'darwin'), { platform: 'darwin', raw: 'snapshot' });
  assert.deepEqual(commands[0], ['ps', '-ww', '-eo', 'pid,rss,command']);

  assert.deepEqual(await getProcessSnapshot(execute, 'win32'), { platform: 'win32', raw: 'snapshot' });
  assert.equal(commands[1][0], 'powershell');
  assert.match(commands[1].at(-1), /Get-CimInstance Win32_Process/);
});

test('getEditorMemoryUsage summarizes a valid process snapshot', async () => {
  const readSnapshot = async () => ({
    platform: 'linux',
    raw: [
      'PID RSS COMMAND',
      '1 10000 /usr/bin/editor --type=main',
      '2 15000 /usr/bin/editor --type=renderer',
    ].join('\n'),
  });

  assert.deepEqual(
    await getEditorMemoryUsage(readSnapshot, '/usr/bin/editor', () => 32 * 1024 ** 3),
    { usedKb: 25000, processCount: 2, systemTotalBytes: 32 * 1024 ** 3 }
  );
});

test('getEditorMemoryUsage rejects invalid and unmatched snapshots', async () => {
  await assert.rejects(
    () => getEditorMemoryUsage(async () => ({ platform: 'win32', raw: 'invalid json' }), 'C:\\Editor\\Editor.exe'),
    /could not parse/
  );

  await assert.rejects(
    () => getEditorMemoryUsage(async () => ({ platform: 'linux', raw: 'PID RSS COMMAND' }), '/usr/bin/editor'),
    /no editor processes matched/
  );
});

test('getProcessSnapshot falls back to /proc on Linux when ps fails', async () => {
  const execute = async () => {
    throw new Error('ps: invalid option');
  };
  const readProc = async () => 'PID RSS COMMAND\n1 1000 /usr/bin/editor';

  assert.deepEqual(await getProcessSnapshot(execute, 'linux', readProc), {
    platform: 'linux',
    raw: 'PID RSS COMMAND\n1 1000 /usr/bin/editor',
  });
});

test('getProcessSnapshot does not use the /proc fallback on other unix platforms', async () => {
  const execute = async () => {
    throw new Error('ps failed');
  };
  const readProc = async () => 'should not be called';

  await assert.rejects(() => getProcessSnapshot(execute, 'darwin', readProc), /ps failed/);
});

test('readLinuxProcSnapshot builds ps-compatible output from a proc tree', async () => {
  const procRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimem-proc-'));
  try {
    fs.mkdirSync(path.join(procRoot, '1234'));
    fs.mkdirSync(path.join(procRoot, 'notapid'));
    fs.writeFileSync(
      path.join(procRoot, '1234', 'status'),
      'Name:\teditor\nVmRSS:\t   20480 kB\nVmSize:\t  100 kB\n'
    );
    fs.writeFileSync(
      path.join(procRoot, '1234', 'cmdline'),
      '/usr/bin/editor\0--type=main\n123 5000 /usr/bin/editor\0'
    );
    // A pid whose files vanish mid-read must be skipped, not fail the snapshot.
    fs.mkdirSync(path.join(procRoot, '5678'));

    const output = await readLinuxProcSnapshot(procRoot);
    const lines = output.split('\n');

    assert.equal(lines[0], 'PID RSS COMMAND');
    assert.deepEqual(lines.slice(1), ['1234 20480 /usr/bin/editor --type=main 123 5000 /usr/bin/editor']);
  } finally {
    fs.rmSync(procRoot, { recursive: true, force: true });
  }
});

test('readLinuxProcSnapshot rejects when a /proc read hangs past the timeout', async () => {
  let releaseHang;
  const readdir = async () => ['9999'];
  const readFile = async (filePath) => {
    if (String(filePath).endsWith(`${path.sep}status`)) {
      return 'Name:\thung\nVmRSS:\t    1024 kB\n';
    }
    // Simulate a kernel-blocked /proc/<pid>/cmdline read.
    return new Promise((resolve) => {
      releaseHang = resolve;
    });
  };

  const startedAt = Date.now();
  await assert.rejects(
    () => readLinuxProcSnapshot('/proc-fake', 50, readFile, readdir),
    /timed out/
  );
  assert.ok(Date.now() - startedAt < 1000, 'fallback must not hang indefinitely');
  releaseHang('/usr/bin/hung');
  await new Promise((resolve) => setImmediate(resolve));
});

test('readLinuxProcSnapshot does not start another walk while a timed-out one is still running', async () => {
  let releaseHang;
  let readdirCalls = 0;
  const readdir = async () => {
    readdirCalls += 1;
    return ['9999'];
  };
  const hangingReadFile = async (filePath) => {
    if (String(filePath).endsWith(`${path.sep}status`)) {
      return 'Name:\thung\nVmRSS:\t    1024 kB\n';
    }
    return new Promise((resolve) => {
      releaseHang = resolve;
    });
  };

  await assert.rejects(
    () => readLinuxProcSnapshot('/proc-fake', 50, hangingReadFile, readdir),
    /timed out/
  );
  assert.equal(readdirCalls, 1);

  await assert.rejects(
    () => readLinuxProcSnapshot('/proc-fake', 50, hangingReadFile, readdir),
    /still in progress/
  );
  assert.equal(readdirCalls, 1, 'must not open more /proc reads while one is stuck');

  releaseHang('/usr/bin/hung');
  await new Promise((resolve) => setImmediate(resolve));

  const readyReadFile = async (filePath) => {
    if (String(filePath).endsWith(`${path.sep}status`)) {
      return 'Name:\tok\nVmRSS:\t      10 kB\n';
    }
    return '/bin/ok';
  };
  const output = await readLinuxProcSnapshot('/proc-fake', 1000, readyReadFile, async () => {
    readdirCalls += 1;
    return ['2'];
  });
  assert.match(output, /2 10 \/bin\/ok/);
  assert.equal(readdirCalls, 2);
});

test('readLinuxProcSnapshot clears the mutex after readdir fails so a retry can run', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await assert.rejects(
      () =>
        readLinuxProcSnapshot(
          '/proc-fake',
          1000,
          async () => '',
          async () => {
            throw new Error('readdir failed');
          }
        ),
      /readdir failed/
    );
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled.length, 0);

    const output = await readLinuxProcSnapshot(
      '/proc-fake',
      1000,
      async (filePath) => {
        if (String(filePath).endsWith(`${path.sep}status`)) {
          return 'Name:\tok\nVmRSS:\t      10 kB\n';
        }
        return '/bin/ok';
      },
      async () => ['2']
    );
    assert.match(output, /2 10 \/bin\/ok/);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('timed-out /proc walk does not open files for later batches', async () => {
  const pids = Array.from({ length: PROC_READ_BATCH_SIZE * 2 }, (_, index) => String(1000 + index));
  const firstBatch = new Set(pids.slice(0, PROC_READ_BATCH_SIZE));
  const releaseFirstBatch = [];
  let openedAfterTimeout = 0;
  let timedOut = false;

  const readFile = async (filePath) => {
    const segments = String(filePath).split(path.sep);
    const pid = segments[segments.length - 2];
    if (String(filePath).endsWith(`${path.sep}status`)) {
      return 'Name:\tp\nVmRSS:\t      10 kB\n';
    }
    if (firstBatch.has(pid)) {
      return new Promise((resolve) => {
        releaseFirstBatch.push(() => resolve(`/bin/${pid}`));
      });
    }
    if (timedOut) openedAfterTimeout += 1;
    return `/bin/${pid}`;
  };

  await assert.rejects(
    () => readLinuxProcSnapshot('/proc-fake', 50, readFile, async () => pids),
    /timed out/
  );
  timedOut = true;
  assert.ok(releaseFirstBatch.length > 0, 'first batch should have started before timeout');

  for (const release of releaseFirstBatch) release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(openedAfterTimeout, 0, 'must not schedule reads for later PID batches after timeout');
});

test('timed-out /proc walk does not open cmdline after a late status read', async () => {
  let releaseStatus;
  let cmdlineOpens = 0;

  const readFile = async (filePath) => {
    if (String(filePath).endsWith(`${path.sep}status`)) {
      return new Promise((resolve) => {
        releaseStatus = () => resolve('Name:\tp\nVmRSS:\t      10 kB\n');
      });
    }
    cmdlineOpens += 1;
    return '/bin/late';
  };

  await assert.rejects(
    () => readLinuxProcSnapshot('/proc-fake', 50, readFile, async () => ['4242']),
    /timed out/
  );
  assert.equal(typeof releaseStatus, 'function');
  releaseStatus();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(cmdlineOpens, 0, 'must not open cmdline once the snapshot budget has expired');
});

test('getProcessSnapshot does not fall back to /proc after a ps timeout', async () => {
  const timeoutError = Object.assign(new Error('ps timed out'), {
    killed: true,
    code: 'ETIMEDOUT',
  });
  let readProcCalls = 0;
  const execute = async () => {
    throw timeoutError;
  };
  const readProc = async () => {
    readProcCalls += 1;
    return 'should not be called';
  };

  await assert.rejects(() => getProcessSnapshot(execute, 'linux', readProc), /ps timed out/);
  assert.equal(readProcCalls, 0);
});
