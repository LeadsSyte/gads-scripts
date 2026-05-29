import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Build-time identification — baked into the bundle so the running
// site can show "I am version X built at Y". Lets users sanity-check
// at a glance whether a deploy actually rolled out, instead of
// guessing from cache + CDN behaviour.
function readBuildInfo() {
  // Prefer the env vars CI / Netlify already provide; fall back to
  // shelling out to `git` so local dev still gets accurate info.
  const sha =
    process.env.COMMIT_REF ||                  // Netlify
    process.env.GITHUB_SHA ||                  // GitHub Actions
    safeGit('rev-parse HEAD') ||
    'unknown';
  const branch =
    process.env.HEAD ||                        // Netlify
    process.env.GITHUB_REF_NAME ||             // GitHub Actions
    safeGit('rev-parse --abbrev-ref HEAD') ||
    'unknown';
  return {
    commit: sha.slice(0, 7),
    fullCommit: sha,
    branch,
    builtAt: new Date().toISOString()
  };
}
function safeGit(args) {
  try { return execSync('git ' + args, { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_INFO__: JSON.stringify(readBuildInfo())
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020'
  },
  server: {
    port: 5173
  }
});
