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
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M11 12h1v5h1',
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
