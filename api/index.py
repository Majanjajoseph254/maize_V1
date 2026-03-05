"""
Vercel Serverless Function Handler for KilimoSmart Flask App
This module wraps the Flask application to run on Vercel's serverless platform.
"""

import sys
from pathlib import Path

# Add parent directory to path so we can import webapp
sys.path.insert(0, str(Path(__file__).parent.parent))

from webapp import app

# Export the app for Vercel to use
app_handler = app
