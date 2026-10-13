@echo off
rem Cerebro: continua la conversacion actual en modo Cerebro (Claude + OpenCode).
rem Para volver al modo normal: claude --continue
claude --agent cerebro --continue %*
