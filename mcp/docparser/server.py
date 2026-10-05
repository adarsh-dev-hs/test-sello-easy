"""SelloQ document parser MCP server (FastMCP 2.x, streamable HTTP at /mcp, port 9002).

Tool (see docs/CONTRACTS.md §2):
  parse_document(file_url, mime_type="", filename="")
      -> {"text": str, "tables": [markdown str], "pages": int, "meta": {...}}
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import mimetypes
import os
import shutil
import subprocess
import tempfile
from urllib.parse import unquote, urlparse

import httpx
from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse

log = logging.getLogger("selloq.docparser")

mcp = FastMCP("selloq-docparser")

MAX_DOWNLOAD_BYTES = int(os.getenv("DOCPARSER_MAX_BYTES", str(50 * 1024 * 1024)))
MAX_TEXT_CHARS = 200_000
DOWNLOAD_TIMEOUT = float(os.getenv("DOCPARSER_DOWNLOAD_TIMEOUT_SECONDS", "60"))
OCR_LANG = os.getenv("OCR_LANG", "eng")


def _openai_key() -> str:
    return os.getenv("OPENAI_API_KEY", "").strip()


# --------------------------------------------------------------------------- type detection
KIND_BY_EXT = {
    "pdf": "pdf",
    "docx": "docx",
    "xlsx": "xlsx", "xlsm": "xlsx", "xls": "xls",
    "csv": "csv", "tsv": "csv",
    "txt": "text", "md": "text", "markdown": "text", "json": "text", "log": "text",
    "html": "html", "htm": "html",
    "png": "image", "jpg": "image", "jpeg": "image", "gif": "image", "bmp": "image",
    "tif": "image", "tiff": "image", "webp": "image",
    "mp3": "audio", "wav": "audio", "m4a": "audio", "ogg": "audio", "flac": "audio", "aac": "audio",
    "mp4": "video", "mov": "video", "webm": "video", "mkv": "video", "avi": "video", "mpeg": "video",
}


def _kind_from_mime(mime: str) -> str | None:
    m = (mime or "").split(";")[0].strip().lower()
    if not m or m in ("application/octet-stream", "binary/octet-stream"):
        return None
    if m == "application/pdf":
        return "pdf"
    if "wordprocessingml" in m:
        return "docx"
    if "spreadsheetml" in m:
        return "xlsx"
    if m in ("application/vnd.ms-excel",):
        return "xls"
    if m in ("text/csv", "text/tab-separated-values"):
        return "csv"
    if m in ("text/html", "application/xhtml+xml"):
        return "html"
    if m.startswith("text/") or m in ("application/json", "text/markdown"):
        return "text"
    if m.startswith("image/"):
        return "image"
    if m.startswith("audio/"):
        return "audio"
    if m.startswith("video/"):
        return "video"
    return None


def _kind_from_name(name: str) -> str | None:
    name = (name or "").lower().rsplit("?", 1)[0]
    if "." not in name:
        return None
    return KIND_BY_EXT.get(name.rsplit(".", 1)[1])


def _kind_from_magic(data: bytes) -> str | None:
    h = data[:16]
    if h.startswith(b"%PDF"):
        return "pdf"
    if h.startswith(b"PK\x03\x04"):
        try:
            import zipfile

            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = z.namelist()
            if any(n.startswith("word/") for n in names):
                return "docx"
            if any(n.startswith("xl/") for n in names):
                return "xlsx"
        except Exception:
            return None
        return None
    if h.startswith(b"\xd0\xcf\x11\xe0"):
        return "xls"
    if h.startswith((b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"BM", b"II*\x00", b"MM\x00*")) or (
        h[:4] == b"RIFF" and data[8:12] == b"WEBP"
    ):
        return "image"
    if h.startswith((b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"fLaC", b"OggS")) or (
        h[:4] == b"RIFF" and data[8:12] == b"WAVE"
    ):
        return "audio"
    if data[4:8] == b"ftyp" or h.startswith(b"\x1a\x45\xdf\xa3"):
        return "video"
    head = data[:2048].lstrip().lower()
    if head.startswith((b"<!doctype html", b"<html")):
        return "html"
    try:
        data[:4096].decode("utf-8")
        return "text"
    except UnicodeDecodeError:
        return None


def detect_kind(data: bytes, mime_type: str, filename: str, url: str, resp_mime: str = "") -> str:
    magic = _kind_from_magic(data)
    if magic in ("pdf", "docx", "xlsx", "xls", "image"):
        return magic  # binary signatures are the most reliable
    for k in (
        _kind_from_mime(mime_type),
        _kind_from_name(filename),
        _kind_from_name(unquote(urlparse(url).path)),
        _kind_from_mime(resp_mime),
        magic,
    ):
        if k:
            return k
    return "unknown"


# --------------------------------------------------------------------------- parsers
def _df_to_markdown(df, title: str | None = None) -> str:
    df = df.dropna(how="all").dropna(axis=1, how="all")
    df = df.fillna("")
    cols = [str(c) for c in df.columns]
    lines = []
    if title:
        lines.append(f"### {title}")
    lines.append("| " + " | ".join(cols) + " |")
    lines.append("| " + " | ".join("---" for _ in cols) + " |")
    for row in df.itertuples(index=False):
        cells = [str(v).replace("|", "\\|").replace("\n", " ") for v in row]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def _rows_to_markdown(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    out = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join("---" for _ in rows[0]) + " |"]
    out += ["| " + " | ".join(c.replace("|", "\\|").replace("\n", " ") for c in r) + " |" for r in rows[1:]]
    return "\n".join(out)


def _ocr_image_bytes(data: bytes) -> str:
    import pytesseract
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    # upscale small images for better OCR
    if max(img.size) < 1000:
        scale = 1000 / max(img.size)
        img = img.resize((int(img.width * scale), int(img.height * scale)))
    return pytesseract.image_to_string(img, lang=OCR_LANG)


def parse_pdf(data: bytes) -> tuple[str, list[str], int, dict]:
    import fitz  # pymupdf

    doc = fitz.open(stream=data, filetype="pdf")
    parts, tables, ocr_pages = [], [], []
    for i, page in enumerate(doc):
        txt = page.get_text("text") or ""
        if len(txt.strip()) < 20:
            try:
                pix = page.get_pixmap(dpi=200)
                txt = _ocr_image_bytes(pix.tobytes("png"))
                ocr_pages.append(i + 1)
            except Exception as e:
                log.warning("OCR failed on page %s: %s", i + 1, e)
        parts.append(f"--- Page {i + 1} ---\n{txt.strip()}")
        try:
            for t in page.find_tables().tables:
                rows = [[str(c) if c is not None else "" for c in r] for r in t.extract()]
                md = _rows_to_markdown(rows)
                if md:
                    tables.append(md)
        except Exception:
            pass
    meta = {"title": (doc.metadata or {}).get("title") or "", "ocr_pages": ocr_pages}
    return "\n\n".join(parts), tables, doc.page_count, meta


def parse_docx(data: bytes) -> tuple[str, list[str], int, dict]:
    import docx

    d = docx.Document(io.BytesIO(data))
    parts = []
    for p in d.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        style = (p.style.name or "").lower() if p.style is not None else ""
        if style.startswith("heading"):
            lvl = "".join(ch for ch in style if ch.isdigit()) or "1"
            parts.append("#" * min(int(lvl), 6) + " " + t)
        elif style == "title":
            parts.append("# " + t)
        else:
            parts.append(t)
    tables = []
    for tbl in d.tables:
        rows = [[c.text.strip() for c in r.cells] for r in tbl.rows]
        md = _rows_to_markdown(rows)
        if md:
            tables.append(md)
    text = "\n\n".join(parts)
    if tables:
        text += "\n\n" + "\n\n".join(tables)
    meta = {"title": d.core_properties.title or ""}
    return text, tables, 1, meta


def parse_spreadsheet(data: bytes, kind: str) -> tuple[str, list[str], int, dict]:
    import pandas as pd

    tables, sheet_names = [], []
    if kind == "csv":
        sep = "\t" if data[:2048].count(b"\t") > data[:2048].count(b",") else ","
        df = pd.read_csv(io.BytesIO(data), sep=sep)
        tables.append(_df_to_markdown(df))
        sheet_names = ["csv"]
    else:
        engine = "openpyxl" if kind == "xlsx" else None
        sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, engine=engine)
        for name, df in sheets.items():
            sheet_names.append(name)
            if df.dropna(how="all").empty:
                continue
            tables.append(_df_to_markdown(df, title=f"Sheet: {name}"))
    return "\n\n".join(tables), tables, len(sheet_names), {"sheets": sheet_names}


def parse_html(data: bytes) -> tuple[str, list[str], int, dict]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(data, "html.parser")
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    tables = []
    for tbl in soup.find_all("table"):
        rows = [[c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])] for tr in tbl.find_all("tr")]
        md = _rows_to_markdown([r for r in rows if r])
        if md:
            tables.append(md)
    text = soup.get_text("\n", strip=True)
    return text, tables, 1, {"title": title}


def parse_text(data: bytes) -> tuple[str, list[str], int, dict]:
    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(enc), [], 1, {"encoding": enc}
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace"), [], 1, {}


async def _openai_vision(data: bytes, mime: str) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=_openai_key())
    b64 = base64.b64encode(data).decode()
    resp = await client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Extract all readable text from this image verbatim, then describe the image "
                        "(diagrams, charts, labels, numbers) in a concise paragraph useful for a B2B sales analyst.",
                    },
                    {"type": "image_url", "image_url": {"url": f"data:{mime or 'image/png'};base64,{b64}"}},
                ],
            }
        ],
    )
    return resp.choices[0].message.content or ""


async def parse_image(data: bytes, mime: str) -> tuple[str, list[str], int, dict]:
    meta: dict = {"method": "tesseract"}
    try:
        text = await asyncio.to_thread(_ocr_image_bytes, data)
    except Exception as e:
        text = ""
        meta["ocr_error"] = str(e)
    if len(text.strip()) < 40:
        if _openai_key():
            try:
                vision = await _openai_vision(data, mime)
                text = (text.strip() + "\n\n" + vision).strip()
                meta["method"] = "tesseract+openai_vision"
            except Exception as e:
                meta["warning"] = f"OpenAI vision failed: {e}"
        else:
            meta["warning"] = "OCR text short and OPENAI_API_KEY not set; vision fallback skipped"
    return text, [], 1, meta


async def parse_media(data: bytes, filename: str) -> tuple[str, list[str], int, dict]:
    meta: dict = {}
    if not _openai_key():
        meta["warning"] = "OPENAI_API_KEY not set; audio/video transcription skipped"
        return "", [], 1, meta
    if not shutil.which("ffmpeg"):
        meta["warning"] = "ffmpeg not installed"
        return "", [], 1, meta
    with tempfile.TemporaryDirectory() as tmp:
        ext = os.path.splitext(filename or "")[1] or ".bin"
        src = os.path.join(tmp, "input" + ext)
        dst = os.path.join(tmp, "audio.mp3")
        with open(src, "wb") as f:
            f.write(data)
        proc = await asyncio.to_thread(
            subprocess.run,
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", dst],
            capture_output=True,
            timeout=600,
        )
        if proc.returncode != 0 or not os.path.exists(dst):
            meta["warning"] = "ffmpeg conversion failed: " + proc.stderr.decode(errors="replace")[-500:]
            return "", [], 1, meta
        try:
            dur = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst],
                capture_output=True, timeout=60,
            )
            meta["duration_seconds"] = round(float(dur.stdout.decode().strip() or 0), 1)
        except Exception:
            pass
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=_openai_key())
        model = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
        try:
            with open(dst, "rb") as f:
                tr = await client.audio.transcriptions.create(model=model, file=f)
            text = getattr(tr, "text", "") or ""
            meta["method"] = f"openai:{model}"
        except Exception as e:
            meta["warning"] = f"transcription failed: {e}"
            text = ""
    return text, [], 1, meta


# --------------------------------------------------------------------------- download
async def _download(url: str) -> tuple[bytes, str, str]:
    """Return (bytes, response content-type, final url). Enforces size cap."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(DOWNLOAD_TIMEOUT)) as client:
        async with client.stream("GET", url, headers={"User-Agent": "SelloQ-DocParser/0.1"}) as r:
            r.raise_for_status()
            cl = r.headers.get("content-length")
            if cl and cl.isdigit() and int(cl) > MAX_DOWNLOAD_BYTES:
                raise ValueError(f"file too large ({cl} bytes > {MAX_DOWNLOAD_BYTES})")
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > MAX_DOWNLOAD_BYTES:
                    raise ValueError(f"file too large (> {MAX_DOWNLOAD_BYTES} bytes)")
            ctype = r.headers.get("content-type", "")
            # filename from Content-Disposition, if any
            disp = r.headers.get("content-disposition", "")
            return bytes(buf), ctype + ("\x00" + disp if disp else ""), str(r.url)


def _filename_from_disposition(disp: str) -> str:
    for part in disp.split(";"):
        part = part.strip()
        if part.lower().startswith("filename*="):
            return unquote(part.split("''", 1)[-1].strip('"'))
        if part.lower().startswith("filename="):
            return part.split("=", 1)[1].strip('"')
    return ""


async def parse_bytes(data: bytes, mime_type: str = "", filename: str = "", url: str = "", resp_mime: str = "") -> dict:
    kind = detect_kind(data, mime_type, filename, url, resp_mime)
    mime = (mime_type or resp_mime or mimetypes.guess_type(filename or "")[0] or "").split(";")[0]
    if kind == "pdf":
        text, tables, pages, meta = await asyncio.to_thread(parse_pdf, data)
    elif kind == "docx":
        text, tables, pages, meta = await asyncio.to_thread(parse_docx, data)
    elif kind in ("xlsx", "xls", "csv"):
        text, tables, pages, meta = await asyncio.to_thread(parse_spreadsheet, data, kind)
    elif kind == "html":
        text, tables, pages, meta = parse_html(data)
    elif kind == "text":
        text, tables, pages, meta = parse_text(data)
    elif kind == "image":
        text, tables, pages, meta = await parse_image(data, mime)
    elif kind in ("audio", "video"):
        text, tables, pages, meta = await parse_media(data, filename or urlparse(url).path)
    else:
        text, tables, pages, meta = "", [], 0, {"warning": "unsupported or unknown file type"}
    meta = dict(meta)
    meta.update({"kind": kind, "mime_type": mime, "filename": filename, "bytes": len(data)})
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
        meta["truncated"] = True
    return {"text": text, "tables": tables, "pages": int(pages), "meta": meta}


# --------------------------------------------------------------------------- tool
@mcp.tool
async def parse_document(file_url: str, mime_type: str = "", filename: str = "") -> dict:
    """Download a document by URL and extract its text. Supports PDF (with OCR fallback), DOCX,
    XLSX/XLS/CSV (as markdown tables), TXT/MD/HTML, images (OCR, vision fallback) and audio/video
    (transcription). Returns {text, tables, pages, meta}."""
    try:
        data, ctype_disp, final_url = await _download(file_url)
    except Exception as e:
        return {"text": "", "tables": [], "pages": 0, "meta": {"error": f"download failed: {e}"}}
    ctype, _, disp = ctype_disp.partition("\x00")
    if not filename and disp:
        filename = _filename_from_disposition(disp)
    try:
        return await parse_bytes(data, mime_type, filename, final_url, ctype)
    except Exception as e:
        log.exception("parse failed")
        return {"text": "", "tables": [], "pages": 0, "meta": {"error": f"parse failed: {e}", "filename": filename}}


# --------------------------------------------------------------------------- http app
@mcp.custom_route("/health", methods=["GET"])
async def health(_: Request) -> JSONResponse:
    return JSONResponse({"ok": True})


class BearerAuthMiddleware:
    """Pure ASGI middleware: require `Authorization: Bearer $MCP_SHARED_TOKEN` (if set), except GET /health."""

    def __init__(self, app, token: str | None = None):
        self.app = app
        self.token = token if token is not None else os.getenv("MCP_SHARED_TOKEN", "")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self.token:
            return await self.app(scope, receive, send)
        if scope.get("path", "").rstrip("/") == "/health":
            return await self.app(scope, receive, send)
        auth = ""
        for k, v in scope.get("headers", []):
            if k == b"authorization":
                auth = v.decode("latin-1")
                break
        if auth != f"Bearer {self.token}":
            resp = JSONResponse({"error": "unauthorized"}, status_code=401)
            return await resp(scope, receive, send)
        return await self.app(scope, receive, send)


app = mcp.http_app(path="/mcp", middleware=[Middleware(BearerAuthMiddleware)])

if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "9002")))
