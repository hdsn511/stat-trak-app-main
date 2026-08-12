// Builds the Lambda deployment artifact into server/build/lambda/.
//
// The output is what SAM zips and uploads: a single bundled entrypoint, the one
// dependency that cannot be bundled, and the startup script the Lambda Web
// Adapter invokes as the function handler.
import { build } from 'esbuild'
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(serverRoot, 'build/lambda')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

// libpg-query ships a .wasm binary that a bundler cannot inline, so it stays
// external and is copied in whole. Everything else collapses into one file,
// which measurably shortens cold starts by removing module resolution work.
const external = ['libpg-query']

const result = await build({
  entryPoints: [resolve(serverRoot, 'src/lambda.ts')],
  outfile: resolve(outDir, 'index.js'),
  bundle: true,
  platform: 'node',
  // Matches the SAM runtime in infra/template.yaml.
  target: 'node20',
  format: 'cjs',
  external,
  // Not minified on purpose: the artifact is already small, and readable
  // CloudWatch stack traces are worth more than the saved kilobytes.
  minify: false,
  sourcemap: 'linked',
  logLevel: 'info',
  metafile: true,
})

await cp(
  resolve(serverRoot, 'node_modules/libpg-query'),
  resolve(outDir, 'node_modules/libpg-query'),
  { recursive: true }
)

await cp(resolve(serverRoot, 'lambda/run.sh'), resolve(outDir, 'run.sh'))

// The zip preserves file modes, and LWA's bootstrap must be able to exec this.
// Git tracks the bit too (see .gitattributes), but a Windows checkout can drop
// it, so it is set explicitly here rather than assumed.
const { chmod } = await import('node:fs/promises')
await chmod(resolve(outDir, 'run.sh'), 0o755)

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0)
await writeFile(
  resolve(outDir, 'build-info.json'),
  JSON.stringify({ builtAt: new Date().toISOString(), bundleBytes: bytes, external }, null, 2)
)

const pkg = JSON.parse(await readFile(resolve(serverRoot, 'package.json'), 'utf8'))
console.log(`\nBundled ${pkg.name} -> build/lambda (${(bytes / 1024).toFixed(0)} KB, external: ${external.join(', ')})`)
