import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * The run's last word on page loads that needed the watchdog (ADR-044,
 * tests/e2e/fixtures.ts): how many loads were reloaded automatically, how
 * many pages were still dead at the end of their test — and, apart, how many
 * of each the watchdog's own tests made on purpose. Printed even when the
 * numbers are zero: "0" is a result, silence is not.
 */
class RecoveryReporter implements Reporter {
  private readonly counts = new Map<string, string[]>();

  onTestEnd(test: TestCase, result: TestResult): void {
    for (const annotation of result.annotations ?? test.annotations) {
      if (!annotation.type.startsWith('page-recovered') && !annotation.type.startsWith('page-dead')) continue;
      const list = this.counts.get(annotation.type) ?? [];
      list.push(`${annotation.description ?? ''} — ${test.titlePath().slice(3).join(' › ')}`);
      this.counts.set(annotation.type, list);
    }
  }

  onEnd(): void {
    const count = (type: string) => this.counts.get(type)?.length ?? 0;
    console.log(
      `\nPAGE-RECOVERED-TOTAL ${count('page-recovered')} page load(s) needed the automatic reload; ` +
        `PAGE-DEAD-TOTAL ${count('page-dead')} page(s) stayed dead ` +
        `(made on purpose by the watchdog's own tests: ${count('page-recovered-forced')} recovered, ${count('page-dead-forced')} dead)`,
    );
    for (const type of ['page-recovered', 'page-dead']) {
      for (const line of this.counts.get(type) ?? []) console.log(`  ${type}: ${line}`);
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}

export default RecoveryReporter;
