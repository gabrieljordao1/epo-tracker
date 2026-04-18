#!/bin/bash
cd "$(dirname "$0")"
echo "=== Committing email sync fix ==="
git add backend/app/api/email_sync.py backend/app/services/gmail_sync.py
git commit -m "Fix email sync to actually fetch and parse emails through Gemini pipeline

The /api/email/sync endpoint was a stub that only updated timestamps.
Now it decrypts OAuth tokens, fetches from Gmail IMAP, and runs each
email through the Gemini parser pipeline to create EPOs.

Also broadened Gmail search keywords (paint, drywall, lot, touch-up, PO)."
echo ""
echo "=== Pushing to GitHub ==="
git push origin main
echo ""
echo "=== Done! Railway should auto-deploy. ==="
read -p "Press Enter to close..."
