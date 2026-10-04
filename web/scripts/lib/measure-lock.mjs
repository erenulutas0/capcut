/**
 * The machine-wide measurement lock: one heavy run at a time on this
 * computer (several agents and the founder share it).
 *
 * The lock is a directory (`mkdir` is atomic). Whoever holds it writes
 * `owner.txt`; it is removed as soon as the run ends, also when the run
 * fails. A holder waits 60 s after releasing before taking it again, so
 * someone else gets a turn.
 *
 *   node scripts/lib/measure-lock.mjs run "<owner>" -- <command> [args…]
 *
 * Exits with the command's own status.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const LOCK = process.env.MEASURE_LOCK ?? 'E:\\capcut_better\\.claude\\measure-lock';
const RELEASED = join(tmpdir(), 'clip-measure-lock-last-release.txt');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function acquire(owner) {
  // Give others a turn after our own last release.
  if (existsSync(RELEASED)) {
    const since = Date.now() - Number(readFileSync(RELEASED, 'utf8'));
    if (since >= 0 && since < 60_000) await sleep(60_000 - since);
  }
  mkdirSync(dirname(LOCK), { recursive: true });
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const holder = existsSync(join(LOCK, 'owner.txt')) ? readFileSync(join(LOCK, 'owner.txt'), 'utf8').trim() : 'unknown';
      console.log(`measure-lock: held by ${holder}; waiting 60 s`);
      await sleep(60_000);
    }
  }
  writeFileSync(join(LOCK, 'owner.txt'), `${owner}\npid ${process.pid}\n${new Date().toISOString()}\n`);
}

export function release() {
  rmSync(LOCK, { recursive: true, force: true });
  writeFileSync(RELEASED, String(Date.now()));
}

if (process.argv[2] === 'run') {
  const split = process.argv.indexOf('--');
  const owner = process.argv[3] ?? 'unnamed';
  const command = process.argv.slice(split + 1);
  if (split < 0 || command.length === 0) {
    console.error('usage: measure-lock.mjs run "<owner>" -- <command> [args…]');
    process.exit(2);
  }
  await acquire(owner);
  let status = 1;
  try {
    status = await new Promise((resolve) => {
      const child = spawn(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' });
      child.on('exit', (code) => resolve(code ?? 1));
      child.on('error', () => resolve(1));
    });
  } finally {
    release();
  }
  process.exit(status);
}
