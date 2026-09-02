import re, json, os, glob, collections
SRC = os.path.expanduser("~/Dev/foldlab/library/effects/node_modules/effect/src")
rows = []
block_re = re.compile(r"/\*\*((?:(?!\*/).)*)\*/\s*\n(export (?:const|function|class|interface|type|namespace|declare const|abstract class) ([A-Za-z_$][\w$]*))", re.S)
for path in sorted(glob.glob(os.path.join(SRC, "*.ts"))):
    mod = os.path.basename(path)[:-3]
    text = open(path, encoding="utf8").read()
    for m in block_re.finditer(text):
        body = m.group(1)
        lines = [re.sub(r"^\s*\*\s?", "", l) for l in body.split("\n")]
        doc = "\n".join(lines).strip()
        # summary = first paragraph before a blank line or a ** header or @tag
        summary = re.split(r"\n\s*\n|\n\*\*|\n@", doc, maxsplit=1)[0].strip().replace("\n", " ")
        cat = re.search(r"@category ([^\n]+)", doc); since = re.search(r"@since ([^\n]+)", doc)
        wtu = re.search(r"\*\*When to use\*\*\s*\n\s*\n(.*?)(?:\n\s*\n\*\*|\n@|$)", doc, re.S)
        details = re.search(r"\*\*Details\*\*\s*\n\s*\n(.*?)(?:\n\s*\n\*\*|\n@|$)", doc, re.S)
        examples = re.findall(r"\*\*Example\*\*\s*(?:\(([^)]*)\))?\s*\n\s*\n```ts[^\n]*\n(.*?)```", doc, re.S)
        rows.append({"module": mod, "name": m.group(3), "kind": m.group(2).split()[1], "category": cat.group(1).strip() if cat else None,
                     "since": since.group(1).strip() if since else None, "summary": summary[:300],
                     "whenToUse": wtu.group(1).strip().replace("\n"," ")[:300] if wtu else None,
                     "details": details.group(1).strip().replace("\n"," ")[:300] if details else None,
                     "examples": [{"title": t, "code": c} for t, c in examples], "internal": "@internal" in doc})
json.dump(rows, open(os.path.join(os.path.dirname(__file__), "api-docs.json"), "w"), indent=1)
by_mod = collections.Counter(r["module"] for r in rows)
print("documented exports:", len(rows), "modules:", len(by_mod))
print("with summary:", sum(1 for r in rows if r["summary"]), "with whenToUse:", sum(1 for r in rows if r["whenToUse"]),
      "with details:", sum(1 for r in rows if r["details"]), "with >=1 example:", sum(1 for r in rows if r["examples"]),
      "total examples:", sum(len(r["examples"]) for r in rows), "internal:", sum(1 for r in rows if r["internal"]))
print("kinds:", collections.Counter(r["kind"] for r in rows).most_common())
print("top modules:", by_mod.most_common(10))
print("\n--- Effect.ts samples ---")
for r in [r for r in rows if r["module"] == "Effect" and r["name"] in ("gen","fn","flatMap","provideService","catchTag","scoped","fork","succeed","fail","acquireRelease")]:
    print(f"{r['name']:16s} [{r['category']}] since {r['since']}: {r['summary'][:110]}")
    if r["whenToUse"]: print(f"{'':16s}   when: {r['whenToUse'][:120]}")
    print(f"{'':16s}   examples: {len(r['examples'])} {[e['title'] for e in r['examples']][:3]}")
# summary verb profile: first word of summary
first = collections.Counter((r["summary"].split() or [""])[0].rstrip(",.").lower() for r in rows if r["summary"])
print("\nsummary first words:", first.most_common(25))
