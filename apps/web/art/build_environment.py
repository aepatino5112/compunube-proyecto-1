"""Stylized shoreline kit. Run Blender --background --factory-startup --python this file."""
from pathlib import Path
from math import sin, cos, pi
from mathutils import Vector
import bpy

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def material(name, color):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1)
    value.use_nodes = True
    shader = value.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = value.diffuse_color
    shader.inputs['Roughness'].default_value = .85
    return value

wood = material('Honey wood', (.38, .21, .10))
trim = material('Cream trim', (.93, .86, .63))
walls = material('HouseColor', (.92, .92, .92))
roof = material('Terracotta roof', (.53, .19, .095))
glass = material('Window shade', (.035, .14, .17))
bark = material('Mangrove bark', (.28, .19, .11))
greens = [material('Mangrove canopy '+str(i),color) for i,color in enumerate([(.12,.30,.15),(.20,.42,.18),(.33,.51,.21)])]
boat_color = material('BoatColor', (.75, .75, .75))

def root(name):
    obj = bpy.data.objects.new(name,None)
    bpy.context.collection.objects.link(obj)
    return obj

def box(name, position, size, mat, parent, bevel=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=position)
    obj=bpy.context.object; obj.name=name; obj.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.parent=parent; obj.data.materials.append(mat)
    if bevel:
        mod=obj.modifiers.new('Rounded edges','BEVEL'); mod.width=bevel; mod.segments=1
        obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return obj

def rod(name, start, end, radius, mat, parent):
    a,b=Vector(start),Vector(end)
    bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=radius,radius2=radius*.88,depth=(b-a).length,location=(a+b)/2)
    obj=bpy.context.object; obj.name=name; obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    obj.parent=parent; obj.data.materials.append(mat)
    return obj

house=root('Palafito')
for x in [-1.55,1.55]:
    for y in [-1.35,1.35]:
        rod('Stilt',(x,y,-.5),(x,y,1.7),.15,wood,house)
box('Floor',(0,0,1.55),(3.65,3.4,.22),wood,house)
box('House',(0,.25,2.9),(3.1,2.7,2.45),walls,house,.10)
for x in [-1.57,1.57]:
    for y in [-1.1,1.6]: box('Corner trim',(x,y,2.9),(.13,.13,2.5),trim,house)
box('Front door',(.55,-1.13,2.48),(.68,.08,1.6),glass,house)
box('Door lintel',(.55,-1.19,3.30),(.84,.09,.13),trim,house)
for x in [-.85]:
    box('Window frame',(x,-1.15,2.95),(.87,.10,.87),trim,house)
    box('Window',(x,-1.21,2.95),(.69,.06,.67),glass,house)
    box('Window crossbar',(x,-1.25,2.95),(.06,.05,.67),trim,house)
for x in [-1.60,1.60]:
    box('Side window frame',(x,.25,3.0),(.10,.96,.88),trim,house)
    box('Side window',(x*1.025,.25,3.0),(.06,.76,.68),glass,house)
for side in [-1,1]:
    panel=box('Roof slope',(side*.86,.20,4.35),(2.10,3.50,.19),roof,house)
    panel.rotation_euler.y=side*.39
    for i in range(8):
        ridge=box('Roof seam',(side*.88,-1.28+i*.42,4.46),(2.14,.04,.055),roof,house,.012)
        ridge.rotation_euler.y=side*.39
rod('Roof ridge',(0,-1.56,4.76),(0,1.95,4.76),.10,trim,house)
# Open porch and a short pier point toward the racing canal.
for i in range(12): box('Pier plank',(0,-2.0-i*.29,1.50),(1.45,.26,.14),wood,house,.025)
for y in [-2.25,-4.80]:
    for x in [-.64,.64]: rod('Pier post',(x,y,-.55),(x,y,1.95),.11,wood,house)
for x in [-.70,.70]: rod('Pier rail',(x,-2.2,2.0),(x,-4.8,2.0),.045,trim,house)
box('Porch bench',(-1.05,-1.52,1.92),(.7,.4,.12),trim,house)

mangrove=root('Mangrove')
for i in range(6):
    a=i*pi/3; foot=(cos(a)*1.1,sin(a)*1.0,-.15)
    bend=(cos(a)*.62,sin(a)*.6,.7)
    rod('Prop root',foot,bend,.11,bark,mangrove)
    rod('Root shoulder',bend,(.1,0,1.4),.13,bark,mangrove)
rod('Trunk',(.1,0,.85),(-.16,.08,2.65),.23,bark,mangrove)
for i,(x,y,z) in enumerate([(-.85,0,2.85),(.55,.3,3.20),(.45,-.7,2.80),(-.1,.1,3.6)]):
    rod('Branch',(-.1,0,1.9),(x,y,z),.12,bark,mangrove)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,y,z))
    obj=bpy.context.object; obj.name='Canopy'; obj.scale=(1.3,1.2,.92)
    obj.parent=mangrove; obj.data.materials.append(greens[i%3])
    for face in obj.data.polygons: face.use_smooth=True

boat=root('Canoe')
# A shallow, open hull with a pointed bow and a contrasting interior.
vertices=[]; faces=[]; segments=32
for width,height in [(.36,.08),(.58,.44),(.48,.43),(.25,.20)]:
    for i in range(segments):
        a=i*2*pi/segments
        vertices.append((sin(a)*width,cos(a)*2.05,height+abs(cos(a))**5*.16))
for ring in range(3):
    for i in range(segments): faces.append((ring*segments+i,ring*segments+(i+1)%segments,(ring+1)*segments+(i+1)%segments,(ring+1)*segments+i))
faces.append(tuple(range(3*segments,4*segments)))
geometry=bpy.data.meshes.new('Open hull'); geometry.from_pydata(vertices,[],faces); geometry.update()
obj=bpy.data.objects.new('Canoe hull',geometry); bpy.context.collection.objects.link(obj)
obj.parent=boat; obj.data.materials.append(boat_color)
for face in geometry.polygons: face.use_smooth=True
for y in [-.65,.55]: box('Seat',(0,y,.44),(.94,.25,.09),wood,boat)
rod('Paddle',(-.78,.30,.60),(.90,-.20,.60),.045,trim,boat)
box('Paddle blade',(.96,-.22,.60),(.43,.28,.08),trim,boat)

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'shoreline-kit.blend'))
for parent,filename in [(house,'palafito'),(mangrove,'mangrove'),(boat,'canoe')]:
    batches={}
    for obj in list(parent.children_recursive):
        if obj.type=='MESH': batches.setdefault(obj.data.materials[0].name,[]).append(obj)
    for name,objects in batches.items():
        for obj in objects:
            bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active=obj
            for mod in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects: obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1: bpy.ops.object.join()
        bpy.context.object.name=name
    bpy.ops.object.select_all(action='DESELECT'); parent.select_set(True)
    for obj in parent.children_recursive: obj.select_set(True)
    result=bpy.ops.export_scene.gltf(filepath=str(ROOT/'dist'/'assets'/(filename+'.glb')),export_format='GLB',use_selection=True,export_animations=False)
    if result!={'FINISHED'}: raise RuntimeError(filename)
print('COMPUNUBE_SHORELINE_READY')
