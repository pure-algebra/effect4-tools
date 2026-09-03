#!/usr/bin/env node
// Check one generated module against the pinned host profile.
//
//   effect4-check <dir>            dir holds fixture.ts, optional tail.ts and atoms.ts, tsconfig.json
//   env EFFECT4_EFFECT_NODE_MODULES   an exact installation of the pinned packages
//   env EFFECT4_HOST_PIN              JSON {effect, typescript, tsgo}; defaults to rc.112 / 7.0.2 / 0.38.0
//
// Evidence, in order: the unpatched compiler accepts the file set; the language
// service reports no diagnostic at strict; node runs tail.ts and it exits 0.
// The harness prints one line per gate and exits non-zero on the first failure.
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { stageHarness } from "./copy.mjs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const target = resolve(process.argv[2] ?? ".")
const nodeModules = resolve(process.env.EFFECT4_EFFECT_NODE_MODULES ??
  join(process.env.HOME, "Dev/foldlab/library/effects/node_modules"))
const pin = JSON.parse(process.env.EFFECT4_HOST_PIN ??
  '{"effect":"4.0.0-rc.112","typescript":"7.0.2","tsgo":"0.38.0"}')

const version = (name) =>
  JSON.parse(readFileSync(join(nodeModules, name, "package.json"), "utf8")).version
const seen = { effect: version("effect"), typescript: version("typescript"), tsgo: version("@effect/tsgo") }
for (const key of Object.keys(pin)) {
  if (seen[key] !== pin[key]) throw new Error(`host pin mismatch for ${key}: wanted ${pin[key]}, found ${seen[key]}`)
}
console.log(`pin ok ${JSON.stringify(seen)}`)

const tsc = execFileSync("find", [nodeModules, "-path", "*/@typescript/typescript-*/lib/tsc.original", "-type", "f", "-print", "-quit"],
  { encoding: "utf8" }).trim()
if (!tsc) throw new Error("unpatched TypeScript compiler (tsc.original) not found")

const temporary = mkdtempSync(join(tmpdir(), "effect4-check-"))
try {
  stageHarness(target, temporary, nodeModules)

  const direct = spawnSync(tsc, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: temporary, encoding: "utf8" })
  if (direct.status !== 0 || direct.stdout !== "" || direct.stderr !== "")
    throw new Error(`tsc rejected the file set\n${direct.stdout}${direct.stderr}`)
  console.log("tsc ok")

  const tsgo = spawnSync(join(nodeModules, ".bin/effect-tsgo"),
    ["diagnostics", "--project", "tsconfig.json", "--format", "json", "--strict", "--list-files"],
    { cwd: temporary, encoding: "utf8" })
  let report
  try { report = JSON.parse(tsgo.stdout) } catch { throw new Error(`tsgo produced no JSON\n${tsgo.stdout}${tsgo.stderr}`) }
  const diagnostics = report.diagnostics ?? report
  if (Array.isArray(diagnostics) && diagnostics.length > 0)
    throw new Error(`tsgo diagnostics\n${JSON.stringify(diagnostics, null, 2)}`)
  console.log(`tsgo ok (${(report.files ?? []).length} files listed)`)

  if (existsSync(join(temporary, "tail.ts"))) {
    const run = spawnSync("node", ["--experimental-strip-types", "--no-warnings", "tail.ts"], { cwd: temporary, encoding: "utf8" })
    if (run.status !== 0) throw new Error(`node run failed\n${run.stdout}${run.stderr}`)
    process.stdout.write(run.stdout)
    console.log("run ok")
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
