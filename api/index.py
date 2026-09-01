import os
import sys

# Ensure the backend source directory is in the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "agcc", "backend", "src")))

if os.environ.get("VERCEL"):
    # Open-Meteo's free tier blocks Vercel serverless IPs.
    # Unset the URL to disable live weather and avoid terminal errors.
    os.environ.pop("AGCC_WEATHER_API_URL", None)

from agcc.api.app import create_app
from agcc.api.service import AgccApplicationService

# Enable fixture mode to bypass production weather attenuation checks
app = create_app(AgccApplicationService(fixture_mode=True))
