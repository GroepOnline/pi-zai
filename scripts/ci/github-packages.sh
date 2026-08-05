#!/usr/bin/env bash
# GitHub Packages helper for @groeponline/* mirrors.
#
# Usage:
#   scripts/ci/github-packages.sh check
#   scripts/ci/github-packages.sh publish
#
# Env:
#   NODE_AUTH_TOKEN  — required (GITHUB_TOKEN with packages:read/write)
#   PACKAGE_NAME     — optional; defaults to package.json "name"
#   PACKAGE_VERSION  — optional; defaults to package.json "version"
#   GITHUB_OUTPUT    — when set (Actions), check writes published=true|false
#
# check always exits 0 and writes published=true|false to GITHUB_OUTPUT when set.
# On auth/network probe failure it warns and writes published=true (soft-skip)
# so a broken mirror never blocks callers; re-run when packages:write works.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

cmd="${1:-}"
if [ "$cmd" != "check" ] && [ "$cmd" != "publish" ]; then
	echo "usage: $0 check|publish" >&2
	exit 1
fi

if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
	echo "NODE_AUTH_TOKEN is required" >&2
	exit 1
fi

PACKAGE_NAME="${PACKAGE_NAME:-$(node -p "require('./package.json').name")}"
PACKAGE_VERSION="${PACKAGE_VERSION:-$(node -p "require('./package.json').version")}"
REGISTRY="https://npm.pkg.github.com"

userconfig="$(mktemp)"
cleanup() { rm -f "$userconfig"; }
trap cleanup EXIT

{
	printf '%s\n' "@groeponline:registry=${REGISTRY}"
	printf '%s\n' "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}"
} >"$userconfig"

write_published() {
	local value="$1"
	if [ -n "${GITHUB_OUTPUT:-}" ]; then
		printf 'published=%s\n' "$value" >>"$GITHUB_OUTPUT"
	fi
	printf 'github-packages published=%s (%s@%s)\n' "$value" "$PACKAGE_NAME" "$PACKAGE_VERSION"
}

case "$cmd" in
check)
	set +e
	out="$(npm view "$PACKAGE_NAME@$PACKAGE_VERSION" version --userconfig "$userconfig" --registry "$REGISTRY" --json 2>&1)"
	status=$?
	set -e

	if [ "$status" -eq 0 ]; then
		write_published true
		exit 0
	fi
	if printf '%s\n' "$out" | grep -Eqi 'E404|404 Not Found|code E404'; then
		write_published false
		exit 0
	fi

	printf '%s\n' "$out" >&2
	echo "::warning title=GitHub Packages check::Could not determine publish state; skipping GH Packages for this run." >&2
	write_published true
	exit 0
	;;
publish)
	if [ ! -f dist/index.js ]; then
		echo "dist/index.js missing; run the quality gate / npm run build first" >&2
		exit 1
	fi
	# Explicit --registry so publishConfig.registry (npmjs) cannot win.
	npm publish --access public --ignore-scripts --userconfig "$userconfig" --registry "$REGISTRY"
	;;
esac
