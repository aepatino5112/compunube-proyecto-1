"""Cartoon delta vegetation. Blender --background --factory-startup --python art/build_orinoco.py"""
from pathlib import Path
from math import sin, cos, pi
from mathutils import Vector
import bpy

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0

def material(name,color):
    mat=bpy.data.materials.new(name);mat.diffuse_color=(*color,1);mat.use_nodes=True
    shader=mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=mat.diffuse_color
    shader.inputs['Roughness'].default_value=.92
    return mat

bark=material('Delta bark',(.30,.20,.105))
rootmat=material('Delta root',(.40,.28,.13))
greens=[material('Delta leaves '+str(i),color) for i,color in enumerate([(.13,.33,.16),(.22,.43,.17),(.40,.56,.22)])]
parent=bpy.data.objects.new('Orinoco broadleaf',None);bpy.context.collection.objects.link(parent)

def rod(name,a,b,radius,mat):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=radius,radius2=radius*.62,depth=(b-a).length,location=(a+b)/2)
    obj=bpy.context.object;obj.name=name;obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    obj.parent=parent;obj.data.materials.append(mat)

rod('Curved trunk',(0,0,0),(.25,.15,3.2),.42,bark)
rod('Upper trunk',(.25,.15,3.2),(-.25,.18,6),.30,bark)
for i in range(5):
    a=i*2*pi/5
    rod('Buttress root',(cos(a)*1.15,sin(a)*1.15,.02),(.08,.04,1.8),.19,rootmat)
for i,(x,y,z,scale) in enumerate([(-1.7,-.6,5.8,(2.1,1.9,1.3)),(1.4,-.4,6.2,(2.2,1.9,1.4)),(.3,1.4,6.5,(2.3,1.8,1.5)),(-.2,-.3,7.4,(2.3,2.1,1.4)),(-1.5,1.1,6.6,(1.7,1.7,1.25))]):
    rod('Spreading branch',(.16,.1,3.5),(x,y,z-.2),.16,bark)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=(x,y,z))
    obj=bpy.context.object;obj.name='Sculpted canopy';obj.scale=scale;obj.rotation_euler.z=i*.37
    obj.parent=parent;obj.data.materials.append(greens[i%3])
    for face in obj.data.polygons:face.use_smooth=True
    # Small overlapping lobes keep the silhouette rounded and irregular.
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x+cos(i)*1.3,y+sin(i)*1.2,z-.1))
    obj=bpy.context.object;obj.name='Leaf lobe';obj.scale=(1.0,1.1,.8);obj.parent=parent;obj.data.materials.append(greens[(i+1)%3])
    for face in obj.data.polygons:face.use_smooth=True

# Keep an editable source; the export is batched by material to reduce draw calls.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'orinoco-kit.blend'))
batches={}
for obj in list(parent.children_recursive):
    if obj.type=='MESH':batches.setdefault(obj.data.materials[0].name,[]).append(obj)
for name,objects in batches.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    if len(objects)>1:bpy.ops.object.join()
    bpy.context.object.name=name
bpy.ops.object.select_all(action='DESELECT');parent.select_set(True)
for obj in parent.children_recursive:obj.select_set(True)
result=bpy.ops.export_scene.gltf(filepath=str(ROOT/'dist'/'assets'/'delta-tree.glb'),export_format='GLB',use_selection=True,export_animations=False)
if result!={'FINISHED'}:raise RuntimeError('delta-tree export failed')
print('COMPUNUBE_ORINOCO_READY')
