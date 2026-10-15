import next from 'eslint-config-next';

const config = [
  {
    ignores: [
      '.next/**',
      // Static export for GitHub Pages (generated).
      'out/**',
      // Static export for GitHub Pages (generated).
      'out/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'screenshots/**',
      // Generated measurements and media (gitignored). The fuzz corpus has an MPEG transport stream named `.ts`.
      '.scratch/**',
    ],
  },
  ...next,
];

export default config;
