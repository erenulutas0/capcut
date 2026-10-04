/**
 * Saves a small text file the page made itself (the transcript as TXT, SRT
 * or VTT): an object URL and a download link, as the subtitle export does.
 * Nothing is sent anywhere; the browser writes the file.
 */
export function saveTextFile(fileName: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Revoked on the next task: some browsers start the download after click returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const TEXT_MIME = {
  txt: 'text/plain;charset=utf-8',
  /** SRT has no registered type; this is the one players and browsers use. */
  srt: 'application/x-subrip;charset=utf-8',
  vtt: 'text/vtt;charset=utf-8',
} as const;
