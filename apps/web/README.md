# Surf Club: Acción por las Aguas (cliente web)

## Frontend dentro del repositorio del equipo

Importación de la base visual y jugable existente, ubicada en `apps/web/` según el ownership de Ralph Antar y Santiago Rivera. Incluye código, recursos Blender/GLB, documentación, capturas y pruebas del prototipo; no reemplaza los servicios del monorepo.

Desde la raíz del repositorio:

```sh
cd apps/web
npm ci
npm run check
npm test
npm start
```

Abrir http://127.0.0.1:4173/. El servidor incluido sirve los archivos estáticos y escucha en loopback (`COMPUNUBE_WEB_HOST`/`COMPUNUBE_WEB_PORT` lo cambian). No necesita Docker ni credenciales para la demo local. Los recursos del juego también están incluidos, por lo que `npm start` funciona sin instalar dependencias; `npm ci` prepara la compilación TypeScript y las pruebas.

### Modo online contra Go

Con el stack levantado (`docker compose up -d --build --wait` en la raíz), arrancar el cliente con el origen público de Go:

```sh
COMPUNUBE_GO_URL=http://127.0.0.1:8080 npm start
```

`server.mjs` reenvía `/v1` (HTTP y la actualización WebSocket de `/v1/realtime`) a Go conservando el `Host` de la página. Así el navegador queda en un único origen: Go emite la cookie de sesión `HttpOnly; Secure; SameSite=Strict` y comprueba `Origin` en mutaciones y en el WebSocket. Sin `COMPUNUBE_GO_URL`, `/v1` responde `503 SERVICE_UNAVAILABLE` y el modo local sigue funcionando. Los navegadores aceptan la cookie `Secure` en `http://127.0.0.1`/`localhost`; desde otro equipo por `http://<IP>` la rechazan. Para el laboratorio, `server.mjs` sirve HTTPS con `COMPUNUBE_TLS_CERT` y `COMPUNUBE_TLS_KEY` (certificado de `scripts/deploy/web-tls-cert.sh` o mkcert) y Go acepta ese origen con `PUBLIC_ORIGINS`: ver la [guía HTTPS](../../docs/deployment/https-lab.md).

### Documentación de la API (Swagger UI)

Con `COMPUNUBE_GO_URL` configurado, `http://127.0.0.1:4173/api-docs/` muestra el contrato E45 ([openapi.yaml](../../contracts/http/openapi.yaml)) con Swagger UI y permite «Try it out» contra Go por el mismo origen. `npm run build` copia el contrato y los recursos fijados de `swagger-ui-dist` a `dist/api-docs/`; CI Web falla si la copia difiere.

### TypeScript

La interfaz online (lobby de salas `src/multiplayer-lobby.ts`, panel «Mi progreso» `src/profile-panel.ts`, cliente de sala `src/multiplayer-client.ts` y almacén del perfil online `src/online-profile.ts`) y los módulos de integración (`src/net/*.ts`) están en TypeScript. Los módulos nuevos de integración online están en `src/net/*.ts` y todos se compilan con `npm run build` (TypeScript fijado en `package-lock.json`, modo `strict`) a `dist/net/`, que se versiona para que `npm start` no requiera compilar. Los tipos realtime se importan del contrato normativo [`contracts/realtime/v1.ts`](../../contracts/realtime/v1.ts) mediante `tsconfig.contracts.json`, sin copiarlo; los DTO HTTP de `src/net/e45.ts` reflejan [`openapi.yaml`](../../contracts/http/openapi.yaml). CI Web compila y falla si algún archivo generado en `dist` no coincide con su fuente.

`dist/` contiene los módulos y assets publicados directamente, no un directorio generado que deba borrarse. `art/` conserva fuentes y scripts de Blender; no se necesita Blender para jugar. `tests/` contiene pruebas y evidencias históricas. Los módulos Three.js y el auxiliar PNG de pruebas conservan sus licencias incluidas.

La simulación y el guardado del navegador son exclusivamente la demo local contra IA. Online se reciben estados confirmados, se envían intenciones y se espera confirmación de economía. `dist/backend-config.js` conecta `profileAdapter` a la API pública de Go (G57: sesión, perfil, catálogo, compra, fabricación, canje, equipamiento y apariencia) y `backendAdapter` a crear/entrar sala por E45 y al WebSocket E43 `/v1/realtime` (G59). `src/net/translate.ts` traduce los mensajes E43 a los DTO que ya validan `multiplayer-client`, `network-race` y `network-presentation`, sin mover autoridad al navegador: posiciones, recogidas, vidas, puestos y acreditación los decide Go/Rust. Una caída del WebSocket se reintenta dentro de la ventana de reentrada de 15 s sin pausar la sala, y una recarga recupera la sala o la carrera vigente con la misma sesión (G60/G61; ver [FRONT_ADAPTER.md](docs/backend/FRONT_ADAPTER.md)).

Las guías de [salas/carrera](docs/backend/FRONT_ADAPTER.md), [perfil/economía](docs/backend/PROFILE_ADAPTER.md) y [fixtures](docs/backend/fixtures/current-front.json) describen lo que espera este cliente. Sus DTOs TypeScript son propuestas de la frontera pública, **no** reemplazan el contrato interno Go↔Rust de [proto/](../../proto/) ni congelan E43. La integración respetará [ARCHITECTURE.md](../../ARCHITECTURE.md): cliente → Go; Go → Envoy/gRPC → Rust. Los proveedores del cliente deben usar la frontera pública acordada con Go, sin acceder a PostgreSQL o al gRPC interno desde el navegador.

Los planes e informes importados registran los pases del prototipo. [Trello y el roadmap del equipo](../../docs/roadmap.md) mantienen la planificación vigente: esta importación no marca tarjetas como Done ni representa el cierre del proyecto multijugador completo.

## Estado de la base importada

**Preparación front para backend (1.2).** El front incorpora **Jugar con amigos**, presentación de carreras recibidas y **Mi progreso**, con perfiles local/online separados. Tienda, canje, taller y personalización esperan la confirmación del servicio cuando se elige online; una respuesta perdida conserva la solicitud para reintentar. Ambos adaptadores se entregan desconectados: no hay multijugador ni cuentas activas. La [preparación de conexión](docs/FRONTEND_NETWORK.md) y la [guía de perfil](docs/backend/PROFILE_ADAPTER.md) describen la integración pendiente con el equipo backend.

**La v1.0 local sigue disponible:** dos mapas —Maracaibo y Orinoco—, cuatro personajes, tres tablas, siete redes y el ciclo de carrera, recogida, resultados, canje, tienda, taller y guardado. Juegas contra **tres rivales de IA**. El [resumen de entrega Front v1](docs/FRONTEND_V1.md) conserva ese cierre como historial. La [entrega al equipo backend](docs/backend/README.md) documenta reglas y contratos propuestos; el [adaptador del front](docs/backend/FRONT_ADAPTER.md) describe cómo conectarlos sin imponer transporte o endpoints.

## Abrir sin conexión a internet

Probado con **Node.js 24**. Desde la raíz de la carpeta completa:

```powershell
npm start
```

Abre [Surf Club local](http://127.0.0.1:4173/). También sirve `node server.mjs`. Para jugar no hace falta `npm install`: el servidor usa módulos de Node y Three.js está incluido en `dist/vendor/`. Modelos, recursos y audio se resuelven localmente; no hacen falta CDN, cuentas, servicios en la nube ni Blender instalado. El servidor debe seguir abierto y el navegador debe permitir WebGL.

Usa siempre la misma dirección: `localhost:4173` y `127.0.0.1:4173` tienen perfiles separados por el navegador.

## Controles

- Flechas izquierda/derecha o **A/D**: girar.
- **Espacio**: saltar obstáculos.
- **Z/X**: dejar la red a izquierda/derecha; recoge por contacto, sin botón adicional.
- **Shift**: mantener para consumir el impulso ganado recogiendo.
- **P**: pausar o continuar la carrera local. **C**: alternar tercera persona/cenital.
- **♪**: activar/silenciar sonido; el audio comienza tras interacción.
- En móvil: botones de giro, salto, lado de la red e impulso.

Una futura partida conectada sigue el reloj del servicio: perder foco libera los controles y no pausa la carrera de los demás.

## Qué incluye la v1

Las carreras de 1800 m (unos dos minutos) comparten residuos y salvavidas entre el jugador y las tres IA. Cada surfista empieza con tres vidas; los golpes y el pulpo perseguidor restan una, y los salvavidas permiten recuperarla hasta el máximo. El impulso se carga recogiendo plástico o chatarra. El pulpo se ve en la cámara trasera. El juego se pausa al perder el foco o ante interrupciones largas.

Maracaibo presenta el puente en el horizonte, palafitos, manglares y agua turquesa. Orinoco interpreta el delta con caños, bosque de copas anchas, canoas y agua verde dorada. Los recorridos son estilizados y no representan rutas geográficas a escala. Caroní y Encuentro quedan anunciados como futuras ampliaciones.

**Nico, Luna, Amara y Samuel** tienen modelos y ropa propios. Se pueden combinar cinco peinados, cinco tonos de piel y seis colores de cabello. Las tablas **Coral, Manglar y Sol del lago**, y los siete conjuntos de mango y malla del taller, son cosméticos: no conceden ventajas de velocidad o alcance. Carrera y vistas previas usan los mismos modelos Blender/GLB.

Llegar a meta guarda plástico y chatarra; descalificarse, abandonar o reiniciar no acredita recursos de esa carrera. **Tienda → Canjear** consume materiales a cambio de monedas. **Taller** consume materiales para fabricar redes. Comprar/fabricar y equipar son acciones distintas. La interfaz muestra saldos, faltantes, estados y confirmaciones.

El perfil comienza sin monedas ni materiales y se guarda en `localStorage`, bajo `compunube.profile.v1`. Destino y sonido tienen preferencias separadas. Si no se permite guardar, se avisa y la sesión continúa en memoria. El perfil es local y editable por el cliente; backend debe implementar la autoridad de resultados y economía para las partidas conectadas.

La temática vincula recogida y reciclaje con [ODS 14: Vida submarina](https://sdgs.un.org/goals/goal14). Reciclar se representa con canje y reutilizar con fabricación; reducir aparece como hábito educativo, sin mecánica propia. Los contadores miden residuos virtuales, no impacto ambiental real.

## Verificación y entrega

Ver [tests/QA-frontend-v1.md](tests/QA-frontend-v1.md) para las comprobaciones del cierre local y sus límites; [tests/QA-multiplayer-lobby.md](tests/QA-multiplayer-lobby.md) registra la interfaz de amigos. Los informes de pases anteriores se conservan como historial; sus cifras de pruebas no son el total de esta entrega. No se promete una cifra de FPS para todos los dispositivos ni igualdad exacta con la ilustración de referencia. La preparación del cliente no sustituye las pruebas con un servidor multijugador real.

Para trabajar con las pruebas, con las dependencias de desarrollo disponibles:

```powershell
npm ci
npm run check
npm test
```

`npm ci` puede necesitar conexión si los paquetes no están en caché. `npm run check` revisa sintaxis; `npm test` cubre economía, supervivencia, recorridos, animación, deformaciones, equipamiento, apoyos, agua, espuma, pausa y reinicio. La revisión del navegador distingue poses de estudio de carreras reales.

## Integración siguiente

La interfaz de sala y la frontera del cliente están preparadas; falta conectar el servicio real. Esta versión no implementa cuentas, autenticación, API de negocio, base de datos ni un servidor de partidas. `server.mjs` sirve archivos estáticos en el equipo local. El equipo backend puede partir del [adaptador del front](docs/backend/FRONT_ADAPTER.md), la [documentación de reglas](docs/backend/README.md), los [fixtures](docs/backend/fixtures/current-front.json) y los [contratos propuestos](docs/backend/contracts-proposed.ts) para acordar su conexión, simulación autoritativa y resultados.

La ruta conectada presenta estado confirmado y no concede premios al perfil offline. El almacén de perfil online del cliente está preparado y separado de `compunube.profile.v1`; faltan el proveedor, la autenticación y la persistencia del servicio. Ver [preparación 1.2 y límites](docs/FRONTEND_NETWORK.md).

El [plan](PLAN.md) distingue el cierre local v1 de esas ampliaciones. No se necesita cambiar de motor para ejecutar esta entrega: Blender 5.2.1 → GLB → Three.js es el flujo usado y documentado en [art/README.md](art/README.md). Blender se utilizó mediante scripts locales, sin un plugin conectado.

## Estudios y diagnóstico

- [Estudio de movimiento](http://127.0.0.1:4173/animation-review.html): poses, tabla y red completas, desde tres vistas.
- [Galería del club](http://127.0.0.1:4173/character-review.html): los cuatro personajes.
- [Estudio de paisaje](http://127.0.0.1:4173/scene-review.html): composición y recursos.
- [Escena piloto](http://127.0.0.1:4173/art-study.html): comparación histórica con la referencia.

Los estudios no compran ni equipan objetos en el perfil. Para diagnosticar localmente, añade `?rendimiento=1`: el panel informa intervalos, coste de CPU del último dibujo y llamadas/triángulos de ambas cámaras. No mide tiempo de GPU ni demuestra por sí solo fluidez sostenida. `/frame-probe.html` permite contrastar el intervalo sin la escena.

## Estructura

- `dist/index.html`: interfaz.
- `dist/style.css`: diseño y adaptación a móvil.
- `dist/brand.css`: identidad «Surf Club: Acción por las Aguas» de menús, diálogos y paneles: el atardecer del juego sobre el agua (cielo melocotón, agua menta, tinta de laguna, coral y sol), logo tipo calcomanía y botones-pegatina con sombra dura que se hunden al pulsar. Títulos y botones usan [Lilita One](dist/assets/fonts/OFL.txt) (OFL, incluida para funcionar sin internet); el texto usa la fuente del sistema. Se carga la última; textos secundarios con contraste de 4,5:1 o más. La escena 3D y el HUD de carrera conservan sus estilos.
- `dist/game.js`: escena, animación y simulación local.
- `dist/environment.js`: paisaje instanciado y agua animada en la GPU.
- `dist/art-direction.js`: horizonte escénico, cielo y dirección solar compartida.
- `dist/illustrated-water.js`: superficie con pigmentos y reflejos solares fragmentados.
- `dist/illustrated-materials.js`: degradados y relleno de color con propiedad explícita de materiales.
- `dist/illustrated-shore.js` y `dist/shore-layout.js`: grupos de Maracaibo y selección de tramos cercanos.
- `dist/coastal-ribbon.js`: terreno continuo, plantas bajas y espuma de costa.
- `dist/scenery-instancing.js`: geometría glTF compartida y transformaciones de emplazamiento.
- `dist/art-study.html` y `dist/art-study.js`: escena piloto para comparar Amara y el acabado elegido.
- `dist/rock-kit.js`: cuatro modelos de piedra de Blender dibujados por lotes.
- `dist/scene-review.html` y `dist/scene-review.js`: revisión estática de composición y modelos reales.
- `dist/water-surface.js`: ondas y pendientes compartidas entre GPU y objetos flotantes.
- `dist/surf-effects.js`: halos por material, ondas de recogida y estelas con historia del recorrido.
- `dist/surf-motion.js`: respuesta visual de red, postura y contacto al aterrizar.
- `dist/contact-foam.js`: espuma de contacto compartida para obstáculos y orillas.
- `dist/animation-review.html` y `dist/animation-review.js`: revisión manual de gestos con los modelos reales.
- `dist/buoys.js`: geometría compartida e instancias de las boyas del recorrido.
- `dist/render-diagnostics.js`: medición opcional del intervalo y coste de dibujo.
- `dist/frame-probe.html`: prueba de fotogramas sin cargar la escena 3D.
- `dist/maps.js`: destinos y generación determinista de sus recorridos.
- `dist/equipment.js`: instancias de tablas y redes de Blender, con geometría compartida y materiales propios.
- `dist/frame-clock.js`: avance en pasos fijos, pausa ante interrupciones y descarte de tiempo al reiniciar.
- `dist/audio.js`: efectos procedurales y ambiente, con controles de silencio persistentes.
- `dist/surfer-animation.js`: clips del surfista, transiciones y ajuste de agarres/apoyos.
- `dist/app.js`: navegación, tienda, taller, resultados y guardado.
- `dist/backend-config.js`: inyección del adaptador del servicio, sin conexión configurada en esta entrega.
- `dist/multiplayer-client.js`: ciclo de conexión, sala y mensajes con el adaptador de backend.
- `dist/multiplayer-lobby.js` y `.css`: interfaz de amigos, códigos, participantes y alternativa local.
- `dist/network-race.js` y `dist/network-presentation.js`: validación y presentación de carreras autoritativas, sin simular reglas ni conceder premios locales.
- `dist/economy.js`: inventario, compra, fabricación, canje y acreditación de carreras.
- `dist/survival.js`: vidas, protección, salvavidas y distancia de persecución.
- `dist/chase-view.js`: pulpo, animaciones GLB y cámara trasera sobre el mismo renderizador.
- `dist/assets/`: GLB exportados desde Blender.
- `dist/collection.js`: recogida con detección del recorrido de la red.
- `dist/mechanics.js`: alcance de la red y balance de impulso.
- `dist/vendor/`: Three.js y su licencia.
- `server.mjs`: servidor local, limitado a `dist/`.

## Historial de arte y revisiones

Los siguientes párrafos registran los pases que llevaron a la v1. Las capturas, cifras de pruebas y observaciones corresponden a cada pase; no son pendientes nuevos ni sustituyen el informe del cierre. Se conservan las fuentes y decisiones para posteriores mejoras.

El primer pase de dirección artística sitúa el puente en un fondo escénico que acompaña toda la carrera, siempre delante del jugador en tercera persona. Cielo, luz cálida y destellos del agua comparten la dirección solar. Cuatro rocas de Blender sustituyen los volúmenes redondos repetidos del recorrido y de las orillas. La guía y las fases de personaje, redes y paisaje de aquel momento están en [art/ART_DIRECTION.md](art/ART_DIRECTION.md). El [estudio de paisaje](http://127.0.0.1:4173/scene-review.html) permite revisar salida, mitad, meta y los cuatro modelos sin modificar el perfil.

El [primer traslado del boceto aceptado](art/AMARA_PILOT.md) integra un modelo nuevo de Amara, con proporciones, chaleco y articulaciones revisados, en tienda y carrera. La [escena piloto](http://127.0.0.1:4173/art-study.html) permite compararlo con el anterior desde la misma cámara, animar el traslado de la red y revisar una pequeña orilla. Su familia de vegetación y palafitos ya se integra en Maracaibo. La ilustración fue la referencia de acabado; aquel pase inicial dio paso a las revisiones posteriores de dirección artística.

El [pase 02 de acabado ilustrado](art/ILLUSTRATED_RENDER.md) lleva el agua con pigmentos y reflejos fragmentados, materiales con degradados y luz cálida a las carreras de ambos mapas. La cámara acerca al surfista y las etiquetas ocupan menos espacio; la estela y la espuma tienen más presencia. El puente añade pilares sólidos, vigas y abanicos de cables modelados en Blender. La pequeña orilla de Blender añade color por vértice, árboles, plantas y porches, y se revisó dentro de la escena piloto. La revisión está en [tests/QA-illustrated-render.md](tests/QA-illustrated-render.md).

El [pase 03 de composición de orillas](art/SHORE_COMPOSITION.md) extiende esa familia a Maracaibo: alterna aldeas y manglares, añade profundidad, conecta los grupos con una costa continua y sitúa espuma, plantas, rocas y canoas junto al agua. Los bancos de Blender comparten geometría y se dibujan por tramos cercanos, conservando los buffers al avanzar o reiniciar. El paisaje continúa después de la meta para mantener el horizonte. Orinoco conserva su composición del delta. La revisión está en [tests/QA-shore-composition.md](tests/QA-shore-composition.md).

El [pase 04 de comparación con la referencia](art/REFERENCE_ALIGNMENT.md) revisa Amara, tablas, profundidad de las siete redes, cámara, postura, nubes, reflejos y sombras. Corrige la distancia adicional que introducía el seguimiento de cámara al avanzar. `/art-study.html` muestra la imagen acordada al lado de la escena real, compara el modelo anterior y prueba sombras de contacto adicionales. Ese efecto adicional permanece en el estudio; los demás cambios se integran en el juego. [Capturas y comprobaciones](tests/QA-reference-alignment.md) registran el avance y las diferencias artísticas detectadas entonces.

El [pase 05 de paisaje pintado](art/PAINTED_SCENERY.md) integra hojas con atlas transparente sobre copas/ramas 3D, raíces más construidas, palafitos con porches y ventanas detalladas y cuatro perfiles de roca revisados. Las piezas de orilla proyectan sombras en Maracaibo. En `/art-study.html`, **Orilla de cerca** permite inspeccionarlas. [QA-painted-scenery.md](tests/QA-painted-scenery.md) recoge las capturas y 54 pruebas aprobadas.

El [pase 06](art/CHARACTER_FINISH.md) refina el modelo de Amara, ropa, rostro, manos/pies, rizos y pintura local. El cambio Z/X intercambia agarres y ajusta la orientación del mango sin desplazar la boca de recogida.

El [pase 07](art/SCENE_REWORK.md) revisa el conjunto: proporciones más atléticas, pies atravesados sobre la tabla, torso que mira hacia la red, cámara lateral más baja, luz cálida, color más intenso, pigmentos de agua y estelas más presentes. `/art-study.html` reúne cuatro actores y compara Amara con el modelo del pase 06 bajo el render actual, además de mostrar la ilustración elegida. [QA-scene-rework.md](tests/QA-scene-rework.md) registra las comprobaciones de esa entrega.

El [pase 08 de personajes](art/CLUB_CHARACTERS.md) añade modelos Blender propios para Nico, Luna y Samuel: mangas y bermudas de Nico, paneles lavanda y coleta de Luna, lycra teal/ocre y rizos de Samuel. Carrera, rivales, tienda y revisores utilizan sus recursos por ID. Amara conserva el acabado aprobado. [El club](http://127.0.0.1:4173/character-review.html) permite compararlos juntos o de cerca, de frente/espalda y al cambiar la red. Los cuatro mantienen peinados, tonos y equipamiento cosmético; [QA-club-characters.md](tests/QA-club-characters.md) registra las 61 pruebas y la revisión.

El visor ajusta el encuadre a la pose y al tamaño del panel para mostrar personaje, tabla y red completos. La revisión posterior del pase 08 corrigió el panel del short de Luna y los dobladillos de Nico y Samuel en Blender. [QA-motion-review.md](tests/QA-motion-review.md) registra las capturas y las 62 pruebas aprobadas.

El [pase 09 de deformaciones](art/CHARACTER_DEFORMATION.md) corrige los brazos que se ensanchaban al alcanzar el mango, las sisas que formaban solapas invertidas y las uniones de cintura, muñeca y tobillo. Los paneles y dobladillos de los shorts forman parte de la tela; Luna tiene una V de espalda continua. Los cuatro recursos Blender se regeneraron y mantienen sus anclajes y personalización. [QA-character-deformation.md](tests/QA-character-deformation.md) recoge las capturas y las 65 pruebas aprobadas.

El [pase 10 de tablas](art/BOARD_FINISH.md) corrige dibujos que se cruzaban con la cubierta, baja la goma al apoyo de los pies y añade quillas curvas. Coral, Manglar y Sol mantienen sus identidades y precios. El estudio de movimiento permite compararlas sin equiparlas. [QA-board-finish.md](tests/QA-board-finish.md) registra las capturas y las 67 pruebas aprobadas. Este pase precedió a la revisión de contacto, giro, espuma y estela de la entrega v1.

## Música

Una pista por pantalla, en bucle y con fundido entre pistas (`dist/audio.js`, `createMusic`). El botón «Sonido» la controla junto con los efectos, y suena desde el primer clic o tecla (los navegadores bloquean el audio antes).

| Pantalla | Pista | Autor | Licencia |
|---|---|---|---|
| Inicio | Summer Adventure | Flixberry Entertainment | CC BY 4.0 |
| Club y salas | Racing Game Menu | MintoDog | CC0 |
| Lago de Maracaibo (y última recta) | Sunny City (y su versión *climax*) | MintoDog | CC0 |
| Río Orinoco (y última recta) | Joyful Jungle (y su versión *climax*) | MintoDog | CC0 |

Fuentes y licencias en `dist/assets/music/CREDITS.txt`; en el juego, «Créditos» en el pie del club.
