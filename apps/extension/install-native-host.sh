#!/bin/sh
# User-scoped Chromium registration. Keep the executable at this stable path.
set -eu
if [ "$#" -lt 2 ]; then
  echo 'Usage: bash install-native-host.sh <host executable> <extension ID> [extension ID ...]' >&2
  exit 1
fi
exec python3 - "$@" <<'PY'
import json, os, pathlib, re, sys
host = pathlib.Path(sys.argv[1]).expanduser().resolve(strict=True)
ids = sys.argv[2:]
if not host.is_file() or not os.access(host, os.X_OK):
    raise SystemExit('Host must be an executable file.')
if any(not re.fullmatch('[a-p]{32}', value) for value in ids):
    raise SystemExit('Extension IDs must contain 32 letters a-p.')
manifest = dict(name='com.127vaults.connector', description='127Vaults local client connector',
    path=str(host), type='stdio', allowed_origins=['chrome-extension://' + value + '/' for value in ids])
if sys.platform == 'darwin':
    support = pathlib.Path.home() / 'Library' / 'Application Support'
    directories = [support / browser / 'NativeMessagingHosts' for browser in ['Google/Chrome', 'Chromium', 'Microsoft Edge']]
else:
    config = pathlib.Path(os.environ.get('XDG_CONFIG_HOME', str(pathlib.Path.home() / '.config')))
    directories = [config / browser / 'NativeMessagingHosts' for browser in ['google-chrome', 'chromium', 'microsoft-edge']]
for directory in directories:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / 'com.127vaults.connector.json'
    path.write_text(json.dumps(manifest, indent=2) + '\n')
    path.chmod(0o600)
    print('Registered', path)
PY
