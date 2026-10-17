# C20 · Diagrama de casos de uso online

[Fuente PlantUML](use-cases.puml) y [SVG generado](use-cases.svg) representan el mismo modelo del [catálogo C19](../requirements/online-use-cases.md). El límite es **Compunube Online** y su único actor externo primario es **Jugador**. Frontend, Go, Rust, PostgreSQL y Envoy son participantes internos; la nota del diagrama resume su recorrido y C19 precisa las responsabilidades.

El diagrama agrupa UC-01…UC-17 en acceso/perfil, sala/preparación, carrera/continuidad y resultado/progreso. Las extensiones se usan solo para contacto elegible, desconexión, salida voluntaria y decisión de repetir/salir después del resultado. Las precondiciones y el orden completo están en C19; el diagrama no fija API ni protocolo.

## Regenerar el SVG

Se usó **PlantUML 1.2026.9** en contenedor, fijado por digest. Desde la raíz del repositorio:

```bash
docker run --rm -v "$PWD/docs/uml:/work" -w /work \
  plantuml/plantuml@sha256:9b5071ab56a4192aac458ab4b0d42261c22c8109695894ae5be6013c3be6cac1 \
  -tsvg use-cases.puml
```

El comando escribe `docs/uml/use-cases.svg` desde `use-cases.puml`. Para revisar cambios, regenerar y comparar el SVG versionado con `git diff`; no editar el SVG a mano. El contenedor evita exigir Java/PlantUML instalados en el host.
