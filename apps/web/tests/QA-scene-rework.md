# QA · pase 07 de conjunto visual

Fecha: 13 de octubre de 2026. Fuente: [SCENE_REWORK.md](../art/SCENE_REWORK.md).

## Comprobaciones automáticas

Después de la última exportación de Blender y de los cambios de postura:

- `npm run check`: aprobado.
- `npm test`: **60 aprobadas, 0 fallidas**.
- El GLB real mantiene 15 huesos, 8 clips, pesos normalizados y atributos de pintura finitos.
- La nueva silueta alarga las piernas y reduce la masa del cabello respecto al pase 06; conserva altura y separación longitudinal de los pies.
- Cabeza y cuerpo giran hacia la herramienta a ambos lados. Esta comprobación detectó y permitió corregir un giro con signo invertido.
- Pies y vértices deformados de las plantas se apoyan en las superficies de las tres tablas, incluida la orientación transversal final.
- Las siete redes mantienen agarres y boca de recogida en ambos extremos y posiciones intermedias, también al inclinarse.
- El encuadre incluye los vértices reales de personaje, tabla y red en escritorio y proporción vertical, con salto y posiciones laterales.
- Continúan aprobadas economía, vidas, impulso, recursos compartidos, pausa, reinicio, ondas físicas y conservación de las estelas.

## Evidencia visual

Se inspeccionaron los recursos en WebGL nativo. Carrera y estudio de movimiento no registraron errores ni avisos en la comprobación final. El estudio de composición mostró un aviso X4122 del compilador sobre la suma de constantes casi nulas; el programa compiló y dibujó la escena. No se registraron errores de shader.

| Captura | Qué demuestra |
|---|---|
| `preview-escena-antes-v7.jpg` | Escena completa del pase 06, antes de actualizar sus recursos |
| `preview-escena-despues-v7.jpg` | Conjunto final del pase 07, gesto 35 %, cuatro actores y paisaje |
| `preview-escena-izquierda-v7.jpg` | Postura final con red a la izquierda, gesto 100 % |
| `preview-postura-surf-v7.jpg` | Espalda de Amara y orientación transversal final de los pies |
| `preview-carrera-v7-intermedia.jpg` | Carrera en movimiento alrededor de 411 m, anterior al último ajuste de orientación de pies |
| `preview-inicio-v7.jpg` | Inicio actualizado con Amara y su equipo seleccionado |

La comparación del menú «Modelo» cambia el cuerpo al del pase 06, manteniendo el render y la postura actuales. No representa toda la escena anterior. Las capturas de composición usan el ensayo de volumen del estudio; ese efecto no se ha incorporado a la carrera.

La sesión de juego confirmó avance, recolección, vidas, barra de impulso y vista trasera con el nuevo color y cámara. No se repitió una carrera completa hasta meta después del último ajuste de los pies.

## Perfil y navegador

La pestaña principal se dejó actualizada en Inicio, con Amara, Coral, Costero, Red costera y Maracaibo. Al revisar la interfaz mostraba **150 monedas, 36 plásticos y 22 chatarras**. No se efectuaron compras, canjes ni fabricación durante este pase. Hubo cambios de controles y navegación ajenos a las acciones de comprobación; no se atribuye todo el estado final del perfil a una sesión aislada de QA.

El navegador devolvió un viewport de 1280 × 720, con ancho útil de documento y contenido de 1265 px. El intento de establecer 390 × 844 no cambió esas dimensiones; por tanto **no se acredita una revisión visual móvil nueva**. El encuadre vertical sí queda cubierto por proyección automática de los modelos. Se restableció la configuración de viewport y se cerraron las pestañas temporales.

## Límites

Nico, Luna y Samuel mantienen la familia de modelos anterior y necesitan el mismo cuidado de prendas y anatomía. También quedan por refinar la repetición de orillas y la deformación en hombros/caderas. No se midieron FPS sostenidos ni tiempo de GPU. La escena avanza hacia la ilustración elegida, pero todavía no alcanza su acabado.
