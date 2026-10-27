# Laboratorio por roles: un equipo por pieza

Cinco equipos, cada uno con un papel, como pidió el profesor. Todo se hace con `node` y `docker compose`: no hace falta Git, ni PowerShell con scripts `.ps1` habilitados, ni Git Bash, ni ser administrador para lanzar los comandos.

| Equipo | Rol | Qué corre | Puerto que recibe conexiones |
| --- | --- | --- | --- |
| A | **BD** | PostgreSQL + migraciones | 55432 |
| B | **Rust** | `player-profile-rust-1`, `player-profile-rust-2` y Envoy | 50051 |
| C | **Go** | Match Service (salas, carreras, tiempo real) | 8080 |
| D | **Web 1** | instancia **TypeScript** del cliente (`server.mjs`) en `http://127.0.0.1:4173` | ninguno |
| E | **Web 2** | instancia **Python** del cliente (`compunube_client.webhost`), misma interfaz | ninguno |

```text
navegador (D, E) -> server.mjs local -> Go (C:8080) -> Envoy (B:50051) -> rust-1 / rust-2 -> PostgreSQL (A:55432)
                                          \---------------------------------------------------> PostgreSQL (A:55432)
```

Las IP del laboratorio **no se escriben en el repositorio**: viven solo en el `.env` de cada equipo.

## Antes de ir

- En cada equipo: la carpeta del proyecto (ZIP de GitHub descomprimido o `git clone`), Docker Desktop abierto en A, B y C, y Node.js (el del laboratorio sirve).
- **A, B y C publican un puerto.** La primera vez Windows muestra el aviso de firewall de *Docker Desktop Backend*; sin cuenta de administrador hay que pedir al admin que lo **permita**. En los equipos web no aparece.
- Los comandos se lanzan en la carpeta del proyecto (la que tiene `compose.yml`). En PowerShell: `cd <carpeta>`; si no, Docker dice `no configuration file provided`.

## Paso 0 · Un solo `.env` para todos (una vez)

En **un** equipo cualquiera:

```powershell
node scripts/lab.mjs init
```

Pregunta la IP (o el nombre) de los equipos BD, Rust y Go y crea `.env` con cinco secretos aleatorios (no se muestran). También acepta `node scripts/lab.mjs init --db <IP A> --rust <IP B> --go <IP C>`.

Copia **ese mismo archivo** `.env` a la carpeta del proyecto de A, B y C (USB o carpeta compartida; nunca por chat ni Git). Los tres necesitan las mismas contraseñas. Volver a ejecutar `init` conserva los secretos y solo cambia las direcciones.

## Pasos 1 a 3 · Arrancar en orden

| Orden | Equipo | Comando | Termina con |
| --- | --- | --- | --- |
| 1 | A (BD) | `node scripts/lab.mjs db` | `BD lista en el puerto 55432` |
| 2 | B (Rust) | `node scripts/lab.mjs rust` | `Rust listo: Envoy ve 2 réplicas sanas` |
| 3 | C (Go) | `node scripts/lab.mjs go` | `Go listo en el puerto 8080` |

Antes de arrancar, Rust y Go comprueban que llegan al equipo anterior y, si no, dicen cuál falla y qué revisar. La primera vez construyen las imágenes (varios minutos); después arrancan en segundos.

## Paso 4 · Clientes web (D y E)

```powershell
node scripts/lab.mjs web --go <IP C>            # D: instancia TypeScript
node scripts/lab.mjs web --go <IP C> --python   # E: instancia Python (necesita Python 3.11+, sin pip install)
```

Abre `http://127.0.0.1:4173` **en ese mismo equipo**. Las dos instancias muestran la misma interfaz de Surf Club; cambia el programa que la sirve y habla con Go (TypeScript/Node en D, Python en E). No hace falta HTTPS ni abrir puertos: el navegador habla con `server.mjs` en su propio equipo, y este reenvía `/v1` y el WebSocket a Go. Si copias el `.env` también aquí, basta `node scripts/lab.mjs web`.

Sin el script, la instancia Python es: `cd apps/client-secondary` y `python -m compunube_client.webhost --server http://<IP C>:8080`.

## Demostración del failover (en B)

```powershell
docker compose kill player-profile-rust-1      # la carrera sigue; Envoy usa rust-2
node scripts/lab.mjs rust                      # vuelve rust-1
docker compose kill player-profile-rust-2
node scripts/lab.mjs rust
```

En B, A y C usa siempre `node scripts/lab.mjs <rol>` para (re)arrancar. `docker compose start` o `docker compose up -d` a secas no sirven en estos equipos: intentan arrancar servicios que viven en otro equipo (por ejemplo, Rust depende de las migraciones de A).

## Comprobar, ver y parar

| Para | Comando |
| --- | --- |
| Probar desde este equipo las conexiones a BD, Rust y Go | `node scripts/lab.mjs check` |
| Ver los contenedores de este equipo | `node scripts/lab.mjs status` |
| Parar este equipo **sin borrar datos** | `node scripts/lab.mjs stop` |
| Actualizar el código | reemplazar la carpeta, volver a copiar `.env` y repetir el rol con `--build` |

Nunca `docker compose down -v`: borra la base de datos.

## Si algo falla

| Mensaje | Causa probable | Qué hacer |
| --- | --- | --- |
| `Docker no responde` | Docker Desktop cerrado o arrancando | Abrirlo y esperar a *Engine running* |
| `falta el archivo .env` | No se copió el `.env` o no estás en la carpeta del proyecto | `cd` a la carpeta; copiar el `.env` del paso 0 |
| `FALLA BD <ip>:55432` (o Rust `:50051`) | El otro equipo no está arriba, IP mal escrita o el firewall no aprobó Docker en **ese** equipo | `node scripts/lab.mjs status` en el otro equipo; pedir al admin la aprobación de *Docker Desktop Backend* |
| `Envoy no ve las dos réplicas Rust sanas` | Rust no llega a PostgreSQL | `docker compose logs --tail 50 player-profile-rust-1` |
| `/readyz no responde 200` | Go no llega a la BD o a Rust | `docker compose logs --tail 50 match-service-go` |
| `Go no responde en …` (equipo web) | Go caído o IP mal escrita | `node scripts/lab.mjs check --go <IP C>` |

**Por qué 55432 y no 5432:** en el laboratorio el 5432 de un equipo ya estaba escuchando por dos procesos distintos, y la conexión desde otro equipo fallaba mientras el 50051 de Docker sí llegaba. Lo más probable es un PostgreSQL de Windows instalado en el equipo, y comprobarlo cuesta un comando: `Get-Process -Id <PID>` con los PID de `Get-NetTCPConnection -LocalPort 5432 -State Listen`. Publicar la BD en 55432 evita el choque sin tocar ese servicio.

## Planes de respaldo

- **Backend en un equipo:** en ese equipo `node scripts/lab.mjs all` (todo el sistema). En los equipos web, `node scripts/lab.mjs web --go <IP de ese equipo>`.
- **Todo en un equipo:** `node scripts/lab.mjs all` y `node scripts/lab.mjs web` en el mismo equipo, con dos navegadores y el cliente Python.
- **Sin Internet para construir:** construir en casa y llevar las imágenes: `docker save -o compunube.tar compunube-match-service:dev compunube-player-profile-service:dev postgres:17-alpine envoyproxy/envoy:v1.31.10`, y en el laboratorio `docker load -i compunube.tar`.

## Qué demuestra y qué no

- Cada pieza corre en su propio equipo y solo se comunica por la red del laboratorio. Go sigue sin conocer a las réplicas Rust: solo conoce Envoy.
- rust-1 y rust-2 comparten el equipo B: el failover demuestra la caída de una **réplica**, no la de un equipo.
- Prometheus y Grafana no forman parte del reparto: sus objetivos son los nombres de la red de Compose de un solo equipo (H68/H69). Para mostrarlos, usar `all` en un equipo aparte o la evidencia de CI.

## Evidencia

- CI Deploy, job `lab-roles`: cuatro carpetas con el mismo `.env` y cuatro proyectos Compose distintos (BD, Rust, Go y web) que solo se ven por los puertos publicados de la IP del runner. Ejecuta `init`, `db`, `rust`, `go` y `check`, abre una sesión web a través de `server.mjs` y corre una carrera con dos clientes Python mientras rust-1 y luego rust-2 caen y vuelven. Exige `Settlement … confirmed` en ambos.
- CI Infrastructure: pruebas unitarias de `scripts/lab.mjs` (`node --test scripts/lab.test.mjs`).
- Ensayo local (27/10/2026), con tres proyectos Compose separados en Docker Desktop:
  - Rust y Go llegaron a la BD y a Envoy por los puertos publicados.
  - Hubo una carrera completa con dos clientes y se cayeron rust-1 y rust-2 por turnos: el settlement salió `confirmed` para ambos.
  - La web por proxy creó una sesión (`201`) y leyó el perfil (`200`).
