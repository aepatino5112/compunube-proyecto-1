"""Bake broad local occlusion into editable vertex paint, without light direction.

Small nearby creases keep depth when viewed from behind. Each hair variant is
baked against its own geometry; hidden hairstyles do not shadow the active one.
"""
from math import sqrt, sin, cos, pi
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def paint_character(root):
    meshes=[obj for obj in root.children if obj.type=='MESH']
    body=[obj for obj in meshes if not obj.data.materials[0].name.startswith('Hair-')]
    variants={style:[obj for obj in meshes if obj.data.materials[0].name=='Hair-'+style]
              for style in ['swept','curls','bun','ponytail','afro']}

    def tree(objects):
        vertices,faces=[],[]
        for obj in objects:
            offset=len(vertices)
            vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
            faces.extend(tuple(offset+i for i in p.vertices) for p in obj.data.polygons)
        return BVHTree.FromPolygons(vertices,faces,all_triangles=False)

    def bake(objects,bvh):
        for obj in objects:
            mat=obj.data.materials[0];normal_matrix=obj.matrix_world.to_3x3().inverted().transposed()
            colours=obj.data.color_attributes.new(name='Painted character',type='FLOAT_COLOR',domain='POINT')
            for vertex in obj.data.vertices:
                point=obj.matrix_world @ vertex.co
                normal=(normal_matrix @ vertex.normal).normalized()
                if normal.length<.5:normal=Vector((0,0,1))
                across=normal.cross(Vector((0,0,1)))
                if across.length<.01:across=normal.cross(Vector((0,1,0)))
                across.normalize();other=normal.cross(across)
                occlusion=0
                for i in range(12):
                    t=(i+.5)/12;angle=i*2.399963229728653
                    direction=normal*sqrt(1-t)+sqrt(t)*(across*cos(angle)+other*sin(angle))
                    hit,_,_,distance=bvh.ray_cast(point+normal*.006,direction,.28)
                    if hit is not None:occlusion+=(1-distance/.28)**.5
                shade=1-.30*occlusion/12
                # Broad colour variation follows the authored form, not race position.
                height=max(0,min(1,point.z/3.15))
                if mat.name.startswith('Hair-'):
                    tint=(.86+.14*height,.85+.12*height,.85+.09*height)
                elif mat.name=='Skin':
                    tint=(.95+.05*height,.94+.055*height,.96+.025*height)
                else:
                    tint=(.91+.09*height,.94+.06*height,.97+.03*height)
                colours.data[vertex.index].color=(*(shade*c for c in tint),1)
    # The worn hairstyle shades the body. Alternate caps must not paint their
    # hidden volume into a different character's face, collar or shoulders.
    default_style={'nico':'swept','luna':'ponytail','samuel':'curls'}.get(root.get('character_id'),'afro')
    bake(body,tree(body+variants[default_style]))
    for objects in variants.values():
        if objects:bake(objects,tree(body+objects))
    for mat in {mat for obj in meshes for mat in obj.data.materials}:
        shader=mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Roughness'].default_value=.64 if mat.name=='Skin' else .78 if mat.name.startswith('Hair-') else .87
        colour=mat.node_tree.nodes.new('ShaderNodeVertexColor');colour.layer_name='Painted character'
        multiply=mat.node_tree.nodes.new('ShaderNodeMix');multiply.data_type='RGBA';multiply.blend_type='MULTIPLY'
        multiply.inputs[0].default_value=1;multiply.inputs[6].default_value=mat.diffuse_color
        mat.node_tree.links.new(colour.outputs['Color'],multiply.inputs[7])
        mat.node_tree.links.new(multiply.outputs[2],shader.inputs['Base Color'])
    print('COMPUNUBE_CHARACTER_VERTEX_PAINT_READY',sum(len(obj.data.vertices) for obj in meshes))
