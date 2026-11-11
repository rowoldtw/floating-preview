#!/bin/sh
# Builds Muta's native parts for this Mac and installs it into a
# vault: ./scripts/install.sh "/path/to/vault"
#
# The vault's plugin folder links back here, so `git pull` and running this
# again updates it. Then enable "Muta" in Obsidian's community
# plugins (reload Obsidian first if it was already open).
set -eu

vault=${1:?usage: scripts/install.sh /path/to/vault}
here=$(cd "$(dirname "$0")/.." && pwd)

[ -d "$vault/.obsidian" ] || { echo "No .obsidian folder in $vault: is it a vault?" >&2; exit 1; }
command -v swiftc >/dev/null || { echo "Needs the Xcode command line tools: xcode-select --install" >&2; exit 1; }

echo "Building the trackpad helper and the glass module…"
swiftc -O "$here/pip-helper.swift" -o "$here/pip-helper"
clang -bundle -undefined dynamic_lookup -fobjc-arc -O2 \
  -framework AppKit -framework QuartzCore "$here/glass.m" -o "$here/glass.node"

target="$vault/.obsidian/plugins/muta"
mkdir -p "$vault/.obsidian/plugins"
if [ -e "$target" ] && [ ! -L "$target" ]; then
  echo "$target already exists and isn't a link to this folder; move it aside first." >&2
  exit 1
fi
ln -sfn "$here" "$target"
echo "Installed into $target"
