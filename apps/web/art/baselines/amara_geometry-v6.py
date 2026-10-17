"""Sculpted sportswear, planted feet and cylindrical grips in game coordinates.

Y is up and -Z forward. Rig anchors retain the existing clips and gameplay.
"""
from math import sin, cos, pi
from mathutils import Vector
import bpy


def build_amara(ctx):
    root,coord=ctx['root'],ctx['coord']
    skin,outfit,cream=ctx['skin'],ctx['outfit'],ctx['cream']
    shorts,ink,stitch=ctx['shorts'],ctx['ink'],ctx['stitch']
    oval,surface,cord=ctx['oval'],ctx['surface'],ctx['cord']
    straps=ctx['material']('Surf straps',(.035,.13,.15))
    iris=ctx['material']('Amber iris',(.40,.21,.08))
    for obj in list(root.children):
        if obj.type!='MESH':continue
        name=obj.data.materials[0].name
        if name.startswith('Hair-') and name!='Hair-afro':
            inverse=obj.matrix_world.inverted()
            for vertex in obj.data.vertices:
                p=obj.matrix_world @ vertex.co
                vertex.co=inverse @ coord((p.x*.82,2.37+(p.z-2.23)*.80,-p.y*.82))
        else:bpy.data.objects.remove(obj,do_unlink=True)

    def bind(bone):ctx['current_bone']=bone

    def geometry(name,vertices,faces,mat,weights):
        data=bpy.data.meshes.new(name)
        data.from_pydata([coord(p) for p in vertices],[],faces);data.update()
        obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
        obj.parent=root;obj['deform_bone']=next(iter(weights[0]));data.materials.append(mat)
        groups={}
        for i,influences in enumerate(weights):
            for bone,weight in influences.items():
                if bone not in groups:groups[bone]=obj.vertex_groups.new(name=bone)
                groups[bone].add([i],weight,'REPLACE')
        for face in data.polygons:face.use_smooth=True
        return obj

    def tube(name,centers,radii,mat,influences,sides=24):
        vertices,weights,faces=[],[],[]
        for i,p in enumerate(centers):
            tangent=Vector(centers[min(i+1,len(centers)-1)])-Vector(centers[max(0,i-1)])
            tangent.normalize();across=tangent.cross(Vector((0,0,1)))
            if across.length<.01:across=tangent.cross(Vector((0,1,0)))
            across.normalize();other=tangent.cross(across).normalized()
            rx,ry=radii[i] if isinstance(radii[i],tuple) else (radii[i],radii[i])
            for j in range(sides):
                a=j*2*pi/sides;contour=1+.025*cos(a*3+i*.4)
                vertices.append(Vector(p)+contour*(rx*across*cos(a)+ry*other*sin(a)))
                weights.append(influences[i])
        for i in range(len(centers)-1):
            for j in range(sides):
                a,b=i*sides+j,i*sides+(j+1)%sides;faces.append((a,b,b+sides,a+sides))
        faces += [tuple(range(sides-1,-1,-1)),tuple((len(centers)-1)*sides+j for j in range(sides))]
        return geometry(name,vertices,faces,mat,weights)

    leg_points=[('L',(-.23,1.10,.05),(-.4,.65,-.3),(-.43,.38,-.54)),
                ('R',(.23,1.10,.05),(.34,.68,.49),(.41,.38,.76))]
    for suffix,hip,knee,foot in leg_points:
        thigh,shin='Thigh_'+suffix,'Shin_'+suffix
        h,k,f=Vector(hip),Vector(knee),Vector(foot)
        tube('Tailored shorts leg '+suffix,[h,h.lerp(k,.14),h.lerp(k,.29),h.lerp(k,.43)],
             [(.217,.218),(.228,.225),(.222,.212),(.215,.205)],shorts,
             [{'Hips':.65,thigh:.35},{'Hips':.25,thigh:.75},{thigh:1},{thigh:1}])
        tube('Rolled ivory shorts hem '+suffix,[h.lerp(k,.415),h.lerp(k,.455),h.lerp(k,.49)],
             [.217,.222,.210],cream,[{thigh:1}]*3)
        tube('Continuous thigh and calf '+suffix,
             [h.lerp(k,.34),h.lerp(k,.55),h.lerp(k,.76),k,k.lerp(f,.20),k.lerp(f,.44),k.lerp(f,.72),f],
             [(.207,.193),(.205,.191),(.177,.169),(.143,.146),(.151,.146),(.150,.139),(.099,.092),(.083,.080)],skin,
             [{thigh:1},{thigh:1},{thigh:.9,shin:.1},{thigh:.5,shin:.5},{thigh:.1,shin:.9},{shin:1},{shin:1},{shin:1}])
        bind('Foot_'+suffix)
        # Broad heel, instep, toes and a sole at .305 (deck is .30).
        vertices,faces=[],[]
        for dz,width,height,y in [(.12,.067,.041,.35),(.065,.091,.065,.370),
                                 (-.035,.115,.083,.390),(-.14,.155,.060,.365),(-.235,.150,.039,.345)]:
            for i in range(24):
                a=i*2*pi/24;vertices.append((foot[0]+width*cos(a),y+height*sin(a),foot[2]+dz))
        for ring in range(4):
            for i in range(24):
                a,b=ring*24+i,ring*24+(i+1)%24;faces.append((a,a+24,b+24,b))
        faces += [tuple(range(23,-1,-1)),tuple(96+i for i in range(24))]
        geometry('Sculpted planted foot '+suffix,vertices,faces,skin,[{'Foot_'+suffix:1}]*len(vertices))
        side=-1 if suffix=='L' else 1
        for i in range(5):
            x=foot[0]+side*(.104-i*.048);radius=.040-i*.0035
            oval('Toe '+suffix+str(i),(x,.337,foot[2]-.246-.040*(1-i/5)),(radius,.030,.067-i*.006),skin)
        bind(shin)
        tube('Neoprene ankle cuff '+suffix,[k.lerp(f,.83),k.lerp(f,.94)],[.094,.092],straps,[{shin:1}]*2)
        bind('Foot_'+suffix)
        cord('Ankle cuff folded tab '+suffix,[(foot[0]+side*.078,.419,foot[2]),(foot[0]+side*.093,.386,foot[2]+.025)],.014,stitch)

    bind('Hips')
    surface('Tailored shorts saddle',[(1.005,.370,.263,.055),(1.09,.397,.269,.06),
            (1.19,.374,.245,.055),(1.265,.292,.194,.04)],shorts,40)
    surface('Ivory shorts waistband',[(1.242,.303,.201,.04),(1.284,.288,.192,.04)],cream,40)
    for side in [-1,1]:
        cord('Shorts curved side piping',[(side*.294,1.25,.118),(side*.357,1.17,.175),(side*.356,1.07,.258)],.012,cream)
        cord('Shorts pocket stitching',[(side*.14,1.17,.308),(side*.21,1.095,.311),(side*.27,1.15,.304)],.0045,stitch)
    bind('Chest')
    surface('Continuous athletic torso',[(1.23,.287,.189,.035),(1.35,.286,.189,.035),
            (1.49,.337,.211,.02),(1.68,.391,.218,.005),(1.82,.405,.215,0),
            (1.94,.360,.169,0),(2.00,.223,.123,0),(2.05,.12,.095,0)],skin,40)
    # One open garment with an underarm curve, rather than a closed solid vest.
    rings=[(1.345,.290,.199,.035),(1.42,.310,.217,.032),(1.56,.365,.237,.018),
           (1.72,.413,.240,.01),(1.82,.425,.227,.005),(1.94,.370,.183,0)]
    vertices,faces=[],[];steps=64
    def garment_point(row,a,offset=1):
        y,rx,rz,z=rings[row]
        if row==len(rings)-1:
            side=abs(cos(a));y=1.985-.205*side**6-.060*(1-side)**5
            rx=.407;rz=.161+.034*side
        fold=(.005*cos(a*6+.6)+.004*sin(a*9))*max(0,1-row/5)
        return ((rx+fold)*offset*cos(a),y,z+(rz+fold)*offset*sin(a))
    for row in range(len(rings)):
        for i in range(steps):vertices.append(garment_point(row,i*2*pi/steps))
    for row in range(len(rings)-1):
        for i in range(steps):
            a,b=row*steps+i,row*steps+(i+1)%steps;faces.append((a,a+steps,b+steps,b))
    geometry('Open sculpted surf vest',vertices,faces,outfit,[{'Chest':1}]*len(vertices))
    for side in [-1,1]:
        vertices,faces=[],[]
        for row in range(len(rings)):
            extent=[.48,.53,.57,.56,.48,.20][row]
            for i in range(9):
                a=-extent+2*extent*i/8+(0 if side>0 else pi)
                vertices.append(garment_point(row,a,1.012))
        for row in range(len(rings)-1):
            for i in range(8):
                a=row*9+i;faces.append((a,a+9,a+10,a+1))
        geometry('Tailored ivory side insert',vertices,faces,cream,[{'Chest':1}]*len(vertices))
    cord('Rolled armholes and neckline',[garment_point(5,i*2*pi/96,1.017) for i in range(97)],.012,cream)
    cord('Coral folded vest hem',[garment_point(0,i*2*pi/64,1.016) for i in range(65)],.011,outfit)
    for x in [-.18,.18]:
        cord('Tailored back seam',[(x*.85,1.36,.202),(x*1.10,1.53,.224),(x*1.40,1.77,.201),(x*1.12,1.94,.147)],.0055,stitch)
    cord('Front vest zip',[(0,1.36,-.167),(0,1.58,-.221),(0,1.925,-.164)],.0065,ink)
    oval('Zip slider',(0,1.79,-.237),(.015,.025,.012),stitch)
    oval('Club fabric patch',(0,1.635,.258),(.107,.096,.008),shorts)
    for row in range(2):
        cord('Club wave embroidery',[(x,1.61+row*.034+.011*sin(x*38),.268) for x in [-.071+i*.0089 for i in range(17)]],.0055,cream)
    tube('Continuous neck',[(0,1.97,0),(0,2.07,-.005),(0,2.18,-.012)],
         [.114,.103,.115],skin,[{'Chest':1},{'Chest':.5,'Head':.5},{'Head':1}])

    bind('Head')
    surface('Designed jaw and cheekbones',[(2.105,.074,.071,-.025),(2.15,.164,.122,-.032),
            (2.235,.254,.194,-.022),(2.33,.301,.247,-.007),(2.45,.306,.252,.005),
            (2.55,.269,.226,.012),(2.64,.169,.147,.01),(2.68,.024,.024,0)],skin,40)
    for side in [-1,1]:
        oval('Sculpted ear',(side*.300,2.365,.014),(.061,.091,.042),skin)
        oval('Inner ear',(side*.335,2.363,-.010),(.021,.052,.014),ctx['pink'])
        oval('Warm cheek',(side*.184,2.295,-.205),(.054,.020,.010),ctx['pink'])
        oval('Eye white',(side*.12,2.423,-.244),(.059,.065,.022),cream)
        oval('Amber iris',(side*.12,2.422,-.263),(.036,.045,.010),iris)
        oval('Pupil',(side*.12,2.423,-.271),(.018,.031,.007),ink)
        oval('Eye glint',(side*.12-.010,2.441,-.278),(.008,.010,.004),cream)
        cord('Upper sculpted eyelid',[(side*.065,2.443,-.246),(side*.10,2.485,-.254),(side*.145,2.486,-.252),(side*.180,2.444,-.227)],.010,skin)
        cord('Upper eyelash',[(side*.069,2.448,-.258),(side*.112,2.480,-.269),(side*.158,2.465,-.254)],.0055,ink)
        cord('Expressive brow',[(side*.065,2.53,-.221),(side*.112,2.548,-.238),(side*.171,2.535,-.219)],.013,ctx['brows'])
        cord('Small hoop earring',[(side*(.325+.029*cos(i*2*pi/24)),2.277+.037*sin(i*2*pi/24),-.016) for i in range(25)],.006,stitch)
    surface('Sculpted nose bridge',[(2.302,.021,.021,-.267),(2.328,.047,.032,-.269),(2.367,.041,.041,-.264),(2.407,.023,.026,-.249)],skin,20)
    oval('Nose tip',(0,2.342,-.292),(.041,.027,.025),skin)
    for side in [-1,1]:oval('Nostril',(side*.025,2.318,-.293),(.010,.005,.006),ctx['pink'])
    cord('Upper lip',[(-.065,2.250,-.211),(-.025,2.250,-.235),(0,2.254,-.239),(.022,2.249,-.236),(.062,2.252,-.217)],.010,ctx['pink'])
    cord('Quiet smile',[(-.060,2.247,-.215),(-.024,2.241,-.238),(.023,2.242,-.237),(.058,2.249,-.217)],.0045,ink)
    cord('Lower lip',[(-.044,2.235,-.218),(0,2.224,-.233),(.040,2.237,-.222)],.008,ctx['pink'])

    afro=ctx['afro_hair']
    surface('Afro shaped core',[(2.48,.303,.294,.043),(2.66,.417,.357,.027),
            (2.88,.362,.309,.012),(3.055,.125,.108,.004)],afro,40)
    # Tapered curved locks create distinct clumps, avoiding repeated corkscrews.
    for row,count in [(0,15),(1,13),(2,10)]:
        for i in range(count):
            a=i*2*pi/count+row*.31
            radius=[.371,.397,.271][row]+.031*sin(i*2.3+row)
            height=2.48+row*.217+.105*max(0,-sin(a))+.042*cos(i*1.9)
            path=[];radii=[]
            for j in range(9):
                t=j/8;arc=(t-.5)*(1.1*pi+.16*sin(i));r=radius+.076*cos(arc);tangent=.095*sin(arc)
                path.append((r*cos(a)-tangent*sin(a),height+.163*t+.031*sin(arc),.025+r*sin(a)+tangent*cos(a)))
                size=(.105+.013*sin(i*1.1+row))*(.58+.42*sin(pi*t)**.7)
                radii.append((size,size*.82))
            tube('Sculpted grouped afro lock',path,radii,afro,[{'Head':1}]*9,16)
    for x,z in [(-.16,0),(.02,-.07),(.155,.072)]:
        tube('Crown swept curl',[(x-.08,2.99,z+.035),(x-.06,3.08,z+.01),(x+.02,3.12,z-.015),(x+.095,3.04,z)],
             [.055,.11,.105,.045],afro,[{'Head':1}]*4,20)

    arm_points={}
    for side,suffix in [(-1,'L'),(1,'R')]:
        shoulder=(side*.355,1.91,0);elbow=(side*.57,1.46,-.15);hand=(side*.61,1.025,-.44)
        arm_points[suffix]=(shoulder,elbow,hand);s,e,h=Vector(shoulder),Vector(elbow),Vector(hand)
        upper,lower,palm='UpperArm_'+suffix,'Forearm_'+suffix,'Hand_'+suffix
        tube('Continuous sculpted arm '+suffix,
             [s+Vector((-side*.065,.015,0)),s.lerp(e,.15),s.lerp(e,.36),s.lerp(e,.62),s.lerp(e,.87),e,
              e.lerp(h,.22),e.lerp(h,.46),e.lerp(h,.74),e.lerp(h,.94),h],
             [(.065,.065),(.160,.151),(.158,.153),(.140,.133),(.108,.115),(.098,.100),
              (.121,.108),(.119,.104),(.091,.085),(.068,.067),(.064,.062)],skin,
             [{'Chest':1},{'Chest':.40,upper:.60},{'Chest':.05,upper:.95},{upper:1},
              {upper:.85,lower:.15},{upper:.5,lower:.5},{upper:.12,lower:.88},
              {lower:1},{lower:1},{lower:.8,palm:.2},{lower:.4,palm:.6}])
        tube('Neoprene wrist cuff '+suffix,[e.lerp(h,.85),e.lerp(h,.94)],[.087,.079],straps,[{lower:1}]*2)
        bind(palm)
        # Authored around game X at the grip anchor. Runtime aligns it to the pole.
        oval('Grip palm '+suffix,(hand[0],hand[1]+.003,hand[2]+.053),(.101,.062,.052),skin)
        for i in range(4):
            x=hand[0]+(i-1.5)*.041
            cord('Wrapped finger '+suffix,[(x,hand[1]+.014,hand[2]+.072),(x,hand[1]-.048,hand[2]+.059),
                 (x,hand[1]-.065,hand[2]-.014),(x,hand[1]-.029,hand[2]-.060),(x,hand[1]+.013,hand[2]-.043)],.023,skin)
        cord('Opposing thumb '+suffix,[(hand[0]-side*.090,hand[1]+.036,hand[2]+.053),
             (hand[0]-side*.116,hand[1]+.053,hand[2]+.004),(hand[0]-side*.073,hand[1]+.038,hand[2]-.048),
             (hand[0]-side*.027,hand[1]+.013,hand[2]-.054)],.028,skin)
        oval('Wrist cuff stitched tab '+suffix,(hand[0]-side*.02,hand[1]+.053,hand[2]+.091),(.026,.009,.022),stitch)
    root['visual_revision']='Amara / concept 02 / character 06'
    root['grip_frame']='game-X / pole aligned / fingers wrap at anchor'
    return arm_points,leg_points
