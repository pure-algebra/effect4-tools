import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
const require = createRequire(import.meta.url)
const ts = require("/Users/pooks/Dev/vsco-loupe/node_modules/typescript")
const src = "/Users/pooks/Dev/foldlab/library/effects/node_modules/effect/src"
const files = readdirSync(src).filter(f => f.endsWith(".ts")).map(f => join(src, f))
const texts = files.map(f => readFileSync(f, "utf8"))
const bytes = texts.reduce((a, t) => a + Buffer.byteLength(t), 0)
// warm up
for (const t of texts) ts.createSourceFile("x.ts", t, ts.ScriptTarget.Latest, false)
for (const setParents of [false, true]) {
  const t0 = process.hrtime.bigint()
  let nodes = 0
  for (const t of texts) { const sf = ts.createSourceFile("x.ts", t, ts.ScriptTarget.Latest, setParents); nodes += sf.statements.length }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`tsc 5.9.3 createSourceFile setParentNodes=${setParents}: ${files.length} files, ${bytes} bytes, ${ms.toFixed(0)} ms, ${(bytes / 1048576 / (ms / 1000)).toFixed(1)} MiB/s, ${nodes} top-level statements`)
}
// scanner only
{
  const t0 = process.hrtime.bigint(); let toks = 0
  for (const t of texts) { const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, t); while (sc.scan() !== ts.SyntaxKind.EndOfFileToken) toks++ }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`tsc scanner only: ${toks} tokens, ${ms.toFixed(0)} ms, ${(bytes / 1048576 / (ms / 1000)).toFixed(1)} MiB/s`)
}
