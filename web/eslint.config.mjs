import next from 'eslint-config-next';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'screenshots/**',
    ],
  },
  ...next,
];

export default config;
