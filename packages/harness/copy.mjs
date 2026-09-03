// The one rule for staging a harness directory in a temp copy.
//
// A run reads the harness's `.ts` sources, its `tsconfig.json`, its
// `host-pin.json`, and whatever data files a tail opens beside them. It never
// reads the directories the harness *writes*: `receipts/` and `types/` are
// outputs of earlier runs, and `patched/_copy` is a gitignored patched copy of
// the pinned package tree -- 51 MB of the 52 MB that `harness/trace` measures.
// Copying those meant every one of the ~135 node runs a full host sweep makes
// staged a tree it would not open (effect4 survey finding H1).
//
// The patched runs are unaffected: `check-trace-patched.sh` points
// EFFECT4_EFFECT_NODE_MODULES and EFFECT4_PATCHED at absolute paths in the
// original directory, not at anything inside the copy.
import { cpSync, existsSync, symlinkSync } from "node:fs"
import { join, relative, sep } from "node:path"

/** Directories, relative to the harness root, that no run reads. */
export const notCopied = new Set(["patched", "receipts", "types", "node_modules"])

/**
 * Copy `target` into `temporary`, skipping the written-only directories, and
 * link the pinned installation in as `node_modules` when the harness has none
 * of its own.
 */
export const stageHarness = (target, temporary, nodeModules) => {
  cpSync(target, temporary, {
    recursive: true,
    filter: (source) => {
      const path = relative(target, source)
      if (path === "") return true
      return !notCopied.has(path.split(sep)[0])
    }
  })
  if (!existsSync(join(temporary, "node_modules"))) {
    symlinkSync(nodeModules, join(temporary, "node_modules"), "dir")
  }
}
