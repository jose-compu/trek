#!/usr/bin/env bash
# Clips every Trek logo from the identity board. Logos are never redrawn.
# Boxes are pixels in assets/brand/trek-identity.jpg (1024x687): name width height left top.
# The board background around each crop is flood-filled to transparent from the corners.
# Requires ImageMagick 7 (magick).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
identity="$root/assets/brand/trek-identity.jpg"
out="$root/assets/brand/logos"
fuzz="${TREK_BRAND_FUZZ:-9%}"

if ! command -v magick >/dev/null 2>&1; then
	echo "clip-brand-logos: magick not found (brew install imagemagick)" >&2
	exit 1
fi

size="$(magick identify -format '%wx%h' "$identity")"
if [[ "$size" != "1024x687" ]]; then
	echo "clip-brand-logos: expected a 1024x687 identity, got $size. Update the boxes." >&2
	exit 1
fi

mkdir -p "$out"

clip() {
	local name="$1" w="$2" h="$3" left="$4" top="$5"
	local right=$((w - 1)) bottom=$((h - 1))
	magick "$identity" -crop "${w}x${h}+${left}+${top}" +repage -alpha set -fuzz "$fuzz" -fill none \
		-draw "color 0,0 floodfill" -draw "color ${right},0 floodfill" \
		-draw "color 0,${bottom} floodfill" -draw "color ${right},${bottom} floodfill" \
		"PNG32:$out/$name.png"
	echo "$name.png ${w}x${h} at ${left},${top}"
}

clip mark-hero 100 100 14 8
clip lockup-dark-full 160 60 14 192
clip lockup-dark-white 160 60 180 192
clip lockup-dark-violet 160 60 343 192
clip lockup-light-full 160 60 527 192
clip lockup-light-black 160 60 690 192
clip lockup-light-violet 160 60 852 192
