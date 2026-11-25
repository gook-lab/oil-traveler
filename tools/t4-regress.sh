#!/bin/sh
# The T4 regression set, run after a merge of the streets, bridges, skyline or intro branches into feat/buildings:
# the collisions (a palace podium, a mountain's trees), the bridge decks walked, the six places' buildings and their
# problems, the streets, the intro and the map. Each headless Chrome runs inside the GPU lock. Needs `npm run build`
# and CHROME (see CLAUDE.md). Writes the stills to <out> (default shots/t4-regress) and prints one result a check.
#   tools/t4-regress.sh [out]
set -u
cd "$(dirname "$0")/.."
OUT="${1:-shots/t4-regress}"
LOCK=tools/with-gpu-lock.sh
echo "== collide gyeongbokgung"
timeout 600 $LOCK node tools/probe.mjs --query "scene=travel&place=37.5788,126.9770&clean" --eval "$(cat tools/collide-check.js)" 2>&1 | tail -1
echo "== collide bukhansan"
timeout 600 $LOCK node tools/probe.mjs --query "scene=travel&place=37.6588,126.9772&clean" --eval "$(cat tools/collide-check.js)" 2>&1 | tail -1
echo "== bridges walk (banpo · hangang)"
for p in 37.5126,126.9960 37.5170,126.9590; do
  timeout 600 $LOCK node tools/probe.mjs --query "scene=travel&place=$p&clean" --eval "$(cat tools/bridges-walk.js)" 2>&1 | tail -1 | cut -c1-400
done
echo "== buildings"
timeout 2400 $LOCK node tools/buildings-check.mjs --out "$OUT" 2>&1 | grep -o '"problems":\[[^]]*\]' | sort | uniq -c
echo "== streets"
timeout 1800 $LOCK node tools/streets-check.mjs 2>&1 | grep -o '"place":"[a-z]*"\|"problems":\[[^]]*\]' | paste - -
echo "== intro"
timeout 600 $LOCK node tools/intro-check.mjs 2>&1 | tail -1
echo "== travel"
timeout 600 $LOCK node tools/travel-check.mjs 2>&1 | tail -1
echo DONE
