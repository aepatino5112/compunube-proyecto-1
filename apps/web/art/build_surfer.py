"""Editable cartoon rig and authored glTF clips; runtime IK follows board and net."""
from pathlib import Path
from math import sin, cos, pi
from mathutils import Vector
import bpy
import sys

ROOT = Path(__file__).resolve().parents[1]
CHARACTER = None
if '--character' in sys.argv:
    CHARACTER = sys.argv[sys.argv.index('--character') + 1]
    if CHARACTER not in ['nico', 'luna', 'samuel']:
        raise ValueError('Expected --character nico, luna or samuel')
PILOT = '--amara-study' in sys.argv or CHARACTER is not None
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def material(name, color):
    color = tuple(c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in color)
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = m.diffuse_color
    shader.inputs['Roughness'].default_value = .9
    return m

skin = material('Skin', (.72, .39, .21))
outfit = material('OutfitColor', (.86, .24, .12))
shorts = material('Lagoon shorts', (.025, .16, .18))
cream = material('Warm cream', (.96, .91, .72))
hair = material('Hair-swept', (.23, .12, .075))
curl_hair = material('Hair-curls', (.16, .085, .055))
bun_hair = material('Hair-bun', (.28, .13, .065))
pony_hair = material('Hair-ponytail', (.73,.45,.18))
afro_hair = material('Hair-afro', (.16,.085,.055))
brows = material('Brows', (.23,.12,.075))
stitch = material('Clothing trim', (.96, .77, .43))
ink = material('Face ink', (.018, .035, .034))
pink = material('Cheeks', (.84, .27, .17))

root = bpy.data.objects.new('CartoonSurfer', None)
bpy.context.collection.objects.link(root)
# Author in the game's coordinates: Y up, facing -Z; convert to Blender Z up.
def coord(p): return Vector((p[0], -p[2], p[1]))
current_bone = 'Hips'

def bind_piece(obj):
    obj['deform_bone'] = current_bone
    group = obj.vertex_groups.new(name=current_bone)
    group.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')

def oval(name, pos, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, location=coord(pos))
    o = bpy.context.object
    o.name = name
    o.scale = (scale[0], scale[2], scale[1])
    o.data.materials.append(mat)
    o.parent = root
    bind_piece(o)
    for poly in o.data.polygons: poly.use_smooth = True
    return o

def capsule(name, a, b, radius, mat):
    av, bv = coord(a), coord(b)
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=radius, radius2=radius*.9,
        depth=(bv-av).length, location=(av+bv)/2)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = (bv-av).to_track_quat('Z', 'Y').to_euler()
    o.data.materials.append(mat)
    o.parent = root
    bind_piece(o)
    for poly in o.data.polygons: poly.use_smooth = True
    for p in [a,b]: oval(name+' joint', p, (radius, radius, radius), mat)

def surface(name, rings, mat, segments=24):
    # Sculpted rings define shoulders, waist and hems instead of overlapping spheres.
    vertices=[]; faces=[]
    for y,rx,rz,z in rings:
        for i in range(segments):
            a=i*2*pi/segments; vertices.append(coord((rx*cos(a),y,z+rz*sin(a))))
    for j in range(len(rings)-1):
        for i in range(segments):
            a=j*segments+i;b=j*segments+(i+1)%segments
            faces.append((a,a+segments,b+segments,b))
    faces += [tuple(range(segments)),tuple((len(rings)-1)*segments+i for i in range(segments-1,-1,-1))]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    obj.parent=root;mesh.materials.append(mat);bind_piece(obj)
    for face in mesh.polygons:face.use_smooth=True
    return obj

def cord(name, path, radius, mat):
    # A tapered mesh ribbon/tube; vertices stay bound to the current bone.
    vertices=[];faces=[];n=8
    for i,p in enumerate(path):
        direction=Vector(path[min(i+1,len(path)-1)])-Vector(path[max(0,i-1)])
        direction.normalize();cross=direction.cross(Vector((0,0,1)))
        if cross.length<.01:cross=direction.cross(Vector((0,1,0)))
        cross.normalize();other=direction.cross(cross).normalized()
        r=radius*(.2+.8*sin(pi*(i+.5)/len(path))**.4)
        for k in range(n):vertices.append(coord(Vector(p)+r*(cross*cos(k*2*pi/n)+other*sin(k*2*pi/n))))
    for j in range(len(path)-1):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.parent=root
    mesh.materials.append(mat);bind_piece(obj)
    for face in mesh.polygons:face.use_smooth=True
    return obj

for side, hip, knee, foot in [
    (-1, (-.23,1,.05), (-.4,.61,-.3), (-.43,.38,-.54)),
    (1, (.23,1,.05), (.34,.64,.49), (.41,.38,.76))]:
    suffix = 'L' if side < 0 else 'R'
    current_bone = 'Thigh_'+suffix
    capsule('Short leg', hip, knee, .185, shorts)
    oval('Turned shorts hem', knee, (.198,.073,.188), shorts)
    capsule('Shorts side piping', (hip[0]+side*.17,hip[1],hip[2]), (knee[0]+side*.17,knee[1]+.055,knee[2]), .021, stitch)
    current_bone = 'Shin_'+suffix
    capsule('Calf', knee, foot, .125, skin)
    current_bone = 'Foot_'+suffix
    oval('Bare foot', (foot[0], .37, foot[2]-.035), (.16,.095,.24), skin)
current_bone = 'Hips'
surface('Tailored shorts waist',[(.88,.34,.25,.04),(1.08,.38,.275,.04),(1.19,.31,.245,.04)],shorts)
surface('Waistband',[(1.13,.345,.264,.04),(1.19,.33,.26,.04)],ink)
current_bone = 'Chest'
surface('Tailored surf vest',[(1.14,.33,.26,.015),(1.22,.36,.28,.015),(1.42,.405,.295,.015),(1.64,.425,.26,.015),(1.75,.32,.23,.015),(1.80,.19,.16,.015)],outfit)
surface('Reinforced vest hem',[(1.14,.34,.27,.015),(1.20,.367,.292,.015)],ink)
for x in [-.23,.23]:
    cord('Shoulder webbing',[(x,1.31,-.266),(x,1.62,-.25),(x*.88,1.77,-.12),(x*.88,1.78,.14),(x,1.61,.269),(x,1.25,.29)],.035,cream)
    cord('Back seam',[(x*1.3,1.23,.22),(x*1.5,1.40,.21),(x*1.5,1.59,.185)],.012,stitch)
cord('Vest zip',[(0,1.21,-.286),(0,1.45,-.29),(0,1.73,-.23)],.018,cream)
oval('Zip pull', (0,1.55,-.325), (.039,.055,.025), ink)
oval('Back embroidered patch', (0,1.50,.318), (.165,.185,.024), ink)
for row in range(2):
    cord('Club wave embroidery',[(x,1.48+row*.075+.025*sin(x*25),.347) for x in [-.12+i*.01 for i in range(25)]],.014,cream)
cord('Back waist strap',[(-.30,1.29,.22),(0,1.29,.315),(.30,1.29,.22)],.033,ink)
oval('Back buckle',(0,1.29,.35),(.055,.047,.025),stitch)
capsule('Neck', (0,1.76,0), (0,1.99,0), .14, skin)
current_bone = 'Head'
oval('Big cartoon head', (0,2.23,-.025), (.40,.43,.355), skin)
for side in [-1,1]:
    oval('Ear', (side*.39,2.2,-.005), (.105,.14,.075), skin)
    oval('Cheek', (side*.235,2.13,-.304), (.095,.045,.02), pink)
    oval('Eye white', (side*.151,2.3,-.344), (.112,.139,.044), cream)
    oval('Pupil', (side*.147,2.295,-.383), (.052,.075,.022), ink)
    oval('Eye glint', (side*.147-.014,2.325,-.402), (.016,.024,.01), cream)
    capsule('Eyebrow', (side*.09,2.467,-.312), (side*.23,2.46,-.292), .032, brows)
oval('Button nose', (0,2.205,-.382), (.082,.077,.089), skin)
oval('Smile', (0,2.068,-.337), (.116,.068,.021), ink)
oval('Smile teeth', (0,2.092,-.357), (.087,.022,.009), cream)
for style,mat in [('swept',hair),('curls',curl_hair),('bun',bun_hair),('ponytail',pony_hair),('afro',afro_hair)]:
    surface('Sculpted hair cap '+style,[(2.30,.31,.295,.07),(2.44,.392,.35,.04),(2.60,.345,.29,.02),(2.70,.15,.13,0),(2.72,.01,.01,0)],mat)
    for x in [-.34,.34]:oval('Temple '+style,(x,2.36,.09),(.055,.13,.15),mat)
    if style=='swept':
        for i in range(9):
            x=-.30+i*.07
            rise=.085*cos(i*.35)+.015*sin(i*1.9)
            cord('Swept lock',[(x,2.39,.31),(x+.07,2.56,.30),(x+.11,2.71+rise,.10),(x+.055,2.70+rise,-.15),(x-.035,2.57+.045*cos(i*.6),-.32)],.046+.012*sin(i*.6)**2,mat)
        for i in range(5):
            cord('Tapered nape',[(i*.075-.15,2.41,.342),(i*.068-.136,2.27,.31),(i*.05-.10,2.22,.25)],.027,mat)
    elif style=='curls':
        for row in range(3):
            for i in range(11):
                a=i*2*pi/11+row*.28;r=.36-row*.065
                oval('Sculpted curl',(r*cos(a),2.44+row*.13,.02+r*sin(a)),(.105,.11,.105),mat)
        for i in range(4):oval('Crown curl',(i*.075-.11,2.79,.02),(.10,.10,.12),mat)
    elif style=='bun':
        oval('Tied bun',(0,2.63,.40),(.24,.23,.21),mat)
        for i in range(8):
            a=i*2*pi/8
            cord('Combed braid',[(.32*cos(a),2.40,.05+.30*sin(a)),(.26*cos(a),2.62,.12+.25*sin(a)),(.12*cos(a),2.68,.32)],.027,mat)
        cord('Bun tie',[(.21*cos(i*2*pi/32),2.63+.20*sin(i*2*pi/32),.40) for i in range(33)],.024,mat)
    elif style=='ponytail':
        for i in range(9):
            a=i*2*pi/9
            cord('Combed pony crown',[(.32*cos(a),2.40,.05+.30*sin(a)),(.28*cos(a),2.61,.10+.24*sin(a)),(.09*cos(a),2.60,.41)],.027,mat)
        for i in range(7):
            x=(i-3)*.035
            cord('Long swept ponytail',[(x,2.55,.39),(x+.03,2.42,.58),(x+.055,2.16,.66),(x+.07,1.92,.65),(x+.11,1.76+.025*abs(i-3),.54)],.055,mat)
        # Band is part of the hairstyle, so changing style cannot leave it behind.
        cord('Pony band',[(.11*cos(i*2*pi/32),2.52+.10*sin(i*2*pi/32),.46) for i in range(33)],.018,mat)
    else:
        for row in range(4):
            radius=[.40,.47,.40,.25][row]
            for i in range(13):
                a=i*2*pi/13+row*.27
                hairline=max(0,-sin(a))*.24*(1-row/5)
                oval('Afro sculpted curl',(radius*cos(a),2.33+row*.18+hairline,.035+radius*sin(a)),(.13,.15,.14),mat)
        for x in [-.13,.05,.20]:oval('Afro crown',(x,2.96,.03),(.17,.14,.18),mat)

arm_points = {}
for side, suffix in [(-1,'L'),(1,'R')]:
    shoulder=(side*.36,1.65,0)
    elbow=(side*.57,1.26,-.20)
    hand=(side*.60,.93,-.46)
    arm_points[suffix]=(shoulder,elbow,hand)
    current_bone='UpperArm_'+suffix
    capsule('Upper arm '+suffix,shoulder,elbow,.105,skin)
    oval('Shoulder fabric '+suffix,shoulder,(.15,.13,.17),outfit)
    current_bone='Forearm_'+suffix
    capsule('Forearm '+suffix,elbow,hand,.09,skin)
    current_bone='Hand_'+suffix
    oval('Hand '+suffix,hand,(.12,.10,.14),skin)

leg_points=[('L',(-.23,1,.05),(-.4,.61,-.3),(-.43,.38,-.54)),('R',(.23,1,.05),(.34,.64,.49),(.41,.38,.76))]
if PILOT:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from amara_geometry import build_amara
    arm_points, leg_points = build_amara(globals())
    if CHARACTER:
        from importlib import import_module
        arm_points, leg_points = import_module('character_' + CHARACTER).customize(globals(), arm_points, leg_points)
        root['character_id'] = CHARACTER
        root['visual_revision'] = CHARACTER.capitalize() + ' / club wardrobe / silhouette 08'
    bpy.context.view_layer.update()
    from character_deformation import finish_deformation
    finish_deformation(globals(), arm_points, leg_points)
    from paint_character import paint_character
    paint_character(root)

armature=bpy.data.armatures.new('Surfer skeleton')
rig=bpy.data.objects.new('SurferRig',armature)
bpy.context.collection.objects.link(rig); rig.parent=root
bpy.context.view_layer.objects.active=rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
def bone(name,a,b,parent=None):
    result=armature.edit_bones.new(name); result.head=coord(a); result.tail=coord(b)
    if parent: result.parent=armature.edit_bones[parent]
    return result
points=globals().get('pilot_bone_points',{'hips':((0,1,.04),(0,1.25,.04)),
                                       'chest':((0,1.25,.04),(0,1.78,0)),
                                       'head':((0,1.88,0),(0,2.45,0))})
bone('Hips',*points['hips'])
bone('Chest',*points['chest'],'Hips')
bone('Head',*points['head'],'Chest')
for suffix,hip,knee,foot in leg_points:
    bone('Thigh_'+suffix,hip,knee,'Hips')
    bone('Shin_'+suffix,knee,foot,'Thigh_'+suffix)
    yaw=globals().get('pilot_foot_yaws',{}).get(suffix,0)
    bone('Foot_'+suffix,foot,(foot[0]-.2*sin(yaw),foot[1],foot[2]-.2*cos(yaw)),'Shin_'+suffix)
    shoulder,elbow,hand=arm_points[suffix]
    bone('UpperArm_'+suffix,shoulder,elbow,'Chest')
    bone('Forearm_'+suffix,elbow,hand,'UpperArm_'+suffix)
    bone('Hand_'+suffix,hand,(hand[0],hand[1],hand[2]-.15),'Forearm_'+suffix)
bpy.ops.object.mode_set(mode='OBJECT')
for obj in list(root.children):
    if obj.type!='MESH': continue
    obj.parent=rig
    modifier=obj.modifiers.new('Surfer deformation','ARMATURE'); modifier.object=rig

# Real geometry variants share the same rig, clips and hair library. Position-only
# profile changes leave hand/foot anchors untouched; shape keys remain editable.
for obj in list(rig.children):
    if PILOT or obj.type!='MESH' or obj.data.materials[0].name.startswith('Hair-'):continue
    obj.shape_key_add(name='Basis')
    for variant in ['Luna','Amara','Samuel']:
        key=obj.shape_key_add(name=variant)
        deform=obj['deform_bone'];inverse=obj.matrix_world.inverted()
        for point in key.data:
            p=obj.matrix_world @ point.co
            x,y,z=p.x,p.z,-p.y
            if deform=='Head':
                height=y-2.23
                if variant=='Luna':
                    x*=.92 if y>2.22 else .83; y=2.23+height*1.03;z=-.025+(z+.025)*.96
                elif variant=='Amara':
                    x*=1.04 if y<2.32 else .98;y=2.23+height*.96;z=-.025+(z+.025)*1.03
                else:
                    x*=.89;y=2.23+height*1.13;z=-.025+(z+.025)*.92
            elif deform=='Chest':
                if variant=='Luna':x*=.91 if y<1.52 else .94
                elif variant=='Amara':x*=.97 if y<1.4 else 1.025
                else:x*=.90;y=1.25+(y-1.25)*1.035
            elif deform=='Hips':
                if variant=='Luna':x*=1.025
                elif variant=='Amara':x*=1.065
                else:x*=.94
            elif deform.startswith(('UpperArm','Forearm')):
                if variant=='Luna':
                    anchor=arm_points[deform[-1]][0 if deform.startswith('UpperArm') else 1]
                    x=anchor[0]+(x-anchor[0])*.94
                    z=anchor[2]+(z-anchor[2])*.94
            point.co=inverse @ coord((x,y,z))

# All actions key the same torso channels; no root travel is baked into the clips.
bpy.context.scene.render.fps=24
rig.animation_data_create()
clip_specs=[('SurfIdle',48),('TurnLeft',24),('TurnRight',24),('Boost',24),('Jump',24),('Scoop',24),('Land',16),('Hit',24)]
for name,frames in clip_specs:
    action=bpy.data.actions.new(name); action.use_fake_user=True
    rig.animation_data.action=action
    for frame in range(1,frames+2,2):
        t=(frame-1)/frames; wave=sin(t*2*pi); pulse=sin(t*pi)**2
        for pose in rig.pose.bones: pose.rotation_mode='XYZ'; pose.rotation_euler=(0,0,0); pose.location=(0,0,0)
        hips=rig.pose.bones['Hips']; chest=rig.pose.bones['Chest']; head=rig.pose.bones['Head']
        # Leave room for knee flexion; runtime IK keeps the soles on the board.
        hips.location.y=-.09+.025*wave
        chest.rotation_euler.x=(-.10 if PILOT else 0)+.025*wave
        head.rotation_euler.y=.025*sin(t*2*pi+.6)
        if name in ['TurnLeft','TurnRight']:
            side=-1 if name=='TurnLeft' else 1
            chest.rotation_euler.z=side*.19; chest.rotation_euler.y=side*.10
            head.rotation_euler.z=-side*.07; hips.location.y=-.12
        elif name=='Boost': chest.rotation_euler.x=-.22+.025*wave; hips.location.y=-.18
        elif name=='Jump': chest.rotation_euler.x=-.12; hips.location.y=-.18
        elif name=='Scoop': chest.rotation_euler.x=.11*pulse; hips.location.y=-.09-.045*pulse; head.rotation_euler.x=.10*pulse
        elif name=='Land': hips.location.y=-.09-.19*pulse; chest.rotation_euler.x=-.12*pulse
        elif name=='Hit': chest.rotation_euler.z=.23*wave*(1-t); chest.rotation_euler.x=.15*pulse; hips.location.y=-.09-.09*pulse
        for pose in [hips,chest,head]:
            pose.keyframe_insert(data_path='location',frame=frame,group=pose.name)
            pose.keyframe_insert(data_path='rotation_euler',frame=frame,group=pose.name)
    track=rig.animation_data.nla_tracks.new(); track.name=name
    strip=track.strips.new(name,1,action); strip.action_frame_start=1; strip.action_frame_end=frames+1
    track.mute=True
rig.animation_data.action=None
bpy.context.scene.frame_set(1)
for pose in rig.pose.bones: pose.rotation_euler=(0,0,0); pose.location=(0,0,0)
# Keep components and their weights editable. Runtime geometry is grouped by material.
asset_name='surfer-' + CHARACTER if CHARACTER else 'surfer-amara' if PILOT else 'surfer'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/f'{asset_name}.blend'))
batches = {}
for obj in list(rig.children): batches.setdefault(obj.data.materials[0].name, []).append(obj)
for name, objects in batches.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects)>1:bpy.ops.object.join()
    bpy.context.object.name = name
    bpy.context.object.data.validate(verbose=True)
    bpy.context.object.data.update()
bpy.ops.object.select_all(action='SELECT')
result = bpy.ops.export_scene.gltf(filepath=str(ROOT/'dist'/'assets'/f'{asset_name}.glb'),
    export_format='GLB', use_selection=True, export_animations=True, export_skins=True,
    export_animation_mode='ACTIONS', export_anim_single_armature=True,
    export_reset_pose_bones=True, export_force_sampling=True,export_morph=True,
    export_vertex_color='NAME' if PILOT else 'MATERIAL',export_vertex_color_name='Painted character',
    export_extras=True)
if result != {'FINISHED'}: raise RuntimeError('Surfer export failed')
print('COMPUNUBE_CARTOON_SURFER_READY')
