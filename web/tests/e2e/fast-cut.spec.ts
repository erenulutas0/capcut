import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  barcodeFrames,
  fastCutFixture,
  frameMd5s,
  probeFrames,
} from "./fastcut-media";
import {
  addKesit,
  closeSheet,
  installSavePicker,
  openEditor,
  openSettings,
  openVideo,
  pickerCalls,
  readSaved,
} from "./kesitFlow";

/**
 * ADR-027: a download whose frames need no change keeps the source's own
 * compressed pictures; only the frames between a cut and the next IDR are
 * re-encoded. Checked with ffmpeg on the saved file: every frame is exactly
 * the marked source frame (burned-in barcode), and every frame that was not
 * re-encoded is bit-for-bit the source's decoded frame. Driven through the
 * kesit list (ADR-026): the top button downloads the kesitler joined.
 */

async function openFixture(
  page: Page,
  rate: 25 | 30 | 60 = 30,
): Promise<string[]> {
  await installSavePicker(page);
  const errors = await openEditor(page);
  await openVideo(page, fastCutFixture(rate));
  return errors;
}

async function setQuality(page: Page, quality: "720" | "1080") {
  await openSettings(page, "frame");
  await page.getByTestId("export-quality").selectOption(quality);
  await closeSheet(page);
}

/** Downloads every kesit joined (the top button) and waits for "Kaydedildi". */
async function downloadAll(page: Page) {
  await page.getByTestId("download-all").click();
  await expect(page.getByTestId("download-saved")).toBeVisible({
    timeout: 180_000,
  });
}

async function savedFile(page: Page, testInfo: TestInfo): Promise<string> {
  const name = (await pickerCalls(page)).at(-1);
  expect(name).toBeTruthy();
  return readSaved(page, testInfo, `saved-${name}`);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

test.describe("fast cut", () => {
  test("two kesitler cut off the keyframes: smart cut, every frame exact, copied frames bit-exact", async ({
    page,
  }, testInfo) => {
    const errors = await openFixture(page);
    // Frames 33..119 and 165..266 (IDR every 30 frames, B-frames).
    await addKesit(page, "00:01.100", "00:04.000");
    await addKesit(page, "00:05.500", "00:08.900");
    await setQuality(page, "720");
    await downloadAll(page);

    const method = page.getByTestId("export-method");
    await expect(method).toHaveAttribute("data-method", "smart");
    await expect(method).toContainText("Hızlı kesim");
    const encoded = Number(await method.getAttribute("data-frames-encoded"));
    // The heads up to the next IDR (27 + 15) and at most a B-frame group at the end.
    expect(encoded).toBeGreaterThanOrEqual(42);
    expect(encoded).toBeLessThanOrEqual(42 + 8);

    const file = await savedFile(page, testInfo);
    const expected = [...range(33, 119), ...range(165, 266)];
    const probe = probeFrames(file);
    expect(probe.frames).toBe(expected.length);
    expect(
      Math.abs(probe.durationS - expected.length / 30),
    ).toBeLessThanOrEqual(1 / 30 + 0.002);
    expect(barcodeFrames(file)).toEqual(expected);

    const source = frameMd5s(fastCutFixture());
    const output = frameMd5s(file);
    const identical = output.filter(
      (md5, i) => md5 === source[expected[i] ?? -1],
    ).length;
    expect(identical).toBe(expected.length - encoded);
    expect(errors).toEqual([]);
  });

  test("a kesit from one IDR to the next is a pure copy", async ({
    page,
  }, testInfo) => {
    const errors = await openFixture(page);
    await addKesit(page, "00:02.000", "00:04.000");
    await setQuality(page, "720");
    await downloadAll(page);

    const method = page.getByTestId("export-method");
    await expect(method).toHaveAttribute("data-method", "copy");
    await expect(method).toHaveText(
      "Hızlı kesim — görüntü yeniden kodlanmadı, orijinal kalite",
    );

    const file = await savedFile(page, testInfo);
    const expected = range(60, 119);
    expect(barcodeFrames(file)).toEqual(expected);
    const source = frameMd5s(fastCutFixture());
    expect(frameMd5s(file)).toEqual(expected.map((n) => source[n]));
    expect(errors).toEqual([]);
  });

  test("a zoomed picture is encoded and the result says why", async ({
    page,
  }) => {
    const errors = await openFixture(page);
    await addKesit(page, "00:01.000", "00:03.000");
    await openSettings(page, "frame");
    await page.getByTestId("zoom-slider").fill("150");
    await page.getByTestId("export-quality").selectOption("720");
    await closeSheet(page);
    await downloadAll(page);

    const method = page.getByTestId("export-method");
    await expect(method).toHaveAttribute("data-method", "encode");
    await expect(method).toHaveAttribute("data-fallback", "crop");
    await expect(method).toHaveText("Kodlandı (kırpma veya yakınlaştırma var)");
    expect(errors).toEqual([]);
  });

  test("a different download size is encoded (1080p from a 720p source)", async ({
    page,
  }) => {
    const errors = await openFixture(page);
    await addKesit(page, "00:01.000", "00:02.000");
    await setQuality(page, "1080");
    await downloadAll(page);
    await page.getByTestId("export-succeeded").getByText("Ayrıntılar").click();
    await expect(page.getByTestId("export-method")).toHaveAttribute(
      "data-fallback",
      "resolution",
    );
    await expect(page.getByTestId("measured-resolution")).toHaveText(
      "1920×1080",
    );
    expect(errors).toEqual([]);
  });

  test("doc 15 v6: a 25 fps source is copied at its own rate, frames exact", async ({
    page,
  }, testInfo) => {
    const errors = await openFixture(page, 25);
    // Source frames 30..99 (1.2 s to 4.0 s at 25 fps; IDR every 25 frames).
    await addKesit(page, "00:01.200", "00:04.000");
    await setQuality(page, "720");
    await downloadAll(page);
    await expect(page.getByTestId("export-method")).toHaveAttribute(
      "data-method",
      "smart",
    );
    const file = await savedFile(page, testInfo);
    const expected = range(30, 99);
    expect(barcodeFrames(file)).toEqual(expected);
    const probe = probeFrames(file);
    expect(probe.frames).toBe(70);
    expect(Math.abs(probe.durationS - 2.8)).toBeLessThanOrEqual(1 / 30 + 0.002);
    expect(errors).toEqual([]);
  });

  test("doc 15 v6: a 60 fps source is encoded to 30 fps and the result says why", async ({
    page,
  }, testInfo) => {
    const errors = await openFixture(page, 60);
    await addKesit(page, "00:01.000", "00:03.000");
    await setQuality(page, "720");
    await downloadAll(page);
    const method = page.getByTestId("export-method");
    await expect(method).toHaveAttribute("data-method", "encode");
    await expect(method).toHaveAttribute("data-fallback", "fps");
    await expect(method).toHaveText(
      "Kodlandı (kaynak 30 fps’den hızlı, 30 fps’ye çevrildi)",
    );
    expect(probeFrames(await savedFile(page, testInfo)).frames).toBe(60);
    expect(errors).toEqual([]);
  });

  test("the full encode can still be forced (measurement hook) and says so", async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      (window as unknown as { __clipExportMode: string }).__clipExportMode =
        "encode";
    });
    const errors = await openFixture(page);
    await addKesit(page, "00:02.000", "00:04.000");
    await setQuality(page, "720");
    await downloadAll(page);
    const method = page.getByTestId("export-method");
    await expect(method).toHaveAttribute("data-method", "encode");
    await expect(method).toHaveAttribute("data-fallback", "requested_encode");
    await expect(method).toHaveText("Kodlandı");
    const file = await savedFile(page, testInfo);
    expect(barcodeFrames(file)).toEqual(range(60, 119));
    expect(errors).toEqual([]);
  });
});
