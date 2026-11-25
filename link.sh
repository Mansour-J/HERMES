#!/usr/bin/env bash
# Links this repo's customizations where they're read from, so they're used from here:
#   mods/<name>/            -> ~/.config/herdr-app/mods/<name>      (Herdr; $HERDR_APP_HOME)
#   layouts/<name>.json     -> ~/.config/herdr-app/layouts/<name>.json
#   claude/commands/<n>.md  -> ~/.claude/commands/<n>.md            (Claude Code; $CLAUDE_CONFIG_DIR)
#   claude/global.md        -> ~/.claude/CLAUDE.md                  (rules for every Claude Code session)
#
# Layouts, commands and claude/global.md are templates: each {{settings.<path>}} in them is filled in from your
# settings file (~/.config/hermes/settings.json; $HERMES_SETTINGS), which holds everything
# that's yours (AWS account, Jira site, work folders) and is never in this repo. The filled-in
# copies are kept in ~/.local/state/herder-customizations/build, and those are what's linked.
# A setting that's a list of lines is filled in as those lines; one that starts with ~/ is
# under your home folder. A setting the settings file doesn't have stops the run.
#
# Re-linking is also how Herdr is told to reload: it watches its own folder, not what a link
# points at, so an edit made here shows up once this runs (or by itself with --watch). So
# does an edit to a command or to the settings file: the copies are only filled in here.
#
#   ./link.sh           fill in and link, or re-link, everything (Herdr reloads it)
#   ./link.sh --watch   link everything, then re-link whatever you save here, until Ctrl-C
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
claude="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
settings="${HERMES_SETTINGS:-${XDG_CONFIG_HOME:-$HOME/.config}/hermes/settings.json}"
state="${XDG_STATE_HOME:-$HOME/.local/state}/herder-customizations"
backups="$state/backup"
build="$state/build"

if [ ! -f "$settings" ]; then
  echo "No settings file at $settings."
  echo "Copy settings.example.json there and put your own values in it:"
  echo "  mkdir -p '$(dirname "$settings")' && cp '$repo/settings.example.json' '$settings'"
  exit 1
fi
jq empty "$settings" 2>/dev/null || { echo "! $settings isn't valid JSON."; exit 1; }

# Fills in every {{settings.<path>}} in a string from the settings file.
FILL='
def value($k):
  ($s[0] | getpath($k | split("."))) as $v
  | if $v == null then error("\($k) isn'"'"'t in the settings file")
    elif ($v | type) == "array" then $v | join("\n")
    else $v | tostring end
  | if startswith("~/") then $home + .[1:] else . end;
def fill: gsub("\\{\\{settings\\.(?<k>[A-Za-z0-9_.-]+)\\}\\}"; value(.k));
'

# Layouts and commands are filled in; mods are linked as they are.
templated() { case "$1" in layouts/* | claude/commands/* | claude/global.md) return 0 ;; esac; return 1; }

# Fills in an item's copy, swapped in whole. A JSON file's settings are filled in as strings.
render() {
  local item="$1" out="$build/$1" err
  mkdir -p "$(dirname "$out")"
  case "$item" in
    *.json) err="$(jq --slurpfile s "$settings" --arg home "$HOME" "$FILL"' walk(if type == "string" then fill else . end)' "$repo/$item" 2>&1 >"$out.tmp")" ;;
    *) err="$(jq -Rjs --slurpfile s "$settings" --arg home "$HOME" "$FILL"' fill' "$repo/$item" 2>&1 >"$out.tmp")" ;;
  esac || { rm -f "$out.tmp"; echo "! Couldn't fill in $item: ${err#jq: error*: }"; exit 1; }
  mv -f "$out.tmp" "$out"
}

# Herdr writes these into every mod folder itself: never ours, never compared.
generated=(--exclude=gpui-kit.d.ts --exclude=jsconfig.json)

# Everything this repo customizes, one "item<TAB>where it's read from" a line.
items() {
  local d f
  for d in "$repo"/mods/*/; do [ -f "$d/main.js" ] && printf 'mods/%s\t%s\n' "$(basename "$d")" "$app/mods/$(basename "$d")"; done
  for f in "$repo"/layouts/*.json; do [ -f "$f" ] && printf 'layouts/%s\t%s\n' "$(basename "$f")" "$app/layouts/$(basename "$f")"; done
  for f in "$repo"/claude/commands/*.md; do [ -f "$f" ] && printf 'claude/commands/%s\t%s\n' "$(basename "$f")" "$claude/commands/$(basename "$f")"; done
  [ -f "$repo/claude/global.md" ] && printf 'claude/global.md\t%s\n' "$claude/CLAUDE.md"
  return 0
}

link() {
  local item="$1" dst="$2" src="$repo/$1"
  if templated "$item"; then src="$build/$item"; fi
  # A CLAUDE.md that isn't this link is your own rules: it's never moved or replaced.
  if [ "$item" = claude/global.md ] && { [ -e "$dst" ] || [ -L "$dst" ]; } && [ "$(readlink "$dst")" != "$src" ]; then
    echo "! $dst is your own, so it's left as it is. Add the rules in $src to it,"
    echo "  or move it away and run ./link.sh again."
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    # Something real is there: the original, or a file its program rewrote in place of the link.
    local backup
    backup="$backups/$(date +%Y%m%d-%H%M%S)/$item"
    if ! diff -rq "${generated[@]}" "$dst" "$src" >/dev/null 2>&1; then
      echo "! $item where it's read from differs from this repo. Kept it at:"
      echo "    $backup"
      echo "  Compare: diff -r ${generated[*]} '$backup' '$src'"
    fi
    mkdir -p "$(dirname "$backup")"
    mv "$dst" "$backup"
  fi
  # Swapped in with one rename, so Herdr sees its folder change and reloads it.
  local tmp
  tmp="$(dirname "$dst")/.$(basename "$dst").link-$$"
  ln -sfn "$src" "$tmp"
  mv -Tf "$tmp" "$dst"
  echo "linked $item"
}

mapfile -t all < <(items)
# Everything is filled in before anything is linked, so a missing setting changes nothing.
for line in "${all[@]}"; do item="${line%%$'\t'*}"; if templated "$item"; then render "$item"; fi; done
for line in "${all[@]}"; do link "${line%%$'\t'*}" "${line#*$'\t'}"; done

[ "${1:-}" = "--watch" ] || exit 0

# A fingerprint of an item's files (and the settings, for a template): when it changes, the
# item was saved.
stamp() {
  {
    find "$repo/$1" \( -name gpui-kit.d.ts -o -name jsconfig.json \) -prune -o -type f -printf '%T@ %s %p\n'
    if templated "$1"; then find "$settings" -printf '%T@ %s %p\n'; fi
  } 2>/dev/null | sort | md5sum
}
declare -A seen
for line in "${all[@]}"; do item="${line%%$'\t'*}"; seen[$item]="$(stamp "$item")"; done
echo "Watching $repo for saves (Ctrl-C to stop)."
while sleep 1; do
  mapfile -t all < <(items)
  for line in "${all[@]}"; do
    item="${line%%$'\t'*}"
    now="$(stamp "$item")"
    if [ "${seen[$item]:-}" != "$now" ]; then
      seen[$item]="$now"
      if templated "$item"; then render "$item"; fi
      link "$item" "${line#*$'\t'}"
    fi
  done
done
