# Agua, espuma y residuos · 12 de octubre de 2026

## Evaluación del pase anterior

El paisaje y la tienda habían avanzado más que la sensación de surf. El agua desplazaba sus vértices muy poco y conservaba una iluminación plana. La estela era un triángulo unido al surfista, sin guardar el recorrido de los giros. Los materiales compartían un aro amarillo fino, difícil de reconocer sobre el agua. Por eso completar otro mapa no equivalía a terminar el acabado visual.

## Cambios aplicados

- `water-surface.js` define tres ondas y sus pendientes. La superficie GPU, las tablas, residuos y salvavidas comparten altura y tiempo. El agua recibe normales variables y pequeñas crestas gráficas en movimiento.
- Cada tabla genera una cinta de espuma sobre posiciones anteriores del mundo. Tiene bordes irregulares, se abre con el impulso, se desvanece y no se emite en el aire. Se limita a 46 muestras por surfista; reutiliza sus atributos de geometría.
- Los residuos flotan y se balancean. Plástico: halo azul y aro continuo. Chatarra: halo naranja y aro segmentado. Los halos son transparentes y usan materiales/geometría compartidos; no añaden una luz por objeto ni otro contexto WebGL.
- Recoger elimina conjuntamente residuo y señal; una onda breve confirma el contacto. Doce ondas reutilizables cubren ese efecto.
- Las tablas acompañan la pendiente del agua, el cuerpo compensa la inclinación del giro y la cámara de tercera persona se aproxima. Giros e impulso emiten gotas sobre el mismo conjunto de 48 instancias que usa el escurrido de la red.
- La pausa conserva el tiempo de los efectos, reiniciar limpia sus estados y la preferencia de movimiento reducido suspende balanceo/pulsos/salpicaduras. La espuma conserva su caducidad con movimiento reducido.
- Los materiales de carrera, incluidas las estelas inicialmente ocultas, se preparan con `compileAsync` antes de habilitar Jugar. La protección ante interrupciones largas permanece activa.

## Comprobaciones

`npm run check` aprobado. `npm test`: 28 pruebas aprobadas. Las tres nuevas pruebas verifican altura acotada/pendientes analíticas, conservación de curvas y buffers, pausa, suspensión de emisión en saltos, caducidad/reinicio y señales/recogida sin residuos fantasma. Las pruebas existentes de economía, animaciones GLB, equipamiento y supervivencia siguen pasando.

`node art/verification/check_environment.mjs` aprobado para ambos mapas. Se conservan sus 23 lotes instanciados y límites de orilla. Esta comprobación no mide el coste completo de partículas, personajes o GPU.

En el navegador, el primer pase se probó activamente en Orinoco: recogida inicial de plástico, impulso y giros, con agua iluminada, halo por material y estelas curvas visibles. La consola no mostró errores ni advertencias. `preview-agua-residuos.png` conserva esa captura del primer pase; los bordes de espuma y las salpicaduras se refinaron después.

El pase final cargó y preparó sus shaders sin errores/advertencias. La revisión posterior de Maracaibo se pausó automáticamente durante la cuenta atrás. El diagnóstico registró repetidamente **1.016 ms entre fotogramas**, con el documento marcado visible. El aviso confirma que actúa la protección ante intervalos largos; no permite atribuir por sí solo la causa al navegador o a la GPU. Precompilar no eliminó ese comportamiento en esta sesión. No se considera validada la fluidez sostenida del pase final.

Se revisó la distribución móvil a 390 × 844: controles táctiles, equipo, halos y vidas visibles; ancho de documento y contenido de 390 px, sin desbordamiento horizontal. La carrera permaneció pausada, por lo que esto no valida rendimiento móvil ni respuesta de todos sus controles. El tamaño temporal se restauró.

Las pruebas usan `localhost:4173`, separado del perfil habitual de `127.0.0.1:4173`. No se añadieron ni gastaron monedas/materiales. El perfil principal conserva sus 150 monedas.

## Lo que sigue abierto

Revisar el intervalo de dibujo en una sesión activa y medir rendimiento sostenido; observar las salpicaduras finales en movimiento; afinar transiciones del cuerpo/red, espuma de contacto en obstáculos/orillas, contraste entre mapas y equilibrio de dificultad. El paseo recto, las etiquetas de rivales que pueden solaparse al inicio y la repetición del paisaje todavía requieren acabado. El primer pase mejora agua y lectura de objetos, pero no declara terminado el arte.

Referencias técnicas: [materiales y compilación](https://threejs.org/docs/pages/Material.html), [atributos dinámicos](https://threejs.org/docs/pages/BufferAttribute.html), [preparación de shaders](https://threejs.org/docs/pages/WebGLRenderer.html).

## Segundo ajuste · postura y continuidad

La inclinación de tabla se amortigua con el tiempo de animación, sin modificar conducción o colisiones. La compensación del cuerpo se aplica sobre el pecho del esqueleto; deja de girar el contenedor de avatar/red, que también desplazaba los pies respecto a la tabla. Se conserva la pose del pecho anterior a ese ajuste para que no se acumule al pausar. Los agarres y apoyos siguen resolviéndose después de los clips.

La red tiene una subida rápida, una retención corta y una bajada suave dentro del mismo intervalo de recogida de 0,75 s. Los brazos siguen sus agarres. La espuma conserva su patrón sobre las muestras del recorrido, el extremo sigue la popa entre muestras y sus segmentos no atraviesan el tramo de un salto. Reutiliza buffers de posiciones, opacidades, UV e índices; los fragmentos anteriores continúan disipándose separados del nuevo contacto.

`npm run check` aprobado y `npm test`: **29 pruebas aprobadas**. La nueva comprobación sigue un punto de espuma entre actualizaciones, comprueba el contacto con la popa y que los índices no unan el salto. Las pruebas de manos/pies, distintas frecuencias de animación, pausa y reinicio siguen pasando.

El navegador cargó/preparó los shaders sin errores ni advertencias. La nueva prueba volvió a pausar al comienzo: registró 1.001 ms entre fotogramas y 85,4 ms para la llamada de dibujo anterior. Esa duración de CPU no mide por separado el tiempo de GPU ni confirma la causa del intervalo. Sigue pendiente la validación visual en movimiento y de fluidez sostenida. `preview-acabado-maracaibo.png` muestra la escena actual **pausada**, no prueba las nuevas transiciones. No se gastaron ni acreditaron recursos de los perfiles.

El pase posterior aisló también el intervalo largo en una página sin Three.js y redujo llamadas de dibujo y trabajo en pausa. Las muestras, comprobaciones y limitaciones están en [QA-performance.md](QA-performance.md); la validación de fluidez en una carrera activa continúa pendiente.
