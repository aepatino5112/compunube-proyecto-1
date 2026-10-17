"""Luna: an adult sports silhouette, a paneled jersey and a sculpted ponytail.

This pass edits the Amara construction before paint and armature binding. It
retains the planted feet, the actual hand grips and all five selectable styles.
Coordinates supplied to the helpers are game Y-up, facing -Z.
"""
from math import sin, cos, pi
from mathutils import Vector
import bmesh
from character_common import (
    remap_character, remove_pieces, mesh_piece, tube_piece, set_bone, sew_tube_panel,
)


def customize(ctx, arm_points, leg_points):
    def point(x, y, z):
        # Support geometry is shared by all three boards. Do not narrow toes or
        # move the foot anchors when changing the upper silhouette.
        if y <= .48:
            return x, y, z
        anchors = [(.48, 1.00, 1.00), (.82, .96, .98),
                   (1.30, 1.055, 1.025), (1.62, .92, .98),
                   (2.10, .89, .98), (2.25, .955, 1.00)]
        sx, sz = anchors[-1][1:]
        for a, b in zip(anchors, anchors[1:]):
            if a[0] <= y <= b[0]:
                t = (y - a[0]) / (b[0] - a[0])
                sx = a[1] + (b[1] - a[1]) * t
                sz = a[2] + (b[2] - a[2]) * t
                break
        # An oval head rather than a uniformly scaled copy; the neck and
        # clavicles remain continuous with their original blended weights.
        height = y - .047 * min(1, (y - .48) / 1.65)
        if y >= 2.25:
            height += (y - 2.25) * .035
        return x * sx, height, z * sz

    arm_points, leg_points = remap_character(ctx, arm_points, leg_points, point)
    material, cord, oval = ctx['material'], ctx['cord'], ctx['oval']
    ivory = material('Luna ivory woven panel', (.96, .93, .82))
    lavender = material('Luna lavender technical panel', (.56, .47, .73))
    graphite = material('Luna indigo sport shorts', (.15, .18, .30))
    edging = material('Luna muted lavender seams', (.41, .35, .59))
    outfit = ctx['outfit']

    remove_pieces(ctx, (
        'Open sculpted surf vest', 'Tailored ivory side insert',
        'Rolled armholes and neckline', 'Coral folded vest hem',
        'Tailored back seam', 'Front vest zip', 'Zip slider',
        'Club fabric patch', 'Club wave embroidery',
        'Tailored shorts leg', 'Rolled ivory shorts hem',
        'Tailored shorts saddle', 'Ivory shorts waistband',
        'Shorts curved side piping', 'Shorts pocket stitching',
        'Small hoop earring',
    ))

    # The underlying anatomy remains smooth. This surface is a garment with a
    # wide collar and underarm opening, rather than extra chest/body volume.
    rings = [(1.345, .290, .199, .035), (1.42, .310, .217, .032),
             (1.56, .365, .237, .018), (1.72, .413, .240, .010),
             (1.82, .425, .227, .005), (1.94, .370, .183, 0)]

    def jersey_point(row, angle, offset=1):
        lower = min(int(row), 4)
        t = row - lower
        a, b = rings[lower], rings[lower + 1]
        y, rx, rz, z = (a[i] + (b[i] - a[i]) * t for i in range(4))
        fraction = (y-rings[0][0])/(rings[-1][0]-rings[0][0])
        side = abs(cos(angle))
        top_y = 1.985 - .205 * side ** 6 - .060 * (1 - side) ** 5
        y = rings[0][0]+(top_y-rings[0][0])*fraction
        if row > 4:
            rx += (.407 - rings[5][1]) * (row - 4)
            rz += (.161 + .034 * side - rings[5][2]) * (row - 4)
        fold = (.005 * cos(angle * 6 + .6) + .004 * sin(angle * 9)) * max(0, 1-row/5)
        # Convert the source garment's frame to the final Amara proportions,
        # then to Luna's own waist/shoulder construction.
        return point((rx + fold) * 1.13 * offset * cos(angle),
                     1.57 + (y - 1.30) * (.68 / .78),
                     (z + (rz + fold) * offset * sin(angle)) * 1.10)

    def width_at(row, keys):
        if row < keys[0][0]:
            return 0
        for a, b in zip(keys, keys[1:]):
            if a[0] <= row <= b[0]:
                t = (row-a[0])/(b[0]-a[0])
                return a[1]+(b[1]-a[1])*t
        return keys[-1][1]

    # Place the garment's actual edge loops on each colour boundary. Painting
    # arbitrary grid faces made the V look like a staircase from behind.
    side_keys = list(enumerate([.30, .36, .38, .41, .38, .14]))
    back_keys = [(2.1, .045), (3.2, .40), (4.2, .78), (5, 1.04)]
    rows = [0, .5, 1, 1.5, 2, 2.1, 2.5, 3, 3.2, 3.5, 4, 4.2, 4.5, 5]
    vertices, faces = [], []
    columns = [0, 4, 24, 32, 40, 52, 60, 64]
    for row in rows:
        side_width = width_at(row, side_keys)
        back_width = max(.0001, width_at(row, back_keys))
        boundaries = [-pi, -pi+side_width, -side_width, side_width,
                      pi/2-back_width, pi/2+back_width, pi-side_width, pi]
        for col in range(65):
            for region in range(len(columns)-1):
                if columns[region] <= col <= columns[region+1]:
                    t = (col-columns[region])/(columns[region+1]-columns[region])
                    angle = boundaries[region]+(boundaries[region+1]-boundaries[region])*t
                    vertices.append(jersey_point(row, angle, 1.008))
                    break
    for row in range(len(rows)-1):
        for col in range(64):
            a = row*65+col
            faces.append((a, a+65, a+66, a+1))
    jersey = mesh_piece(ctx, 'Luna fitted open sports jersey', vertices, faces, outfit)
    jersey.data.materials.append(lavender)
    jersey.data.materials.append(ivory)
    for row in range(len(rows)-1):
        for col in range(64):
            face = jersey.data.polygons[row*64+col]
            if col < 4 or 24 <= col < 32 or col >= 60:
                face.material_index = 1
            if rows[row] >= 2.1 and 40 <= col < 52:
                face.material_index = 2
    mesh = bmesh.new()
    mesh.from_mesh(jersey.data)
    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=.000001)
    mesh.to_mesh(jersey.data)
    mesh.free()
    set_bone(ctx, 'Chest')
    cord('Luna ivory shaped collar', [jersey_point(5, i*2*pi/96, 1.032)
                                     for i in range(97)], .014, ivory)
    cord('Luna bound jersey hem', [jersey_point(0, i*2*pi/64, 1.028)
                                   for i in range(65)], .014, edging)
    # A short, subtle front zip belongs to this jersey; the back is left clear
    # so the silhouette/yoke retain their value at a distance.
    cord('Luna concealed front zipper', [jersey_point(row, -pi/2, 1.028)
                                         for row in [2.5, 3, 4, 5]], .0055, edging)
    p = jersey_point(3.85, -pi/2, 1.036)
    oval('Luna recessed zip pull', p, (.011, .018, .009), ivory)

    # Broad but short shoulder caps replace the sleeveless appearance. Skin
    # remains underneath; attachment weights blend at the clavicle.
    for suffix, (shoulder, elbow, hand) in arm_points.items():
        s, e = Vector(shoulder), Vector(elbow)
        centers = [s.lerp(e, t) for t in [-.018, .07, .17, .225]]
        sleeve = tube_piece(ctx, 'Luna short raglan shoulder '+suffix, centers,
                            [(.139, .138), (.154, .152), (.156, .150), (.151, .146)],
                            lavender, 'UpperArm_'+suffix, sides=24)
        upper = sleeve.vertex_groups['UpperArm_'+suffix]
        chest = sleeve.vertex_groups.new(name='Chest')
        for row, blend in enumerate([.78, .35, .06, 0]):
            indices = list(range(row*24, (row+1)*24))
            upper.remove(indices)
            upper.add(indices, 1-blend, 'REPLACE')
            if blend:
                chest.add(indices, blend, 'REPLACE')
        tube_piece(ctx, 'Luna ivory sleeve binding '+suffix,
                   [s.lerp(e, .214), s.lerp(e, .235)],
                   [(.155, .149), (.152, .147)], ivory,
                   'UpperArm_'+suffix, sides=24)

    # Recut athletic shorts have an angular lavender side gusset and a rolled
    # narrow binding. The saddle binds to Hips; each leg blends into its thigh.
    set_bone(ctx, 'Hips')
    ctx['surface']('Luna high sport shorts saddle',
                   [(1.255, .399, .286, .056), (1.34, .386, .274, .046),
                    (1.425, .332, .235, .041), (1.497, .316, .216, .039)],
                   graphite, 40)
    ctx['surface']('Luna soft lavender waistband',
                   [(1.465, .325, .224, .039), (1.505, .318, .218, .039)],
                   lavender, 40)
    for suffix, hip, knee, foot in leg_points:
        h, k = Vector(hip), Vector(knee)
        centers = [h.lerp(k, t) for t in [.0, .14, .27, .415, .445]]
        # Keep room around the remapped thigh, including its deformed contour.
        # The original tight shell exposed skin through the lavender side hem.
        radii = [(.253, .242), (.262, .252), (.261, .248), (.255, .244), (.251, .240)]
        shorts = tube_piece(ctx, 'Luna recut sport short '+suffix, centers,
                            radii, graphite, 'Thigh_'+suffix, sides=32)
        thigh = shorts.vertex_groups['Thigh_'+suffix]
        hips = shorts.vertex_groups.new(name='Hips')
        for row, blend in enumerate([.70, .25, 0, 0, 0]):
            indices = list(range(row*32, (row+1)*32))
            thigh.remove(indices)
            thigh.add(indices, 1-blend, 'REPLACE')
            if blend:
                hips.add(indices, blend, 'REPLACE')
        side = -1 if suffix == 'L' else 1
        middle_ring = [shorts.data.vertices[2*32+j].co for j in range(32)]
        peak = max(range(32), key=lambda j: side*middle_ring[j].x)
        sew_tube_panel(shorts, 32, range(3), range(peak-5, peak+5), lavender)
        sew_tube_panel(shorts, 32, [3], range(32), ivory)

    # All pieces below use the same Hair-ponytail material and Head binding.
    # Changing hairstyle therefore hides the whole crown, tie and tail.
    remove_pieces(ctx, ('Sculpted hair cap ponytail', 'Temple ponytail',
                        'Combed pony crown', 'Long swept ponytail', 'Pony band'))
    pony = ctx['pony_hair']
    set_bone(ctx, 'Head')
    vertices, faces = [], []
    hair_rings = [(2.492, .249, .236, .039), (2.65, .274, .258, .030),
                  (2.765, .204, .187, .025), (2.825, .074, .064, .031),
                  (2.837, .005, .005, .035)]
    for row, (y, rx, rz, z) in enumerate(hair_rings):
        for i in range(48):
            a = i*2*pi/48
            hairline = .08*max(0, -sin(a)) if row == 0 else 0
            vertices.append((rx*cos(a), y+hairline, z+rz*sin(a)))
    for row in range(len(hair_rings)-1):
        for i in range(48):
            a, b = row*48+i, row*48+(i+1)%48
            faces.append((a, a+48, b+48, b))
    mesh_piece(ctx, 'Luna swept ponytail crown', vertices, faces, pony, 'Head')
    tail = [(0, 2.73, .205), (.015, 2.72, .298), (.037, 2.64, .400),
            (.061, 2.50, .474), (.089, 2.31, .510), (.130, 2.12, .492),
            (.179, 1.981, .428), (.217, 1.908, .335), (.231, 1.925, .286)]
    widths = [(.079, .075), (.092, .085), (.117, .097), (.132, .103),
              (.130, .111), (.112, .095), (.085, .068), (.033, .027), (.004, .004)]
    tube_piece(ctx, 'Luna continuous swept ponytail', tail, widths, pony, 'Head', sides=24)
    # Three broad attached locks articulate the mass instead of seven loose,
    # constant-width tubes. Their terminal taper merges into the swept tip.
    for i, xshift in enumerate([-.063, 0, .065]):
        path = [(x+xshift*(1-j/12), y+.012*sin(j*.65+i), z+.055*(1-j/10))
                for j, (x, y, z) in enumerate(tail[1:])]
        radii = [(.045, .024), (.051, .029), (.058, .034), (.057, .034),
                 (.047, .029), (.034, .022), (.013, .010), (.002, .002)]
        tube_piece(ctx, 'Luna grouped ponytail lock '+str(i), path, radii,
                   pony, 'Head', sides=14)
    # A compact band is geometry in the hairstyle batch. It never survives as
    # a stray accessory when another of the five selectable styles is shown.
    cord('Luna ponytail sculpted tie', [( .080*cos(i*2*pi/32),
         2.711+.074*sin(i*2*pi/32), .288) for i in range(33)], .013, pony)
    for side in [-1, 1]:
        cord('Luna swept temple mass', [(side*.242, 2.532, .036),
             (side*.254, 2.61, .066), (side*.177, 2.735, .139),
             (side*.055, 2.76, .228)], .029, pony)
        # Small round studs replace the previous hoops; they remain secondary
        # to the larger head and clothing silhouette.
        oval('Luna matte ear stud', (side*.2925, 2.466, -.015),
             (.014, .014, .008), ivory)

    ctx['root']['visual_revision'] = 'Luna / illustrated club / silhouette 08'
    ctx['root']['character_style'] = 'Luna / lavender raglan jersey / swept ponytail'
    return arm_points, leg_points
