# Cierre de orillas · 2026-10-15

Revisión de código y geometría del paisaje existente. Se conserva la composición ilustrada, los recursos exportados, el canal, la semilla del recorrido y el puente. No se añadieron adornos ni se modificaron los modelos.

## Corrección de contacto litoral

La tira continua de espuma usaba la amplitud de las ondas sin sumar `WATER_BASE` (-0,15 m). Quedaba a 0,182 m sobre la superficie analítica, aunque el desplazamiento previsto era de 0,032 m. Ahora comparte tanto la altura base como las ondas del agua. Sus límites de descarte incluyen la nueva altura y toda la amplitud.

La espuma tenía 90 tramos para 1.600 m de costa, separados 17,78 m. Ahora sólo esa tira usa 400 tramos de 4 m para reducir los cortes al seguir las ondas. El terreno conserva sus 90 tramos, sus colores y su silueta. La lámina transparente de espuma usa `forceSinglePass`: sigue siendo visible desde ambos lados y evita dibujar una segunda pasada de caras para esta superficie fina.

## Verificación y coste

- `node --check dist/coastal-ribbon.js`: correcto.
- `node --test tests/illustrated-shore.test.js`: 2 pruebas aprobadas. La prueba nueva comprueba la altura absoluta, el pequeño desplazamiento sobre el agua, los límites de geometría, índices válidos, paso máximo de 4 m y coste acotado. El caso existente carga los GLB reales, preserva el recorrido, valida separación de 24 m y la selección de bancos con buffers reutilizados.
- `node art/verification/check_environment.mjs`: Maracaibo mantiene 27 lotes instanciados, 1.600.896 triángulos completos y separación de 24 m. Los recuentos por tramo siguen en 719.170 / 1.000.614 / 682.986 a 0 / 450 / 900 m. Orinoco mantiene 26 lotes, 456.136 triángulos y separación de 33,19 m.
- La espuma continua pasa de 360 a 1.600 triángulos: +1.240 triángulos y aproximadamente 46 KiB de atributos/índices. No añade objetos, materiales, texturas ni lotes; elimina una pasada transparente de esa lámina por cámara. Estos triángulos no están incluidos en el recuento instanciado anterior.

## Límites

Esta revisión no usa navegador ni mide FPS/GPU. La repetición de las dos familias de bancos permanece, con sus escalas y orientaciones deterministas existentes. El paisaje de Orinoco no recibe esta tira litoral y conserva su representación anterior. La revisión adicional siguiente corrige también la resolución de la superficie de agua compartida por ambos destinos.

## Conformidad entre el agua y los contactos

Se comparó `sampleWater` con la altura interpolada de las caras indexadas que realmente se dibujan. Se desplazaron los vértices de la malla con las mismas ondas y coordenadas mundiales que el shader, y se interpoló cada triángulo con coordenadas baricéntricas. La malla anterior de 64 × 180 dividía el agua en pasos de 15,625 × 13,333 m; eso producía una diferencia de hasta 9,52 cm respecto a la altura analítica usada por tablas, residuos y espuma.

El muestreo cubrió el recorrido de 0 a 900 m cada metro; canal entre -18 y 18 m cada 0,5 m, ambas orillas entre 24 y 45 m cada metro y tres posiciones en la tira litoral real. Tiempos: 0 / 0,5 / 2 / 5 / 13 / 29 / 60 s. Son 775.761 posiciones-tiempo por configuración.

| Geometría | Triángulos | Error máximo canal | Error máximo orillas | Error máximo borde de espuma |
|---|---:|---:|---:|---:|
| Anterior, uniforme 64 × 180 | 23.040 | 9,520 cm | 9,478 cm | 9,424 cm |
| Uniforme 128 × 360, comparación | 92.160 | 2,933 cm | 2,937 cm | 2,901 cm |
| Uniforme 160 × 480, comparación | 153.600 | 1,836 cm | 1,838 cm | 1,823 cm |
| Uniforme 200 × 600, comparación | 240.000 | 1,202 cm | 1,201 cm | 1,206 cm |
| **Aplicada: columnas variables, 40 × 600** | **48.000** | **0,886 cm** | **0,881 cm** | **0,891 cm** |

`water-geometry.js` conserva los 1.000 × 2.400 m del horizonte. Concentra columnas cada 4 m entre -64 y 64 m; después usa columnas en ±96, ±160, ±300 y ±500 m. Los pasos longitudinales son de 4 m. `illustrated-water.js` y la variante clásica de `environment.js` usan esa geometría sin modificar materiales, ondas, coordenadas mundiales ni límites de desplazamiento de cada consumidor.

La superficie nueva tiene 24.641 vértices y 48.000 triángulos por cámara: +24.960 triángulos respecto a la anterior. Sus atributos e índices ocupan 1.076.512 bytes, un incremento de 561.792 bytes (~549 KiB), sin nuevos objetos, materiales o lotes. El error cuadrático medio observado es de aproximadamente 0,36 cm en las tres zonas. Para todas las fases temporales, el límite conservador de interpolación dentro del corredor de ±64 m es 1,313 cm: se obtiene sumando `amplitud × rangoDeFase² / 8` de cada onda sobre cada triángulo. La prueba comprueba también ese límite, además del muestreo numérico.

Una comparación adicional entre las caras reales de espuma y agua, en el centro de ambas tiras cada metro y con los siete tiempos, dio una separación de 1,91 a 4,55 cm en 12.614 muestras: la espuma se mantuvo por encima de la superficie dibujada. Esta medición no sustituye la revisión visual ni establece un FPS. Fuera del corredor de ±64 m se conserva una aproximación más amplia del agua, bajo la costa o en el horizonte; el límite anterior se refiere al corredor de contacto.

`node --test tests/water-geometry.test.js tests/illustrated-shore.test.js`: 5 pruebas aprobadas. Sintaxis de los tres módulos de agua y verificador de ambos mapas correctos; el recuento instanciado y la separación de orillas permanecen sin cambios.
