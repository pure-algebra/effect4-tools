// Export a TypeScript file's AST as (a) PTB bracketed constituency trees, one per top-level
// statement, with SyntaxKind names as categories and tokens as leaves; (b) CoNLL-U dependency
// rows with a head-percolation table, XPOS = token SyntaxKind, DEPREL = the parent property name.
import { createRequire } from "node:module"
import { readFileSync, writeFileSync } from "node:fs"
const require = createRequire(import.meta.url)
const ts = require("/Users/pooks/Dev/vsco-loupe/node_modules/typescript")
const [,, input, outBase] = process.argv
const text = readFileSync(input, "utf8")
const sf = ts.createSourceFile(input, text, ts.ScriptTarget.Latest, true)
const canonicalKind = new Map()
for (const [name, val] of Object.entries(ts.SyntaxKind)) if (typeof val === "number" && !/^(First|Last)[A-Z]/.test(name) && !canonicalKind.has(val)) canonicalKind.set(val, name)
const kindName = (k) => canonicalKind.get(k) ?? ts.SyntaxKind[k]
const isToken = (n) => n.kind < ts.SyntaxKind.FirstNode  // tokens and keywords have no children
const esc = (s) => s.replace(/\(/g, "-LRB-").replace(/\)/g, "-RRB-").replace(/\s+/g, "_") || "_EMPTY_"

// children in source order, including tokens (getChildren uses the scanner-backed tree)
const isJsDoc = (c) => c.kind >= ts.SyntaxKind.FirstJSDocNode && c.kind <= ts.SyntaxKind.LastJSDocNode
const kids = (n) => n.getChildren(sf).flatMap(c => c.kind === ts.SyntaxKind.SyntaxList ? c.getChildren(sf) : [c]).filter(c => !isJsDoc(c))

// PTB
function ptb(n) {
  if (isToken(n)) return `(${kindName(n.kind)} ${esc(n.getText(sf))})`
  const cs = kids(n).filter(c => c.kind !== ts.SyntaxKind.EndOfFileToken)
  if (cs.length === 0) return `(${kindName(n.kind)} ${esc(n.getText(sf))})`
  return `(${kindName(n.kind)} ${cs.map(ptb).join(" ")})`
}

// property name of a child inside its parent (the dependency relation vocabulary)
function roleOf(parent, child) {
  for (const key of Object.keys(parent)) {
    if (key === "parent" || key === "pos" || key === "end" || key === "flags" || key === "kind" || key === "modifierFlagsCache" || key === "transformFlags" || key === "id") continue
    const v = parent[key]
    if (v === child) return key
    if (Array.isArray(v) && v.includes(child)) return key
  }
  return "punct"
}

// head percolation: which child carries the head token of a node
const headProp = {
  CallExpression: "expression", PropertyAccessExpression: "name", ElementAccessExpression: "expression",
  YieldExpression: null /* the yield keyword itself */, AwaitExpression: null, ReturnStatement: null,
  VariableStatement: "declarationList", VariableDeclarationList: "declarations", VariableDeclaration: "name",
  ExpressionStatement: "expression", ParenthesizedExpression: "expression", ArrowFunction: "equalsGreaterThanToken",
  FunctionExpression: null, FunctionDeclaration: "name", ClassDeclaration: "name", HeritageClause: "types",
  ExpressionWithTypeArguments: "expression", TypeReference: "typeName", QualifiedName: "right",
  BinaryExpression: "operatorToken", Block: null, ImportDeclaration: null, ExportDeclaration: null,
  NewExpression: "expression", PropertyAssignment: "name", PropertySignature: "name", MethodDeclaration: "name",
  Parameter: "name", TypeLiteral: null, ObjectLiteralExpression: null, ArrayLiteralExpression: null,
  TemplateExpression: null, AsExpression: "expression", TypeAssertionExpression: "expression",
  ConditionalExpression: "questionToken", SpreadElement: "expression", ShorthandPropertyAssignment: "name",
  ImportClause: "namedBindings", NamedImports: "elements", ImportSpecifier: "name", FunctionType: "type",
  TypeParameter: "name", ArrayType: "elementType", UnionType: null, LiteralType: "literal", IndexedAccessType: "objectType",
}
let tokens = []  // {form, kind, node}
function collectTokens(n) {
  if (isToken(n)) { if (n.kind !== ts.SyntaxKind.EndOfFileToken) tokens.push({ form: n.getText(sf), kind: kindName(n.kind), node: n }); return }
  for (const c of kids(n)) collectTokens(c)
}
const headTokenCache = new Map()
function headToken(n) {
  if (!n) return null
  if (isToken(n)) return n
  if (headTokenCache.has(n)) return headTokenCache.get(n)
  const cs = kids(n)
  let h = null
  const prop = headProp[kindName(n.kind)]
  if (prop === null) h = cs.find(isToken) ?? cs[0]  // the node's own first token (yield, return, {, function, …)
  else if (prop && n[prop]) { const v = n[prop]; h = Array.isArray(v) ? (v[0] ?? cs[0]) : (v.kind !== undefined ? v : cs[0]) }
  else h = cs.find(c => !isToken(c)) ?? cs[0]
  const t = h ? headToken(h) : null
  headTokenCache.set(n, t)
  return t
}
const upos = (t) => /Keyword$/.test(t.kind) ? "KW" : t.kind === "Identifier" ? "IDENT" : /Literal|Template/.test(t.kind) ? "LIT"
  : /Token$/.test(t.kind) && /[A-Za-z]/.test(t.form) ? "OP" : /Token$/.test(t.kind) ? "PUNCT" : "X"

let ptbOut = [], conllu = []
let sid = 0
for (const st of sf.statements) {
  sid++
  ptbOut.push(`(Statement ${ptb(st)})`)
  tokens = []; collectTokens(st)
  const index = new Map(tokens.map((t, i) => [t.node, i + 1]))
  const rows = []
  for (const t of tokens) {
    // walk up to the nearest ancestor whose head token differs from this token; head = that ancestor's head
    let n = t.node, head = 0, rel = "root"
    while (n.parent && n.parent !== sf) {
      const p = n.parent
      const ph = headToken(p)
      if (ph && ph !== t.node) { head = index.get(ph) ?? 0; rel = roleOf(p, n); if (rel === "punct" && !isToken(n)) rel = kindName(n.kind).toLowerCase(); break }
      n = p
    }
    rows.push(`${index.get(t.node)}\t${t.form.replace(/\s+/g, "_")}\t_\t${upos(t)}\t${t.kind}\t_\t${head}\t${rel}\t_\t_`)
  }
  conllu.push(`# sent_id = ${sid}\n# text = ${st.getText(sf).split("\n")[0].slice(0, 80)}\n${rows.join("\n")}\n`)
}
writeFileSync(`${outBase}.ptb`, ptbOut.join("\n") + "\n")
writeFileSync(`${outBase}.conllu`, conllu.join("\n"))
console.log(`${input}: ${sf.statements.length} statements, ${ptbOut.join("").length} PTB bytes, ${conllu.join("").split("\n").length} CoNLL-U lines`)
