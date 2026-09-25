import os
from dotenv import load_dotenv

load_dotenv()

# Internal authentication
INTERNAL_SECRET = os.getenv("AST_ENGINE_INTERNAL_SECRET", "")

# Server
HOST = os.getenv("AST_ENGINE_HOST", "0.0.0.0")
PORT = int(os.getenv("AST_ENGINE_PORT", "8000"))

# Plagiarism thresholds
COSINE_SIMILARITY_LOW = 0.3
COSINE_SIMILARITY_MEDIUM = 0.6
COSINE_SIMILARITY_HIGH = 0.8

TED_THRESHOLD_LOW = 0.5
TED_THRESHOLD_MEDIUM = 0.75
TED_THRESHOLD_HIGH = 0.9

# Timeout for batch processing
BATCH_TIMEOUT_SECONDS = 120
MAX_BATCH_SIZE = 50
