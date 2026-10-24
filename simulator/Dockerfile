FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
RUN pip install paho-mqtt==2.1.0
COPY simulator.py .

RUN useradd --system --uid 10001 sim && mkdir /data && chown sim /data
USER sim
VOLUME /data
CMD ["python", "simulator.py"]
