#!/usr/bin/env node
// Compare a host trace with a Lean golden under every registered mask.
//
//   effect4-trace <dir> --golden <file.tsv> --masks <masks.tsv> [--tail tail.ts] [--receipt <out.json>]
//   env EFFECT4_EFFECT_NODE_MODULES   an exact installation of the pinned packages
//   env EFFECT4_HOST_PIN              JSON {effect, typescript, tsgo}
//
// The tail prints one JSON report (see harness/trace/tracer.ts RunReport) to
// stdout. This driver renders the compared window as wire rows, projects both
// sides under each mask, and prints `trace <program> mask <m> ok` or the first
// differing row with the frame snapshot beside it. A run with a tracer defect
// is reported invalid, never pass or fail.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const target = resolve(args.find((a) => !a.startsWith("--") && !args.includes(`--${a}`) && args[args.indexOf(a) - 1]?.startsWith("--") !== true) ?? ".")
const goldenPath = flag("--golden")
const masksPath = flag("--masks")
const tail = flag("--tail", "tail.ts")
const receiptPath = flag("--receipt")
if (!goldenPath || !masksPath) { console.error("usage: effect4-trace <dir> --golden <tsv> --masks <tsv> [--tail tail.ts] [--receipt out.json]"); process.exit(2) }

const nodeModules = resolve(process.env.EFFECT4_EFFECT_NODE_MODULES ??
  join(process.env.HOME, "Dev/foldlab/library/effects/node_modules"))
const pin = JSON.parse(process.env.EFFECT4_HOST_PIN ??
  '{"effect":"4.0.0-rc.112","typescript":"7.0.2","tsgo":"0.38.0"}')
const version = (name) => JSON.parse(readFileSync(join(nodeModules, name, "package.json"), "utf8")).version
const seen = { effect: version("effect"), typescript: version("typescript"), tsgo: version("@effect/tsgo") }
for (const key of Object.keys(pin)) if (seen[key] !== pin[key]) throw new Error(`host pin mismatch for ${key}: wanted ${pin[key]}, found ${seen[key]}`)

// --- goldens and masks ------------------------------------------------------
const parseGolden = (text) => {
  const header = {}; const rows = []
  for (const line of text.split("\n")) {
    if (line === "") continue
    const cells = line.split("\t")
    if (["format", "face", "program", "tape", "rules"].includes(cells[0])) header[cells[0]] = cells.slice(1).join("\t")
    else rows.push(line)
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
  const kind = row.split("\t")[0]
  switch (kind) {
    case "op": return mask.ops
    case "answer": case "failed": return mask.answers
    case "decide": return mask.decisions
    case "enter": case "leave": return mask.regions
    case "finalizer": return mask.finalizers
    case "done": return mask.outcome
    case "frontier": return mask.frontier
    default: throw new Error(`unknown row kind ${kind}`)
  }
}
const project = (mask, rows) => rows.filter((r) => keeps(mask, r))

const golden = parseGolden(readFileSync(goldenPath, "utf8"))
const masks = parseMasks(readFileSync(masksPath, "utf8"))
if (masks.length === 0) throw new Error("mask table drift: no mask rows")
const program = golden.header.program ?? "?"

// --- run the tail -----------------------------------------------------------
const temporary = mkdtempSync(join(tmpdir(), "effect4-trace-"))
let report
try {
  cpSync(target, temporary, { recursive: true })
  if (!existsSync(join(temporary, "node_modules"))) symlinkSync(nodeModules, join(temporary, "node_modules"), "dir")
  const run = spawnSync("node", ["--experimental-strip-types", "--no-warnings", tail], {
    cwd: temporary, encoding: "utf8", env: { ...process.env, EFFECT4_TAPE: golden.header.tape ?? "" }
  })
  if (run.status !== 0) throw new Error(`tail failed\n${run.stdout}${run.stderr}`)
  const last = run.stdout.trim().split("\n").pop()
  report = JSON.parse(last)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

if (report.tracerDefect) {
  console.log(`trace ${program} INVALID: tracer defect ${report.tracerDefect}`)
  process.exit(3)
}
if (report.yields !== 0 && report.expectYields !== true) {
  console.log(`trace ${program} INVALID: ${report.yields} scheduler yields in a single-fiber run`)
  process.exit(3)
}

// --- compare under each mask ------------------------------------------------
let failed = false
const results = {}
for (const mask of masks) {
  const expected = project(mask, golden.rows)
  const actual = project(mask, report.rows)
  let i = 0
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i += 1
  if (i === expected.length && i === actual.length) {
    console.log(`trace ${program} mask ${mask.name} ok (${expected.length} rows)`)
    results[mask.name] = "ok"
  } else {
    failed = true
    results[mask.name] = `diverges at row ${i}`
    console.log(`trace ${program} mask ${mask.name} DIVERGES at row ${i}`)
    console.log(`  expected: ${expected[i] ?? "<end>"}`)
    console.log(`  actual:   ${actual[i] ?? "<end>"}`)
    const frame = report.frames?.[Math.min(i, (report.frames?.length ?? 1) - 1)]
    if (frame) console.log(`  frame:    ${frame.op} at depth ${frame.depth}`)
  }
}

if (receiptPath) {
  const pinFile = existsSync(join(target, "host-pin.json")) ? JSON.parse(readFileSync(join(target, "host-pin.json"), "utf8")) : null
  const receipt = {
    format: "effect4-trace-receipt-v1",
    program, tape: golden.header.tape ?? "", rules: golden.header.rules ?? "",
    host: { ...seen, pin: pinFile, node: process.version, platform: `${process.platform}-${process.arch}`, patched: null },
    scheduler: { mode: "TapeScheduler", maxOpsBeforeYield: report.maxOpsBeforeYield, yields: report.yields, scheduled: report.scheduled },
    foreign: report.foreign ?? [],
    primitives: report.primitives,
    results
  }
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 1) + "\n")
}
process.exit(failed ? 1 : 0)
