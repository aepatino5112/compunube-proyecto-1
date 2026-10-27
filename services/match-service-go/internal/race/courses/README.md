# Manifiestos de carrera

Snapshots estáticos de la geometría generada por `apps/web/dist/maps.js` (`createCourse`, semillas 57 y 819). Los escribe y comprueba [`apps/web/tools/generate-course-manifests.mjs`](../../../../../apps/web/tools/generate-course-manifests.mjs); `npm run check` exige que los archivos coincidan byte a byte con el generador. Los IDs `o-###`, `t-###` y `l-###` se asignan por orden de cada lista; `pipe` corresponde a metal y `bottle`/`wrapper` a plástico. Go carga los JSON embebidos y nunca ejecuta el generador durante una carrera.

| Versión | Meta | Obstáculos | Residuos | Salvavidas | Estado |
| --- | --- | --- | --- | --- | --- |
| `surf-mvp-2` | 1800 | 113 | 211 | 21 | Vigente (`race.RulesVersion`) |
| `surf-mvp-1` | 900 | 54 | 103 | 10 | Publicada; se conserva sin cambios |

`surf-mvp-2` usa la misma separación entre objetos y el mismo margen antes de la meta que `surf-mvp-1`; con `createCourse(mapId, 900)` el generador reproduce exactamente los archivos `surf-mvp-1`. Si cambia un objeto, su tipo, posición, meta o slot de salida, crear una nueva versión (`node tools/generate-course-manifests.mjs surf-mvp-N <longitud>`) y actualizar las pruebas; no modificar archivos ya publicados.
