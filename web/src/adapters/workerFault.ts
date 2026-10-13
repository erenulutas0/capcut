/**
 * TEST BUILDS ONLY (`CLIP_TEST_HOOKS=1`): breaks the running job of one of
 * the small workers the way a test asked for (`window.__clipWorkerFault`,
 * see `workerWatch.ts`). Every caller guards the call with its build-time
 * constant, so the published site never reaches this.
 */

import type { WorkerTestFault } from './workerWatch';

export async function applyWorkerFault(fault: WorkerTestFault | null | undefined): Promise<void> {
  if (!fault) return;
  if (fault.kind === 'throw') throw new DOMException(fault.message ?? 'test fault', fault.errorName ?? 'OperationError');
  if (fault.kind === 'crash') {
    // Outside every handler: nothing catches it, the worker's `error` event fires on the page.
    setTimeout(() => {
      throw new Error(fault.message ?? 'test crash');
    }, 0);
  }
  // `stall` (and the moment before a crash): nothing more happens, and nothing is thrown.
  if (fault.kind === 'stall' || fault.kind === 'crash') await new Promise<never>(() => undefined);
}
