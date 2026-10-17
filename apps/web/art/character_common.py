"""Shared editable geometry helpers for the club's illustrated character family.

Operate before skin binding/export. Coordinates are game Y-up, facing -Z;
the generator's coord() handles conversion to Blender's Z-up convention.
"""
from math import sin, cos, pi
from mathutils import Vector
import bpy


def set_bone(ctx, name):
    ctx['current_bone'] = name


def remove_pieces(ctx, prefixes):
    if isinstance(prefixes, str):
        prefixes = (prefixes,)
    for obj in list(ctx['root'].children):
        if obj.type == 'MESH' and obj.name.startswith(tuple(prefixes)):
            bpy.data.objects.remove(obj, do_unlink=True)


def remap_character(ctx, arms, legs, transform):
    bpy.context.view_layer.update()
    for obj in ctx['root'].children:
        if obj.type != 'MESH':
            continue
        inverse = obj.matrix_world.inverted()
        for vertex in obj.data.vertices:
            p = obj.matrix_world @ vertex.co
            vertex.co = inverse @ ctx['coord'](transform(p.x, p.z, -p.y))
        obj.data.update()
    arms = {side: tuple(transform(*point) for point in points) for side, points in arms.items()}
    legs = [(side, transform(*hip), transform(*knee), transform(*foot)) for side, hip, knee, foot in legs]
    ctx['pilot_bone_points'] = {
        name: tuple(transform(*point) for point in points)
        for name, points in ctx['pilot_bone_points'].items()
    }
    bpy.context.view_layer.update()
    return arms, legs


def mesh_piece(ctx, name, vertices, faces, material, bone='Chest'):
    data = bpy.data.meshes.new(name)
    data.from_pydata([ctx['coord'](p) for p in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = ctx['root']
    obj['deform_bone'] = bone
    data.materials.append(material)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(data.vertices))), 1.0, 'REPLACE')
    for face in data.polygons:
        face.use_smooth = True
    return obj


def tube_piece(ctx, name, points, radii, material, bone='Chest', sides=16):
    vertices, faces = [], []
    for i, point in enumerate(points):
        tangent = Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(0, i - 1)])
        tangent.normalize()
        across = tangent.cross(Vector((0, 0, 1)))
        if across.length < .01:
            across = tangent.cross(Vector((0, 1, 0)))
        across.normalize()
        other = tangent.cross(across).normalized()
        radius = radii[i] if isinstance(radii, (list, tuple)) else radii
        rx, ry = radius if isinstance(radius, (list, tuple)) else (radius, radius)
        for j in range(sides):
            angle = j * 2 * pi / sides
            vertices.append(Vector(point) + rx * across * cos(angle) + ry * other * sin(angle))
    for i in range(len(points) - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces += [tuple(range(sides - 1, -1, -1)), tuple((len(points) - 1) * sides + j for j in range(sides))]
    return mesh_piece(ctx, name, vertices, faces, material, bone)


def sew_tube_panel(obj, sides, rows, angles, material):
    """A coloured fabric inset is part of the cloth, not a second skin shell."""
    slot = len(obj.data.materials)
    obj.data.materials.append(material)
    columns = {angle % sides for angle in angles}
    for row in rows:
        for col in columns:
            obj.data.polygons[row * sides + col].material_index = slot
