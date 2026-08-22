#!/usr/bin/env python3
"""
Fails if a component uses a class name that no stylesheet defines.

This project does not run Tailwind. `App.css` keeps a hand-written utility
layer, and a class that looks like a Tailwind utility but was never defined
here fails silently -- it reads as correct in review and does nothing in the
browser. Five real layout bugs have started this way; see `DOCS/ERRORS.md`.

    python3 scripts/check-css-classes.py

Exits non-zero and lists the offenders, grouped by file.
"""
import re
import sys
import pathlib
import collections

SRC = pathlib.Path(__file__).resolve().parent.parent / "apps/web/src"

# Class names that are attached from outside this stylesheet and so have no
# rule of their own to find.
IGNORED = {
    # lucide-react puts this on every icon it renders.
    "lucide",
}


def defined_classes() -> set[str]:
    found = set()
    for sheet in SRC.rglob("*.css"):
        for name in re.findall(r"\.((?:[-\w]|\\.|\\/)+)", sheet.read_text()):
            found.add(name.replace("\\", ""))
    return found


def used_classes(path: pathlib.Path):
    """Yields every class name in a file's className attributes.

    Covers the two spellings this codebase uses -- a plain string, and a
    template literal holding conditionals. For the template form the `${...}`
    expressions are searched for their own string literals, which is where the
    conditional class names live.
    """
    text = path.read_text()

    for match in re.finditer(r'className="([^"]*)"', text):
        yield from match.group(1).split()

    for match in re.finditer(r"className=\{`([^`]*)`\}", text):
        body = match.group(1)
        # The literal parts, minus the interpolations.
        for chunk in re.split(r"\$\{[^}]*\}", body):
            yield from chunk.split()
        # And the branches of the conditionals inside them.
        for expr in re.findall(r"\$\{([^}]*)\}", body):
            yield from _branches(expr)

    # className={cond ? "a" : "b"}, with no template literal involved.
    for match in re.finditer(r"className=\{([^}`]*)\}", text):
        yield from _branches(match.group(1))


def _branches(expr: str):
    """Yields class names from the result side of a conditional.

    Only what follows a `?`, `:`, `&&` or `||` counts. A literal before one of
    those is being compared against, not applied: in
    `type === 'recent' ? 'active' : ''` the class is `active`, not `recent`.
    """
    # `\?(?!\.)` so optional chaining -- `doc?.type` -- is not read as a ternary.
    for tail in re.split(r"\?(?!\.)|:|&&|\|\|", expr)[1:]:
        for literal in re.findall(r"['\"]([^'\"]*)['\"]", tail):
            yield from literal.split()


def main() -> int:
    defined = defined_classes()
    missing = collections.defaultdict(collections.Counter)

    for component in sorted(SRC.rglob("*.tsx")):
        for name in used_classes(component):
            if name not in defined and name not in IGNORED:
                missing[component.relative_to(SRC)][name] += 1

    if not missing:
        print(f"OK: every class used in {SRC.name} has a rule.")
        return 0

    total = set()
    for path, names in sorted(missing.items(), key=lambda kv: -sum(kv[1].values())):
        total |= set(names)
        print(f"\n{path}")
        for name, count in sorted(names.items()):
            print(f"  {name}  (x{count})")

    print(f"\n{len(total)} class names used with no matching rule.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
