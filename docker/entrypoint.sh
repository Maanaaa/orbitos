#!/bin/sh
set -e
if [ ! -d /ssh ] || [ -z "$(ls -A /ssh 2>/dev/null)" ]; then
  echo "⚠  Aucun dossier SSH monté sur /ssh : monte ~/.ssh en lecture seule (voir docker-compose.yml)."
fi
nginx -t -q
nginx
echo "OrbitOS → http://${ORBIT_HOSTS%%,*}"
exec node server/index.js
