# Laya — modelo local de decisiones (enrutamiento de tareas).
# Servidor HTTP oficial del paquete `laya[serve]`. CPU por defecto (421M, milisegundos).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/modelos \
    LAYA_DEVICE=cpu \
    LAYA_PRELOAD=1

# Dependencias del sistema mínimas para torch CPU + wheels
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "laya[serve]"

EXPOSE 8000

# La primera vez descarga los checkpoints (~850 MB) al volumen /modelos.
# Con LAYA_PRELOAD=1 los carga al arrancar; las siguientes veces es inmediato.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["laya-serve", "--host", "0.0.0.0", "--port", "8000"]
