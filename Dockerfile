# Lightweight backend image for PadelPro Vision API.
# Includes ffmpeg + OpenCV runtime libs. Deliberately does NOT install torch —
# the "useful time" (condense) feature only needs segmentation (OpenCV + numpy + ffmpeg).
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching)
COPY pyproject.toml ./
COPY padelpro_vision ./padelpro_vision
RUN pip install --no-cache-dir -e ".[backend]"

# App code
COPY api ./api
COPY scripts ./scripts
COPY config.py ./

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
