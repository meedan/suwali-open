#!/bin/bash
set -e
test -f config/credentials.json || echo $GOOGLE_DRIVE_CREDENTIALS_JSON > config/credentials.json
if [ -z "$(tr -d '[:space:]' < config/credentials.json)" ]
then
  echo "File config/credentials.json is blank! See apps/cms-api/README.md for instructions!"
  exit 1
fi
