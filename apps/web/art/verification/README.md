# Verificación local de Blender

Esta carpeta contiene una prueba técnica del acceso a Blender mediante Python y de la exportación a GLB. El objeto de prueba es un bloque con material y una animación corta; no es una tabla ni un recurso final del juego.

El proceso utiliza `--background --factory-startup`: trabaja en una sesión separada y no guarda preferencias ni modifica proyectos del usuario.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python 'C:/Users/santi/Desktop/cp/art/verification/check_blender.py'
```

El archivo `.blend` conserva la fuente editable y el `.glb` permite comprobar la importación en el Three.js del proyecto. Esta vía no requiere un plugin conectado a Codex.

Resultado verificado: Blender 5.2.1 LTS exportó el GLB; el `GLTFLoader` de la dependencia Three.js del proyecto encontró una malla, un material y un clip. `AnimationMixer` reprodujo el clip y cambió la orientación del objeto. Esta comprobación valida el intercambio básico de modelos y animaciones; el acabado visual de los recursos finales se revisará en el navegador al incorporarlos.
