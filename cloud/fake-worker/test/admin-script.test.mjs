/**
 * The founder's command (cloud/admin.mjs) against the LOCAL FAKE's admin API,
 * which answers as the Worker's does. The command is run as a child process
 * with the fake's address and a test token in its environment: nothing here
 * reaches the live Worker, and the token must never appear in any output.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { startFakeWorker } from '../server.mjs';

const run = promisify(execFile);
const SCRIPT = join(import.meta.dirname, '..', '..', 'admin.mjs');
const TOKEN = 'fake-admin-token-for-the-script-0123456789';
const ORIGIN = 'http://127.0.0.1:3999';
let fake;
let tmp;

before(async () => {
  fake = await startFakeWorker({ allowedOrigins: [ORIGIN], adminToken: TOKEN });
  tmp = mkdtempSync(join(tmpdir(), 'lilocut-admin-'));
});
after(async () => {
  await fake.close();
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => fake.reset());

/** Runs the command; never throws on a non-zero exit — the caller reads the code. */
async function admin(args, env = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], {
      env: { PATH: process.env.PATH, CLOUD_WORKER_URL: fake.url, ADMIN_TOKEN: TOKEN, ADMIN_TOKEN_FILE: join(tmp, 'no-such-file'), ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}
const noToken = (result) => assert.ok(!`${result.stdout}${result.stderr}`.includes(TOKEN), 'the token must never be printed');

describe('cloud/admin.mjs against the fake', () => {
  it('spend: the month, the cap, what is spent and reserved, and the invites', async () => {
    const invite = fake.newInvite(60, 'friend-1');
    const result = await admin(['spend']);
    noToken(result);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /yol AÇIK/);
    assert.match(result.stdout, /Tavan 1\.0000 \$ · harcanan 0\.0000 \$ · ayrılmış 0\.0000 \$/);
    assert.match(result.stdout, /friend-1\s+60\s+0\s+geçerli/);
    assert.ok(!result.stdout.includes(invite), 'the invite code is not in the spend report');
    assert.match(result.stderr, /Vekil: http:\/\/127\.0\.0\.1:/);
  });

  it('invites add → list → revoke → list', async () => {
    const added = await admin(['invites', 'add', 'arkadas-2', '45']);
    noToken(added);
    assert.equal(added.code, 0, added.stderr);
    const code = /Davet kodu[^:]*: ([A-Za-z0-9]{5}(?:-[A-Za-z0-9]{5}){3})/.exec(added.stdout)?.[1];
    assert.ok(code, `a code in the Worker's format: ${added.stdout}`);
    const id = /id ([0-9a-f]{12})/.exec(added.stdout)?.[1];
    assert.ok(id, 'an id of 12 hex characters');
    // The code works at the fake's browser API (the same check the site makes when "Kodu kaydet" is pressed).
    const quota = await fetch(`${fake.url}/v1/quota`, { headers: { origin: ORIGIN, authorization: `Bearer ${code}` } });
    assert.deepEqual(await quota.json(), { on: true, remainingMinutes: 45, maxJobMinutes: 120 });

    const listed = await admin(['invites', 'list']);
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(listed.stdout, new RegExp(`${id}\\s+arkadas-2\\s+45\\s+0\\s+geçerli`));
    assert.ok(!listed.stdout.includes(code), 'the list never shows a code');

    const revoked = await admin(['invites', 'revoke', id]);
    assert.equal(revoked.code, 0, revoked.stderr);
    assert.match(revoked.stdout, /İptal edildi: 1 davet/);
    assert.equal((await fetch(`${fake.url}/v1/quota`, { headers: { origin: ORIGIN, authorization: `Bearer ${code}` } })).status, 401);
    assert.match((await admin(['invites', 'list'])).stdout, /İPTAL \(by_admin\)/);
    // A second revoke finds nothing (exit 1, not an error).
    const again = await admin(['invites', 'revoke', id]);
    assert.equal(again.code, 1);
    assert.match(again.stdout, /bulunamadı/);
  });

  it('kill on / off', async () => {
    const invite = fake.newInvite(60);
    const on = await admin(['kill', 'on']);
    assert.equal(on.code, 0, on.stderr);
    assert.match(on.stdout, /BASILI/);
    const refused = await fetch(`${fake.url}/v1/jobs`, { method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${invite}`, 'content-type': 'audio/webm', 'x-audio-duration-s': '10' }, body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0]) });
    assert.deepEqual([refused.status, await refused.json()], [503, { error: 'cloud_off' }]);
    assert.match((await admin(['spend'])).stdout, /yol KAPALI .*acil düğme BASILI/);
    const off = await admin(['kill', 'off']);
    assert.equal(off.code, 0, off.stderr);
    assert.match((await admin(['spend'])).stdout, /yol AÇIK/);
  });

  it('a wrong token, no token, a bad address and a bad command: clear messages, nothing printed that is secret', async () => {
    const wrong = await admin(['spend'], { ADMIN_TOKEN: 'wrong-token-wrong-token-wrong-token' });
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /Yetki yok: vekil 404/);
    assert.ok(!wrong.stderr.includes('wrong-token'), 'the wrong token is not printed either');

    const none = await admin(['spend'], { ADMIN_TOKEN: '' });
    assert.equal(none.code, 2);
    assert.match(none.stderr, /ADMIN_TOKEN ortam değişkeni ya da cloud\/pass\.txt/);

    const badUrl = await admin(['spend', '--url=http://127.0.0.1:1/v1']);
    assert.equal(badUrl.code, 2);
    assert.match(badUrl.stderr, /köken olmalı/);

    const unreachable = await admin(['spend', '--url=http://127.0.0.1:1']);
    assert.equal(unreachable.code, 1);
    assert.match(unreachable.stderr, /Vekile ulaşılamadı/);

    for (const args of [[], ['nothing'], ['invites'], ['invites', 'add'], ['invites', 'revoke', 'not-hex'], ['kill', 'maybe'], ['invites', 'add', 'x', 'lots']]) {
      const bad = await admin(args);
      assert.equal(bad.code, 2, args.join(' '));
      noToken(bad);
    }
  });

  it('the token never travels in clear to another machine, and never follows a redirect', async () => {
    for (const url of ['http://example.invalid', 'http://192.0.2.1:8787', 'http://proxy.example.invalid:80']) {
      const plain = await admin(['spend', `--url=${url}`]);
      assert.equal(plain.code, 2, url);
      assert.match(plain.stderr, /şifresiz bağlantıyla gönderilmez/);
      noToken(plain);
    }
    // A redirecting address (not our proxy): the command stops at the redirect; the target never sees a request.
    const seen = [];
    const target = createServer((request, response) => {
      seen.push(request.headers.authorization ?? null);
      response.end('{}');
    });
    await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
    const redirector = createServer((request, response) => {
      response.writeHead(307, { location: `http://127.0.0.1:${target.address().port}${request.url}` });
      response.end();
    });
    await new Promise((resolve) => redirector.listen(0, '127.0.0.1', resolve));
    try {
      const redirected = await admin(['spend', `--url=http://127.0.0.1:${redirector.address().port}`]);
      assert.equal(redirected.code, 1);
      assert.match(redirected.stderr, /Vekile ulaşılamadı/);
      noToken(redirected);
      assert.deepEqual(seen, []);
    } finally {
      await new Promise((resolve) => redirector.close(resolve));
      await new Promise((resolve) => target.close(resolve));
    }
  });

  it('the token can come from a file (read only when the command runs); the file is never echoed', async () => {
    const file = join(tmp, 'pass.txt');
    writeFileSync(file, `# yorum\n\nADMIN_TOKEN=${TOKEN}\n`);
    const result = await admin(['spend'], { ADMIN_TOKEN: '', ADMIN_TOKEN_FILE: file });
    noToken(result);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Tavan/);
  });

  it('the fake\'s admin API is invisible without the exact token, like the Worker\'s', async () => {
    for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: `Bearer ${TOKEN}x` }]) {
      const response = await fetch(`${fake.url}/admin/spend`, { headers });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'not_found' });
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    const withoutAdmin = await startFakeWorker({ allowedOrigins: [ORIGIN] });
    try {
      assert.equal((await fetch(`${withoutAdmin.url}/admin/spend`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 404);
    } finally {
      await withoutAdmin.close();
    }
  });
});
