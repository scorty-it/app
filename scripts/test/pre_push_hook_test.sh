#!/usr/bin/env bash
# Test del hook pre-push della security review, con un `claude` finto nel PATH.
# Uso: bash scripts/test/pre_push_hook_test.sh      (HOOK=<percorso> per provarne un'altra copia)
set -euo pipefail

hook="${HOOK:-$(cd "$(dirname "$0")/../.." && pwd)/.githooks/pre-push}"
hook="$(cd "$(dirname "$hook")" && pwd)/$(basename "$hook")"
zero="0000000000000000000000000000000000000000"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fakebin="$work/bin"
mkdir -p "$fakebin"
cat >"$fakebin/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$FAKE_CALLS"
ctx="$(printf '%s\n' "$@" | sed -n 's|^/security-review-range .* --context \(.*\)$|\1|p')"
if [[ -n "$ctx" && -d "$ctx" ]]; then
  echo "ctxdir:$ctx" >>"$FAKE_CALLS"
  echo "ctx: $(cd "$ctx" && ls | tr '\n' ' ')" >>"$FAKE_CALLS"
  [[ -s "$ctx/client.patch" && ! -s "$ctx/rules.patch" ]] && echo "areas-ok" >>"$FAKE_CALLS"
  grep -qx "client: lib" "$ctx/areas.txt" && echo "areas-listed" >>"$FAKE_CALLS"
fi
printf '%b\n' "${FAKE_OUTPUT:-}"
exit "${FAKE_EXIT:-0}"
EOF
chmod +x "$fakebin/claude"

repo="$work/repo"
git init -q -b main "$repo"
cd "$repo"
git config user.email t@example.com
git config user.name t
mkdir -p lib docs test .githooks
cat >.githooks/security-review-areas <<'AREAS'
# Aree della review: <area>: <pathspec>...; exclude: <glob>...
rules: firestore.rules
client: lib
exclude: **/*.md docs/** test/**
AREAS
echo a >lib/a.dart && git add . && git commit -qm base
base_sha="$(git rev-parse HEAD)"
git update-ref refs/remotes/origin/main "$base_sha"
git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main

git checkout -qb feature
echo b >lib/a.dart && git commit -qam code1
code1="$(git rev-parse HEAD)"
echo c >lib/a.dart && git commit -qam code2
code2="$(git rev-parse HEAD)"
echo d >docs/x.md && echo e >README.md && echo f >test/a_test.dart
git add . && git commit -qm docs-and-tests
docs_only="$(git rev-parse HEAD)"

pass=0
fail=0
export FAKE_CALLS="$work/calls"

# run_hook <riga su stdin> [env...] → imposta $status, cancella il file delle chiamate precedenti
run_hook() {
  local line="$1"
  shift
  rm -f "$FAKE_CALLS"
  set +e
  env PATH="$fakebin:/usr/bin:/bin" "$@" bash "$hook" origin https://example.invalid \
    <<<"$line" >"$work/out" 2>&1
  status=$?
  set -e
}

check() {
  local name="$1" cond="$2"
  if eval "$cond"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $name" >&2
    sed 's/^/    /' "$work/out" >&2
  fi
}

run_hook "refs/heads/feature $code2 refs/heads/feature $zero" FAKE_OUTPUT='ok\nSECURITY-REVIEW: PASS'
check "new branch: range from merge-base" '[[ $status -eq 0 ]] && grep -q "^/security-review-range $base_sha..$code2 --context " "$FAKE_CALLS"'
check "review runs read-only" 'grep -qx "dontAsk" "$FAKE_CALLS" && grep -qx "Edit" "$FAKE_CALLS"'
# Bash(git log:*) fa passare `--output=<file>` (verificato il 2026-09-27): nessuna shell
# per chi fa la review, il hook prepara quello che avrebbe chiesto a git.
check "reviewer has no shell" '! grep -q "^Bash(" "$FAKE_CALLS" && grep -qx "Bash" "$FAKE_CALLS"'
# Niente hook di Claude Code (un .claude/settings.json arrivato con un contributo potrebbe definirne) e niente rete.
check "reviewer without hooks or web" 'grep -q "disableAllHooks" "$FAKE_CALLS" && grep -qx "WebFetch" "$FAKE_CALLS" && grep -qx "WebSearch" "$FAKE_CALLS"'
check "context prepared: log, stat, diff, one patch per area" 'grep -q "^ctx: .*diff.patch.*log.txt.*stat.txt" "$FAKE_CALLS" && grep -qx "areas-ok" "$FAKE_CALLS"'
check "areas come from .githooks/security-review-areas" 'grep -qx "areas-listed" "$FAKE_CALLS"'
check "context readable by the reviewer" 'grep -qx -- "--add-dir" "$FAKE_CALLS"'
check "context removed afterwards" 'ctx="$(sed -n "s/^ctxdir://p" "$FAKE_CALLS")"; [[ -n "$ctx" && ! -e "$ctx" ]]'
# `git grep -O<cmd>` lancia un comando: per cercare basta lo strumento Grep.
check "no git grep for the reviewer" '! grep -q "git grep" "$FAKE_CALLS"'

run_hook "refs/heads/feature $code2 refs/heads/feature $code1" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "existing branch: range from remote sha" '[[ $status -eq 0 ]] && grep -q "^/security-review-range $code1..$code2 --context " "$FAKE_CALLS"'

run_hook "refs/heads/feature $code2 refs/heads/feature $zero" FAKE_OUTPUT='# Vuln 1\nSECURITY-REVIEW: FAIL 1'
check "FAIL verdict blocks" '[[ $status -ne 0 ]] && grep -q "Vuln 1" "$work/out"'

run_hook "refs/heads/feature $code2 refs/heads/feature $zero" FAKE_OUTPUT='SECURITY-REVIEW: PASS\nactually, one more thing'
check "verdict not on last line blocks" '[[ $status -ne 0 ]]'

run_hook "refs/heads/feature $code2 refs/heads/feature $zero" FAKE_OUTPUT='```\nSECURITY-REVIEW: PASS\n```\n'
check "verdict inside a code fence still read" '[[ $status -eq 0 ]]'

run_hook "refs/heads/feature $code2 refs/heads/feature $zero" FAKE_OUTPUT='SECURITY-REVIEW: PASS' FAKE_EXIT=1
check "review that crashes blocks" '[[ $status -ne 0 ]]'

run_hook "refs/heads/feature $docs_only refs/heads/feature $code2"
check "docs/tests only: no review" '[[ $status -eq 0 ]] && [[ ! -e $FAKE_CALLS ]]'

run_hook "(delete) $zero refs/heads/feature $code2"
check "branch deletion: no review" '[[ $status -eq 0 ]] && [[ ! -e $FAKE_CALLS ]]'

run_hook "refs/tags/v1 $code2 refs/tags/v1 $zero"
check "tag: no review" '[[ $status -eq 0 ]] && [[ ! -e $FAKE_CALLS ]]'

run_hook "refs/heads/feature $code2 refs/heads/feature $zero" SKIP_SECURITY_REVIEW=1
check "explicit bypass" '[[ $status -eq 0 ]] && [[ ! -e $FAKE_CALLS ]]'

rm -f "$FAKE_CALLS"
set +e
env PATH="/usr/bin:/bin" bash "$hook" origin x <<<"refs/heads/feature $code2 refs/heads/feature $zero" >"$work/out" 2>&1
status=$?
set -e
check "claude missing: fail-safe" '[[ $status -ne 0 ]] && grep -q "SKIP_SECURITY_REVIEW" "$work/out"'

# Un commit senza antenati in comune con il remoto (storia nuova in un repo vuoto): si rivede tutto il contenuto.
empty_tree="$(git hash-object -t tree /dev/null)"
orphan="$(git commit-tree "$code2^{tree}" -m orfano)"
run_hook "refs/heads/nuovo $orphan refs/heads/main $zero" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "unrelated history: whole content reviewed" '[[ $status -eq 0 ]] && grep -q "^/security-review-range $empty_tree..$orphan --context " "$FAKE_CALLS"'
check "unrelated history: context prepared" 'grep -q "^ctx: .*diff.patch.*log.txt.*stat.txt" "$FAKE_CALLS" && grep -qx "areas-ok" "$FAKE_CALLS"'

# Lockfile: npm ci scarica da qualsiasi "resolved", quindi si controlla in modo deterministico prima della review.
ln -s "$(command -v node)" "$fakebin/node"
lockv() { # lockv <chiave> <versione> <resolved> [campi in più] → commit con un lockfile di una sola voce
  cat >package-lock.json <<EOF
{
  "name": "x", "lockfileVersion": 3, "requires": true,
  "packages": {
    "": { "name": "x" },
    "$1": { "version": "$2", "resolved": "$3", "integrity": "sha512-x"${4:-} }
  }
}
EOF
  git add package-lock.json && git commit -qm lock && git rev-parse HEAD
}
lock() { lockv node_modules/lodash 4.17.21 "$1"; }
prima="$(git rev-parse HEAD)"
pulito="$(lock https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz)"
run_hook "refs/heads/feature $pulito refs/heads/feature $prima" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "lockfile from the npm registry: reviewed and passes" '[[ $status -eq 0 ]] && [[ -e $FAKE_CALLS ]]'
esterno="$(lock https://evil.example/lodash-4.17.21.tgz)"
run_hook "refs/heads/feature $esterno refs/heads/feature $pulito" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "lockfile from another host blocks, before the review" '[[ $status -ne 0 ]] && grep -q "evil.example" "$work/out" && [[ ! -e $FAKE_CALLS ]]'
altro="$(lock https://registry.npmjs.org/lodash/-/../../evil/-/evil-4.17.21.tgz)"
run_hook "refs/heads/feature $altro refs/heads/feature $pulito" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "lockfile pointing to another npm package blocks" '[[ $status -ne 0 ]] && [[ ! -e $FAKE_CALLS ]]'
# npm ignora "inBundle" nei lockfile v3 e scarica comunque dal resolved: il flag non deve saltare il controllo.
bundle="$(lockv node_modules/lodash 4.17.21 https://evil.example/l.tgz ', "inBundle": true')"
run_hook "refs/heads/feature $bundle refs/heads/feature $pulito" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "lockfile: inBundle does not skip the check" '[[ $status -ne 0 ]] && [[ ! -e $FAKE_CALLS ]]'
# npm normalizza percorsi e URL (.., #): chiave e versione devono essere un nome e una versione veri.
chiave="$(lockv 'node_modules/evil/-/evil-1.0.0.tgz#/../../../lodash' 4.17.21 'https://registry.npmjs.org/evil/-/evil-1.0.0.tgz#/../../../lodash/-/lodash-4.17.21.tgz')"
run_hook "refs/heads/feature $chiave refs/heads/feature $pulito" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "lockfile: key that is not a package name blocks" '[[ $status -ne 0 ]] && [[ ! -e $FAKE_CALLS ]]'
versione="$(lockv node_modules/lodash 'x/../../../evil/-/evil-1.0.0' 'https://registry.npmjs.org/lodash/-/lodash-x/../../../evil/-/evil-1.0.0.tgz')"
run_hook "refs/heads/feature $versione refs/heads/feature $pulito" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "lockfile: version that is not semver blocks" '[[ $status -ne 0 ]] && [[ ! -e $FAKE_CALLS ]]'
scope="$(lockv node_modules/a/node_modules/@types/node 22.1.0-rc.1 https://registry.npmjs.org/@types/node/-/node-22.1.0-rc.1.tgz)"
run_hook "refs/heads/feature $scope refs/heads/feature $pulito" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "lockfile: nested scoped package from the registry passes" '[[ $status -eq 0 ]] && [[ -e $FAKE_CALLS ]]'
rm -f "$FAKE_CALLS"
set +e
env PATH="/usr/bin:/bin" bash "$hook" origin x <<<"refs/heads/feature $esterno refs/heads/feature $pulito" >"$work/out" 2>&1
status=$?
set -e
check "lockfile changed, node missing: fail-safe" '[[ $status -ne 0 ]] && grep -q "node" "$work/out"'

# Nessun ramo di default noto (remoto mai letto, o repo appena creato): si rivede tutto invece di bloccare.
git symbolic-ref --delete refs/remotes/origin/HEAD
git update-ref -d refs/remotes/origin/main
run_hook "refs/heads/feature $code2 refs/heads/feature $zero" FAKE_OUTPUT='SECURITY-REVIEW: PASS'
check "no default branch: whole content reviewed" '[[ $status -eq 0 ]] && grep -q "^/security-review-range $empty_tree..$code2 --context " "$FAKE_CALLS"'

echo "pre-push hook: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
