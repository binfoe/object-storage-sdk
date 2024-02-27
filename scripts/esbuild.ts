import path from 'path';
import type { BuildOptions } from 'esbuild';
import esbuild from 'esbuild';

function getOption(type: 'cjs' | 'esm'): BuildOptions {
  return {
    entryPoints: [path.resolve(__dirname, '../src/index.ts')],
    sourcemap: true,
    // external,
    packages: 'external',
    charset: 'utf8',
    bundle: true,
    ...(type === 'cjs'
      ? {
          platform: 'node',
        }
      : {
          format: 'esm',
          target: 'esnext',
        }),
    // outdir: 'dist',
    outfile: `dist/index.${type === 'cjs' ? 'cjs' : 'mjs'}`,
  };
}

async function bundle(type: 'cjs' | 'esm') {
  const result = await esbuild.build(getOption(type));
  // console.log(result);
  if (result.errors?.length) {
    console.error(result.errors);
  } else {
    console.log(`==> dist/index.${type} bundled.`);
  }
}
(async () => {
  await Promise.all([bundle('cjs'), bundle('esm')]);

  if (process.env.WATCH) {
    const ctx = await esbuild.context(getOption('esm'));
    await ctx.watch();
    console.log('Watching For dist/index.mjs bundle...');
  }
})().catch((ex) => {
  console.error(ex);
});
