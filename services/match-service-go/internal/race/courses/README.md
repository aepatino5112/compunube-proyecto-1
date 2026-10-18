# Manifiestos de carrera v1

`maracaibo-surf-mvp-1.json` y `orinoco-surf-mvp-1.json` son snapshots estáticos de la geometría generada por `apps/web/dist/maps.js` (`createCourse`, seeds 57 y 819). Los IDs `o-###`, `t-###` y `l-###` se asignaron por orden de cada lista; `pipe` corresponde a metal y `bottle`/`wrapper` a plástico. Las posiciones, radios, rotaciones y fases se fijaron al generar estos archivos. Go carga los JSON embebidos y nunca ejecuta el generador del cliente durante una carrera.

Cada mapa conserva 54 obstáculos, 103 residuos y 10 salvavidas. `race_test.go` verifican conteos, versiones e IDs. Si cambia un objeto, su tipo, posición, meta o slot de salida, crear una nueva `courseVersion` para ese mapa y actualizar las pruebas; no modificar silenciosamente estos archivos versionados.
