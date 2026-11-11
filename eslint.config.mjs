import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const config = [
  {
    ignores: [
      '.next/**',
      '.venv/**',
      'node_modules/**',
      'next-env.d.ts',
      '.impeccable/**',
      'verification/archive/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
