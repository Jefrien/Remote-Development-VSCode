import { build } from 'esbuild';

await build({
    entryPoints: ['out/extension.js'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    loader: {
      '.node': 'copy'
    },
    outfile: 'out/extension.bundle.js',
    sourcemap: false,
    logLevel: 'info'
});
