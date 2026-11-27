#!/usr/bin/env bash
# Names TIde's .deb package "tide". Tauri names it after productName in kebab case, which turns
# "TIde" into "t-ide", and has no setting for it. The file keeps its name (TIde_<version>_amd64.deb);
# only the package inside is renamed. tauri.conf.json's deb "conflicts" and "replaces" on t-ide
# make installing it take the place of an installed t-ide. A .deb with an updater signature
# (.deb.sig) is signed again, since its bytes change.
# Usage: rename-deb.sh path/to/TIde_x.y.z_amd64.deb…  (needs dpkg-deb, and the signing key in the
# environment for a .deb that has a .sig)
set -euo pipefail
NAME=tide

for deb in "$@"; do
  work=$(mktemp -d)
  dpkg-deb --raw-extract "$deb" "$work"
  sed -i "s/^Package: .*/Package: $NAME/" "$work/DEBIAN/control"
  # gzip, as Tauri builds it, so every dpkg reads it.
  dpkg-deb --root-owner-group -Zgzip --build "$work" "$deb" >/dev/null
  rm -rf "$work"
  got=$(dpkg-deb --field "$deb" Package)
  if [ "$got" != "$NAME" ]; then
    echo "::error::$deb is still the package \"$got\", not \"$NAME\""
    exit 1
  fi
  if [ -f "$deb.sig" ]; then
    rm -f "$deb.sig"
    npx tauri signer sign "$deb"
  fi
  echo "$deb: package $got ($(dpkg-deb --field "$deb" Version)), conflicts/replaces: $(dpkg-deb --field "$deb" Conflicts)"
done
