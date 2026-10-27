#!/usr/bin/env bash
set -euo pipefail
work=${VAULTS_SECURITY_WORK:?Run desktop-security-prepare.sh and set VAULTS_SECURITY_WORK}
case "$(realpath "$work")" in /tmp/127v-desktop-security-*) ;; *) exit 1;; esac
mkdir -p "$work/source/node_modules/@127vaults" "$work/build/vite-temp" "$work/build/tmp"
ln -sfn ../../packages/domain "$work/source/node_modules/@127vaults/domain"
exec /usr/bin/timeout 120 /usr/bin/bwrap --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /bin /bin \
  --ro-bind /etc/alternatives /etc/alternatives --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$work/build" /scratch --ro-bind "$work/source" /source --ro-bind /opt/vaults-node24 /node \
  --ro-bind /home/vaults-dev/projects/127Vaults/node_modules/.pnpm /source/node_modules/.pnpm \
  --ro-bind /home/vaults-dev/projects/127Vaults/apps/desktop/node_modules /source/apps/desktop/node_modules \
  --ro-bind /home/vaults-dev/projects/127Vaults/packages/ui/node_modules /source/packages/ui/node_modules \
  --bind "$work/build/vite-temp" /source/node_modules/.vite-temp \
  --bind "$work/build/vite-temp" /source/apps/desktop/node_modules/.vite-temp \
  --chdir /source/apps/desktop --clearenv --setenv PATH /node/bin:/usr/bin:/bin \
  --setenv HOME /scratch/home --setenv TMPDIR /scratch/tmp --setenv NODE_OPTIONS --max-old-space-size=256 \
  --setenv RAYON_NUM_THREADS 2 --setenv UV_THREADPOOL_SIZE 2 \
  --setenv VAULTS_TEST_CACHE_DIR /scratch/vite-cache \
  /bin/bash -c 'ulimit -t 100; ulimit -u 96; ulimit -v 8388608; ulimit -n 512; node node_modules/typescript/bin/tsc --noEmit && node --test --test-concurrency=2 test/*.test.mjs && node node_modules/vite/bin/vite.js build --configLoader runner --outDir /scratch/desktop-dist'
