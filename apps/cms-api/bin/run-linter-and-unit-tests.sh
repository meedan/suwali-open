#!/bin/bash
set -e
bundle exec standardrb
bundle exec brakeman --ignore-config config/brakeman.ignore --no-pager
bundle exec rspec spec/units --require ./spec/unit_spec_helper
