#!/usr/bin/env bash
# Stop hook: before Claude stops, force one "is this a black box?" pass.
# Skips if we're already continuing because of this hook (stop_hook_active) to avoid loops.
input=$(cat)
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi
jq -n --arg r "BLACK-BOX CHECK (project rule: WE DON'T WANT A BLACK BOX). Before stopping, answer briefly to the user: is anything you just built, ran or claimed a black box? For every number, score, weight, ranking or shopper decision you produced or reported this turn, state where it traces to: an Open Food Facts field (barcode+field), a Jev probability (question + answer), a Reddit verbatim (thread URL), a paper/URL, real sales data (data/sales), or an explicitly labelled assumption. If anything can't be traced, say so plainly and explain it (or fix it). If nothing numeric was produced this turn, say 'no black boxes this turn' in one line." '{decision:"block", reason:$r}'
