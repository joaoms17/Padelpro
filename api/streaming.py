"""Range-aware video streaming shared by the review and label routers."""

from __future__ import annotations
import os
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

_CHUNK = 1024 * 1024


def range_stream_response(path: Path, request: Request, media_type: str = "video/mp4") -> StreamingResponse:
    """Stream a file honouring the HTTP Range header (video seeking)."""
    file_size = os.path.getsize(path)
    range_header = request.headers.get("range")

    start, end = 0, file_size - 1
    status_code = 200
    if range_header and range_header.startswith("bytes="):
        spec = range_header[len("bytes="):].split("-")
        try:
            if spec[0]:
                start = int(spec[0])
            if len(spec) > 1 and spec[1]:
                end = min(int(spec[1]), file_size - 1)
            status_code = 206
        except ValueError:
            raise HTTPException(status_code=416, detail="Range inválido.")
        if start > end or start >= file_size:
            raise HTTPException(status_code=416, detail="Range fora do ficheiro.")

    length = end - start + 1

    def reader():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(_CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    return StreamingResponse(reader(), status_code=status_code,
                             media_type=media_type, headers=headers)
