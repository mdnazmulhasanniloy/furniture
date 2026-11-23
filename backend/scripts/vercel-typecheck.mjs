import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-026 regression check (`npm run build:vercel`): type-check the `api/` entry files the way the
 * Vercel function compiler (@vercel/node) does, so "builds locally, fails on Vercel" cannot recur.
 *
 * @vercel/node (v32, dist/index.js `registerNativeCompiler`/legacy register) compiles with the
 * project tsconfig BUT overrides the language-service host's `resolveModuleNames` with a bare
 * `ts.resolveModuleName(name, file, options, ts.sys)` — no `resolutionMode`. Under NodeNext that
 * resolves every package import with the `require` condition, even from ESM files, so a
 * dual-published package (helmet, ...) presents its CommonJS types, where an ESM default import is
 * the exports namespace and not callable (TS2349). This script replicates exactly that resolver on
 * top of our own tsconfig, checks the whole program reachable from `api/`, and fails on any error.
 */

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
/** @type {import('typescript')} */
const ts = require_('typescript');

console.log(`vercel-typecheck: TypeScript ${ts.version} (same compiler Vercel picks up)`);

// Our tsconfig's options, read the way @vercel/node's readConfig does (files/include dropped).
const configFile = ts.readConfigFile(resolve(backendRoot, 'tsconfig.json'), ts.sys.readFile);
if (configFile.error) {
  console.error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(
  { ...configFile.config, files: [], include: [] },
  ts.sys,
  backendRoot,
);
const options = { ...parsed.options, noEmit: true };

const rootNames = [resolve(backendRoot, 'api/index.ts'), resolve(backendRoot, 'api/socket-io.ts')];

const host = ts.createCompilerHost(options);
// The faithful part: @vercel/node's mode-less resolver (require condition for everything).
host.resolveModuleNames = (moduleNames, containingFile) =>
  moduleNames.map(
    (moduleName) =>
      ts.resolveModuleName(moduleName, containingFile, options, ts.sys).resolvedModule,
  );

const program = ts.createProgram({ rootNames, options, host });
const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .filter((d) => d.category === ts.DiagnosticCategory.Error);

if (diagnostics.length > 0) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => backendRoot,
      getCanonicalFileName: (f) => f,
      getNewLine: () => ts.sys.newLine,
    }),
  );
  console.error(`vercel-typecheck: FAIL (${diagnostics.length} error(s) under Vercel's resolver)`);
  process.exit(1);
}
console.log(
  `vercel-typecheck: PASS (${program.getSourceFiles().filter((f) => !f.fileName.includes('node_modules')).length} project files clean under Vercel's resolver)`,
);
