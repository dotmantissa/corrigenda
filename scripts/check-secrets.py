"""Check staged blobs against local credentials without printing their values."""
import json
import re
import subprocess
from pathlib import Path

secrets: set[bytes] = set()
environment = Path('.env')
if environment.exists():
    for line in environment.read_text().splitlines():
        key, _, value = line.partition('=')
        if re.search(r'SECRET|PRIVATE_KEY|ENCRYPTION_KEY|DATABASE_URL', key):
            value = value.strip().strip('"\'')
            if len(value) >= 16:
                secrets.add(value.encode())
consumer_keys = Path('.env.consumer-keys')
if consumer_keys.exists():
    secrets.update(value.encode() for value in json.loads(consumer_keys.read_text()).values())
credentials = Path('.git/credentials')
if credentials.exists():
    for token in re.findall(r'ghp_[A-Za-z0-9]+', credentials.read_text()):
        secrets.add(token.encode())
paths = subprocess.check_output(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split(b'\0')
failed = []
for raw in paths:
    if not raw:
        continue
    path = raw.decode()
    blob = subprocess.check_output(['git', 'show', ':' + path])
    if any(secret in blob for secret in secrets) or re.search(rb'(?:ghp_[A-Za-z0-9]{30,}|privy_app_secret_[A-Za-z0-9]{30,}|npg_[A-Za-z0-9]{10,})', blob):
        failed.append(path)
    if Path(path).name.lower() in ('tasks.md', 'agent.md', 'agents.md'):
        failed.append(path)
if failed:
    raise SystemExit('Refusing credential or instruction file publication: ' + ', '.join(sorted(set(failed))))
print(f'Credential scan passed for {len([p for p in paths if p])} staged files.')
