#!/bin/bash

echo "This will stop all services and delete all volumes for Suwali."
read -p "Are you sure you want to continue? [y/N]: " confirm

if [[ "$confirm" =~ ^[Yy]$ ]]; then
  echo "Stopping services and removing volumes..."
  docker compose -p suwali -f docker-compose-development.yml down --remove-orphans
  docker compose -p suwali -f docker-compose-development.yml down -v
  echo "Done."
else
  echo "Operation cancelled."
fi
