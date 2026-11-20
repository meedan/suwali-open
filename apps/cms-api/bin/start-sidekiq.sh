#!/bin/bash
set -e
ruby sidekiq_health.rb &
bundle exec sidekiq -C config/sidekiq.yml
