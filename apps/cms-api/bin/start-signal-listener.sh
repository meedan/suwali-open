#!/bin/bash
set -e
exec bundle exec rails runner "SignalEventListener.new.run"
