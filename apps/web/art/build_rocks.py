"""Four authored rock silhouettes. Blender --background --factory-startup --python art/build_rocks.py"""
from pathlib import Path
from math import sin, cos, pi
import bpy

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def linear_hex(value):
    channels = [int(value[i:i+2], 16)/255 for i in (0, 2, 4)]
    return tuple(c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in channels)

material = bpy.data.materials.new('Rock painted strata')
material.use_nodes = True
shader = material.node_tree.nodes.get('Principled BSDF')
shader.inputs['Roughness'].default_value = .93
color = material.node_tree.nodes.new('ShaderNodeVertexColor')
color.layer_name = 'RockColor'
material.node_tree.links.new(color.outputs['Color'], shader.inputs['Base Color'])

specs = [
    ('basalt', 9, 1.30, 1.20, 1.40, '536b73', '8d9b96'),
    ('sandstone', 10, 1.48, 1.10, .96, 'aa8966', 'd2b596'),
    ('split', 11, 1.35, 1.10, 1.28, '6d827c', 'aab3a0'),
    ('slab', 8, 1.52, .97, .67, '756a73', 'a39895'),
]
roots = []
for variant, (name, n, width, depth, height, base, edge) in enumerate(specs):
    root = bpy.data.objects.new('Rock_'+name, None)
    bpy.context.collection.objects.link(root)
    vertices, faces = [], []
    # Separate profiles: a leaning stack, broad weathered wedge, notched split
    # and low shelf. The collision envelope remains independent of these forms.
    profiles={
        'basalt':[(.64,-.48),(1,-.05),(.83,height*.36),(.71,height*.73),(.42,height*.95)],
        'sandstone':[(.68,-.48),(.98,-.04),(.94,height*.25),(.82,height*.62),(.59,height*.82)],
        'split':[(.68,-.48),(1,-.04),(.88,height*.33),(.80,height*.67),(.61,height*.91)],
        'slab':[(.76,-.38),(1,-.04),(.94,height*.25),(.87,height*.55),(.56,height*.82)],
    }
    profile=profiles[name]
    for ring, (radius, y) in enumerate(profile):
        for i in range(n):
            a = 2*pi*i/n
            irregular = 1 + .11*sin(i*2.7+variant) + .04*cos(i*1.3+variant+ring*.43)
            notch = .48 if name == 'split' and i in (2,3) and ring >= 2 else 1
            offset=[0,.015,-.10,.045,.12][ring]*width
            x = cos(a)*radius*width*irregular*notch + offset
            z = sin(a)*radius*depth*irregular+max(0,ring-1)*.035*cos(variant)
            top = y + (.13*sin(a+variant)+.065*cos(a*3+.4) if ring >= 2 else 0)
            if name=='sandstone' and ring>=2:top+=cos(a)*height*.12
            if name=='slab' and ring>=2:top+=sin(a+.3)*height*.12
            if name == 'split' and i in (2,3) and ring >= 3:
                top -= height*.40
            vertices.append((x, -z, top))
    for ring in range(len(profile)-1):
        for i in range(n):
            a = ring*n+i; b = ring*n+(i+1)%n
            faces.append((a,b,b+n,a+n))
    faces.extend([tuple(range(n-1,-1,-1)), tuple(range(4*n,5*n))])
    geometry = bpy.data.meshes.new('Cut strata '+name)
    geometry.from_pydata(vertices, [], [tuple(reversed(face)) for face in faces]); geometry.update()
    obj = bpy.data.objects.new('Rock '+name, geometry)
    bpy.context.collection.objects.link(obj); obj.parent = root
    obj.data.materials.append(material)
    layer = geometry.color_attributes.new(name='RockColor', type='FLOAT_COLOR', domain='CORNER')
    colors = [linear_hex(base), linear_hex(edge), linear_hex('354e4b')]
    for polygon in geometry.polygons:
        band = polygon.index//n
        choice = 2 if band == 0 else 1 if polygon.index == len(faces)-1 or polygon.index%9 == 0 else 0
        shade = .92 + .12*(sin(polygon.index*4.1+variant)*.5+.5)
        for index in polygon.loop_indices:
            vertex=geometry.vertices[geometry.loops[index].vertex_index].co
            height_mix=max(0,min(1,(vertex.z+.45)/(height+.45)))
            painted=.70+.29*height_mix+.035*sin(vertex.x*2.2+vertex.y*.9)
            layer.data[index].color = (*[min(1, c*shade*painted) for c in colors[choice]], 1)
    bevel = obj.modifiers.new('Worn corners', 'BEVEL'); bevel.width = .055; bevel.segments = 2
    bevel.affect = 'EDGES'
    obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
    root.location.x = variant*4
    roots.append(root)

# Editable contact sheet retains modifiers. GLBs have one material/mesh each.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'rock-kit.blend'))
for root in roots:
    root.location.x = 0
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in root.children:
        obj.select_set(True); bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    result = bpy.ops.export_scene.gltf(filepath=str(ROOT/'dist'/'assets'/('rock-'+root.name[5:]+'.glb')), export_format='GLB', use_selection=True, export_animations=False)
    if result != {'FINISHED'}: raise RuntimeError(root.name)
print('COMPUNUBE_ROCK_KIT_READY')
