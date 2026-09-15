#!/usr/bin/env bash
# Roda os cenários de segurança do acesso restrito contra firestore.rules no
# emulador oficial do Firestore (precisa de Java). Uso: bash scripts/rules-test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund --silent firebase-tools @firebase/rules-unit-testing firebase
cp ../../firestore.rules ./firestore.rules
cat > firebase.json <<'JSON'
{ "firestore": { "rules": "firestore.rules" }, "emulators": { "firestore": { "port": 8089 }, "ui": { "enabled": false } } }
JSON
npx firebase emulators:exec --only firestore --project wq-rules-test "node restricted-access.test.mjs" 2>&1 | grep -E "✅|❌|cenários"
