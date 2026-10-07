const PATHS = {
  scissors: 'M6 4l12 12M18 4L6 16M8 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm13 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  undo: 'M4 9h11a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4',
  redo: 'M20 9H9a5 5 0 0 0 0 10h7M20 9l-4-4M20 9l-4 4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4M12 17h.01',
  download: 'M12 4v10m0 0 4-4m-4 4-4-4M4 18h16',
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  pause: 'M9 5v14M15 5v14',
  trash: 'M4 7h16M9 7V5h6v2m-7 0 .7 12h6.6L16 7',
  up: 'M6 14l6-6 6 6',
  down: 'M6 10l6 6 6-6',
  frame: 'M4 6h16v12H4zM9 6v12M15 6v12',
  music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  film: 'M4 5h16v14H4zM4 9h16M4 15h16M9 5v14M15 5v14',
  folder: 'M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  shield: 'M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3Zm-2.5 8.5 2 2 4-4',
  alert: 'M12 8v5m0 3h.01M10.3 4.3 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z',
  check: 'M5 12.5l4.5 4.5L19 7',
  captions: 'M4 5h16v14H4zM7 12h4M13 12h4M7 15.5h7M16 15.5h1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M11 12h1v5h1',
  minus: 'M5 12h14',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  exitFullscreen: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  settings:
    'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  share: 'M12 15V4m0 0L8 8m4-4 4 4M6 11H5v9h14v-9h-1',
  install: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 4v7m0 0 3-3m-3 3-3-3',
  // The opening screen and the task wizards (ADR-034; drawn in docs/ux/2026-10-03-home).
  search: 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.35-4.35',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  upload: 'M12 15V3M7 8l5-5 5 5M5 21h14',
  taskCut:
    'M3 6a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12',
  taskSilence: 'M4 10v4M8 6v12M12 11v2M16 6v12M20 10v4',
  taskVertical: 'M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zM11 18h2',
  taskShrink: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
  taskText: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 15h4M15 15h2M7 11h2M13 11h4',
  taskMusic: 'M9 18V5l12-2v13M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0M15 16a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  taskSound: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7',
  // "Sesi kapat": the same speaker, crossed out.
  taskMute: 'M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  // Asked for, not possible yet (search results only): a clock.
  taskLater: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  taskConvert: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  // "İyileştir" (ADR-037): light. A sun, not a sparkle: nothing here is AI.
  taskEnhance:
    'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={size ? { width: size, height: size } : undefined}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-badge">
        <Icon name="scissors" />
      </span>
      clip
    </span>
  );
}
