FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN groupadd --system pdm && useradd --system --gid pdm --home-dir /app pdm

COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

COPY app ./app
COPY README.md LICENSE THIRD_PARTY_NOTICES.md ./
COPY third_party ./third_party

USER pdm
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]

