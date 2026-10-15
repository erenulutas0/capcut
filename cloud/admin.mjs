#!/usr/bin/env node
/**
 * Kurucunun yönetim komutu — vekil Worker'ın `/admin/*` uçları (cloud/SECURITY.md).
 *
 *   node cloud/admin.mjs spend                       bu ayın harcaması, tavan, ayrılmış, davetler, açık/kapalı
 *   node cloud/admin.mjs invites list                davet kodlarının özeti (kodun kendisi hiçbir yerde yok)
 *   node cloud/admin.mjs invites add <etiket> [dk]   yeni davet kodu (yalnız bu çıktıda görünür; dk varsayılanı Worker'ın)
 *   node cloud/admin.mjs invites revoke <id>         bir daveti iptal et (id: `invites list` çıktısındaki 12 karakter)
 *   node cloud/admin.mjs kill on|off                 acil düğme: yeni iş başlamaz / yeniden açılır
 *
 * Adres: `--url=https://…` ya da `CLOUD_WORKER_URL`; verilmezse yayındaki vekil (aşağıda).
 * Yetki: `ADMIN_TOKEN` ortam değişkeni; yoksa `cloud/pass.txt` (ilk boş olmayan satır) — dosya yalnız bu
 * komut çalışırken, kurucunun makinesinde okunur. Belirteç hiçbir çıktıya yazılmaz.
 * Bağımlılık yok; yalnız verilen adrese istek atar.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE_URL = 'https://lilocut-transcript-proxy.eerenulutass.workers.dev';
const here = dirname(fileURLToPath(import.meta.url));

const usage = () => {
  console.error(
    [
      'Kullanım:',
      '  node cloud/admin.mjs spend',
      '  node cloud/admin.mjs invites list',
      '  node cloud/admin.mjs invites add <etiket> [dakika]',
      '  node cloud/admin.mjs invites revoke <id>',
      '  node cloud/admin.mjs kill on|off',
      'Seçenek: --url=https://…  (ya da CLOUD_WORKER_URL)   Yetki: ADMIN_TOKEN ya da cloud/pass.txt',
    ].join('\n'),
  );
  return 2;
};

/** The token, read at run time only; never echoed. */
function readToken() {
  const fromEnv = (process.env.ADMIN_TOKEN ?? '').trim();
  if (fromEnv) return fromEnv;
  const file = process.env.ADMIN_TOKEN_FILE || join(here, 'pass.txt');
  try {
    const line = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (line) return line.replace(/^ADMIN_TOKEN=/, '').trim();
  } catch {
    // no file
  }
  return null;
}

function parseArgs(argv) {
  const positional = [];
  let url = process.env.CLOUD_WORKER_URL || LIVE_URL;
  for (const arg of argv) {
    if (arg.startsWith('--url=')) url = arg.slice(6);
    else if (arg === '--url') url = '';
    else positional.push(arg);
  }
  return { positional, url: url.replace(/\/+$/, '') };
}

async function callAdmin(url, token, method, path, body) {
  let response;
  try {
    response = await fetch(`${url}${path}`, {
      method,
      // The Worker never redirects; a redirect means "not our proxy" — the token is not carried anywhere else.
      redirect: 'error',
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Vekile ulaşılamadı (${url}): ${error?.cause?.code ?? error?.message ?? 'bağlantı hatası'}`);
  }
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (response.status === 404 && json?.error === 'not_found') {
    throw new Error('Yetki yok: vekil 404 döndü — ADMIN_TOKEN yanlış ya da bu adres bizim vekil değil. (Belirteç yazdırılmaz.)');
  }
  if (!response.ok) throw new Error(`Vekil ${response.status} döndü: ${json?.error ?? text.slice(0, 200)}`);
  return json;
}

const usd = (n) => `${Number(n).toFixed(4)} $`;
const pad = (s, n) => String(s).padEnd(n);

function printSpend(s) {
  console.log(`Ay ${s.month} · yol ${s.on ? 'AÇIK' : 'KAPALI'} (ENABLED=${s.enabledVariable}, acil düğme ${s.killSwitch ? 'BASILI' : 'basılı değil'})`);
  console.log(`Tavan ${usd(s.capUsd)} · harcanan ${usd(s.spentUsd)} · ayrılmış ${usd(s.reservedUsd)} · kalan ${usd(s.capUsd - s.spentUsd - s.reservedUsd)} · fiyat ${usd(s.priceUsdPerHour)}/saat`);
  console.log(`Süren iş: ${s.activeJobs} · sağlayıcıda hâlâ duran kayıt: ${s.transcriptsStillAtProvider}${s.transcriptsStillAtProvider > 0 ? '  ← 0 olmalı; temizlik alarmı siler, 24 saat sonra hâlâ >0 ise SECURITY.md "Olay"' : ''}`);
  if (s.months?.length) {
    console.log('Aylar:');
    for (const m of s.months) console.log(`  ${m.month}  ${usd(m.spentUsd)}  ${m.jobs} iş  ${m.minutes} dk`);
  }
  printInvites(s.invites ?? []);
}

function printInvites(invites) {
  if (invites.length === 0) {
    console.log('Davet yok.');
    return;
  }
  console.log(`${pad('id', 13)}${pad('etiket', 22)}${pad('dakika', 9)}${pad('kullanılan', 12)}durum`);
  for (const i of invites) {
    console.log(`${pad(i.id, 13)}${pad(i.label, 22)}${pad(i.minutes, 9)}${pad(i.usedMinutes, 12)}${i.revoked === false ? 'geçerli' : `İPTAL (${i.revoked === true ? 'nedensiz' : i.revoked})`}`);
  }
}

async function main(argv) {
  const { positional, url } = parseArgs(argv);
  const [command, sub, ...rest] = positional;
  if (!command) return usage();
  if (!/^https?:\/\/[^/\s]+$/.test(url)) {
    console.error(`Adres bir köken olmalı (yol yok): "${url}"`);
    return 2;
  }
  // The token is a bearer secret: plain http only to this machine (the local fake / `wrangler dev`).
  if (url.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(url)) {
    console.error(`Belirteç şifresiz bağlantıyla gönderilmez: "${url}" — https:// kullan (http yalnız 127.0.0.1 / localhost).`);
    return 2;
  }
  const token = readToken();
  if (!token) {
    console.error('Yetki yok: ADMIN_TOKEN ortam değişkeni ya da cloud/pass.txt dosyası gerekli.');
    return 2;
  }
  console.error(`Vekil: ${url}`);

  if (command === 'spend' && !sub) {
    printSpend(await callAdmin(url, token, 'GET', '/admin/spend'));
    return 0;
  }
  if (command === 'invites' && sub === 'list' && rest.length === 0) {
    printInvites((await callAdmin(url, token, 'GET', '/admin/spend')).invites ?? []);
    return 0;
  }
  if (command === 'invites' && sub === 'add' && rest.length >= 1 && rest.length <= 2) {
    const [label, minutes] = rest;
    const body = { label };
    if (minutes !== undefined) {
      body.minutes = Number(minutes);
      if (!Number.isFinite(body.minutes) || body.minutes <= 0) {
        console.error(`Dakika bir sayı olmalı: "${minutes}"`);
        return 2;
      }
    }
    const made = await callAdmin(url, token, 'POST', '/admin/invites', body);
    console.log(`Davet kodu (bir kez gösterilir, defterde yalnız özeti durur): ${made.code}`);
    console.log(`id ${made.id} · etiket ${made.label} · ${made.minutes} dakika`);
    return 0;
  }
  if (command === 'invites' && sub === 'revoke' && rest.length === 1) {
    const id = rest[0];
    if (!/^[0-9a-f]{8,64}$/.test(id)) {
      console.error('id, `invites list` çıktısındaki 8–64 karakterlik onaltılık kimliktir.');
      return 2;
    }
    const { revoked } = await callAdmin(url, token, 'DELETE', `/admin/invites/${id}`);
    console.log(revoked > 0 ? `İptal edildi: ${revoked} davet.` : 'Bu id ile geçerli davet bulunamadı (zaten iptal ya da yanlış id).');
    return revoked > 0 ? 0 : 1;
  }
  if (command === 'kill' && (sub === 'on' || sub === 'off') && rest.length === 0) {
    const { killSwitch } = await callAdmin(url, token, 'POST', '/admin/kill', { on: sub === 'on' });
    console.log(killSwitch ? 'Acil düğme BASILI: yeni iş başlamaz, süren işler bitince silinir.' : 'Acil düğme kaldırıldı: yol yeniden açık (ENABLED ve tavan izin veriyorsa).');
    return 0;
  }
  return usage();
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(String(error?.message ?? error));
    process.exit(1);
  },
);
