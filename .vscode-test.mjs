import { defineConfig } from '@vscode/test-cli';

// Keep the test runtime pinned. The newest automatic download can change the
// macOS executable name before @vscode/test-electron supports it.
export default defineConfig({
    files: 'out/test/**/*.test.js',
    version: '1.94.2',
});
