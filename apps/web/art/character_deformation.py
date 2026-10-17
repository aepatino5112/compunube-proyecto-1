"""Finish continuous joints and open garments before binding/export.

This works on the editable meshes, in Blender world coordinates. It keeps the
existing hand/foot anchors and the wardrobe; no runtime cloth simulation.
"""
import bpy
import bmesh
from mathutils import Vector


def smoothstep(value):
    t = max(0, min(1, value))
    return t*t*(3-2*t)


def finish_deformation(ctx, arms, legs):
    root = ctx['root']
    bpy.context.view_layer.update()
    chest_y = ctx['pilot_bone_points']['chest'][0][1]

    def set_weights(obj, vertex, weights):
        for group in obj.vertex_groups:
            group.remove([vertex.index])
        for name, weight in weights.items():
            if weight <= .00001:
                continue
            group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
            group.add([vertex.index], weight, 'REPLACE')

    def game_point(obj, vertex):
        p = obj.matrix_world @ vertex.co
        return Vector((p.x, p.z, -p.y))

    # Do not render anatomy through opaque clothing. The hidden torso used to
    # protrude as a skin-coloured wedge at the hip when the jersey leaned.
    for obj in list(root.children):
        if obj.type != 'MESH' or not obj.name.startswith('Continuous athletic torso'):
            continue
        if ctx.get('CHARACTER') == 'samuel':
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        hidden = [face for face in mesh.faces if all(
            (obj.matrix_world @ vertex.co).z < chest_y+.29 for vertex in face.verts)]
        bmesh.ops.delete(mesh, geom=hidden, context='FACES_ONLY')
        # Remove unused points as well; exporters need only occupied geometry.
        loose = [vertex for vertex in mesh.verts if not vertex.link_faces]
        bmesh.ops.delete(mesh, geom=loose, context='VERTS')
        mesh.to_mesh(obj.data)
        mesh.free()

    # All lower torso layers follow the pelvis at the waist, then gradually
    # follow the chest. Rigid Chest-only hems peeled away from the waistband.
    for obj in list(root.children):
        if obj.type != 'MESH':
            continue
        groups = {group.name for group in obj.vertex_groups}
        if groups == {'Chest'}:
            for vertex in obj.data.vertices:
                p = game_point(obj, vertex)
                blend = smoothstep((p.y-chest_y)/.32)
                if blend < 1:
                    set_weights(obj, vertex, {'Hips': 1-blend, 'Chest': blend})
        # Luna's jersey previously ended above the waistband even at rest.
        if ctx.get('CHARACTER') == 'luna' and obj.name.startswith((
                'Luna fitted open sports jersey', 'Luna bound jersey hem')):
            for vertex in obj.data.vertices:
                p = game_point(obj, vertex)
                drop = .082 * (1-smoothstep((p.y-(chest_y+.015))/.22))
                vertex.co.z -= drop
            obj.data.update()

    # Wrist/ankle skin and their cuffs share the same transition to the end
    # bone. Previously the rigid cuff followed the forearm/shin while the palm
    # or foot turned independently, exposing a sliced circular boundary.
    for suffix, (shoulder, elbow, hand) in arms.items():
        start, end = Vector(elbow), Vector(hand)
        axis = end-start
        for obj in list(root.children):
            if obj.type != 'MESH' or not obj.name.startswith((
                    'Continuous sculpted arm '+suffix, 'Neoprene wrist cuff '+suffix)):
                continue
            for vertex in obj.data.vertices:
                p = game_point(obj, vertex)
                t = (p-start).dot(axis)/axis.length_squared
                blend = smoothstep((t-.76)/.24)
                if blend > 0:
                    set_weights(obj, vertex, {'Forearm_'+suffix: 1-blend, 'Hand_'+suffix: blend})

    for suffix, hip, knee, foot in legs:
        start, end = Vector(knee), Vector(foot)
        axis = end-start
        for obj in list(root.children):
            if obj.type != 'MESH' or not obj.name.startswith((
                    'Continuous thigh and calf '+suffix, 'Neoprene ankle cuff '+suffix)):
                continue
            for vertex in obj.data.vertices:
                p = game_point(obj, vertex)
                t = (p-start).dot(axis)/axis.length_squared
                blend = smoothstep((t-.72)/.28)
                if blend > 0:
                    set_weights(obj, vertex, {'Shin_'+suffix: 1-blend, 'Foot_'+suffix: blend})

    # Cloth needs open cuffs and hems. The old filled end caps made a disk
    # across the limb; those disks became visible as the character flexed.
    garment_terms = ('short', 'sleeve', 'rashguard', 'jersey', 'vest', 'waistband', 'cuff')
    smooth_terms = ('Continuous sculpted arm', 'Continuous thigh and calf',
                    'Continuous neck', 'Nico continuous athletic neck',
                    'Continuous athletic torso', 'rashguard',
                    'Luna fitted open sports jersey', 'sport short ',
                    'long boardshort', 'lycra sleeve', 'raglan shoulder')
    for obj in list(root.children):
        if obj.type != 'MESH':
            continue
        material = obj.data.materials[0].name
        name = obj.name
        if material not in ('Skin', 'Cheeks') and not material.startswith('Hair-') and any(term in name.lower() for term in garment_terms):
            mesh = bmesh.new()
            mesh.from_mesh(obj.data)
            caps = [face for face in mesh.faces if len(face.verts) > 4]
            if caps:
                bmesh.ops.delete(mesh, geom=caps, context='FACES_ONLY')
                mesh.to_mesh(obj.data)
            mesh.free()
        # One authored subdivision pass adds deforming loops and interpolates
        # skin weights. Do not subdivide fingers, hair or decorative cords.
        if any(term in name for term in smooth_terms):
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new('Continuous joint loops', 'SUBSURF')
            modifier.levels = 1
            modifier.render_levels = 1
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        # Subdivision can yield 1.0000001 at a fully weighted boundary. Clamp
        # and normalize before validation/paint rather than leaving repair to
        # the exporter, where vertex colours already reference these points.
        for vertex in obj.data.vertices:
            values = {obj.vertex_groups[g.group].name: max(0, min(1, g.weight))
                      for g in vertex.groups}
            total = sum(values.values())
            if total and (any(g.weight > 1 or g.weight < 0 for g in vertex.groups)
                          or abs(total-1) > .000001):
                set_weights(obj, vertex, {name: value/total for name, value in values.items()})
        obj.data.validate(verbose=True)
        obj.data.update()
    root['deformation_revision'] = 'continuous waist, wrists and ankles / open sewn cloth / 09'
    bpy.context.view_layer.update()
