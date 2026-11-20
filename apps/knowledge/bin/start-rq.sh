#!/bin/bash
set -e

# Download models
python init_models.py

# Start RQ workers
echo "Starting RQ workers..."
python rq_worker.py
