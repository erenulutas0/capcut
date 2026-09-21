import { join } from 'node:path';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';

/**
 * SRT/VTT import and export, source-anchored captions and the clock change
 * (ADR-016), driven through the UI only.
 */

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const CRLF = '\r\n';

/** Turkish letters in Windows-1254; everything else here is plain ASCII. */
const CP1254: Record<string, number> = {
  Ç: 0xc7,
  ç: 0xe7,
  Ğ: 0xd0,
  ğ: 0xf0,
  İ: 0xdd,
  ı: 0xfd,
  Ö: 0xd6,
  ö: 0xf6,
  Ş: 0xde,
  ş: 0xfe,
  Ü: 0xdc,
  ü: 0xfc,
};

function windows1254(text: string): Buffer {
  return Buffer.from(
    Array.from(text).map((char) => {
      const mapped = CP1254[char];
      if (mapped !== undefined) return mapped;
      const code = char.charCodeAt(0);
      if (code > 0x7f) throw new Error(`not in the test table: ${char}`);
      return code;
    }),
  );
}

type Line = [start: string, end: string, text: string];

function srt(lines: Line[]): string {
  return lines
    .map(([start, end, text], index) => `${index + 1}${CRLF}${start} --> ${end}${CRLF}${text.split('\n').join(CRLF)}${CRLF}`)
    .join(CRLF);
}

/** Source-timed lines for the 24 s sample: one at the start, one in the middle, one no moment uses. */
const SOURCE_LINES: Line[] = [
  ['00:00:01,000', '00:00:03,000', 'Günaydın ışık'],
  ['00:00:09,000', '00:00:13,000', 'Şimdi köprüdeyiz'],
  ['00:00:15,000', '00:00:19,000', 'Kullanılmayan'],
];

async function openWithSample(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('open-export')).toBeVisible();
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await expect(page.getByTestId('total-time')).toHaveText('00:24.000');
  return errors;
}

async function addMoment(page: Page, start: string, end: string) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

/** Two moments in reverse source order: output 0–6 s is source 8–14 s, output 6–10 s is source 0–4 s. */
async function buildReversedOutput(page: Page) {
  await addMoment(page, '00:08.000', '00:14.000');
  await addMoment(page, '00:00.000', '00:04.000');
  await expect(page.getByTestId('output-duration-us')).toHaveText('10000000');
}

async function showResult(page: Page) {
  await page.getByRole('tab', { name: 'Sonuç', exact: true }).click();
  await expect(page.getByTestId('output-note')).toBeVisible();
}

function timecode(ms: number): string {
  return `00:${String(Math.floor(ms / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

async function seek(page: Page, ms: number) {
  await page.getByLabel('Zamanda gezin').fill(String(ms));
  await expect(page.getByTestId('current-time')).toHaveText(timecode(ms));
}

async function pickSubtitleFile(scope: Page | Locator, name: string, buffer: Buffer) {
  await scope.getByTestId('caption-file-input').setInputFiles({
    name,
    mimeType: name.endsWith('.vtt') ? 'text/vtt' : 'application/x-subrip',
    buffer,
  });
}

function importDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Altyazı dosyasını içe aktar' });
}

async function importFile(
  page: Page,
  name: string,
  buffer: Buffer,
  choice: 'source' | 'output',
  scope: Page | Locator = page,
) {
  await pickSubtitleFile(scope, name, buffer);
  const dialog = importDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByTestId(`caption-import-choice-${choice}`).check();
  await dialog.getByTestId('caption-import-confirm').click();
  await expect(dialog).toHaveCount(0);
}

/**
 * The words the result preview is drawing right now, read from what the user
 * sees: the overlay names the line it draws, the caption list shows its words.
 * Also checks that the overlay really has caption pixels.
 */
async function activeCaptionText(page: Page): Promise<string | null> {
  const cueId = await page.getByTestId('caption-overlay').getAttribute('data-cue-id');
  if (!cueId) return null;
  const ink = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="caption-overlay"]');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return 0;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if ((data[index] ?? 0) > 0) count += 1;
    return count;
  });
  if (ink === 0) return null;
  return page.locator(`[data-testid="cue-item"][data-cue-id="${cueId}"]`).getByTestId('cue-text').inputValue();
}

async function expectActiveText(page: Page, ms: number, text: string | null) {
  await seek(page, ms);
  await expect.poll(() => activeCaptionText(page)).toBe(text);
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

test.describe('captions: SRT/VTT and source-anchored lines', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase('clip-editor');
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        }),
    );
  });

  test('a Windows-1254 SRT timed to the original video follows the picture when moments are reordered', async ({
    page,
  }) => {
    const errors = await openWithSample(page);
    await buildReversedOutput(page);
    await page.getByTestId('inspector-tab-captions').click();

    await pickSubtitleFile(page, 'turkce.srt', windows1254(srt(SOURCE_LINES)));
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('caption-import-file')).toHaveText('turkce.srt');
    await expect(dialog.getByTestId('caption-import-format')).toHaveText('SRT');
    await expect(dialog.getByTestId('caption-import-lines')).toHaveText('3');
    await expect(dialog.getByTestId('caption-import-encoding')).toHaveText(
      'Türkçe Windows kodlaması olarak okundu (Windows-1254)',
    );
    // The file runs past the 10 s result but fits the 24 s video: a hint, not a choice.
    await expect(dialog.getByTestId('caption-import-suggest-source')).toContainText('orijinal videoya göre');
    await expect(dialog.getByTestId('caption-import-choice-source')).not.toBeChecked();
    await expect(dialog.getByTestId('caption-import-choice-output')).not.toBeChecked();

    // The question is required: import does nothing until it is answered.
    const confirm = dialog.getByTestId('caption-import-confirm');
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    // aria-disabled keeps the button pressable (Playwright treats it as
    // disabled), so a press explains what is missing instead of doing nothing.
    await confirm.click({ force: true });
    await expect(dialog.getByTestId('caption-import-need-choice')).toContainText('neye göre zamanlandığını');
    await expect(dialog.getByTestId('caption-import-question')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('cue-item')).toHaveCount(0);

    await dialog.getByTestId('caption-import-choice-source').check();
    await expect(dialog.getByTestId('caption-import-need-choice')).toHaveCount(0);
    await dialog.getByTestId('caption-import-confirm').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('caption-import-count')).toHaveText('3 satır içe aktarıldı.');

    await expect(page.getByTestId('caption-clock-now')).toHaveText('Görüntüye bağlı');
    const items = page.getByTestId('cue-item');
    await expect(items).toHaveCount(3);
    // Decoded correctly: dotless ı, ş, ğ and ü survive.
    await expect(items.nth(0).getByTestId('cue-text')).toHaveValue('Günaydın ışık');
    await expect(items.nth(1).getByTestId('cue-text')).toHaveValue('Şimdi köprüdeyiz');
    // Times are on the video's clock and say so.
    await expect(items.nth(0).getByTestId('cue-clock')).toHaveText('Videodaki zamanı');
    await expect(items.nth(0).getByTestId('cue-range')).toHaveText('00:01.000 — 00:03.000');
    await expect(items.nth(0).getByTestId('cue-badge-usage')).toHaveText('Sonuçta 1 kez görünüyor');
    await expect(items.nth(1).getByTestId('cue-badge-usage')).toHaveText('Sonuçta 1 kez görünüyor');
    await expect(items.nth(2).getByTestId('cue-badge-unused')).toHaveText('Hiçbir anda yok, çıktıda görünmez');
    await expect(page.getByTestId('strip-caption-mark')).toHaveCount(2);

    // Output 0–6 s shows source 8–14 s; output 6–10 s shows source 0–4 s.
    await showResult(page);
    await expectActiveText(page, 2000, 'Şimdi köprüdeyiz');
    await expectActiveText(page, 5500, null);
    await expectActiveText(page, 8000, 'Günaydın ışık');

    // Reorder the moments: the lines move with their picture.
    await page.getByTestId('moment-card').nth(1).getByTestId('move-up').click();
    // Now output 0–4 s is source 0–4 s and output 4–10 s is source 8–14 s.
    await expectActiveText(page, 2000, 'Günaydın ışık');
    await expectActiveText(page, 4500, null);
    await expectActiveText(page, 6000, 'Şimdi köprüdeyiz');
    await expectActiveText(page, 9500, null);

    // "Buraya git" goes to the first appearance in the result...
    await items.nth(1).getByTestId('cue-goto').click();
    await expect(page.getByTestId('current-time')).toHaveText('00:05.000');
    await expect(page.getByTestId('output-note')).toBeVisible();
    // ...and for a line no moment shows, to its picture in the source preview.
    await items.nth(2).getByTestId('cue-goto').click();
    await expect(page.getByRole('tab', { name: 'Kaynak', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('current-time')).toHaveText('00:15.000');
    expect(errors).toEqual([]);
  });

  test('adding a line to a source track uses the picture under the playhead, and says why when there is none', async ({
    page,
  }) => {
    await openWithSample(page);
    await buildReversedOutput(page);
    await page.getByTestId('inspector-tab-captions').click();
    await importFile(page, 'kaynak.srt', Buffer.from(srt(SOURCE_LINES)), 'source');
    await showResult(page);

    // Output 2 s shows source 10 s, inside line 2 (9–13 s): the new line
    // starts where it ends and stops at line 3 (15 s). Source clock.
    await seek(page, 2000);
    await page.getByTestId('captions-add').click();
    const draft = page.getByTestId('cue-draft');
    await expect(draft.getByTestId('cue-range')).toHaveText('00:13.000 — 00:15.000');
    await expect(draft.getByTestId('cue-clock')).toHaveText('Videodaki zamanı');
    await expect(page.getByTestId('current-time')).toHaveText('00:02.000');
    await page.keyboard.type('Köprünün sonu');
    await draft.getByTestId('cue-text').blur();
    await expect(page.getByTestId('cue-item')).toHaveCount(4);
    // It is cut at the moment's edge (source 14 s) in this result.
    const added = page.getByTestId('cue-item').nth(2);
    await expect(added.getByTestId('cue-badge-partial')).toHaveText('Bir anın kenarında kesiliyor');
    await expectActiveText(page, 5500, 'Köprünün sonu');

    // Played to the very end, the playhead is past every moment.
    await seek(page, 9700);
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('current-time')).toHaveText('00:10.000', { timeout: 10_000 });
    await page.getByTestId('captions-add').click();
    await expect(page.getByTestId('captions-add-error')).toContainText('görüntünün üzerinde değil');
    await expect(page.getByTestId('cue-draft')).toHaveCount(0);
  });

  test('broken blocks, overlaps and too-short lines are reported by their place in the file', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:00.000', '00:10.000');
    await page.getByTestId('inspector-tab-captions').click();

    const file = [
      `1${CRLF}00:00:01,000 --> 00:00:03,000${CRLF}Bir${CRLF}`,
      `2${CRLF}00:00:0X --> bozuk${CRLF}Okunamaz${CRLF}`,
      `3${CRLF}00:00:02,000 --> 00:00:04,000${CRLF}Üst üste${CRLF}`,
      `4${CRLF}00:00:05,000 --> 00:00:05,100${CRLF}Kısa${CRLF}`,
      `5${CRLF}00:00:06,000 --> 00:00:08,000${CRLF}Üç${CRLF}satırlı${CRLF}metin${CRLF}`,
    ].join(CRLF);
    await pickSubtitleFile(page, 'sorunlu.srt', Buffer.from(file));
    const dialog = importDialog(page);
    await expect(dialog.getByTestId('caption-import-encoding')).toHaveText('UTF-8 olarak okundu');
    await expect(dialog.getByTestId('caption-import-lines')).toHaveText('4');
    await expect(dialog.getByTestId('caption-import-problems')).toHaveText(
      'Dosyadaki 2. altyazı okunamadı: zaman satırı bozuk.',
    );
    await expect(dialog.getByTestId('caption-import-joined')).toContainText('1 altyazıda');
    await dialog.getByTestId('caption-import-choice-output').check();
    await dialog.getByTestId('caption-import-confirm').click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByTestId('caption-import-count')).toHaveText('2 satır içe aktarıldı.');
    await expect(page.getByTestId('caption-import-skipped-item')).toHaveText([
      'Dosyadaki 3. altyazı atlandı: önceki satırla üst üste biniyor.',
      'Dosyadaki 4. altyazı atlandı: 0,2 saniyeden kısa.',
    ]);
    await expect(page.getByTestId('caption-clock-now')).toHaveText('Sonuç videosuna bağlı');
    const items = page.getByTestId('cue-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(1).getByTestId('cue-text')).toHaveValue('Üç\nsatırlı metin');
    await expect(items.nth(1).getByTestId('cue-clock')).toHaveText('Sonuçtaki zamanı');

    // A file with nothing usable is an error and changes nothing; the
    // replace warning is shown because lines exist.
    await pickSubtitleFile(page, 'bos.srt', Buffer.from(srt([['00:00:01,000', '00:00:01,050', 'Çok kısa']])));
    await expect(dialog.getByTestId('caption-import-replace')).toContainText('mevcut 2 satırın yerini alır');
    await dialog.getByTestId('caption-import-choice-output').check();
    await dialog.getByTestId('caption-import-confirm').click();
    await expect(dialog.getByTestId('caption-import-error')).toContainText('hiçbir şey değişmedi');
    await expect(dialog.getByTestId('caption-import-error-skipped')).toContainText('0,2 saniyeden kısa');
    await dialog.getByTestId('caption-import-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(items).toHaveCount(2);

    // Not a subtitle file at all.
    await pickSubtitleFile(page, 'not.srt', Buffer.from('merhaba dünya'));
    await expect(page.getByTestId('caption-import-read-error')).toContainText('SRT ya da VTT');
    await expect(dialog).toHaveCount(0);
  });

  test('a VTT file loses its markup, notes and styles and is never rendered as HTML', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:00.000', '00:10.000');
    await page.getByTestId('inspector-tab-captions').click();

    const vtt = [
      'WEBVTT',
      '',
      'NOTE bu bir not',
      'içinde bir --> ok var',
      '',
      'STYLE',
      '::cue { color: red }',
      '',
      'giris',
      '00:00:01.000 --> 00:00:03.000 align:start position:10%',
      '<v Ayşe><i>Merhaba</i> &amp; <b>hoş geldin</b></v>',
      '',
      '00:00:04.000 --> 00:00:06.000',
      '<c.yellow>İkinci</c> satır &lt;3 <img src=x onerror=alert(1)>',
      '',
    ].join('\n');
    await pickSubtitleFile(page, 'isaretli.vtt', Buffer.from(vtt));
    const dialog = importDialog(page);
    await expect(dialog.getByTestId('caption-import-format')).toHaveText('VTT');
    await expect(dialog.getByTestId('caption-import-lines')).toHaveText('2');
    await expect(dialog.getByTestId('caption-import-problems')).toHaveCount(0);
    await dialog.getByTestId('caption-import-choice-output').check();
    await dialog.getByTestId('caption-import-confirm').click();

    const items = page.getByTestId('cue-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).getByTestId('cue-text')).toHaveValue('Merhaba & hoş geldin');
    await expect(items.nth(1).getByTestId('cue-text')).toHaveValue('İkinci satır <3');
    // No element came from the file.
    expect(await page.locator('[data-testid="captions-panel"] img, [data-testid="captions-panel"] i').count()).toBe(0);
  });

  test('SRT and VTT downloads are timed to the finished video', async ({ page }) => {
    await openWithSample(page);
    await buildReversedOutput(page);
    await page.getByTestId('project-title').fill('Günaydın İstanbul');
    await page.getByTestId('inspector-tab-captions').click();

    // Nothing to download yet: the buttons say why instead.
    await expect(page.getByTestId('caption-export-srt')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('caption-export-none')).toContainText('görünen satır yok');

    const lines: Line[] = [
      ['00:00:01,000', '00:00:03,000', 'Günaydın ışık'],
      ['00:00:09,000', '00:00:13,000', 'Şimdi köprüdeyiz'],
      ['00:00:13,000', '00:00:16,000', 'Kenarda'],
    ];
    await importFile(page, 'kaynak.srt', Buffer.from(srt(lines)), 'source');
    await expect(page.getByTestId('cue-item').nth(2).getByTestId('cue-badge-partial')).toBeVisible();
    await expect(page.getByTestId('caption-export-srt')).toHaveAttribute('aria-disabled', 'false');
    await expect(page.getByTestId('caption-export')).toContainText('bitmiş videonun zamanına');

    const srtDownload = page.waitForEvent('download');
    await page.getByTestId('caption-export-srt').click();
    const srtFile = await srtDownload;
    expect(srtFile.suggestedFilename()).toBe('Gunaydin-Istanbul.srt');
    expect(await downloadText(srtFile)).toBe(
      [
        `1${CRLF}00:00:01,000 --> 00:00:05,000${CRLF}Şimdi köprüdeyiz${CRLF}`,
        `2${CRLF}00:00:05,000 --> 00:00:06,000${CRLF}Kenarda${CRLF}`,
        `3${CRLF}00:00:07,000 --> 00:00:09,000${CRLF}Günaydın ışık${CRLF}`,
      ].join(CRLF),
    );

    const vttDownload = page.waitForEvent('download');
    await page.getByTestId('caption-export-vtt').click();
    const vttFile = await vttDownload;
    expect(vttFile.suggestedFilename()).toBe('Gunaydin-Istanbul.vtt');
    expect(await downloadText(vttFile)).toBe(
      'WEBVTT\n\n' +
        '00:00:01.000 --> 00:00:05.000\nŞimdi köprüdeyiz\n\n' +
        '00:00:05.000 --> 00:00:06.000\nKenarda\n\n' +
        '00:00:07.000 --> 00:00:09.000\nGünaydın ışık\n',
    );
  });

  test('the clock converts both ways as one undo step, and refuses a conflict by line number', async ({ page }) => {
    await openWithSample(page);
    await buildReversedOutput(page);
    await page.getByTestId('inspector-tab-captions').click();
    await importFile(page, 'kaynak.srt', Buffer.from(srt(SOURCE_LINES)), 'source');
    const items = page.getByTestId('cue-item');
    await expect(items).toHaveCount(3);

    // Source → output: explained first, then reported.
    await page.getByTestId('caption-clock-switch').click();
    const confirm = page.getByRole('dialog', { name: 'Satırlar sonuç videosuna bağlansın mı?' });
    await expect(confirm).toContainText('hiçbir anın göstermediği satırlar silinir');
    await confirm.getByTestId('caption-clock-confirm').click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId('caption-clock-report')).toHaveText(
      'Dönüştürüldü. 0 satır bölündü, 1 satır ya da parça düştü.',
    );
    await expect(page.getByTestId('caption-clock-now')).toHaveText('Sonuç videosuna bağlı');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).getByTestId('cue-range')).toHaveText('00:01.000 — 00:05.000');
    await expect(items.nth(0).getByTestId('cue-text')).toHaveValue('Şimdi köprüdeyiz');
    await expect(items.nth(1).getByTestId('cue-range')).toHaveText('00:07.000 — 00:09.000');
    await expect(items.nth(0).getByTestId('cue-clock')).toHaveText('Sonuçtaki zamanı');

    // One undo step back to the source clock with all three lines.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('caption-clock-now')).toHaveText('Görüntüye bağlı');
    await expect(items).toHaveCount(3);
    await page.getByTestId('redo').click();
    await expect(page.getByTestId('caption-clock-now')).toHaveText('Sonuç videosuna bağlı');
    await expect(items).toHaveCount(2);

    // Output → source.
    await page.getByTestId('caption-clock-switch').click();
    const toSource = page.getByRole('dialog', { name: 'Satırlar görüntüye bağlansın mı?' });
    await expect(toSource).toContainText('görüntüyle birlikte taşınır');
    await toSource.getByTestId('caption-clock-confirm').click();
    await expect(page.getByTestId('caption-clock-report')).toHaveText(
      'Dönüştürüldü. 0 satır bölündü, 0 satır ya da parça düştü.',
    );
    await expect(page.getByTestId('caption-clock-now')).toHaveText('Görüntüye bağlı');
    await expect(items.nth(0).getByTestId('cue-range')).toHaveText('00:01.000 — 00:03.000');
    await expect(items.nth(0).getByTestId('cue-text')).toHaveValue('Günaydın ışık');
    await expect(items.nth(1).getByTestId('cue-range')).toHaveText('00:09.000 — 00:13.000');

    // Use source 0–4 s twice: the first line now shows twice.
    await addMoment(page, '00:00.000', '00:04.000');
    await expect(items.nth(0).getByTestId('cue-badge-usage')).toHaveText('Sonuçta 2 kez görünüyor');
    await expect(page.getByTestId('strip-caption-mark')).toHaveCount(3);

    // Back to output: each appearance becomes its own line.
    await page.getByTestId('caption-clock-switch').click();
    await page.getByTestId('caption-clock-confirm').click();
    await expect(page.getByTestId('caption-clock-report')).toHaveText(
      'Dönüştürüldü. 1 satır bölündü, 0 satır ya da parça düştü.',
    );
    await expect(items).toHaveCount(3);
    await expect(items.nth(2).getByTestId('cue-range')).toHaveText('00:11.000 — 00:13.000');

    // Two different lines on the same source instant cannot become one.
    await items.nth(2).getByTestId('cue-text').fill('Farklı satır');
    await items.nth(2).getByTestId('cue-text').blur();
    await expect(items.nth(2).getByTestId('cue-text')).toHaveValue('Farklı satır');
    await page.getByTestId('caption-clock-switch').click();
    await page.getByTestId('caption-clock-confirm').click();
    await expect(page.getByTestId('caption-clock-error')).toContainText('Satır 2 ve Satır 3 orijinal videoda aynı ana düşüyor');
    await expect(page.getByTestId('caption-clock-now')).toHaveText('Sonuç videosuna bağlı');
    await expect(items).toHaveCount(3);
  });

  test('shift all by steps or an exact value, refused past the start; import is one undo step', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:00.000', '00:04.000');
    await addMoment(page, '00:08.000', '00:14.000');
    await page.getByTestId('inspector-tab-captions').click();
    await importFile(
      page,
      'sonuc.srt',
      Buffer.from(
        srt([
          ['00:00:01,000', '00:00:03,000', 'Bir'],
          ['00:00:05,000', '00:00:07,000', 'İki'],
        ]),
      ),
      'output',
    );
    const items = page.getByTestId('cue-item');
    await expect(items).toHaveCount(2);

    // The import is one step: undo removes it, redo brings it back.
    await page.getByTestId('undo').click();
    await expect(items).toHaveCount(0);
    await expect(page.getByTestId('captions-empty')).toBeVisible();
    await page.getByTestId('redo').click();
    await expect(items).toHaveCount(2);

    const first = items.nth(0).getByTestId('cue-range');
    await page.getByTestId('caption-shift-plus-100000').click();
    await expect(first).toHaveText('00:01.100 — 00:03.100');
    await expect(items.nth(1).getByTestId('cue-range')).toHaveText('00:05.100 — 00:07.100');
    await page.getByTestId('caption-shift-plus-1000000').click();
    await expect(first).toHaveText('00:02.100 — 00:04.100');
    await page.getByTestId('caption-shift-minus-1000000').click();
    await page.getByTestId('caption-shift-minus-100000').click();
    await expect(first).toHaveText('00:01.000 — 00:03.000');

    await page.getByTestId('caption-shift-exact').fill('-0,5');
    await page.getByTestId('caption-shift-apply').click();
    await expect(first).toHaveText('00:00.500 — 00:02.500');
    await expect(page.getByTestId('caption-shift-report')).toHaveText('Bütün satırlar −0,5 sn kaydırıldı.');

    // Past the start: refused, nothing moves.
    await page.getByTestId('caption-shift-exact').fill('-1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('caption-shift-error')).toContainText('Kaydırılamadı');
    await expect(first).toHaveText('00:00.500 — 00:02.500');

    await page.getByTestId('caption-shift-exact').fill('yarım');
    await page.getByTestId('caption-shift-apply').click();
    await expect(page.getByTestId('caption-shift-error')).toContainText('-0,5 ya da 1,25');
    await expect(page.getByTestId('caption-shift-exact')).toHaveAttribute('aria-invalid', 'true');

    // Each shift is its own undo step.
    await page.getByTestId('undo').click();
    await expect(first).toHaveText('00:01.000 — 00:03.000');
    await page.getByTestId('undo').click();
    await expect(first).toHaveText('00:01.100 — 00:03.100');
  });
});

test.describe('captions: SRT import on a phone', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });

  test('the import dialog opens over the caption sheet at 390 px without horizontal scroll', async ({ page }) => {
    const errors = await openWithSample(page);
    await buildReversedOutput(page);

    await page.getByTestId('tab-captions').click();
    const sheet = page.getByRole('dialog', { name: 'Altyazı' });
    await expect(sheet).toBeVisible();
    const importBox = await sheet.getByTestId('caption-import').boundingBox();
    expect(importBox?.height).toBeGreaterThanOrEqual(44);

    await pickSubtitleFile(sheet, 'telefon.srt', windows1254(srt(SOURCE_LINES)));
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('caption-import-encoding')).toContainText('Türkçe Windows kodlaması');

    const dialogOverflow = await page.evaluate(() => {
      const box = document.querySelector('.dialog');
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dialog: box ? box.scrollWidth - box.clientWidth : -1,
      };
    });
    expect(dialogOverflow).toEqual({ page: 0, dialog: 0 });
    const choiceBox = await dialog.getByTestId('caption-import-choice-source').locator('..').boundingBox();
    expect(choiceBox?.height).toBeGreaterThanOrEqual(44);

    // Escape closes only the dialog; the sheet underneath stays open.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(sheet).toBeVisible();

    await importFile(page, 'telefon.srt', windows1254(srt(SOURCE_LINES)), 'source', sheet);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('caption-import-count')).toHaveText('3 satır içe aktarıldı.');
    await expect(sheet.getByTestId('cue-item').nth(0).getByTestId('cue-badge-usage')).toBeVisible();
    await expect(sheet.getByTestId('caption-shift')).toBeVisible();
    await expect(sheet.getByTestId('caption-export-srt')).toBeVisible();

    const overflow = await page.evaluate(() => {
      const sheetBody = document.querySelector('.sheet-body');
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sheet: sheetBody ? sheetBody.scrollWidth - sheetBody.clientWidth : -1,
      };
    });
    expect(overflow).toEqual({ page: 0, sheet: 0 });
    expect(errors).toEqual([]);
  });
});
