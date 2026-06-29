import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

MONGO_URL = os.getenv("MONGO_URL", "mongodb://94.130.179.94:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "meicottReportDB")
SPEED_LIMIT = float(os.getenv("SPEED_LIMIT", "7.0"))
PORT = int(os.getenv("PORT", "8010"))
HOST = os.getenv("HOST", "0.0.0.0")

# Data Forwarding Settings
FORWARD_URL = os.getenv("FORWARD_URL", "")
FORWARD_INTERVAL = float(os.getenv("FORWARD_INTERVAL", "5.0"))  # Check every 5 seconds by default
