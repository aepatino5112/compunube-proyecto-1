"""Editable stylized pursuer with an exported looping tentacle animation."""
from pathlib import Path
from math import sin, cos, pi
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def material(name, color):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    shader=m.node_tree.nodes.get('Principled BSDF'); shader.inputs['Base Color'].default_value=m.diffuse_color
    shader.inputs['Roughness'].default_value=.42
    return m
purple=material('Octopus mulberry',(.32,.065,.22)); pink=material('Tentacle underside',(.75,.27,.36))
ivory=material('Eyes ivory',(.98,.90,.70)); ink=material('Eyes deep',(.025,.055,.065))
def empty(name, parent=None):
    o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o); o.parent=parent; return o
root=empty('Octopus')
def sphere(name,loc,scale,mat,parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=10,location=loc)
    o=bpy.context.object;o.name=name;o.scale=scale;o.parent=parent;o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    return o
sphere('Mantle',(0,0,2.2),(2.2,1.9,2.55),purple,root)
sphere('Face',(0,1.3,1.4),(1.7,.85,1.2),purple,root)
for x in [-.85,.85]:
    sphere('Eye',(x,1.98,2.1),(.53,.28,.61),ivory,root)
    sphere('Pupil',(x,2.22,2.1),(.22,.12,.34),ink,root)
    sphere('Eye highlight',(x-.06,2.32,2.24),(.065,.035,.09),ivory,root)
# Eight curved arms, each animated around its attachment. No per-frame mesh rebuild.
for arm in range(8):
    angle=2*pi*arm/8
    pivot=empty('Tentacle_%02d'%arm,root)
    pivot.location=(cos(angle)*1.3,sin(angle)*1.3,.6); pivot.rotation_euler.z=angle
    points=[]
    for i in range(15):
        t=i/14;points.append(Vector((t*4.2,sin(t*pi)*.45,.10-t*.45+max(0,t-.63)**2*9)))
    verts=[]; faces=[]; sides=8
    for i,p in enumerate(points):
        tangent=(points[min(i+1,14)]-points[max(i-1,0)]).normalized()
        normal=tangent.cross(Vector((0,1,0))).normalized(); other=tangent.cross(normal).normalized()
        radius=.57*(1-i/15)**1.25+.035
        for k in range(sides):
            v=p+radius*(cos(k*2*pi/sides)*normal+sin(k*2*pi/sides)*other);verts.append(tuple(v))
    for i in range(14):
        for k in range(sides):faces.append((i*sides+k,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,(i+1)*sides+k))
    faces.append(tuple(range(14*sides,15*sides)))
    geo=bpy.data.meshes.new('Curved arm');geo.from_pydata(verts,[],faces);geo.update()
    obj=bpy.data.objects.new('Arm mesh',geo);bpy.context.collection.objects.link(obj);obj.parent=pivot;geo.materials.append(purple)
    for p in geo.polygons:p.use_smooth=True
    for i in range(3,13,2):
        p=points[i];sphere('Sucker',(p.x,p.y,p.z-.22*(1-i/15)),(.18*(1-i/18),.18*(1-i/18),.065),pink,pivot)
    for frame in [1,9,17,25,33]:
        phase=arm*pi/4+(frame-1)/32*2*pi
        pivot.rotation_euler.y=sin(phase)*.16
        pivot.rotation_euler.z=angle+cos(phase)*.075
        pivot.keyframe_insert(data_path='rotation_euler',frame=frame)
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=33;bpy.context.scene.render.fps=24;bpy.context.scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'octopus.blend'))
# Join static children of each arm by material to reduce draw calls; pivots retain animation.
for parent in [root]+[o for o in root.children if o.type=='EMPTY']:
    batches={}
    for child in list(parent.children):
        if child.type=='MESH':batches.setdefault(child.data.materials[0].name,[]).append(child)
    for objects in batches.values():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(ROOT/'dist'/'assets'/'octopus.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='SCENE')
print('OCTOPUS_READY')
