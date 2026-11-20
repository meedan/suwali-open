#!/bin/bash
set -e

check_env_consistency() {
  local sample_file="$1"
  local target_file="$2"

  if [ ! -f "$target_file" ]; then
    echo "Copying $sample_file to $target_file"
    cp "$sample_file" "$target_file"
    return
  fi

  # Extract keys from sample and target files
  sample_keys=$(grep -v '^\s*#' "$sample_file" | grep '=' | cut -d= -f1 | sort | uniq)
  target_keys=$(grep -v '^\s*#' "$target_file" | grep '=' | cut -d= -f1 | sort | uniq)

  # Check for new keys in sample not in target
  new_keys=$(comm -23 <(echo "$sample_keys") <(echo "$target_keys"))

  if [ -n "$new_keys" ]; then
    echo "ERROR: $target_file is missing the following new variables from $sample_file:"
    echo "$new_keys"
    echo "Check the sample file $sample_file and update your file $target_file. Instructions in the README file."
    exit 1
  else
    echo "$target_file is up to date with $sample_file (no new variables found)"
  fi
}

check_env_consistency apps/cms-api/.env.sample apps/cms-api/.env
check_env_consistency apps/frontend/.env.sample apps/frontend/.env
check_env_consistency apps/knowledge/.env.sample apps/knowledge/.env

MODE="dev"
YAGO_FLAG=""

for arg in "$@"; do
  case $arg in
    --with-yago)
      YAGO_FLAG="--profile yago"
      ;;
    test|dev)
      MODE="$arg"
      ;;
  esac
done

if [ "$MODE" = "test" ]; then
  echo "Starting Suwali in TEST mode..."
  docker compose -p suwali -f docker-compose-development.yml -f docker-compose-development-sidekiq.override.yml -f docker-compose-test.yml $YAGO_FLAG up --build --abort-on-container-exit --remove-orphans
else
  echo "Starting Suwali in DEV mode..."
  docker compose -p suwali -f docker-compose-development.yml -f docker-compose-development-sidekiq.override.yml $YAGO_FLAG up --build --abort-on-container-exit --remove-orphans
fi
