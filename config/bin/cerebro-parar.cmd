@echo off
rem Cerebro: para de golpe los trabajos de OpenCode en segundo plano.
rem Uso: cerebro-parar            (todo)
rem      cerebro-parar --seco     (solo dice lo que haria)
rem      cerebro-parar C:\ruta   (solo ese proyecto)
node "%USERPROFILE%\.sistema-cerebro-agentes\hub\parar-todo.mjs" %*
