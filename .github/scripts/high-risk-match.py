#!/usr/bin/env python3
"""Decide whether any changed file matches a high-risk glob.

    high-risk-match.py <glob-file>   # changed paths on stdin, one per line

Exit 1 = high risk (a file matched, OR the question could not be answered).
Exit 0 = not high risk.

The exit codes are deliberately this way round: `review-evidence.sh` treats a
non-zero exit as "needs independent review", so every failure mode here asks for
MORE evidence rather than less.

WHY THIS IS NOT A BASH GLOB
---------------------------
`[[ $f == $pat ]]` has no `**`. The two stars collapse to a single `*`, which in
`[[ ]]` does cross `/` — so `a/**/b` ends up requiring at least one directory
between `a` and `b`, while GitHub's `**/` matches ZERO or more. Measured on this
repo: `packages/@prismalens/foo/src/crypto/key.ts` did not match
`packages/@prismalens/*/src/**/crypto/**`, though the same file one directory
deeper did. A credential file sitting directly under `src/` therefore skipped the
independence requirement — the file that most needs it.
"""
import re
import sys


def translate(glob: str) -> re.Pattern:
    """GitHub-style glob to an anchored regex.

    **/  zero or more whole directory components
    /**  trailing: the directory itself, or anything beneath it
    **   crosses separators
    *    does not cross separators
    ?    a single non-separator character
    """
    out: list[str] = []
    i, n = 0, len(glob)
    while i < n:
        if glob.startswith("**/", i):
            out.append("(?:[^/]+/)*")
            i += 3
        elif glob.startswith("/**", i) and i + 3 == n:
            out.append("(?:/.*)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return re.compile(r"\A" + "".join(out) + r"\Z")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: high-risk-match.py <glob-file>  (paths on stdin)", file=sys.stderr)
        return 1
    try:
        with open(sys.argv[1], encoding="utf-8") as fh:
            patterns = [
                (line.strip(), translate(line.strip()))
                for line in fh
                if line.strip() and not line.lstrip().startswith("#")
            ]
        # ONLY LINE ENDINGS COME OFF A PATH. `.strip()` here removed leading and
        # trailing whitespace, which is CONTENT in a filename: a file literally
        # named `secret ` stopped matching `secret?`, and the script reported not
        # high risk. Patterns above are different — that file is policy we author,
        # where surrounding whitespace is noise rather than meaning.
        files = [line.rstrip("\n\r") for line in sys.stdin]
        files = [f for f in files if f]
    except Exception as exc:  # unreadable list, malformed glob, undecodable input
        print(f"    glob matching failed ({exc}) — treating as high risk", file=sys.stderr)
        return 1

    if not patterns:
        print("    high-risk list is empty — treating as high risk", file=sys.stderr)
        return 1

    for path in files:
        for raw, rx in patterns:
            if rx.match(path):
                print(f"    high-risk: {path} matches {raw}", file=sys.stderr)
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
