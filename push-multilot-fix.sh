#!/bin/bash
cd "$(dirname "$0")"
echo "=== Committing multi-lot EPO fix ==="
git add backend/app/api/epos.py
git commit -m "Fix reparse-all to expand multi-lot emails into separate EPOs

When an email says 'lots 21-23' or 'lots 25, 26, 27 and 28', the
reparse-all endpoint now creates individual EPO records for each lot
instead of only keeping the first lot number. Per-lot amounts are
calculated by dividing total by lot count. Duplicate lots are skipped."
echo ""
echo "=== Pushing to GitHub ==="
git push origin main
echo ""
echo "=== Done! ==="
