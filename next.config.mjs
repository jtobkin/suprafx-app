import { execSync } from 'child_process';

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: (() => {
      try {
        const hash = execSync('git rev-parse --short HEAD').toString().trim();
        const count = execSync('git rev-list --count HEAD').toString().trim();
        return `b${count}.${hash}`;
      } catch {
        return 'dev';
      }
    })(),
  },
};

export default nextConfig;
