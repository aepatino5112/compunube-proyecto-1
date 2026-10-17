"""Rebuild the editable pilot kit and runtime GLBs. Blender --background --factory-startup --python art/build_maracaibo.py"""
from pathlib import Path
from math import sin, cos, pi
from mathutils import Vector
import sys
import bpy

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def mat(name, rgb, roughness=.7):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = m.diffuse_color
    bsdf.inputs['Roughness'].default_value = roughness
    return m

concrete = mat('Warm limestone', (.65, .66, .58))
light = mat('Ivory', (.93, .88, .70))
dark = mat('Deep lagoon', (.025, .13, .12))
coral = mat('BoardColor', (.88, .24, .13), .35)
rail = mat('Rail', (.94, .60, .38), .4)
trunk = mat('Palm bark', (.31, .20, .11))
leaves = [mat('Palm leaf '+str(i), c) for i,c in enumerate([(.12,.32,.14),(.22,.43,.16),(.33,.49,.20)])]

def parent(name):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    return o

def box(name, loc, size, material, root, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.name = name; o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material); o.parent = root
    if bevel:
        modifier = o.modifiers.new('Soft edges', 'BEVEL'); modifier.width = bevel; modifier.segments = 2
        o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return o

def rod(name, a, b, radius, material, root, vertices=8):
    a,b = Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius*.9, depth=(b-a).length, location=(a+b)/2)
    o=bpy.context.object; o.name=name; o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    o.data.materials.append(material); o.parent=root
    return o

def beam(name, a, b, width, depth, material, root):
    a, b = Vector(a), Vector(b)
    o = box(name, (a+b)/2, (width, depth, (b-a).length), material, root, .12)
    o.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    return o

def export_root(root, filename):
    # One runtime mesh per material, while the saved source keeps separate parts.
    batches = {}
    for child in list(root.children_recursive):
        if child.type == 'MESH': batches.setdefault(child.data.materials[0].name, []).append(child)
    for name, objects in batches.items():
        for obj in objects:
            bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active=obj
            for modifier in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects: obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1: bpy.ops.object.join()
        bpy.context.object.name=name
    bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
    for child in root.children_recursive: child.select_set(True)
    result = bpy.ops.export_scene.gltf(filepath=str(OUT/(filename+'.glb')),export_format='GLB',use_selection=True,export_animations=False)
    if result != {'FINISHED'}: raise RuntimeError(filename)

bridge = parent('Maracaibo_Bridge')
box('Deck', (0,0,24), (440,8,1.8), concrete,bridge,.18)
box('Road', (0,0,24.7), (440,6.3,.08), dark,bridge)
for y in [-4,4]:
    box('Deck edge', (0,y,24.5), (440,.45,1.0),light,bridge,.10)
    box('Parapet', (0,y,25.3), (440,.24,1.0),light,bridge,.06)
    box('Underside beam', (0,y*.8,22.75), (440,.7,.6),concrete,bridge,.10)
for x in [-175,-105,-35,35,105,175]:
    box('Pier footing',(x,0,.2),(9.5,10,2.0),concrete,bridge,.35)
    # Broad tapered columns read as concrete mass from the race camera.
    vertices = [(x+sx*w,sy*d,z) for z,w,d in [(1.1,2.1,3.2),(22.9,3.2,3.6)] for sx,sy in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    mesh = bpy.data.meshes.new('Tapered pier')
    mesh.from_pydata(vertices,[],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    mesh.update(); pier=bpy.data.objects.new('Concrete pier',mesh)
    bpy.context.collection.objects.link(pier); pier.parent=bridge; mesh.materials.append(concrete)
    bevel=pier.modifiers.new('Pier corners','BEVEL'); bevel.width=.25; bevel.segments=2
    pier.modifiers.new('Pier normals','WEIGHTED_NORMAL')
    box('Pier cap',(x,0,22.7),(10,9,1.6),light,bridge,.25)
    for y in [-3,3]:
        for side in [-1,1]:
            beam('Pylon leg',(x+side*4.6,y,24),(x+side*.9,y,47),2.0,1.8,light,bridge)
            for i in range(8):
                reach=9+i*3.2
                rod('Cable fan',(x+side*.8,y,45.7-i*.12),(x+side*reach,y,25),.13,light,bridge,6)
        box('Pylon crossbeam',(x,y,37.5),(5.7,1.9,1.5),concrete,bridge,.15)
    box('Pylon crown',(x,0,47),(3.8,8.0,2.0),light,bridge,.15)
for x in range(-210,211,14):
    box('Road marking',(x,0,24.8),(5,.18,.04),light,bridge)

if '--bridge-only' in sys.argv:
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'maracaibo-bridge.blend'))
    export_root(bridge,'maracaibo-bridge')
    print('COMPUNUBE_BRIDGE_READY', (OUT/'maracaibo-bridge.glb').stat().st_size)
    raise SystemExit(0)

palm = parent('Palm')
for i in range(7):
    a=(.12*i,0,i*.7); b=(.12*(i+1),0,(i+1)*.7)
    rod('Trunk',a,b,.22-i*.014,trunk,palm)
for j in range(9):
    angle = j*2*pi/9
    verts=[]; faces=[]
    for i in range(6):
        t=i/5; r=t*3; z=4.95+sin(t*pi)*.55-t*.85
        width=sin(t*pi)*.46+.025
        for side in [-1,0,1]:
            verts.append((.84+cos(angle)*r-sin(angle)*width*side,sin(angle)*r+cos(angle)*width*side,z-(.12 if side else 0)))
    for i in range(5):
        for k in range(2): faces.append((i*3+k,i*3+k+1,(i+1)*3+k+1,(i+1)*3+k))
    geo=bpy.data.meshes.new('Folded frond');geo.from_pydata(verts,[],faces);geo.update()
    o=bpy.data.objects.new('Frond',geo);bpy.context.collection.objects.link(o);o.parent=palm;o.data.materials.append(leaves[j%3])
    mod=o.modifiers.new('Leaf thickness','SOLIDIFY');mod.thickness=.025

board = parent('Surfboard')
# Four perimeter rings produce a curved nose, beveled rails and a rounded tail.
verts=[]; faces=[]; n=48
for scale,z in [(.88,.10),(1,.16),(1,.25),(.9,.30)]:
    for i in range(n):
        t=i*2*pi/n
        x=sin(t)*.61*scale*(1-.13*cos(t)); y=cos(t)*1.92*scale
        verts.append((x,y,z+max(0,y-1.1)**2*.14))
for r in range(3):
    for i in range(n): faces.append((r*n+i,r*n+(i+1)%n,(r+1)*n+(i+1)%n,(r+1)*n+i))
faces += [tuple(range(n-1,-1,-1)),tuple(range(3*n,4*n))]
geo=bpy.data.meshes.new('Shaped board');geo.from_pydata(verts,[],faces);geo.update()
o=bpy.data.objects.new('Board',geo);bpy.context.collection.objects.link(o);o.parent=board;o.data.materials.append(coral)
for poly in geo.polygons: poly.use_smooth=True
box('Stringer',(0,0,.311),(.065,3.15,.013),light,board,.01)
box('Grip', (0,-.78,.32),(.72,.72,.035),dark,board,.14)
for i in range(5):box('Grip groove',(0,-1.03+i*.12,.344),(.59,.018,.008),rail,board)
rod('Nose badge',(-.18,.91,.335),(.18,.91,.335),.025,light,board)
box('Fin',(0,-1.2,-.10),(.04,.48,.40),dark,board,.035)

# Save the unmerged editable source. Runtime meshes are batched by material.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'maracaibo-kit.blend'))
for root, filename in [(bridge,'maracaibo-bridge'),(palm,'palm'),(board,'surfboard')]:
    export_root(root, filename)
print('COMPUNUBE_ART_READY', [(p.name,p.stat().st_size) for p in OUT.glob('*.glb')])
