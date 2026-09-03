#!/usr/bin/env node
// Compare a batch of host traces with a directory of Lean goldens under every
// registered mask, running the tail ONCE for the whole batch.
//
//   effect4-batch <dir> --goldens <dir> --masks <masks.tsv> --tail property-tail.ts [--receipt <out.json>]
//
// The tail reads `EFFECT4_BATCH` (a JSON manifest [{program, tape}]) and prints
// one JSON array of reports {program, tape, rows, ...}. Prints one line per
// diverging case and a summary; exits 1 on any divergence, 3 on any invalid
// run (tracer defect or unexpected scheduler yields).
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { stageHarness } from "./copy.mjs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const target = resolve(args.find((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--")) ?? ".")
const goldensDir = flag("--goldens")
const masksPath = flag("--masks")
const tail = flag("--tail", "property-tail.ts")
const receiptPath = flag("--receipt")
if (!goldensDir || !masksPath) { console.error("usage: effect4-batch <dir> --goldens <dir> --masks <tsv> --tail property-tail.ts [--receipt out.json]"); process.exit(2) }

const nodeModules = resolve(process.env.EFFECT4_EFFECT_NODE_MODULES ??
  join(process.env.HOME, "Dev/foldlab/library/effects/node_modules"))
const pin = JSON.parse(process.env.EFFECT4_HOST_PIN ??
  '{"effect":"4.0.0-rc.112","typescript":"7.0.2","tsgo":"0.38.0"}')
const version = (name) => JSON.parse(readFileSync(join(nodeModules, name, "package.json"), "utf8")).version
const seen = { effect: version("effect"), typescript: version("typescript"), tsgo: version("@effect/tsgo") }
for (const key of Object.keys(pin)) if (seen[key] !== pin[key]) throw new Error(`host pin mismatch for ${key}: wanted ${pin[key]}, found ${seen[key]}`)

const eventKinds = ["op", "answer", "failed", "decide", "enter", "leave", "finalizer", "done", "frontier"]
const parseGolden = (text) => {
  const header = {}; const rows = []
  for (const line of text.split("\n")) {
    if (line === "") continue
    const cells = line.split("\t")
    if (eventKinds.includes(cells[0])) rows.push(line); else header[cells[0]] = cells.slice(1).join("\t")
  }
  return { header, rows }
}
const parseMasks = (text) => {
  const masks = []
  for (const line of text.split("\n")) {
    const cells = line.split("\t")
    if (cells[0] !== "mask") continue
    const [ops, answers, decisions, regions, finalizers, outcome, frontier] = cells.slice(2).map((c) => c === "1")
    masks.push({ name: cells[1], ops, answers, decisions, regions, finalizers, outcome, frontier })
  }
  return masks
}
const keeps = (mask, row) => {
  switch (row.split("\t")[0]) {
    case "op": return mask.ops
    case "answer": case "failed": return mask.answers
    case "decide": return mask.decisions
    case "enter": case "leave": return mask.regions
    case "finalizer": return mask.finalizers
    case "done": return mask.outcome
    case "frontier": return mask.frontier
    default: throw new Error(`unknown row kind`)
  }
}
const project = (mask, rows) => rows.filter((r) => keeps(mask, r))

const masks = parseMasks(readFileSync(masksPath, "utf8"))
if (masks.length === 0) throw new Error("mask table drift: no mask rows")
const goldens = readdirSync(goldensDir).filter((f) => f.endsWith(".tsv")).sort().map((file) => {
  const golden = parseGolden(readFileSync(join(goldensDir, file), "utf8"))
  const name = file.slice(0, -4)
  const [program, tapeName] = [name.slice(0, name.indexOf(".")), name.slice(name.indexOf(".") + 1)]
  return { file, name, program, tapeName, tape: golden.header.tape ?? "", rows: golden.rows, rules: golden.header.rules ?? "" }
})

// --- run the tail once --------------------------------------------------------
const temporary = mkdtempSync(join(tmpdir(), "effect4-batch-"))
let reports
try {
  stageHarness(target, temporary, nodeModules)
  writeFileSync(join(temporary, "batch.json"), JSON.stringify(goldens.map((g) => ({ program: g.program, tape: g.tape }))))
  const run = spawnSync("node", ["--experimental-strip-types", "--no-warnings", tail], {
    cwd: temporary, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, EFFECT4_BATCH: join(temporary, "batch.json") }
  })
  if (run.status !== 0) throw new Error(`tail failed\n${run.stdout.slice(-4000)}${run.stderr.slice(-4000)}`)
  reports = JSON.parse(run.stdout.trim().split("\n").pop())
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
if (reports.length !== goldens.length) throw new Error(`batch returned ${reports.length} reports for ${goldens.length} goldens`)

// --- compare ------------------------------------------------------------------
let diverged = 0, invalid = 0
const results = {}
goldens.forEach((golden, index) => {
  const report = reports[index]
  const key = golden.name
  if (report.tracerDefect) { invalid += 1; results[key] = `invalid: ${report.tracerDefect}`; console.log(`trace ${key} INVALID: tracer defect ${report.tracerDefect}`); return }
  if (report.yields !== 0 && report.expectYields !== true) { invalid += 1; results[key] = "invalid: yields"; console.log(`trace ${key} INVALID: ${report.yields} scheduler yields`); return }
  const perMask = {}
  for (const mask of masks) {
    const expected = project(mask, golden.rows), actual = project(mask, report.rows)
    let i = 0
    while (i < expected.length && i < actual.length && expected[i] === actual[i]) i += 1
    if (i === expected.length && i === actual.length) perMask[mask.name] = "ok"
    else {
      perMask[mask.name] = `diverges at row ${i}`
      console.log(`trace ${key} mask ${mask.name} DIVERGES at row ${i}`)
      console.log(`  expected: ${expected[i] ?? "<end>"}`)
      console.log(`  actual:   ${actual[i] ?? "<end>"}`)
    }
  }
  if (Object.values(perMask).some((v) => v !== "ok")) diverged += 1
  results[key] = perMask
})
console.log(`batch ${goldens.length} cases: ${goldens.length - diverged - invalid} ok, ${diverged} diverge, ${invalid} invalid`)

if (receiptPath) {
  const pinFile = existsSync(join(target, "host-pin.json")) ? JSON.parse(readFileSync(join(target, "host-pin.json"), "utf8")) : null
  writeFileSync(receiptPath, JSON.stringify({
    format: "effect4-batch-receipt-v1",
    cases: goldens.length, diverged, invalid,
    host: { ...seen, pin: pinFile, node: process.version, platform: `${process.platform}-${process.arch}`, patched: null },
    scheduler: { mode: "TapeScheduler", maxOpsBeforeYield: reports[0]?.maxOpsBeforeYield ?? null },
    results
  }, null, 1) + "\n")
}
process.exit(invalid > 0 ? 3 : diverged > 0 ? 1 : 0)
