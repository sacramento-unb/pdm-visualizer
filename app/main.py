"""HTTP entry point for the PowerDesigner model visualizer."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .pdm_parser import MAX_PDM_BYTES, PDMParseError, PDMParser


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DEMO_FILE = BASE_DIR / "sample.pdm"

app = FastAPI(
    title="PowerDesigner Model Visualizer",
    description="Visualização interativa de modelos PowerDesigner PDM e CDM.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/models/parse")
async def parse_model(file: UploadFile = File(...)) -> dict:
    filename = file.filename or "modelo.pdm"
    if not filename.lower().endswith((".pdm", ".cdm", ".xml")):
        raise HTTPException(status_code=415, detail="Envie um arquivo .pdm, .cdm ou .xml.")

    raw = await file.read(MAX_PDM_BYTES + 1)
    await file.close()
    try:
        return PDMParser(raw=raw, filename=filename).parse()
    except PDMParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/models/demo")
def demo_model() -> dict:
    return PDMParser(raw=DEMO_FILE.read_bytes(), filename=DEMO_FILE.name).parse()


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
