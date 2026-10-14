# Spec 11 · Métricas de uso (logs para analizar con IA)

## Objetivo
Recopilar de forma continua datos de uso y coste del sistema en logs JSONL locales, para analizarlos más adelante con una IA y detectar optimizaciones. Alcance v1: **hub + OpenCode** (no tokens de Claude). **Solo métricas: nunca texto de prompts ni respuestas.** Solo logs crudos (sin informe agregado; fuera de alcance).

## Requisitos
- **M1 · Módulo `config/hub/lib/metricas.mjs`.** `crearMetricas({dirLogs})` → `{registrar(evento), leer({desde,tipo,limite}), tamano()}`. Escribe en `hub-data/logs/metricas.jsonl`, una línea JSON por evento: `{ts (ISO), tipo, proyecto?, ...campos numéricos/etiquetas}`. Append atómico por línea; rotación a `metricas.1.jsonl` al pasar de 8 MB. Nunca lanza: un fallo de escritura se ignora (o va a `logErrores` con severidad `aviso`). Sanea: descarta cualquier campo string > 200 caracteres y las claves `prompt`, `texto`, `respuesta`, `contenido`.
- **M2 · Eventos de trabajos.** Cuando un job del ledger pasa a estado terminal (`completado|fallido|cancelado|atascado`), un evento `job` con `jobId, agente, modelo?, directorio (proyecto), estado, duracionMs, coste, tokens {entrada, salida, razonamiento, cache}` si la API de OpenCode los da (si no, omitidos), y `pasos` (nº de eventos si hay). Una sola vez por job (idempotente entre reinicios: no duplicar si ya hay evento `job` con ese `jobId`).
- **M3 · Eventos de contexto/memoria.** `briefing` (chars inyectados por sesión y proyecto, al generarse), `nudge` (disparado/descartado), `compresion` (R7: chars antes/después, modo resumen|fallback), `busqueda` (R1: nº de consultas, nº de resultados, ms; sin la consulta literal), límites 422 (R2: qué fichero, chars).
- **M4 · Eventos de decisión.** `aprobacion` (R4/R8: nivel, decisión, alcance, modo efectivo; sin el comando), `guardian` (veredicto, ms), `skill` (propuesto/aprobado/rechazado/usado, nombre), `cron` (ejecución: id, agente, estado, coste).
- **M5 · API.** `GET /api/metricas?tipo=&desde=&limite=` (JSON, máx. 1000) y `GET /api/metricas/exportar` (descarga el `.jsonl` completo, concatenando rotado + actual, `Content-Disposition`). `GET /api/metricas/resumen` solo devuelve `{eventos, desde, hasta, bytes, porTipo}` (conteos, no análisis).
- **M6 · Configuración.** `metricas_activas` (default `true`) y `metricas_retencion_dias` (default 90) en `hub-data/config.json`; si está desactivado, `registrar` no hace nada. Al arrancar el hub se podan líneas más viejas que la retención.
- **M7 · Panel.** Tarjeta pequeña «Métricas»: interruptor activar/desactivar, tamaño, nº de eventos y botón «Exportar .jsonl». Sin gráficas.
- **M8 · Documentación y pruebas.** `docs/arquitectura.md` y `docs/pruebas.md` (formato de cada evento, qué NO se guarda), CHANGELOG 0.5.0 + `VERSION`. `scripts/test-metricas.mjs` enganchado en `verificar.sh/.ps1`.

## Criterios de aceptación
1. Un job que termina genera exactamente un evento `job` con coste y duración; tras reiniciar el hub no se duplica.
2. Ningún evento contiene prompts, respuestas, comandos ni consultas literales (test que inyecta `prompt`/strings largos y verifica que se descartan).
3. Con `metricas_activas:false` el fichero no crece.
4. Rotación a 8 MB y poda por retención verificadas en test.
5. `GET /api/metricas/exportar` devuelve el JSONL completo; cada línea parsea como JSON.
6. Un fallo al escribir (directorio de solo lectura) no rompe ninguna ruta del hub.
7. `verificar` y todos los tests existentes siguen pasando.

## Fuera de alcance
Tokens de Claude (transcripts), informes agregados, gráficas, envío de datos fuera de la máquina.
