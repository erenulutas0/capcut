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
