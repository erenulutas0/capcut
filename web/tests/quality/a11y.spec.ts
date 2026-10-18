import { test, type Page } from '@playwright/test';

import { installSavePicker, noSavePicker } from '../e2e/kesitFlow';
import { isPhone, langOf } from './lib/app';
import { BUILD, tr, writeResult } from './lib/record';
import { STATES } from './lib/states';

/**
 * Section 9 — accessibility and child-friendliness heuristics that the axe
 * suite (tests/e2e/a11y.spec.ts and friends: contrast, roles, names by rule)
 * does not measure:
 *
 *  - tap targets: every control a finger has to hit, with its size (the
 *    label of a radio button counts, not its dot). 44 × 44 px is the budget
 *    on the phone; links inside a sentence are listed apart;
 *  - text size: how many of the words on screen are set below 14 px and
 *    what the smallest is;
 *  - names: every control has an accessible name, and which ones have no
 *    VISIBLE words (an icon only);
 *  - focus order: Tab from the top of the page — does it reach every
 *    control, does it ever jump back up the page, is the focus ring visible.
 *
 * These are measurements of the page as built. They do not tell whether a
 * child understands a label.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'static', 'runs against the static export');

interface Control {
  key: string;
  tag: string;
  role: string | null;
  name: string;
  visibleWords: boolean;
  width: number;
  height: number;
  top: number;
  left: number;
  inline: boolean;
  tabbable: boolean;
  testId: string | null;
}

function readControls(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const withCheck = element as Element & { checkVisibility?: (options?: Record<string, boolean>) => boolean };
      return box.width > 0 && box.height > 0 && (!withCheck.checkVisibility || withCheck.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    };
    const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="slider"], [role="tab"], ' +
      '[role="radio"], [role="checkbox"], [role="combobox"], [role="option"], [tabindex]:not([tabindex="-1"])';
    const out: Control[] = [];
    const seen = new Set<Element>();
    let index = 0;
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      const input = element as HTMLInputElement;
      if (input.disabled || element.getAttribute('aria-hidden') === 'true') continue;
      // The finger hits the label of a radio button or a check box, not the dot.
      const isChoice = element.tagName === 'INPUT' && (input.type === 'radio' || input.type === 'checkbox');
      const target = isChoice ? (element.closest('label') ?? element) : element;
      if (!visible(target)) continue;
      const box = target.getBoundingClientRect();
      const labelledBy = clean(
        (element.getAttribute('aria-labelledby') ?? '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' '),
      );
      const forLabel = element.id ? clean(document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent) : '';
      const ownText = clean(element.innerText);
      const wrapLabel = clean(element.closest('label')?.textContent);
      const name =
        clean(element.getAttribute('aria-label')) ||
        labelledBy ||
        forLabel ||
        wrapLabel ||
        ownText ||
        clean(element.getAttribute('title')) ||
        clean(input.placeholder) ||
        clean(element.getAttribute('alt'));
      // Words a sighted user can read on or next to the control.
      const visibleLabel = [...document.querySelectorAll<HTMLElement>(`label[for="${CSS.escape(element.id || '__none__')}"]`)].some(
        (label) => !label.closest('.visually-hidden') && visible(label),
      );
      const visibleWords = ownText !== '' || (isChoice && wrapLabel !== '') || visibleLabel || clean(input.placeholder) !== '';
      const style = getComputedStyle(element);
      const role = element.getAttribute('role');
      const tabIndex = element.tabIndex;
      const uncheckedRadio = isChoice && input.type === 'radio' && !input.checked && document.querySelector(`input[type="radio"][name="${CSS.escape(input.name)}"]:checked`) !== null;
      out.push({
        key: `c${(index += 1)}`,
        tag: element.tagName.toLowerCase(),
        role,
        name: name.slice(0, 80),
        visibleWords,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        top: Math.round(box.top + window.scrollY),
        left: Math.round(box.left + window.scrollX),
        inline: element.tagName === 'A' && style.display === 'inline',
        // A listbox option is reached with the arrow keys from its box; an unchecked radio from its group.
        tabbable: tabIndex >= 0 && role !== 'option' && !uncheckedRadio,
        testId: element.getAttribute('data-testid'),
      });
      element.setAttribute('data-quality-key', `c${index}`);
    }
    return out;
  });
}

function readText(page: Page) {
  return page.evaluate(() => {
    const sizes: Array<{ px: number; words: number; sample: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (text === '' || !parent || parent.closest('.visually-hidden, [hidden], script, style, noscript')) continue;
      const withCheck = parent as Element & { checkVisibility?: (options?: Record<string, boolean>) => boolean };
      if (withCheck.checkVisibility && !withCheck.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const box = parent.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
      if (words === 0) continue;
      const px = Math.round(parseFloat(getComputedStyle(parent).fontSize) * 10) / 10;
      // Text set at size 0 is not shown (a word kept for screen readers behind a logo).
      if (px < 1) continue;
      sizes.push({ px, words, sample: text.slice(0, 60) });
    }
    return sizes;
  });
}

interface FocusStop {
  key: string | null;
  name: string;
  top: number;
  ringVisible: boolean;
}

async function tabThrough(page: Page, limit: number): Promise<FocusStop[]> {
  // Start where a keyboard user starts on a fresh page: at the very top. Blurring is not enough — the
  // browser goes on from where focus last was (a wizard step moves focus to its heading), so a probe
  // is focused at the start of the page and taken away again.
  await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.tabIndex = -1;
    document.body.prepend(probe);
    probe.focus();
    probe.remove();
    window.scrollTo(0, 0);
  });
  const stops: FocusStop[] = [];
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      // A player's own controls (audio, video) draw their ring inside the element: the browser's business.
      const native = element.tagName === 'AUDIO' || element.tagName === 'VIDEO';
      const outline = native || (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0);
      const shadow = style.boxShadow !== 'none';
      // A ring may be drawn on the label around a hidden input.
      const holder = element.closest('label');
      const holderStyle = holder ? getComputedStyle(holder) : null;
      const holderRing = holderStyle ? (holderStyle.outlineStyle !== 'none' && parseFloat(holderStyle.outlineWidth) > 0) || holderStyle.boxShadow !== 'none' : false;
      const box = (holder ?? element).getBoundingClientRect();
      return {
        key: element.getAttribute('data-quality-key'),
        name: (
          element.getAttribute('aria-label') ||
          (element as HTMLInputElement).labels?.[0]?.textContent ||
          element.innerText ||
          element.getAttribute('title') ||
          element.tagName.toLowerCase()
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60),
        top: Math.round(box.top + window.scrollY),
        ringVisible: outline || shadow || holderRing,
      };
    });
    if (stop === null) break;
    if (stops.length > 0 && stop.key !== null && stop.key === stops[0]?.key) break;
    // Several stops inside one player (its play button, its slider…) are one stop of the page.
    if (stop.key !== null && stop.key === stops.at(-1)?.key) continue;
    stops.push(stop);
  }
  return stops;
}

for (const state of STATES) {
  test(`a11y: ${state.id}`, async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    writeResult('a11y', `${testInfo.project.name}.${state.id}`, {
      id: state.id,
      label: state.label,
      measured: false,
      reason: 'ölçüm betiği yarıda kaldı (zaman aşımı ya da hata); ayrıntı koşu günlüğünde',
    });
    if (phone) await noSavePicker(page);
    else await installSavePicker(page);
    try {
      await state.open(page, langOf(testInfo));
    } catch (error) {
      writeResult('a11y', `${testInfo.project.name}.${state.id}`, {
        id: state.id,
        label: state.label,
        measured: false,
        reason: `ekrana ulaşılamadı: ${String((error as Error).message).split('\n')[0]?.slice(0, 200)}`,
      });
      return;
    }
    const controls = await readControls(page);
    const text = await readText(page);
    const stops = await tabThrough(page, controls.length + 15);

    const small44 = controls.filter((control) => !control.inline && (control.width < 44 || control.height < 44));
    const small24 = controls.filter((control) => !control.inline && (control.width < 24 || control.height < 24));
    const unnamed = controls.filter((control) => control.name === '');
    const iconOnly = controls.filter((control) => control.name !== '' && !control.visibleWords);
    const totalWords = text.reduce((sum, item) => sum + item.words, 0);
    const under14 = text.filter((item) => item.px < 14);
    const under12 = text.filter((item) => item.px < 12);
    const visited = new Set(stops.map((stop) => stop.key).filter((key): key is string => key !== null));
    const unreached = controls.filter((control) => control.tabbable && !visited.has(control.key));
    let jumpsBack = 0;
    const jumpExamples: string[] = [];
    for (let i = 1; i < stops.length; i += 1) {
      const previous = stops[i - 1];
      const now = stops[i];
      if (previous && now && now.top < previous.top - 8) {
        jumpsBack += 1;
        if (jumpExamples.length < 4) jumpExamples.push(`“${previous.name}” → “${now.name}”`);
      }
    }
    const describe = (control: Control) => `${control.name || `(adsız ${control.tag})`} — ${tr(control.width, 1)} × ${tr(control.height, 1)} px`;
    writeResult('a11y', `${testInfo.project.name}.${state.id}`, {
      id: state.id,
      label: state.label,
      wizard: state.wizard === true,
      measured: true,
      controls: controls.length,
      tapTargets: {
        under44: small44.length,
        under24: small24.length,
        smallest: controls.filter((control) => !control.inline).reduce((least, control) => Math.min(least, control.width, control.height), 999),
        list: small44.map(describe).slice(0, 25),
        inlineLinks: controls.filter((control) => control.inline).map(describe),
      },
      names: {
        unnamed: unnamed.length,
        unnamedList: unnamed.map((control) => `${control.tag}${control.testId ? ` [${control.testId}]` : ''}`),
        iconOnly: iconOnly.length,
        iconOnlyList: iconOnly.map((control) => control.name),
      },
      text: {
        words: totalWords,
        smallestPx: text.reduce((least, item) => Math.min(least, item.px), 999),
        wordsUnder14: under14.reduce((sum, item) => sum + item.words, 0),
        wordsUnder12: under12.reduce((sum, item) => sum + item.words, 0),
        under14Samples: [...new Map(under14.map((item) => [`${item.px}|${item.sample}`, item])).values()]
          .sort((a, b) => a.px - b.px)
          .slice(0, 10)
          .map((item) => `${tr(item.px, 1)} px: ${item.sample}`),
      },
      focus: {
        stops: stops.length,
        tabbable: controls.filter((control) => control.tabbable).length,
        unreached: unreached.length,
        unreachedList: unreached.map((control) => control.name || control.tag).slice(0, 12),
        jumpsBack,
        jumpExamples,
        withoutVisibleRing: stops.filter((stop) => !stop.ringVisible).length,
        withoutRingList: stops.filter((stop) => !stop.ringVisible).map((stop) => stop.name).slice(0, 12),
        order: stops.map((stop) => stop.name),
      },
    });
  });
}
