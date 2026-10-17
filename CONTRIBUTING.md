# Contributing

## Metodología

Usamos **Fast Deployment** para entrega frecuente y **Kanban** para flujo de trabajo.

La política operativa completa —columnas, límites WIP, criterios de entrada/salida, bloqueantes, integración y despliegue— está en [docs/project-management/fast-deployment-kanban.md](docs/project-management/fast-deployment-kanban.md).

## Ramas

- `feature/<descripcion>`
- `fix/<descripcion>`
- `docs/<descripcion>`
- `chore/<descripcion>`

## Pull Requests

Todo cambio hacia `main` pasa por PR.

Debe:

- tener un objetivo claro;
- evitar cambios no relacionados;
- pasar CI;
- actualizar pruebas cuando aplique;
- actualizar docs si cambia contrato, arquitectura o despliegue.

Antes de mergear, revisar los checks de GitHub Actions. La estrategia y responsabilidades de cada workflow están documentadas en [docs/ci-cd.md](docs/ci-cd.md).

## Flujo Kanban

```text
Backlog -> To Do -> In Progress -> Review -> Testing -> Done
```

Límites WIP del equipo: To Do 6, In Progress 4, Review 3 y Testing 2. Antes de abrir trabajo nuevo se prioriza terminar, revisar o probar trabajo existente.

## Definition of Done técnica

Según corresponda:

- compila;
- lint/format pasa;
- tests pasan;
- está integrado;
- CI queda verde;
- docs/contratos quedan actualizados;
- es demostrable.

## Commits

```text
feat(go): add room lifecycle
feat(rust): add profile repository
fix(realtime): ignore stale input sequence
chore(ci): validate compose configuration
docs: document service boundaries
```

`main` debe mantenerse cerca de un estado desplegable.
