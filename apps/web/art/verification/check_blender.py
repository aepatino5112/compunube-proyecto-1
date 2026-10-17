"""Verify local Blender -> GLB access without changing user preferences.

Run Blender with --background --factory-startup --python <this file>.
The generated files are diagnostics, not final Compunube assets.
"""

from pathlib import Path
import bpy

output_dir = Path(__file__).resolve().parent
blend_path = output_dir / "blender-access-check.blend"
glb_path = output_dir / "blender-access-check.glb"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
probe = bpy.context.active_object
probe.name = "Compunube_Access_Check"
probe.scale = (0.6, 0.2, 1.4)

material = bpy.data.materials.new("Compunube_Coral_Check")
material.diffuse_color = (0.9, 0.36, 0.25, 1.0)
material.use_nodes = True
shader = material.node_tree.nodes.get("Principled BSDF")
shader.inputs["Base Color"].default_value = material.diffuse_color
shader.inputs["Roughness"].default_value = 0.75
probe.data.materials.append(material)

bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 24
probe.rotation_euler.z = -0.12
probe.keyframe_insert(data_path="rotation_euler", frame=1)
probe.rotation_euler.z = 0.12
probe.keyframe_insert(data_path="rotation_euler", frame=24)
bpy.context.scene.frame_set(1)

bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
result = bpy.ops.export_scene.gltf(
    filepath=str(glb_path),
    export_format="GLB",
    use_selection=True,
    export_animations=True,
)
if result != {"FINISHED"} or not glb_path.is_file():
    raise RuntimeError("Blender did not export the verification GLB")

print("COMPUNUBE_BLENDER_OK", bpy.app.version_string)
print("COMPUNUBE_GLB_BYTES", glb_path.stat().st_size)
