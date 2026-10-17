# Surfistas y recogedores · pase 03

2026-10-13. Caricatura con más intención de espalda; los cambios cosméticos no conceden ventajas.

## Personaje

Tienda → Personajes ofrece cuatro surfistas desde el inicio: Nico y Samuel, hombres; Luna y Amara, mujeres. Sus rostros, anchura de hombros y proporciones del chaleco tienen variaciones modeladas en Blender. Se mantienen la cabeza grande, ojos expresivos y construcción de ropa del club.

Hay cinco tonos de piel y seis colores de cabello: negro, castaño, rubio, cobrizo, plateado y azul. Los cinco peinados —Al viento, Rizos, Recogido, Coleta y Afro— se pueden usar en cualquier personaje. La vista previa permite mirar de frente o espalda. Todas estas elecciones son gratuitas y no alteran estadísticas.

Seleccionar un personaje aplica su apariencia inicial; después se personaliza libremente. Volver a pulsar el personaje activo conserva los colores personalizados. Las elecciones se guardan inmediatamente en el perfil, también al cambiar de pestaña o recargar. Los retratos muestran los modelos reales con su apariencia inicial; la vista grande muestra la combinación personalizada.

Se conserva el esqueleto de 15 huesos y sus ocho clips. Un GLB compartido contiene las formas Luna, Amara y Samuel como objetivos de deformación; Nico usa la forma base. Cada actor tiene influencias de forma, materiales de piel/cabello, esqueleto y mezclador independientes. Los cinco peinados comparten el rig y solo uno es visible por actor. Los rivales son Amara, Luna y Samuel. La ropa todavía mantiene el corte del club con distintas paletas; prendas y accesorios propios para cada personaje siguen abiertos para otro pase.

El [primer pase basado en el concepto elegido](AMARA_PILOT.md) sustituye la Amara activa por `surfer-amara.glb`, con modelo, chaleco y articulaciones revisados. La forma anterior se conserva para la comparación. Nico, Luna y Samuel siguen usando la familia compartida descrita arriba. La vista piloto prueba la nueva orilla y agua antes de extenderlas a los mapas.

## Siete conjuntos de recogedor

| Diseño | Mango | Malla / aro | Acabado |
|---|---|---|---|
| Costera | Metal recuperado y empuñaduras oscuras | Circular, bolsa en U | Común |
| Reutilizada | Madera, uniones y reparación en espiral | Cuadrado redondeado | Común |
| Marea | Metal con bandas violeta | Óvalo largo, doble borde | Destacada |
| Cobre | Cobre recuperado con envoltura oscura | Hexagonal | Destacada |
| Faro | Acero con tramo telescópico | Octagonal, luces verde agua | Especial |
| Aurora | Acero y dos rieles protectores | Gota, doble borde, luces azules | Especial |
| Sol del puente | Acero con tramo telescópico | Óvalo ancho, luces ámbar | Especial |

Todos tienen cordones diagonales, amarras al aro y costura inferior. Las bandas luminosas usan emisión del material glTF, sin bloom ni luces adicionales. Las categorías de acabado describen la apariencia; no son probabilidades de obtención.

El taller fabrica conjuntos completos de mango y malla, cada uno con su receta de plástico y metal. Son siete conjuntos, no 49 combinaciones intercambiables. Separar componentes puede desarrollarse después, conservando los anclajes y migrando las recetas con cuidado. También quedan abiertos otros objetos fabricables, por ejemplo tablas recuperadas y accesorios de ropa; no aparecen como funciones disponibles todavía.

## Movimiento y compatibilidad

El mango se adelanta al torso sin mover el centro de recogida `(2.05, .34, -1.4)`. Las empuñaduras se encuentran a los factores .15 y .43 de su segmento. `NET_GRIPS` comparte esas coordenadas con el IK y las pruebas. El contacto de recogida, impulso y alcance siguen siendo iguales para todos los diseños.

El cambio de lado usa una respuesta exponencial de velocidad 8: continuo al invertir Z/X y congelado durante la pausa. La bolsa se levanta durante el arco; el pecho y la cabeza acompañan. Es un primer refinamiento: se seguirá evaluando peso, codos y cruces desde la cámara real.

Los guardados v1 conservan monedas, materiales y equipo. Se añade Nico y una apariencia válida a perfiles antiguos sin personaje, conservando su peinado previo. Fabricar consume materiales una sola vez; equipar o personalizar no cambia balances ni estadísticas.

## Producción

Fuentes editables `surfer.blend` y `equipment-kit.blend`; scripts `build_surfer.py` y `build_equipment.py`; GLB compartidos por carrera, taller y estudio manual. Modelo y bolsa se revisan con la cámara de juego además del estudio de movimiento. Las pruebas verifican pesos y esqueletos independientes, manos/pies, pausas, reversión, siete recetas y restauración.

La [documentación de SkinnedMesh de Three.js](https://threejs.org/docs/pages/SkinnedMesh.html) sustenta el uso de índices/pesos y esqueletos cargados por GLTFLoader; se conserva SkeletonUtils para clonar la estructura correctamente. La calidad artística requiere revisión visual además de estas pruebas.
