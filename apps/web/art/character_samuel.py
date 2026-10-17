"""Samuel's editable illustrated silhouette and sportswear.

Extends the planted-foot Amara family before paint/skin/export. Coordinates
are game Y-up and -Z forward; all gear remains cosmetic. Samuel has a narrow
face, a fitted rashguard, an open short vest and longer angular boardshorts.
"""
from math import sin, cos, pi
from mathutils import Vector
import bpy

from character_common import (
    remap_character, remove_pieces, mesh_piece, tube_piece, set_bone, sew_tube_panel,
)


def customize(ctx, arm_points, leg_points):
    root = ctx['root']
    oval, surface, cord = ctx['oval'], ctx['surface'], ctx['cord']

    def silhouette(x, y, z):
        # The sole, toe yaw and board contact positions stay exactly authored.
        if y <= .48:
            return x, y, z
        if y < 1.57:
            t = (y - .48) / 1.09
            return x * (1 - .06 * t), y + .04 * t, z * (1 - .04 * t)
        if y < 2.25:
            t = (y - 1.57) / .68
            face = max(0, min(1, (y - 2.15) / .20))
            return x * (.94 - .04 * face), y + .04 * (1 - t), z * .96
        return x * .90, y, z * .97

    arm_points, leg_points = remap_character(ctx, arm_points, leg_points, silhouette)
    remove_pieces(ctx, (
        'Tailored shorts leg', 'Rolled ivory shorts hem', 'Tailored shorts saddle',
        'Ivory shorts waistband', 'Shorts curved side piping', 'Shorts pocket stitching',
        'Open sculpted surf vest', 'Tailored ivory side insert',
        'Rolled armholes and neckline', 'Coral folded vest hem', 'Tailored back seam',
        'Front vest zip', 'Zip slider', 'Club fabric patch', 'Club wave embroidery',
        'Upper eyelash', 'Small hoop earring',
    ))

    teal = ctx['material']('Samuel fitted lagoon lycra', (.055, .38, .42))
    ochre = ctx['material']('Samuel ochre shoulder panels', (.88, .57, .19))
    navy = ctx['material']('Samuel long boardshorts', (.035, .15, .19))
    pocket = ctx['material']('Samuel reinforced fabric', (.075, .25, .29))
    cream, outfit, ink = ctx['cream'], ctx['outfit'], ctx['ink']

    def weighted_rings(obj, sides, influences):
        # Continuous surfaces blend into their attachment, rather than leaving
        # floating rigid sleeve/short pieces when the runtime IK bends a limb.
        groups = {g.name: g for g in obj.vertex_groups}
        for ring, weights in enumerate(influences):
            ids = list(range(ring * sides, (ring + 1) * sides))
            for group in groups.values():
                group.remove(ids)
            for name, weight in weights.items():
                if name not in groups:
                    groups[name] = obj.vertex_groups.new(name=name)
                groups[name].add(ids, weight, 'REPLACE')

    def inset_panel(name, body, centers, ring_ids, angle_ids, material, bone, influences=None):
        """Follow a tube's real contour with a thin sewn fabric inset."""
        sides = len(body.data.vertices) // len(centers)
        vertices, faces = [], []
        for ring in ring_ids:
            center = Vector(centers[ring])
            for angle in angle_ids:
                vertex = body.data.vertices[ring * sides + angle % sides]
                p = body.matrix_world @ vertex.co
                point = Vector((p.x, p.z, -p.y))
                vertices.append(point + (point - center).normalized() * .007)
        cols = len(angle_ids)
        for row in range(len(ring_ids) - 1):
            for col in range(cols - 1):
                a = row * cols + col
                faces.append((a, a + 1, a + 1 + cols, a + cols))
        panel = mesh_piece(ctx, name, vertices, faces, material, bone)
        if influences:
            weighted_rings(panel, cols, [influences[row] for row in ring_ids])
        return panel

    # A full lycra body carries visible shoulder and sleeve fabric. Its broad
    # teal area still reads around the short vest at race-camera distance.
    set_bone(ctx, 'Chest')
    surface('Samuel continuous fitted rashguard', [
        (1.60, .302, .218, .030), (1.73, .325, .234, .025),
        (1.91, .388, .259, .015), (2.07, .433, .256, .007),
        (2.17, .424, .232, .002), (2.24, .258, .149, 0),
        (2.286, .117, .101, -.004),
    ], teal, 40)
    surface('Samuel raised rashguard collar', [
        (2.267, .121, .104, -.004), (2.305, .118, .102, -.005),
    ], ochre, 32)
    for side, suffix in [(-1, 'L'), (1, 'R')]:
        shoulder, elbow, _ = map(Vector, arm_points[suffix])
        centers = [shoulder + Vector((-side * .045, .015, 0)),
                   shoulder.lerp(elbow, .13), shoulder.lerp(elbow, .29),
                   shoulder.lerp(elbow, .45), shoulder.lerp(elbow, .58)]
        weights = [{'Chest': .70, 'UpperArm_' + suffix: .30},
                   {'Chest': .22, 'UpperArm_' + suffix: .78},
                   {'UpperArm_' + suffix: 1}, {'UpperArm_' + suffix: 1},
                   {'UpperArm_' + suffix: 1}]
        sleeve = tube_piece(ctx, 'Samuel tailored lycra sleeve ' + suffix,
                            centers, [(.122, .137), (.163, .158), (.164, .157),
                                      (.153, .149), (.144, .143)],
                            teal, 'UpperArm_' + suffix, 24)
        weighted_rings(sleeve, 24, weights)
        # Broad ochre shoulders provide a distinct shape, including from behind.
        sew_tube_panel(sleeve, 24, range(3), range(14, 22), ochre)
        cuff = tube_piece(ctx, 'Samuel bound lycra sleeve hem ' + suffix,
                          [shoulder.lerp(elbow, .545), shoulder.lerp(elbow, .594)],
                          [(.148, .145), (.143, .140)], cream,
                          'UpperArm_' + suffix, 24)

    # An actual open front distinguishes this vest from Amara's longer closed
    # surf top. The single OutfitColor material retains the profile palette.
    rings = [
        (1.73, .308, .241, .025), (1.85, .350, .268, .019),
        (2.00, .411, .277, .010), (2.13, .450, .262, .004),
        (2.285, .437, .191, 0),
    ]
    gap = .28
    start, end = -pi / 2 + gap, 3 * pi / 2 - gap

    def vest_point(row, a, offset=0):
        y, rx, rz, z = rings[row]
        top_y = rings[-1][0]-.21*abs(cos(a))**6-.048*max(0, -sin(a))**4
        fraction = (y-rings[0][0])/(rings[-1][0]-rings[0][0])
        y = rings[0][0]+(top_y-rings[0][0])*fraction
        if row == len(rings) - 1:
            rz += .026 * abs(cos(a))
        fold = .004 * cos(a * 5 + .7) * max(0, 1 - row / 4)
        return ((rx + fold + offset) * cos(a), y,
                z + (rz + fold + offset) * sin(a))

    def vest_fraction(row, a, offset=.007):
        lo = min(len(rings) - 2, max(0, int(row)))
        fraction = max(0, min(1, row - lo))
        return Vector(vest_point(lo, a, offset)).lerp(
            Vector(vest_point(lo + 1, a, offset)), fraction)

    vertices, faces, steps = [], [], 56
    for row in range(len(rings)):
        for i in range(steps + 1):
            vertices.append(vest_point(row, start + (end - start) * i / steps))
    for row in range(len(rings) - 1):
        for i in range(steps):
            a = row * (steps + 1) + i
            faces.append((a, a + steps + 1, a + steps + 2, a + 1))
    mesh_piece(ctx, 'Samuel open short surf vest', vertices, faces, outfit)
    set_bone(ctx, 'Chest')
    for angle in [start, end]:
        cord('Samuel bound open vest edge', [vest_point(i, angle, .006)
                                             for i in range(len(rings))], .011, cream)
    cord('Samuel bound vest armholes', [vest_point(4, start + (end - start) * i / 72, .007)
                                        for i in range(73)], .012, cream)
    cord('Samuel short vest lower binding', [vest_point(0, start + (end - start) * i / 72, .006)
                                            for i in range(73)], .012, ink)

    # A wide curved chevron is a real fabric panel wrapped around the vest's
    # volume. It gives Samuel a recognisable back without decorative clutter.
    vertices, faces, cols = [], [], 33
    for delta in [-.25, .25]:
        for i in range(cols):
            angle = .44 + (pi - .88) * i / (cols - 1)
            row = 2.0 + 1.30 * abs(cos(angle)) ** .9 + delta
            vertices.append(vest_fraction(row, angle, .010))
    for i in range(cols - 1):
        faces.append((i, i + cols, i + 1 + cols, i + 1))
    mesh_piece(ctx, 'Samuel broad ochre back chevron', vertices, faces, ochre)
    cord('Samuel chevron upper seam', [
        vest_fraction(2.0 + 1.30 * abs(cos(.44 + (pi - .88) * i / 40)) ** .9 + .25,
                      .44 + (pi - .88) * i / 40, .012)
        for i in range(41)], .006, cream)

    # A low sewn pocket and webbing closures clarify that this is a garment.
    pocket_vertices = [(-.15, 1.81, .288), (.15, 1.81, .288),
                       (.13, 1.925, .300), (-.13, 1.925, .300)]
    mesh_piece(ctx, 'Samuel rectangular lower back pocket', pocket_vertices,
               [(0, 1, 2, 3)], pocket)
    cord('Samuel back pocket top flap', [(-.13, 1.92, .306), (0, 1.925, .309),
                                        (.13, 1.92, .306)], .009, ochre)
    for y in [1.82, 1.985, 2.135]:
        row = (y - 1.73) / .135
        left = vest_fraction(row, end, .010)
        right = vest_fraction(row, start, .010)
        # Profile follows the opening; the closures do not cross bare skin.
        cord('Samuel vest front webbing', [left, (0, y, min(left.z, right.z) - .014), right],
             .014, ink)
        oval('Samuel vest closure', (0, y, min(left.z, right.z) - .027),
             (.034, .023, .012), ochre)

    # Longer boardshorts follow the real bent thigh axes with graduated skin
    # weights. Their wide side panels are legible while the player leans.
    for suffix, hip, knee, _ in leg_points:
        h, k = Vector(hip), Vector(knee)
        side = -1 if suffix == 'L' else 1
        thigh = 'Thigh_' + suffix
        centers = [h, h.lerp(k, .17), h.lerp(k, .35), h.lerp(k, .51), h.lerp(k, .64), h.lerp(k, .685)]
        weights = [{'Hips': .70, thigh: .30}, {'Hips': .25, thigh: .75},
                   {thigh: 1}, {thigh: 1}, {thigh: 1}, {thigh: 1}]
        cloth = tube_piece(ctx, 'Samuel shaped long boardshort leg ' + suffix,
                           centers, [(.240, .233), (.243, .236), (.235, .227),
                                     (.225, .219), (.223, .216), (.218, .211)], navy, thigh, 24)
        weighted_rings(cloth, 24, weights)
        # Outer inset occupies about a third of each trouser leg, rather than a
        # tiny badge. Its rear-facing half can still be read in a four-racer view.
        angles = list(range(-4, 5)) if side < 0 else list(range(8, 17))
        sew_tube_panel(cloth, 24, range(1, 4), angles[:-1], teal)
        sew_tube_panel(cloth, 24, range(1, 4), [angles[0]], ochre)
        sew_tube_panel(cloth, 24, [4], range(24), pocket)
    set_bone(ctx, 'Hips')
    surface('Samuel tailored boardshort saddle', [
        (1.355, .345, .248, .046), (1.445, .372, .255, .050),
        (1.532, .351, .238, .040), (1.596, .288, .192, .035),
    ], navy, 40)
    surface('Samuel teal boardshort waistband', [
        (1.579, .292, .198, .035), (1.622, .291, .198, .035),
    ], teal, 40)
    for x in [-.023, .023]:
        cord('Samuel boardshort flat drawcord', [(x, 1.611, -.173),
                                                (x * 1.6, 1.55, -.217),
                                                (x * 1.8, 1.50, -.225)], .007, cream)

    # Replace only Hair-curls; swept/bun/ponytail/afro retain separate materials
    # and remain available to the inclusive profile customisation system.
    for obj in list(root.children):
        if obj.type == 'MESH' and obj.data.materials[0].name == 'Hair-curls':
            bpy.data.objects.remove(obj, do_unlink=True)
    set_bone(ctx, 'Head')
    curls = ctx['curl_hair']
    surface('Samuel grouped curls core', [
        (2.575, .244, .234, .034), (2.720, .300, .270, .025),
        (2.885, .262, .235, .009), (2.995, .115, .111, -.005),
        (3.015, .020, .020, -.005),
    ], curls, 36)
    for row, count in [(0, 11), (1, 9)]:
        for i in range(count):
            angle = i * 2 * pi / count + row * .36
            radius = [.265, .241][row] + .018 * sin(i * 1.9 + row)
            height = 2.61 + row * .19 + .125 * max(0, -sin(angle)) + .021 * cos(i * 1.7)
            points, radii = [], []
            for j in range(7):
                t = j / 6
                arc = (t - .5) * pi * 1.3
                r = radius + .052 * cos(arc)
                tangent = .058 * sin(arc)
                points.append((r * cos(angle) - tangent * sin(angle),
                               height + .055 * t + .072 * cos(arc),
                               .025 + r * sin(angle) + tangent * cos(angle)))
                size = (.072 + .007 * sin(i * 2.1)) * (.48 + .52 * sin(pi * t) ** .6)
                radii.append((size, size * .83))
            tube_piece(ctx, 'Samuel broad curved curl', points, radii, curls, 'Head', 14)
    for x, z, rise in [(-.14, .075, 0), (.015, -.025, .028), (.15, .045, -.025)]:
        tube_piece(ctx, 'Samuel swept crown curl', [
            (x - .075, 2.91 + rise, z + .045),
            (x - .065, 3.015 + rise, z + .020),
            (x + .015, 3.050 + rise, z - .014),
            (x + .090, 2.99 + rise, z - .025),
            (x + .060, 2.91 + rise, z - .004),
        ], [.029, .071, .070, .055, .018], curls, 'Head', 16)

    root['visual_revision'] = 'Samuel / concept 02 / silhouette 08'
    root['character_style'] = 'slender / short open vest / fitted lycra / long boardshorts'
    bpy.context.view_layer.update()
    return arm_points, leg_points
