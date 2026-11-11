#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Use Node 22. Run nvm use first.')"
python3 -m venv --without-pip .venv
python3 -m pip --python .venv install pip==25.3
.venv/bin/python -m pip install -r requirements.lock
npm ci
PATH="$PWD/.venv/bin:$PATH" python3 scripts/contracts.py lint
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  printf '%s\n' 'Created private .env. Add your service credentials, then run npm run db:migrate and npm run dev.'
  exit 0
fi
npm run db:migrate
printf '%s\n' 'Ready. Run npm run dev for the workspace and npm run worker for continuous delivery.'
