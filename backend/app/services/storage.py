import mimetypes
import os
import re
import uuid
from pathlib import Path

from app.config import settings

EXT_KIND = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "docx",
    ".xlsx": "xlsx",
    ".xls": "xlsx",
    ".csv": "csv",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
    ".gif": "image",
    ".tif": "image",
    ".tiff": "image",
    ".mp4": "video",
    ".mov": "video",
    ".webm": "video",
    ".mkv": "video",
    ".mp3": "audio",
    ".wav": "audio",
    ".m4a": "audio",
    ".txt": "text",
    ".md": "text",
    ".html": "text",
}


def kind_for(filename: str) -> str:
    return EXT_KIND.get(Path(filename).suffix.lower(), "other")


def mime_for(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def safe_name(filename: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(filename))[:150] or "file"


def save_bytes(company_id: uuid.UUID, filename: str, data: bytes) -> str:
    folder = Path(settings.upload_dir) / str(company_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid.uuid4().hex[:8]}_{safe_name(filename)}"
    path.write_bytes(data)
    return str(path)
