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
    ],
  },
  ...next,
];

export default config;
