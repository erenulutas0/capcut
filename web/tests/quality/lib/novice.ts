/**
 * The scripted first-time user.
 *
 * It only does what a person who has never seen the app can do: read the
 * screen and press a control it can see, found by what the control SAYS
 * (its role and accessible name) — never by a test id. When a step cannot be
 * reached that way the script notes it as a finding and goes on through the
 * test id, so the rest of the task is still measured.
 *
 * What it cannot do is hesitate, misread, or give up: every number it
 * produces is a floor, not what a child would need (docs/quality/README.md).
 */

import type { Locator, Page } from '@playwright/test';

import { readScreen, type ScreenReading } from './screen';

/** The one thing every task needs: not counted as a decision. */
export const VIDEO = 'video dosyası';

type Role = 'button' | 'link' | 'radio' | 'textbox' | 'combobox' | 'option';

export interface NoviceStep {
  kind: 'press' | 'file' | 'type';
  role: Role;
  name: string;
  /** False: there was no visible control with this name; the script went through the test id. */
  byName: boolean;
}

export interface NoviceScreen extends Omit<ScreenReading, 'text'> {
  label: string;
  /** Something the user has to bring or decide here before the task can go on. */
  required: string[];
}

export class Novice {
  /** Presses and taps inside the app (the system's file and save dialogs are not the app's). */
  clicks = 0;
  /** Fields the user had to type into. */
  typed = 0;
  readonly steps: NoviceStep[] = [];
  readonly screens: NoviceScreen[] = [];
  readonly unreachable: string[] = [];

  constructor(
    private readonly page: Page,
    private readonly touch: boolean,
  ) {}

  private async find(role: Role, name: string | RegExp, fallbackTestId: string): Promise<{ target: Locator; byName: boolean }> {
    const named = this.page.getByRole(role, typeof name === 'string' ? { name, exact: true } : { name }).first();
    try {
      await named.waitFor({ state: 'visible', timeout: 15_000 });
      return { target: named, byName: true };
    } catch {
      this.unreachable.push(`${role} “${String(name)}” (test kimliği: ${fallbackTestId})`);
      return { target: this.page.getByTestId(fallbackTestId).first(), byName: false };
    }
  }

  private async act(target: Locator): Promise<void> {
    if (this.touch) await target.tap();
    else await target.click();
    this.clicks += 1;
  }

  /** Presses a visible control. */
  async press(role: Role, name: string | RegExp, fallbackTestId: string): Promise<void> {
    const { target, byName } = await this.find(role, name, fallbackTestId);
    await this.act(target);
    this.steps.push({ kind: 'press', role, name: String(name), byName });
  }

  /**
   * Presses the control that opens the system's file dialog and picks a
   * file there. One press: the dialog itself belongs to the system.
   */
  async pickFile(name: string | RegExp, file: string, fallbackTestId: string): Promise<void> {
    const { target, byName } = await this.find('button', name, fallbackTestId);
    const [chooser] = await Promise.all([this.page.waitForEvent('filechooser', { timeout: 15_000 }), this.act(target)]);
    await chooser.setFiles(file);
    this.steps.push({ kind: 'file', role: 'button', name: String(name), byName });
  }

  /** Types into a field found by its label. */
  async type(label: string, value: string, fallbackTestId: string): Promise<void> {
    const { target, byName } = await this.find('textbox', label, fallbackTestId);
    await target.fill(value);
    await target.blur();
    this.typed += 1;
    this.steps.push({ kind: 'type', role: 'textbox', name: label, byName });
  }

  /** Reads the screen the user is on now. */
  async look(label: string, required: string[] = []): Promise<NoviceScreen> {
    const { text: _text, ...reading } = await readScreen(this.page);
    void _text;
    const screen = { ...reading, label, required };
    this.screens.push(screen);
    return screen;
  }

  summary() {
    const distinct = new Map<string, NoviceScreen>();
    for (const screen of this.screens) if (!distinct.has(screen.id)) distinct.set(screen.id, screen);
    const screens = [...distinct.values()];
    return {
      clicks: this.clicks,
      typedFields: this.typed,
      screens: screens.length,
      /**
       * Screens that put a choice in front of the user or need something from them beyond the video
       * itself (every task needs the video; that is not a decision).
       */
      decisions: screens.filter((screen) => screen.choiceGroups > 0 || screen.required.some((item) => item !== VIDEO)).length,
      wordsTotal: screens.reduce((sum, screen) => sum + screen.words, 0),
      wordsMax: Math.max(0, ...screens.map((screen) => screen.words)),
      strongJargon: screens.flatMap((screen) => screen.strong.map((hit) => ({ screen: screen.label, ...hit }))),
      mildJargon: screens.flatMap((screen) => screen.mild.map((hit) => ({ screen: screen.label, ...hit }))),
      unreachable: this.unreachable,
      perScreen: screens.map((screen) => ({
        label: screen.label,
        title: screen.title,
        words: screen.words,
        choiceGroups: screen.choiceGroups,
        required: screen.required,
      })),
      steps: this.steps,
    };
  }
}
