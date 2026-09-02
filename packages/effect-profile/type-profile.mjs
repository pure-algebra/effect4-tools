import { createRequire } from "node:module"
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
const require = createRequire(import.meta.url)
let ts = null
for (const p of [
  "/Users/pooks/Dev/vsco-loupe/node_modules/typescript",
  "/Users/pooks/Dev/foldlab/library/effects/node_modules/typescript",
  "/Users/pooks/Dev/effect-nlp/node_modules/typescript",
  "/Users/pooks/Dev/effect-smol/node_modules/typescript",
]) { try { ts = require(p); console.error("typescript from", p, ts.version); break } catch {} }
if (!ts) { console.error("NO typescript package"); process.exit(2) }

const dist = "/Users/pooks/Dev/foldlab/library/effects/node_modules/effect/dist"
const modules = ["Effect", "Layer", "Stream", "Scope", "Fiber", "Schema", "Context", "Ref", "Queue", "Deferred", "Exit", "Cause"]

function splitTopLevel(text) {
  const out = []; let depth = 0, cur = ""
  for (const ch of text) {
    if ("<([{".includes(ch)) depth++
    if (">)]}".includes(ch)) depth--
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = "" } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
function effectArgs(t) {
  const m = t.match(/^(?:Effect\.)?Effect<([\s\S]*)>$/)
  if (!m) return null
  const args = splitTopLevel(m[1])
  return { A: args[0] ?? "", E: args[1] ?? "never", R: args[2] ?? "never" }
}
function shape(x) {
  if (x === "never") return "never"
  if (/^Exclude</.test(x)) return "Exclude<…>"
  if (x.includes("|")) return "union"
  if (/^[A-Z][A-Za-z0-9]*$/.test(x)) return "single param"
  return "other"
}
const profile = {}
const examples = {}
for (const mod of modules) {
  const file = join(dist, `${mod}.d.ts`)
  let text; try { text = readFileSync(file, "utf8") } catch { continue }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const p = { exports: 0, values: 0, callSignatures: 0, dual: 0, returnsEffect: 0, returnsFn: 0,
    R: {}, E: {}, scopeInR: 0, scopeExcluded: 0, generator: 0, names: [] }
  const isExported = (n) => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) !== 0
  for (const st of sf.statements) {
    if (!isExported(st)) continue
    p.exports++
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        p.values++
        const name = d.name.getText(sf)
        const sigs = []
        if (d.type && ts.isTypeLiteralNode(d.type)) {
          for (const m of d.type.members) if (ts.isCallSignatureDeclaration(m)) sigs.push(m)
        } else if (d.type && ts.isFunctionTypeNode(d.type)) sigs.push(d.type)
        let hasDataLast = false, hasDataFirst = false
        for (const s of sigs) {
          p.callSignatures++
          const ret = s.type ? s.type.getText(sf) : ""
          const params = s.parameters.map(q => q.name.getText(sf))
          if (params[0] === "self") hasDataFirst = true
          if (/^<[^>]*>\s*\(self:|^\(self:/.test(ret)) { hasDataLast = true; p.returnsFn++ }
          const ea = effectArgs(ret.replace(/\s+/g, " "))
          if (ea) {
            p.returnsEffect++
            const rs = shape(ea.R), es = shape(ea.E)
            p.R[rs] = (p.R[rs] ?? 0) + 1; p.E[es] = (p.E[es] ?? 0) + 1
            if (/\bScope\b/.test(ea.R)) p.scopeInR++
            if (/Exclude<[^,]*,\s*Scope/.test(ea.R)) p.scopeExcluded++
            if (/Generator|YieldWrap|Iterator/.test(s.parameters.map(q => q.type ? q.type.getText(sf) : "").join(" "))) p.generator++
          }
          if (["gen", "fn", "provideService", "provide", "flatMap", "catchTag", "scoped", "fork", "forkChild", "succeed", "fail", "service", "effect", "merge"].includes(name) && !examples[`${mod}.${name}`]) {
            examples[`${mod}.${name}`] = { params: s.parameters.map(q => `${q.name.getText(sf)}: ${q.type ? q.type.getText(sf).replace(/\s+/g, " ").slice(0, 90) : "?"}`), returns: ret.replace(/\s+/g, " ").slice(0, 160) }
          }
        }
        if (hasDataFirst && hasDataLast) p.dual++
        p.names.push(name)
      }
    }
  }
  profile[mod] = p
}
for (const [mod, p] of Object.entries(profile)) {
  console.log(`${mod}: exports ${p.exports}, values ${p.values}, call signatures ${p.callSignatures}, dual ${p.dual}, returnsEffect ${p.returnsEffect}, returnsFn ${p.returnsFn}, scopeInR ${p.scopeInR}, scopeExcluded ${p.scopeExcluded}`)
  console.log(`   R shapes ${JSON.stringify(p.R)}  E shapes ${JSON.stringify(p.E)}`)
}
console.log("\nexamples:")
for (const [k, v] of Object.entries(examples)) console.log(`  ${k}(${v.params.join(", ")}) => ${v.returns}`)
writeFileSync("/private/tmp/claude-501/-Users-pooks-Dev-lean4-effect4/e9e3b20e-1d79-4057-8716-c17d6cc177fb/scratchpad/profile/type-profile.json", JSON.stringify({ profile, examples }, null, 1))

// ---- requirement / error algebra census: what each Effect combinator does to R and E ----
{
  const file = join(dist, "Effect.d.ts")
  const text = readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const isExported = (n) => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) !== 0
  const cls = { R: {}, E: {} }
  const members = { R: {}, E: {} }
  const classify = (before, after) => {
    const b = before.trim(), a = after.trim()
    if (a === b) return "neutral"
    if (a === "never") return "closes"
    if (new RegExp(`Exclude<\\s*${b}\\b`).test(a)) return "discharges"
    if (new RegExp(`(^|\\|)\\s*${b}\\s*(\\||$)`).test(a)) return "adds"
    if (a.includes(b)) return "transforms"
    return "replaces"
  }
  for (const st of sf.statements) {
    if (!isExported(st) || !ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      const name = d.name.getText(sf)
      const sigs = []
      if (d.type && ts.isTypeLiteralNode(d.type)) for (const m of d.type.members) if (ts.isCallSignatureDeclaration(m)) sigs.push(m)
      else if (d.type && ts.isFunctionTypeNode(d.type)) sigs.push(d.type)
      for (const s of sigs) {
        // find the self parameter (data-first) or the inner (self: …) => … (data-last)
        let selfType = null, ret = s.type ? s.type.getText(sf).replace(/\s+/g, " ") : ""
        const selfParam = s.parameters.find(q => q.name.getText(sf) === "self")
        if (selfParam && selfParam.type) selfType = selfParam.type.getText(sf).replace(/\s+/g, " ")
        else if (s.type && ts.isFunctionTypeNode(s.type)) {
          const inner = s.type.parameters.find(q => q.name.getText(sf) === "self")
          if (inner && inner.type) { selfType = inner.type.getText(sf).replace(/\s+/g, " "); ret = s.type.type.getText(sf).replace(/\s+/g, " ") }
        }
        if (!selfType) continue
        const before = effectArgs(selfType), after = effectArgs(ret)
        if (!before || !after) continue
        for (const ch of ["R", "E"]) {
          const c = classify(before[ch], after[ch])
          cls[ch][c] = (cls[ch][c] ?? 0) + 1
          ;(members[ch][c] ??= new Set()).add(name)
        }
        break
      }
    }
  }
  console.log("\nEffect combinators with a `self: Effect<A,E,R>` input, classified by what they do to the channel:")
  for (const ch of ["R", "E"]) {
    console.log(` ${ch}: ${JSON.stringify(cls[ch])}`)
    for (const [c, names] of Object.entries(members[ch])) console.log(`   ${c.padEnd(11)} ${[...names].slice(0, 28).join(", ")}${names.size > 28 ? " …" : ""}`)
  }
  writeFileSync("/private/tmp/claude-501/-Users-pooks-Dev-lean4-effect4/e9e3b20e-1d79-4057-8716-c17d6cc177fb/scratchpad/profile/channel-census.json",
    JSON.stringify({ R: Object.fromEntries(Object.entries(members.R).map(([k, v]) => [k, [...v]])), E: Object.fromEntries(Object.entries(members.E).map(([k, v]) => [k, [...v]])) }, null, 1))
}
