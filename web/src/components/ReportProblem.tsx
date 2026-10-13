'use client';

import { createContext, useContext } from 'react';

/**
 * Opens "Sorun bildir" from wherever a failure is shown. The editor and the
 * wizards own the dialog; a failure deep inside them (the silence search,
 * "Yazıya dök", the "İyileştir" preview) reaches it through this, so that
 * "this line is also in the diagnostics file" is one press from the line.
 * Null where no such dialog exists: then no button is shown.
 */
const ReportProblemContext = createContext<(() => void) | null>(null);

export const ReportProblemProvider = ReportProblemContext.Provider;

export function useReportProblem(): (() => void) | null {
  return useContext(ReportProblemContext);
}
