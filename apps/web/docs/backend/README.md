# Compunube · entrega al equipo backend

**Fecha:** 15 de octubre de 2026 · **Estado del front:** juego local y preparación de conexión · **Versión del paquete:** 1.2.0.

Este documento describe lo que existe en el código y propone una frontera de integración para que backend pueda comenzar. Las reglas de juego y precios reflejan la versión actual; siguen abiertos a ajustes de diseño. El front ya reconoce mensajes de carrera mediante un adaptador inyectable, entregado en `null`. Las rutas y la implementación del servicio siguen siendo una **propuesta**, sin conectar ni acordar con backend. [FRONT_ADAPTER.md](FRONT_ADAPTER.md) documenta la frontera que espera este cliente y sus límites.

## 1. Por dónde empezar

1. Leer el estado actual y las reglas de las secciones 2–5.
2. Usar [fixtures/current-front.json](fixtures/current-front.json) para obtener el perfil inicial, catálogo, personalización y recorridos reales, sin copiarlos de capturas.
3. Revisar [contracts-proposed.ts](contracts-proposed.ts) para acordar los datos de perfil, sala, entrada y estado de carrera. No es una API conectada al juego.
4. Resolver las decisiones de la sección 10 antes de cerrar el contrato multijugador.
5. Integrar primero perfil/economía y una sala con estado compartido; después trasladar la simulación autoritativa y resultados.
6. Leer [FRONT_ADAPTER.md](FRONT_ADAPTER.md) para conectar creación/entrada, suscripción y envío al cliente existente. El adaptador traduce el transporte que elijan; no impone endpoints.
7. Leer [PROFILE_ADAPTER.md](PROFILE_ADAPTER.md) para conectar la cartera y las operaciones de tienda/canje/taller. Ambos proveedores deben representar la misma cuenta autenticada.

El paquete ZIP de entrega contiene documentación y ejemplos; para ejecutar el juego y regenerar los fixtures se necesita el repositorio completo.

## 2. Qué hemos construido

Compunube es un juego de surf 3D con temática de limpieza del agua, relacionado con ODS 14 y las tres R. El jugador recoge residuos con una red de piscina, esquiva obstáculos, obtiene impulso y llega a la meta para guardar materiales. Después puede canjearlos por monedas o fabricar equipamiento cosmético.

| Área | Implementación actual |
|---|---|
| Plataforma | Navegador, HTML/CSS y JavaScript con módulos ES; Three.js 0.186.1 incluido en `dist/vendor/` |
| Arte | Modelos/animaciones Blender exportados como GLB; agua, espuma, cámara y efectos en el front |
| Menú | Inicio, elección de mapa, tienda, taller, personalización y ayuda |
| Carrera | Un humano y tres rivales de IA ejecutados en el mismo navegador |
| Mapas | Maracaibo y Orinoco jugables; Caroní y Encuentro anunciados como futuros |
| Sistemas | Recogida compartida, impulso, salto, obstáculos, tres vidas, salvavidas y pulpo perseguidor |
| Progresión | Materiales al completar, canje, compras, fabricación y equipamiento |
| Persistencia | Local en `localStorage`; almacén online del cliente separado, listo para proveedor externo; sin cuentas ni sincronización activa |
| Servidor actual | `server.mjs` sirve archivos estáticos de `dist/` en `127.0.0.1:4173` |
| Preparación de conexión | Lobby, adaptador de sesión, entradas y presentación de snapshots implementados en el cliente; proveedor desactivado |
| Servicio real | No hay API de negocio, base de datos, autenticación, salas de servidor ni WebSocket implementados |

La carrera local presenta un jugador y tres simulados. «Jugar con amigos» abre una sala que, sin proveedor, explica que falta el servicio. La ruta online admite hasta cuatro participantes confirmados por backend y no ejecuta física, IA, recogidas ni acreditaciones locales. «Mi progreso» conecta el perfil confirmado a tienda, canje, taller y apariencia mediante otro adaptador. Se entregan ambos proveedores en `null`: faltan servicio real, autenticación, economía persistente y pruebas con varios clientes.

Las tres R aparecen así: **reciclar**, canje de materiales; **reutilizar**, fabricación de redes; **reducir**, explicación educativa. No existe todavía una mecánica propia de reducir. Los contadores miden objetos virtuales, no impacto ambiental real.

### Ejecutar la base

Desde la raíz, con Node.js instalado:

```sh
npm start
```

Abrir `http://127.0.0.1:4173/`. El juego sirve Three.js y sus recursos desde el proyecto. `npm install` no es necesario para abrir esta copia completa con `dist/vendor/`; el gestor de paquetes se usa si hace falta preparar dependencias de desarrollo.

```sh
npm run check
npm test
```

La preparación 1.2 añade pruebas del perfil, reintentos y conexión real de funciones de `app.js`, conservando la base local y de carreras. [QA-online-profile.md](../../tests/QA-online-profile.md) registra la comprobación vigente y sus límites; [QA-network-front.md](../../tests/QA-network-front.md) conserva la revisión anterior de salas. Estos informes no acreditan un servidor, multijugador entre navegadores, carga o latencia.

## 3. Cómo está organizado el código

`dist/` contiene también el código fuente JavaScript de la aplicación, no únicamente una salida minificada. No existe una arquitectura backend oculta en esa carpeta.

| Archivo | Responsabilidad / interés para backend |
|---|---|
| `dist/app.js` | Menú, perfil en memoria, carga/guardado, acciones de tienda/taller y recepción del resultado |
| `dist/game.js` | Simulación local, IA, estado de carrera, entradas, UI y escena Three.js, todavía mezclados |
| `dist/backend-config.js` | Punto de inyección del adaptador, actualmente `null` |
| `dist/multiplayer-client.js` | Sesiones, sala, entradas permitidas, cancelación y filtrado de mensajes |
| `dist/multiplayer-lobby.js` | Pantalla de sala y estados de conexión |
| `dist/network-race.js` | Validación e interpolación de snapshots autoritativos |
| `dist/network-presentation.js` | IDs estables, modelos, propiedad confirmada, eventos y resultado sin premio local |
| `dist/economy.js` | `CATALOG`, `freshProfile`, `restoreProfile`, `transact`; módulo puro sin DOM |
| `dist/appearance.js` | IDs de personajes, peinados y colores; composición del reparto |
| `dist/maps.js` | Definiciones de mapa, semillas, longitud/límites y `createCourse`; módulo puro |
| `dist/mechanics.js` | Contacto lógico de red, agarres, carga y consumo de impulso; sin DOM |
| `dist/collection.js` | Recogida de basura por segmento barrido y propiedad única; sin DOM |
| `dist/survival.js` | Vidas, protección, salvavidas y avance/contacto del pulpo; sin DOM |
| `dist/frame-clock.js` | Pasos de simulación fijos y pausa por interrupciones del navegador |
| `dist/surf-motion.js` | Transición del ángulo de red y pose visual; contiene partes utilizables sin render |
| `dist/water-surface.js` | Ondas compartidas por agua y objetos visuales |
| `dist/surfer-animation.js`, `dist/equipment.js` | Modelos, clips, agarres y apariencia; responsabilidad del front |
| `tests/*.test.js` | Referencias ejecutables para comportamiento y regresiones |
| `art/` | Fuentes Blender y documentación artística; no son necesarios para simular una partida en backend |

### Puntos actuales de integración

- `app.js:40`: `commit(action)` llama a `transact`, reemplaza el perfil, guarda y vuelve a dibujar el menú. Es el punto natural para introducir un repositorio/servicio de perfil asíncrono.
- `app.js:11`: `equipment()` combina `profile.equipped` y `profile.appearance`; ese objeto alimenta el juego y la vista previa.
- `game.js:709`: exporta `game.state`, `game.onFinish`, `game.preview`, `game.equip`, `game.enter`, `game.exit` y `game.suspend`, además de imágenes generadas para la UI.
- `game.js:417`: `onFinish` entrega actualmente **solo** `{ raceId, plastic, metal }`; `app.js:178` lo transforma en una acción local `finish`. El callback no espera una respuesta remota; hay que añadir estado de acreditación pendiente antes de mostrar que se guardó.
- `game.enter(mapId)` selecciona el mapa, reinicia y comienza la cuenta atrás. Todavía no recibe un estado de servidor ni participantes remotos.
- No hay métodos públicos para recibir snapshots, aplicar reclamaciones de objetos, reconciliar jugadores o gestionar una sala.

No se puede conectar un socket y conservar dos simulaciones independientes repartiendo los mismos objetos. Antes del modo online hay que separar estado/reglas de escena/DOM y añadir un adaptador de entrada y snapshots.

## 4. Carrera y reglas actuales

### Coordenadas y tiempo

- Escala de juego tratada como metros; tiempos y `dt` en segundos, ángulos en radianes.
- X es lateral, Y es altura visual, el avance va hacia **Z negativo**.
- Salida del humano: `(x=3, z=0)`; meta: `z=-1800`. Los rivales parten en `(-5,-3)`, `(7,-7)` y `(-10,-10)`; esos desfases actuales deben revisarse para humanos.
- `COURSE_LENGTH=1800` (`surf-mvp-2`; era 900 en `surf-mvp-1`). `COURSE_WIDTH=15` es el **límite lateral por lado**, por lo que X se limita a `[-15,15]`; no significa un canal total de 15 m.
- La simulación del navegador consume pasos de `1/60 s`; el reloj usa marcas `performance.now()` en milisegundos y las convierte a segundos.
- `elapsed` empieza al iniciar la carrera efectiva, después de la cuenta atrás de tres segundos.

### Estado y fin de partida

Los estados actuales son `ready → countdown → running → finished`, con `paused` desde cuenta atrás o carrera. `finished` representa tanto meta como descalificación; hay que mirar `finishTime` y `disqualified` para distinguirlos. El menú y la suspensión por diálogo son indicadores separados.

El orden mostrado coloca descalificados al final, llegados por `finishTime`, y activos por Z más negativo. La cantidad recogida **no** determina la clasificación. No se otorgan monedas ni materiales extra por posición.

La carrera local completa se detiene cuando el humano llega o es descalificado. Por tanto el resultado actual no es una clasificación definitiva de cuatro humanos. En online conviene separar estado de cada participante y estado global de la sala, dejando que los demás continúen.

### Entradas

| Control | Efecto lógico |
|---|---|
| A/D o ←/→ | Dirección lateral: -1, 0 o +1; avance automático |
| Z / X | Objetivo de red izquierda (-1) / derecha (+1); permanece seleccionado |
| Espacio | Salto si está en carrera y en el agua |
| Shift mantenido | Solicitar uso de impulso mientras exista carga |
| C | Cambiar cámara; solo presentación local |
| P | Pausa de la partida local |
| Controles táctiles | Equivalentes de giro, salto, red e impulso |

Blur, pestaña oculta o un intervalo de más de 0.5 s entre fotogramas pausan la simulación local. Eso **no puede trasladarse como pausa automática de toda una sala online**; hay que acordar qué ocurre con ese participante.

### Movimiento, salto y colisiones

| Parámetro | Valor actual |
|---|---|
| Crucero humano | 16.4 m/s, alcanzado mediante amortiguación |
| Desplazamiento lateral | `turn * 10 * dt`, con amortiguación de giro 8 |
| Amortiguación de velocidad | 3 |
| Impulso | Multiplicador de crucero ×1.4 |
| Salto | Velocidad inicial vertical 6 m/s; aceleración vertical -16 m/s² |
| Golpe | `speed *= 0.45`, temporizador 1.15 s y objetivo de velocidad reducido al 50 % durante ese tiempo |
| Obstáculos | Comprobación en X/Z: `abs(dz) < radius+0.7` y `abs(dx) < radius+0.45` |
| Evitar obstáculo saltando | No comprueba choque si `jump >= 0.75` |

La colisión de obstáculos se evalúa en la posición del paso, sin barrido continuo. Basar el servidor en pasos fijos conserva el comportamiento actual; si se amplían velocidades debe revisarse esa detección.

### Basura e impulso

| `kind` | Visual / material persistente |
|---|---|
| 0 | Botella → `plastic` |
| 1 | Tubo metálico en J → `metal` |
| 2 | Envoltorio → `plastic` |

Hay 211 residuos finitos por recorrido: **141 de plástico y 70 de chatarra** entre todos los participantes. `collectedBy` empieza en `null`; actualmente su propietario es un índice local 0–3. Un residuo solo puede adjudicarse una vez. No es un recurso que reaparece por esperar o bajar la velocidad.

La recogida usa el segmento entre la posición lógica anterior y actual de la boca de la red, radio 1.25 m. Se suspende si `jump > 0.45`. No depende del halo, flotación del modelo, animación de manos o bolsa visual. Los siete recogedores comparten contacto y ventajas.

`netAngle` se aproxima al objetivo con una respuesta exponencial de tasa 8. El contacto lógico es:

```text
angle = netAngle - turn * 0.2
contactX = x + 2.05*cos(angle) - 1.4*sin(angle)
contactZ = z - 2.05*sin(angle) - 1.4*cos(angle)
```

El objetivo derecho es 0; el izquierdo es `2*atan2(2.05,1.4)` (~1.94 rad). La orientación visual del mango incluye compensaciones adicionales, que no cambian este punto lógico.

Cada residuo añade 0.20 de energía; máximo 1.00. Empieza vacía, no se regenera con el tiempo. Solicitar impulso consume 0.25 por segundo. El estado `boosting` se decide al comienzo del paso a partir de la carga positiva; puede gastar el resto de carga en ese paso.

En un empate de contacto, el código local recorre jugadores en orden y el primero obtiene el objeto. Para online habrá que definir un desempate de servidor que no favorezca siempre el puesto del jugador local.

### Vidas, salvavidas y pulpo

- Tres vidas iniciales y máximo tres. A cero, descalificación; no hay reanimación.
- Cada golpe válido resta una vida y da **2.6 s** de protección. Jugadores llegados, descalificados o protegidos no reciben otro daño.
- Diez salvavidas compartidos por recorrido. Recuperan una vida si faltan vidas y siguen disponibles cuando quien pasa tiene salud completa.
- Contacto de salvavidas: segmento barrido de la tabla, radio 1.7 m, con `jump < 0.55`.
- Pulpo: brecha inicial 48 m, margen inicial seis segundos, velocidad de persecución 17.2 m/s, brecha limitada a 3.5–64 m.
- Al llegar a 3.5 m intenta dañar y se retira durante tres segundos, abriendo distancia a 12 m/s; se retira incluso si la protección impidió el daño.
- Saltar no evita al pulpo. La vista trasera aprobada representa al perseguidor de la misma escena.
- El pulpo actual afecta **solo al humano local**, no a los tres rivales. Su reparto en multijugador es una decisión pendiente.

### Recorridos y determinismo

`createCourse(mapId)` produce 45 islas visuales, 113 obstáculos, 21 salvavidas y 211 residuos; `createCourse(mapId, 900)` reproduce exactamente `surf-mvp-1` (24, 54, 10 y 103). [`tools/generate-course-manifests.mjs`](../../tools/generate-course-manifests.mjs) escribe y comprueba los manifiestos de Go. Semillas iniciales: `maracaibo=57`, `orinoco=819`. Usa el generador `seed=(seed*1664525+1013904223)>>>0` y normaliza con `2^32`. Devuelve también la semilla avanzada, que no debe confundirse con la semilla inicial del mapa.

Las entidades todavía se identifican por posición en sus arrays; no traen IDs persistentes ni versión de curso. `fixtures/current-front.json` contiene los dos recorridos exactos antes de recoger objetos. Las islas, el puente y el paisaje aportan composición visual; los obstáculos de juego son el array `obstacles`.

La generación del recorrido es determinista; la simulación completa sigue acoplada a Three.js, al reloj/entradas del navegador y a fases de IA. No hay una implementación compartida de servidor lista para ejecutar.

**Inicialización importante:** `createCourse` produce posiciones y tipos, pero no `collectedBy`. El montaje de `game.js` añade `collectedBy: null`. Los helpers de recogida consideran disponible únicamente el valor exacto `null`; al reutilizar los datos en servidor debe añadirse ese campo. No pasar directamente los arrays crudos del fixture a `collectTrash` sin inicializarlos.

### Estado lógico actual del participante

Antes de extraer la simulación, estos son los campos que ya existen en `game.js:198`:

| Grupo | Campos actuales |
|---|---|
| Identidad local | `index`, `name`, `color`; reemplazar índice por ID online estable |
| Movimiento | `x`, `z`, `speed`, `turn`, `jump`, `jumpVelocity`, `startX`, `startZ` |
| Red/impulso | `netSide`, `netAngle`, `energy`, `boosting` |
| Vida/carrera | `lives`, `protection`, `disqualified`, `hit`, `collected`, `plastic`, `metal`, `finishTime` |
| Presentación | `phase`, `catchTimer`, `landingTimer`, efectos y referencias de objetos Three.js |

No hay choques entre surfistas implementados. Los eventos o marcas de animación pueden alimentar el front; no es necesario replicar todos sus temporizadores visuales en cada snapshot. Los tipos adjuntos dejan algunos como señales opcionales de presentación para quien se incorpora a mitad del gesto.

## 5. Perfil, inventario y catálogo

### Perfil inicial real

```json
{
  "version": 1,
  "coins": 0,
  "plastic": 0,
  "metal": 0,
  "totalCleaned": 0,
  "races": 0,
  "owned": ["coral", "costero", "red-base", "nico", "luna", "amara", "samuel", "swept", "curls", "bun", "ponytail", "afro"],
  "equipped": {"board": "coral", "outfit": "costero", "net": "red-base", "hair": "swept", "character": "nico"},
  "appearance": {"skin": "medium", "hairColor": "brown"},
  "settled": []
}
```

`plastic`/`metal` son saldos disponibles. `totalCleaned` es el acumulado de residuos acreditados en carreras completadas, no el saldo después de gastar. `races` cuenta resultados completados acreditados. `settled` guarda IDs de resultados ya cobrados, limitados a los últimos 40 en el prototipo.

No existe aún `userId`, nombre de usuario, cuenta, fecha de creación, revisión de perfil ni historial persistente de partidas en el esquema local.

### Tablas y ropa

| ID | Tipo | Nombre | Precio en monedas |
|---|---|---|---:|
| `coral` | `board` | Coral | 0, inicial |
| `manglar` | `board` | Manglar | 60 |
| `sol` | `board` | Sol del lago | 100 |
| `costero` | `outfit` | Costero | 0, inicial |
| `brisa` | `outfit` | Brisa | 40 |
| `uva` | `outfit` | Atardecer | 80 |

Los items `outfit` representan acabados de color del chaleco; cada personaje tiene su propio corte de prendas y paneles fijos desde el pase 08. No se añadieron ranuras o estadísticas de equipo nuevas. No cambiar sus IDs para acompañar una mejora de modelo.

### Redes

| ID | Nombre | Plástico | Chatarra |
|---|---|---:|---:|
| `red-base` | Red costera | 0, inicial | 0 |
| `red-reuso` | Red reutilizada | 6 | 3 |
| `red-marea` | Red marea | 10 | 5 |
| `red-cobre` | Cobre | 12 | 8 |
| `red-faro` | Faro | 16 | 10 |
| `red-aurora` | Aurora | 20 | 12 |
| `red-sol` | Sol del puente | 24 | 16 |

Las seis redes con receta se fabrican, no se compran por monedas. Las tres tablas, ropa, personajes, peinados y redes son cosméticos; no mejoran velocidad, alcance, vida o cantidad recogida.

### Personajes y apariencia

- Personajes gratuitos e inicialmente poseídos: `nico`, `luna`, `amara`, `samuel`. El segundo ID actual es `luna`; no existe un personaje `luis` en el código.
- Peinados gratuitos e inicialmente poseídos: `swept`, `curls`, `bun`, `ponytail`, `afro`.
- Piel: `light`, `warm`, `medium`, `dark`, `deep`.
- Cabello: `black`, `brown`, `blonde`, `copper`, `silver`, `blue`.
- Elegir personaje también cambia al peinado, tono de piel y color de cabello predeterminados de ese personaje. Después pueden personalizarse.
- `appearance.hairColor` es un color; `equipped.hair` es un peinado. No intercambiarlos en la API.

Predeterminados y colores exactos están exportados en el fixture. Desde el pase 08 cada personaje utiliza `surfer-{id}.glb` propio. Amara conserva el diseño del pase 07; Nico, Luna y Samuel incorporan nuevas prendas/siluetas. El pase 09 regenera los cuatro recursos para corregir deformaciones de cuerpo y ropa. Los IDs, precios, recetas y estadísticas de juego se conservan; los cambios son visuales.

### Acciones locales existentes

| Acción | Campos | Efecto |
|---|---|---|
| `buy` | `id` | Gasta precio del catálogo y añade a `owned`; no equipa |
| `craft` | `id` | Gasta ambos materiales de la receta y añade a `owned`; no equipa |
| `equip` | `id` | Requiere propiedad y actualiza la ranura del tipo; personaje restablece apariencia predeterminada |
| `appearance` | `field`, `value` | Cambia `skin` o `hairColor` si el valor existe |
| `exchange` | `material`, `amount` | Consume cantidad entera positiva; plástico ×4 monedas, chatarra ×6 |
| `finish` | `raceId`, `plastic`, `metal` | Acredita materiales y acumulados; acción interna local al cruzar meta |

`transact(profile, action)` retorna `{profile, error}`; clona antes de mutar y, si falla, devuelve el perfil anterior sin gasto. Los errores son textos españoles, no códigos de error estables de API.

**Ejemplo:** completar con 12 plásticos y 7 chatarras añade esos materiales, suma 19 a `totalCleaned` y 1 a `races`. Canjear seis plásticos consume seis y añade 24 monedas. Fabricar `red-reuso` requiere otros seis plásticos y tres chatarras; el mismo material ya canjeado no puede utilizarse de nuevo.

Solo se acreditan los materiales del jugador que cruza meta. Descalificarse, abandonar o reiniciar no añade recursos. Los resultados de los rivales simulados no se guardan en perfiles. El inventario previo permanece disponible. Una carrera nueva genera un UUID local con `crypto.randomUUID()`.

### Guardado y límites relevantes

| Clave | Valor |
|---|---|
| `compunube.profile.v1` | JSON del perfil |
| `compunube.map.v1` | Último mapa seleccionado |
| `compunube.sound.v1` | `on` / `off` |

Las claves dependen del origen: `localhost:4173` y `127.0.0.1:4173` no comparten su `localStorage`. Si guardar falla, el juego sigue en memoria y lo comunica. La cámara no se persiste; movimiento reducido procede de la preferencia del sistema.

`restoreProfile` acepta `version:1`, sanea inventario/equipamiento y solo restaura contadores enteros seguros entre 0 y menos de `1e9`. No es validación autoritativa: el usuario controla el almacenamiento y las funciones locales pueden recibir acciones inventadas. El límite se aplica al restaurar, sin una validación general equivalente de los saldos resultantes de todas las transacciones. El historial de 40 IDs tampoco evita cobrar un ID antiguo que ya salió de la lista.

Backend debe decidir si se ignora el progreso de demostración, se migra solo la apariencia o se permite una importación controlada. No asumir que un saldo recibido del navegador es legítimo.

## 6. Qué debe controlar backend

| Servidor | Front-end |
|---|---|
| Identidad de sesión/jugador y pertenencia a sala | Teclado, táctil y preferencias de cámara/audio |
| Mapa, versión de reglas, recorrido e IDs de entidades | Carga de GLB, materiales y paisaje |
| Inicio sincronizado y reloj/ticks | Dibujar/interpolar el estado recibido |
| Posiciones lógicas, salto, red, impulso y colisiones | Pose del personaje, manos, ropa, pelo y bolsa |
| Propietario único de basura/salvavidas | Halos, ocultación y efecto visual de recogida confirmada |
| Vidas, protección, descalificación y meta | Corazones, mensajes, HUD y vista trasera |
| Pulpo según política multijugador acordada | Su modelo y animación |
| Resultados y acreditación por participante | Presentar resultado y actualizar el perfil confirmado |
| Catálogo, inventario y transacciones persistentes | Tienda/taller, vistas previas y respuestas al usuario |

Las entradas del cliente expresan intención. No deben otorgar por sí mismas posiciones finales, vidas, residuos o monedas. La acción local `finish` sirve de referencia de negocio; **no debe convertirse en un endpoint que acepte cantidades declaradas por el cliente**.

La compra, canje y fabricación deben ser atómicos: validar catálogo/propiedad/saldo y descontar/adjudicar en una misma transacción persistente. Un `requestId` por operación permite reconocer reintentos. Para premios se propone unicidad persistente por `(raceId, playerId)`, conservando el resultado acreditado aunque el cliente cierre o reintente.

El servidor necesita IDs de jugador independientes de los índices locales y de los personajes elegidos: dos humanos pueden elegir Amara. Una figura/nombre cosmético no identifica una cuenta.

Las respuestas de perfil/sala deben indicar el ID confirmado del participante local (`playerId` / `selfPlayerId`). El front lo necesita para su cámara, HUD y confirmaciones de entrada; no debe asumir que siempre corresponde al índice 0. Al mostrar nombres de humanos, usar texto escapado o `textContent`: el ranking local actual construye HTML a partir de nombres constantes del club.

## 7. Modelo de datos propuesto para persistencia

Es una guía de responsabilidades; backend puede elegir tablas relacionales, documentos u otra tecnología.

| Entidad | Datos mínimos útiles |
|---|---|
| Jugador / sesión | ID estable y mecanismo de identificación acordado |
| Perfil | Saldos, acumulados, equipo, apariencia, revisión para concurrencia |
| Propiedad | Relación jugador–item única, con IDs del catálogo |
| Catálogo / reglas | Versión, precios, recetas y opciones permitidas |
| Sala | ID, mapa, máximo de jugadores, miembros, listos y estado |
| Carrera | ID, sala, versiones de reglas/curso, inicio y estado global |
| Participación | Jugador, estado, tiempos/posición y materiales recogidos |
| Acreditación | Carrera + jugador únicos; recursos acreditados y resultado |
| Operación económica | Jugador + requestId únicos; acción y respuesta para reintentos |

No hace falta persistir cada vértice, material, gota de agua o fotograma. El estado vivo de una sala y su estrategia de recuperación deben acordarse según la infraestructura elegida.

## 8. Contrato de integración propuesto

**Ninguna de estas rutas ni ningún servicio emisor están conectados.** El cliente reconoce mensajes de protocolo 1 mediante el adaptador de [FRONT_ADAPTER.md](FRONT_ADAPTER.md). Los nombres de rutas siguen siendo una propuesta para discutir el contrato; no obligan a usar REST, Socket.IO, WebSocket nativo ni un framework específico.

### Perfil y catálogo

| Operación sugerida | Uso |
|---|---|
| `GET /api/catalog` | Catálogo y versiones de reglas/cursos admitidos |
| `GET /api/profile` | Perfil del jugador autenticado/identificado |
| `POST /api/profile/actions` | Compra, fabricación, equipamiento, apariencia o canje |
| `POST /api/rooms` | Crear sala con `mapId` |
| `POST /api/rooms/{roomId}/join` | Entrar en una sala válida |
| `GET /api/rooms/{roomId}` | Consultar miembros, estado y versión del curso |

La identidad del actor proviene de la sesión validada, no de un `playerId` arbitrario en el cuerpo de una acción.

```json
{
  "requestId": "op-unique-001",
  "action": {"type": "exchange", "material": "plastic", "amount": 6}
}
```

Respuesta económica sugerida: `{requestId, playerId, profileRevision, profile}` con el saldo final confirmado. Error sugerido: `{code, message, requestId}`. Los tipos propuestos incluyen códigos de saldo insuficiente, item inválido, falta de propiedad, sala llena y versión incompatible. Un reintento reconocido devuelve el resultado previo, sin volver a gastar ni premiar.

La respuesta al entrar incluye `{selfPlayerId, room}` y el mensaje `room.state` conserva esa referencia al participante local. Son campos nuevos de servidor, no valores derivados del nombre del personaje.

### Canal de carrera

Se propone un canal de mensajes en tiempo real. [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) permite enviar/recibir datos bidireccionales en el navegador; su API no incorpora contrapresión automática, así que hay que limitar la cola y el volumen de snapshots. La elección de librería y transporte queda en backend.

| Dirección | Mensaje propuesto | Contenido |
|---|---|---|
| Cliente → servidor | `room.ready` | Preparado después de cargar recursos y aplicar equipo |
| Cliente → servidor | `race.input` | Secuencia, dirección, impulso, objetivo de red y secuencia de salto |
| Cliente → servidor | `room.leave` | Salida voluntaria |
| Servidor → cliente | `room.state` | Miembros, apariencias, mapa y listos |
| Servidor → cliente | `race.start` | ID, mapa/curso, reloj de inicio y jugadores |
| Servidor → cliente | `race.snapshot` | Tick, tiempo, jugadores, objetos reclamados y persecución |
| Servidor → cliente | `race.event` | Recogida, golpe, recuperación, llegada o descalificación |
| Servidor → cliente | `race.ended` | Clasificación y acreditaciones de todos los participantes |
| Servidor → cliente | `profile.updated` | Perfil confirmado después de una operación/acreditación |
| Servidor → cliente | `error` | Código estable y texto presentable |

Ejemplo de intención, sin posición ni recompensa declaradas:

```json
{
  "type": "race.input",
  "protocolVersion": 1,
  "raceId": "race-server-001",
  "seq": 42,
  "steer": -1,
  "netSide": -1,
  "boost": true,
  "jumpSeq": 3
}
```

`seq` ordena entradas de la conexión; `jumpSeq` aumenta al solicitar un salto y se consume una vez. Backend valida rango, estado y permiso de actuación. Mantener un botón o reenviar un mensaje no debe duplicar el salto. Cambiar de sesión/reconectar requiere sincronizar estos contadores.

El snapshot incluye estado suficiente para recuperarse sin volver a recibir cada evento: jugadores y propietarios de todos los objetos reclamados. IDs sugeridos: `trash:0`, `life:0`, `obstacle:0` dentro de una combinación de carrera/versión de curso. Esos IDs **no existen aún** en los arrays actuales.

El cliente puede interpolar estados de jugadores entre snapshots y añadir efectos visuales locales. La [interpolación de snapshots de Glenn Fiedler](https://gafferongames.com/post/snapshot_interpolation/) describe este enfoque y sus compromisos; la propuesta evita suponer que basta con compartir una semilla para sincronizar toda la simulación.

Como punto de partida de pruebas, puede conservarse simulación a 60 Hz y emitir snapshots a una frecuencia menor, por ejemplo 20 Hz. Son valores para medir/ajustar, no requisitos cerrados. Render y frecuencia de red no tienen que coincidir.

### Tipos adjuntos

`contracts-proposed.ts` mantiene los nombres del dominio actual para perfil, materiales y cosméticos. Añade IDs, versiones, sala, entrada y estado de servidor. Los campos nuevos no aparecen automáticamente en el front; ambos equipos deberán implementar el adaptador que los aplique.

Los fixtures son **datos actuales extraídos del código**, no respuestas de una API existente. No incluyen balances ni identidad de ningún usuario de prueba. `sourceHashes` registra SHA-256 de los módulos usados para poder identificar la revisión de referencia. Desde la raíz del repositorio completo pueden regenerarse con `node docs/backend/extract-fixtures.mjs`.

## 9. Orden práctico de integración

| Etapa | Trabajo backend | Trabajo front |
|---|---|---|
| Perfil y economía | Identidad, perfil persistente, catálogo y acciones atómicas | Sustituir carga/`commit`/guardado por servicio asíncrono, mostrar espera/error y evitar doble envío |
| Sala | Crear/unirse, cuatro plazas, listo/salida y mapa común | Pantalla de sala y carga de recursos antes de confirmar listo |
| Carrera compartida | Tick autoritativo, entradas, curso/IDs y snapshots | Separar simulación/render; aplicar snapshot, mostrar humanos y retirar IA local en online |
| Reglas completas | Recogida única, vida/salto/impulso, persecución acordada | Animaciones/efectos por estado confirmado, cámara propia y HUD |
| Resultados | Meta/descalificación independientes, clasificación y premio único | Resultado del participante, espera/espectador y actualización de inventario |
| Continuidad | Política de desconexión/reentrada y limpieza de salas | Estado de conexión, recuperación de snapshot y reseteo de entradas |

El modo local puede mantenerse para desarrollo y revisión artística. Los generadores Blender y modelos seguirán evolucionando sin necesidad de modificar IDs de dominio.

## 10. Decisiones que falta acordar

Estas decisiones no están implementadas ni deben deducirse del comportamiento local:

| Tema | Decisión necesaria |
|---|---|
| Tecnología docente | Stack/librería/protocolo que el profesor exige y responsabilidades de cada equipo |
| Identidad | Invitados, cuentas o ambas; si el progreso se conserva entre dispositivos |
| Inicio | Cuántos jugadores mínimos, quién elige mapa/inicia y si se rellenan plazas con IA |
| Apariencia | Si se permiten personajes repetidos y cómo distinguir humanos por nombre/color |
| Equidad | Salida común y desempate cuando dos jugadores tocan el mismo objeto en un tick |
| Pulpo | Uno por jugador, amenaza compartida u otra política consistente |
| Pausa/desconexión | Qué pasa con el participante al ocultar pestaña, perder conexión o abandonar |
| Fin global | Esperar a todos o definir tiempo límite; vista de quien ya llegó o fue eliminado |
| Recompensas | Mantener premio solo al llegar; posibles cambios de balance o recompensas futuras |
| Guardado local | Ignorar demo, migrar apariencia o migrar progreso con validación acordada |
| Versiones | Cómo acordar catálogo, reglas y curso; cuándo rechazar un cliente incompatible |

No se propone incorporar nuevas ventajas cosméticas ni monetización. Cualquier cambio de reglas debe quedar versionado y reflejado en ambos equipos.

## 11. Pruebas conjuntas sugeridas

La finalidad es validar el comportamiento compartido; pueden ajustarse al diseño final.

- Dos clientes recogen el mismo residuo: aparece un único propietario y una única carga de impulso.
- Dos solicitudes económicas simultáneas no pueden gastar el mismo saldo dos veces; reintentar una operación devuelve el resultado previo.
- Un resultado repetido, incluso después de muchas partidas, no vuelve a acreditar materiales.
- Recoger con la red izquierda/derecha, saltar, usar impulso, chocar y recuperar vida conservan las reglas acordadas.
- Un jugador al llegar/descalificarse no detiene a los demás; sus recompensas corresponden a su propio estado.
- Un cliente que entra/reconecta recupera el estado actual de jugadores y objetos ya recogidos.
- Pestaña oculta o conexión interrumpida sigue la política acordada sin pausar toda la sala por accidente.
- Mapas y posiciones de recogida coinciden en los clientes; un cliente incompatible recibe un error claro.

## 12. Referencias dentro del proyecto

- `README.md`: ejecución, controles y resumen funcional.
- `PLAN.md`: evolución por fases y sistemas futuros.
- `art/SCENE_REWORK.md`, `art/CLUB_CHARACTERS.md`: acabado visual 07 aceptado como base y familia de personajes del pase 08.
- `tests/economy.test.js`: recompensas únicas locales, canje/fabricación y equipamiento.
- `tests/survival.test.js`, `tests/maps.test.js`, `tests/frame-clock.test.js`: reglas y determinismo local.
- `tests/QA-scene-rework.md`: alcance y límites de la revisión visual.

**Conclusión operativa:** la interfaz y las reglas locales ya sirven como referencia de producto. Backend puede empezar por identidad/perfil/economía y contrato de sala. La simulación autoritativa, el canal de red, la finalización por participante y el adaptador del front son trabajo nuevo compartido.
