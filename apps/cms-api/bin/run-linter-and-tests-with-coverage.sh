#!/bin/bash
set -e
bundle exec rails db:reset
bundle exec standardrb
bundle exec brakeman --no-pager
bundle exec rspec
RAILS_ENV=development bundle exec rails db:prepare && RAILS_ENV=development bundle exec rails db:seed
