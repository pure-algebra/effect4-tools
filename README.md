# effect4-tools

TypeScript-side tooling for the pure-algebra Lean family. The Lean packages
generate; these check, parse, and profile.

| Package | What it does |
| --- | --- |
| `@pure-algebra/harness` | `effect4-check <dir>`: unpatched `tsc`, `@effect/tsgo` strict diagnostics, and a node run of `tail.ts`, all against an exact host pin |
| `@pure-algebra/ast-export` | parse TypeScript with the compiler and export PTB and CoNLL-U for lean4-nlp |
| `@pure-algebra/effect-profile` | JSDoc API rows and examples, the A/E/R channel census, the v3 to v4 rename table, the tsgo rule catalog |

Node 22. `EFFECT4_EFFECT_NODE_MODULES` points at an exact installation of
`effect@4.0.0-rc.112`, `typescript@7.0.2`, and `@effect/tsgo@0.38.0`.

MIT.
