"""Nico's own athletic silhouette and layered surf clothing.

This operates on the detailed Amara foundation before paint/rig/export. The
feet, five interchangeable hairstyles and wrapped cylindrical grips survive;
torso, jaw, shirt, vest and boardshorts are deliberately authored for Nico.
All dimensions are game coordinates: Y up, facing -Z.
"""
from math import sin, cos, pi, sqrt
from mathutils import Vector

from character_common import (
    remap_character, remove_pieces, mesh_piece, tube_piece, set_bone, sew_tube_panel,
)


def _ring_weights(obj, sides, influences):
    """Blend clothing at the shoulder/hip rather than hinging a solid sleeve."""
    obj.vertex_groups.clear()
    groups = {}
    for ring, weights in enumerate(influences):
        indices = list(range(ring * sides, (ring + 1) * sides))
        for bone, weight in weights.items():
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add(indices, weight, 'REPLACE')


def customize(ctx, arm_points, leg_points):
    root = ctx['root']
    skin, cream = ctx['skin'], ctx['cream']
    outfit, ink = ctx['outfit'], ctx['ink']
    surface, cord = ctx['surface'], ctx['cord']
    navy = ctx['material']('Nico navy lycra', (.045, .135, .255))
    yellow = ctx['material']('Nico sun-yellow panels', (.97, .72, .22))

    def athletic_frame(x, y, z):
        # The complete sole/instep and its planted anchors remain byte-for-byte
        # at their authored positions. Lower legs grow smoothly into the hip.
        if y <= .48:
            return x, y, z
        if y < 1.30:
            t = min(1, (y - .48) / .32)
            return x * (1 + .02 * t), y, z
        if y >= 2.28:
            return x * 1.08, y + .045, z * 1.015
        t = min(1, max(0, (y - 1.30) / .70))
        return x * (1.07 + .12 * t), y + .045 * t, z * (1.02 + .055 * t)

    arm_points, leg_points = remap_character(ctx, arm_points, leg_points, athletic_frame)

    remove_pieces(ctx, (
        'Tailored shorts leg', 'Rolled ivory shorts hem', 'Tailored shorts saddle',
        'Ivory shorts waistband', 'Shorts curved side piping', 'Shorts pocket stitching',
        'Continuous athletic torso', 'Open sculpted surf vest', 'Tailored ivory side insert',
        'Rolled armholes and neckline', 'Coral folded vest hem', 'Tailored back seam',
        'Front vest zip', 'Zip slider', 'Club fabric patch', 'Club wave embroidery',
        'Continuous neck', 'Designed jaw and cheekbones', 'Small hoop earring',
        'Upper eyelash', 'Warm cheek', 'Expressive brow',
    ))

    # A continuous navy rashguard reads as a genuine short-sleeved shirt under
    # a buoyancy vest, rather than coloured spheres stuck onto the shoulders.
    set_bone(ctx, 'Chest')
    surface('Nico tailored navy rashguard torso', [
        (1.53, .305, .207, .034), (1.66, .331, .224, .025),
        (1.87, .420, .233, .006), (2.09, .466, .229, 0),
        (2.18, .390, .191, 0), (2.235, .229, .135, 0),
        (2.274, .139, .112, 0),
    ], navy, 40)
    for side, suffix in [(-1, 'L'), (1, 'R')]:
        s, e, _ = (Vector(point) for point in arm_points[suffix])
        upper = 'UpperArm_' + suffix
        sleeve = tube_piece(ctx, 'Nico shaped short lycra sleeve ' + suffix,
            [s + Vector((-side * .048, .028, 0)), s.lerp(e, .13),
             s.lerp(e, .31), s.lerp(e, .50), s.lerp(e, .56)],
            [(.160, .153), (.204, .184), (.199, .183), (.186, .174), (.180, .168)],
            navy, upper, 24)
        _ring_weights(sleeve, 24, [
            {'Chest': .65, upper: .35}, {'Chest': .18, upper: .82},
            {upper: 1}, {upper: 1}, {upper: 1},
        ])
        tube_piece(ctx, 'Nico warm-yellow sleeve cuff ' + suffix,
            [s.lerp(e, .535), s.lerp(e, .58)],
            [(.188, .177), (.180, .172)], yellow, upper, 24)

    # Broad shoulders, a tapered lower torso and an open upper contour expose
    # the dark sleeves. The selected cosmetic controls the main vest material.
    rings = [
        (1.585, .331, .233, .039), (1.69, .351, .244, .032),
        (1.87, .425, .259, .015), (2.035, .478, .256, .002),
        (2.135, .487, .235, 0), (2.24, .429, .186, 0),
    ]

    def garment_point(row, angle, extra=0):
        y, rx, rz, center_z = rings[row]
        side = abs(cos(angle))
        top_y = 2.265 - .215 * side ** 6 - .060 * (1 - side) ** 5
        fraction = (y-rings[0][0])/(rings[-1][0]-rings[0][0])
        y = rings[0][0]+(top_y-rings[0][0])*fraction
        if row == len(rings) - 1:
            rx, rz = .475, .188 + .040 * side
        fold = .0035 * cos(angle * 5 + .6) * max(0, 1 - row / 5)
        return ((rx + fold + extra) * cos(angle), y,
                center_z + (rz + fold + extra) * sin(angle))

    steps = 64
    vertices = [garment_point(row, i * 2 * pi / steps)
                for row in range(len(rings)) for i in range(steps)]
    faces = []
    for row in range(len(rings) - 1):
        for i in range(steps):
            a, b = row * steps + i, row * steps + (i + 1) % steps
            faces.append((a, a + steps, b + steps, b))
    mesh_piece(ctx, 'Nico sculpted broad-shouldered surf vest', vertices, faces, outfit)

    # A navy upper-back yoke and a large cream V give Nico a recognisable rear
    # view at game distance. They wrap the garment instead of floating above it.
    vertices, faces = [], []
    for row in [3, 4, 5]:
        for i in range(25):
            angle = .18 + (pi - .36) * i / 24
            vertices.append(garment_point(row, angle, .007))
    for row in range(2):
        for i in range(24):
            a = row * 25 + i
            faces.append((a, a + 25, a + 26, a + 1))
    mesh_piece(ctx, 'Nico large navy shoulder yoke', vertices, faces, navy)

    def back_point(x, y, depth=.012):
        for lower, upper in zip(rings, rings[1:]):
            if lower[0] <= y <= upper[0]:
                t = (y - lower[0]) / (upper[0] - lower[0])
                rx = lower[1] + (upper[1] - lower[1]) * t
                rz = lower[2] + (upper[2] - lower[2]) * t
                center_z = lower[3] + (upper[3] - lower[3]) * t
                return x, y, center_z + rz * sqrt(max(.02, 1 - (x / rx) ** 2)) + depth
        return x, y, .22 + depth

    for side in [-1, 1]:
        # A tapered 3D ribbon follows the convex back. The larger yellow base
        # peeks around the ivory panel and remains visible when the shirt bends.
        for name, width, mat, depth in [
            ('Nico yellow chevron underlay', .122, yellow, .011),
            ('Nico broad ivory back chevron', .081, cream, .017),
        ]:
            vertices, faces = [], []
            dx, dy = side * .342, .265
            length = sqrt(dx * dx + dy * dy)
            nx, ny = -dy / length, dx / length
            for i in range(9):
                t = i / 8
                x, y = side * .342 * (1 - t), 2.12 - .265 * t
                taper = 1 - .16 * t
                for edge in [-1, 1]:
                    vertices.append(back_point(x + edge * nx * width * .5 * taper,
                                               y + edge * ny * width * .5 * taper, depth))
            for i in range(8):
                a = i * 2
                faces.append((a, a + 2, a + 3, a + 1))
            mesh_piece(ctx, name, vertices, faces, mat)

    set_bone(ctx, 'Chest')
    cord('Nico rolled navy armholes',
         [garment_point(5, i * 2 * pi / 96, .011) for i in range(97)], .012, navy)
    cord('Nico wide ivory lower vest piping',
         [garment_point(0, i * 2 * pi / 64, .008) for i in range(65)], .015, cream)
    cord('Nico front navy zip', [(0, 1.60, -.201), (0, 1.88, -.250), (0, 2.20, -.182)],
         .007, ink)
    ctx['oval']('Nico large zipper pull', (0, 1.96, -.265), (.019, .033, .011), yellow)

    # Longer boardshorts replace Amara's rolled shorts. A large side gusset and
    # yellow hem are silhouette/material blocks, with proper thigh articulation.
    set_bone(ctx, 'Hips')
    surface('Nico tailored boardshorts saddle', [
        (1.275, .393, .276, .06), (1.365, .420, .286, .055),
        (1.47, .395, .261, .05), (1.54, .333, .216, .041),
    ], navy, 40)
    surface('Nico broad ivory drawstring waistband', [
        (1.52, .337, .221, .041), (1.565, .328, .217, .041),
    ], cream, 40)

    for suffix, hip, knee, _ in leg_points:
        side = -1 if suffix == 'L' else 1
        h, k = Vector(hip), Vector(knee)
        thigh = 'Thigh_' + suffix
        pants = tube_piece(ctx, 'Nico articulated long boardshorts ' + suffix,
            [h, h.lerp(k, .15), h.lerp(k, .32), h.lerp(k, .48), h.lerp(k, .585), h.lerp(k, .635)],
            [(.246, .252), (.260, .258), (.257, .249), (.248, .235), (.245, .234), (.237, .224)],
            navy, thigh, 32)
        _ring_weights(pants, 32, [
            {'Hips': .65, thigh: .35}, {'Hips': .22, thigh: .78},
            {thigh: 1}, {thigh: 1}, {thigh: 1}, {thigh: 1},
        ])
        # Reuse the authored tube's rings so a cream outer-leg gusset stays
        # flush with the sports fabric and shares precisely the same weights.
        start = (16 if side > 0 else 0) - 4
        sew_tube_panel(pants, 32, range(4), range(start, start+8), cream)
        sew_tube_panel(pants, 32, [4], range(32), yellow)

    # A thicker neck blends both bones across the joint; a squared jaw replaces
    # the rounder foundation while keeping eye/nose/mouth positions compatible.
    neck = tube_piece(ctx, 'Nico continuous athletic neck',
        [(0, 2.17, 0), (0, 2.285, -.006), (0, 2.387, -.013)],
        [(.132, .129), (.130, .124), (.132, .127)], skin, 'Chest', 24)
    _ring_weights(neck, 24, [
        {'Chest': 1}, {'Chest': .5, 'Head': .5}, {'Head': 1},
    ])
    head_rings = [
        (2.3265, .074, .065, -.023), (2.367, .182, .112, -.029),
        (2.4435, .258, .177, -.020), (2.529, .291, .226, -.006),
        (2.637, .294, .230, .005), (2.727, .256, .206, .011),
        (2.808, .161, .134, .009), (2.844, .024, .024, 0),
    ]
    vertices, faces = [], []
    for row, (y, rx, rz, center_z) in enumerate(head_rings):
        for i in range(40):
            a = i * 2 * pi / 40
            c, s = cos(a), sin(a)
            power = .80 if row < 4 else .96
            vertices.append((rx * (1 if c >= 0 else -1) * abs(c) ** power,
                             y, center_z + rz * (1 if s >= 0 else -1) * abs(s) ** .96))
    for row in range(len(head_rings) - 1):
        for i in range(40):
            a, b = row * 40 + i, row * 40 + (i + 1) % 40
            faces.append((a, a + 40, b + 40, b))
    faces += [tuple(range(39, -1, -1)), tuple(280 + i for i in range(40))]
    mesh_piece(ctx, 'Nico square jaw and firm cheek silhouette', vertices, faces, skin, 'Head')

    set_bone(ctx, 'Head')
    for side in [-1, 1]:
        cord('Nico strong swept brow', [
            (side * .060, 2.709, -.210), (side * .107, 2.724, -.227),
            (side * .160, 2.712, -.216),
        ], .015, ctx['brows'])

    root['visual_revision'] = 'Nico / concept 02 / silhouette 08'
    root['wardrobe_design'] = 'Navy short-sleeved lycra / broad chevron vest / long boardshorts'
    root['character_id'] = 'nico'
    return arm_points, leg_points
