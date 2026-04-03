#!/bin/bash

# EPO Tracker Backend - Quick Start Script

set -e

echo "=========================================="
echo "EPO Tracker Backend - Quick Start"
echo "=========================================="
echo ""

# Check Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed"
    exit 1
fi

echo "Python version:"
python3 --version
echo ""

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -q -r requirements.txt

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "Creating .env from template..."
    cp .env.example .env
    echo ".env created - update with your API keys if needed"
fi

echo ""
echo "=========================================="
echo "Starting EPO Tracker Backend"
echo "=========================================="
echo ""
echo "Server will be available at:"
echo "  API: http://localhost:8000"
echo "  Docs: http://localhost:8000/docs"
echo ""
echo "Demo endpoints for testing:"
echo "  POST /api/auth/register - Create account"
echo "  POST /api/demo/seed - Load demo data"
echo "  POST /api/demo/simulate-email - Test email parsing"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Run the server
python3 run.py
