import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { applyCsp, buildPolicy, decodeAttribute, inlineHashes } from '../../scripts/lib/csp.mjs';

const hash = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

const PAGE =
  '<!DOCTYPE html><html lang="tr"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width"/>' +
  '<script src="/capcut/_next/static/chunks/a.js" async=""></script></head><body>' +
  '<svg class="icon" style="width:16px;height:16px"></svg><div style="font-family:&quot;Segoe UI&quot;">x</div>' +
  '<style>body{margin:0}</style>' +
  '<script>(self.__next_f=self.__next_f||[]).push([0])</script>' +
  '<script>self.__next_f.push([1,"{\\"style\\":{\\"width\\":1}} style=\\"not-an-attribute\\""])</script>' +
  '</body></html>';

describe('content security policy (post-build)', () => {
  it('hashes each inline script byte for byte, never the external ones', () => {
    const { scripts } = inlineHashes(PAGE);
    expect(scripts).toEqual(
      [
        hash('(self.__next_f=self.__next_f||[]).push([0])'),
        hash('self.__next_f.push([1,"{\\"style\\":{\\"width\\":1}} style=\\"not-an-attribute\\""])'),
      ].sort(),
    );
  });

  it('hashes decoded style attributes and inline <style>, not text inside scripts', () => {
    const { styles, hasStyleAttributes } = inlineHashes(PAGE);
    expect(hasStyleAttributes).toBe(true);
    expect(styles).toEqual(
      [hash('width:16px;height:16px'), hash('font-family:"Segoe UI"'), hash('body{margin:0}')].sort(),
    );
    expect(styles).not.toContain(hash('not-an-attribute'));
  });

  it('decodes the entities React writes', () => {
    expect(decodeAttribute('a&amp;b&quot;c&#x27;d&lt;e&gt;f&#39;')).toBe('a&b"c\'d<e>f\'');
  });

  it('writes the tag right after the charset, once, and rewriting is stable', () => {
    const first = applyCsp(PAGE);
    expect(first.html.indexOf('http-equiv="Content-Security-Policy"')).toBe(
      first.html.indexOf('<meta charSet="utf-8"/>') + '<meta charSet="utf-8"/>'.length + '<meta '.length,
    );
    const second = applyCsp(first.html);
    expect(second.html).toBe(first.html);
    expect(second.html.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('allows no inline script without a hash and no eval', () => {
    const policy = buildPolicy(inlineHashes(PAGE));
    const script = /script-src ([^;]*)/.exec(policy)?.[1] ?? '';
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toMatch(/frame-ancestors|report-uri|sandbox/);
  });

  it('adds unsafe-hashes only when a page has style attributes', () => {
    const plain = '<html><head><meta charset="utf-8"></head><body><p>x</p></body></html>';
    expect(buildPolicy(inlineHashes(plain))).toContain("style-src 'self'; ");
    expect(buildPolicy(inlineHashes(PAGE))).toContain("style-src 'self' 'unsafe-hashes' 'sha256-");
  });

  it('refuses a page with no charset to anchor after', () => {
    expect(() => applyCsp('<html><head><script>1</script></head></html>')).toThrow(/charset/);
  });
});
