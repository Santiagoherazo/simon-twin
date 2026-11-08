FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt
# Librerías de ciencia de datos para los cuadernos del panel admin (numpy, pandas, scikit-learn, matplotlib).
# Para una imagen más liviana: docker build --build-arg WITH_ML=0 .
ARG WITH_ML=1
COPY requirements-ml.txt .
RUN if [ "$WITH_ML" = "1" ]; then pip install -r requirements-ml.txt; fi

COPY app ./app

RUN useradd --system --uid 10001 simon
USER simon

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
