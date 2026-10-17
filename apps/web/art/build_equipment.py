"""Editable cartoon equipment; shared grip/contact coordinates, independent silhouettes."""
from pathlib import Path
from math import sin, cos, pi, sqrt
from mathutils import Vector
import bpy
import sys

ROOT = Path(__file__).resolve().parents[1]
BOARDS_ONLY = '--boards-only' in sys.argv
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def mat(name, color, alpha=1, metallic=0, glow=0):
    color = tuple(c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in color)
    m = bpy.data.materials.new(name); m.diffuse_color = (*color, alpha); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = m.diffuse_color
    p.inputs['Roughness'].default_value = .36 if metallic else .72
    p.inputs['Metallic'].default_value = metallic
    if glow:
        p.inputs['Emission Color'].default_value = (*color,1)
        p.inputs['Emission Strength'].default_value = glow
    p.inputs['Alpha'].default_value = alpha
    if alpha < 1: m.surface_render_method = 'DITHERED'; m.use_backface_culling = False
    return m

board_color = mat('BoardColor', (1, 1, 1))
net_color = mat('NetColor', (1, 1, 1))
cream = mat('Equipment cream', (.96, .90, .70))
ink = mat('Equipment lagoon', (.025, .16, .17))
wood = mat('Recovered wood', (.59, .35, .15))
sun = mat('Sun coral', (.92, .26, .10))
metal = mat('Recovered metal', (.48, .60, .54), metallic=.65)
steel = mat('Brushed steel', (.66,.75,.79), metallic=.75)
copper = mat('Reclaimed copper', (.76,.40,.22), metallic=.7)
grid_mat = mat('Woven green cord', (.09, .32, .24))
bag_mat = mat('Open woven pouch', (.25, .57, .40), .17)
rubber=mat('Rubber ridge',(.10,.24,.23))

def coord(p): return Vector((p[0], -p[2], p[1]))
def group(name, parent=None, pos=(0,0,0)):
    o = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(o)
    o.parent = parent; o.location = coord(pos); return o
def geometry(name, vertices, faces, material, parent):
    g = bpy.data.meshes.new(name); g.from_pydata([coord(p) for p in vertices], [], faces); g.update()
    o = bpy.data.objects.new(name, g); bpy.context.collection.objects.link(o)
    o.parent = parent; g.materials.append(material)
    for p in g.polygons: p.use_smooth = True
    return o
def tube(name, paths, radius, material, parent, sides=8):
    vertices=[]; faces=[]
    for path in paths:
        base=len(vertices)
        for i,p in enumerate(path):
            v=Vector(p); direction=Vector(path[min(i+1,len(path)-1)])-Vector(path[max(i-1,0)])
            direction.normalize(); cross=direction.cross(Vector((0,1,0)))
            if cross.length < .01: cross=direction.cross(Vector((0,0,1)))
            cross.normalize(); other=direction.cross(cross).normalized()
            for j in range(sides): vertices.append(v+radius*(cross*cos(j*2*pi/sides)+other*sin(j*2*pi/sides)))
        for i in range(len(path)-1):
            for j in range(sides):
                a=base+i*sides+j; b=base+i*sides+(j+1)%sides
                faces.append((a,b,b+sides,a+sides))
        faces.extend([tuple(base+j for j in range(sides-1,-1,-1)),tuple(base+(len(path)-1)*sides+j for j in range(sides))])
    return geometry(name,vertices,faces,material,parent)
def box(name, pos, size, material, parent, bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o=bpy.context.object; o.name=name; o.parent=parent; o.location=coord(pos); o.dimensions=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material)
    if bevel:
        m=o.modifiers.new('Rounded corners','BEVEL');m.width=bevel;m.segments=3
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o

def surf_fin(x, parent, scale=1):
    # A raked foil with a curved leading edge, rather than a rectangular block.
    outline=[(.105,.90),(.105,1.40),(.02,1.405),(-.14,1.385),
             (-.26,1.345),(-.30,1.285),(-.275,1.23),(-.18,1.08),(-.035,.955)]
    points=[];faces=[];count=len(outline)
    for side in [-1,1]:
        for height,z in outline:
            points.append((x+side*.022*scale,.105+(height-.105)*scale,1.14+(z-1.14)*scale))
    faces.extend([tuple(range(count-1,-1,-1)),tuple(count+i for i in range(count))])
    for i in range(count):
        j=(i+1)%count;faces.append((i,j,count+j,count+i))
    fin=geometry('Raked surf fin',points,faces,ink,parent)
    bevel=fin.modifiers.new('Soft foil edges','BEVEL');bevel.width=.007;bevel.segments=2
    fin.modifiers.new('Foil normals','WEIGHTED_NORMAL')
    return fin

roots=[]
for variant in ['coral','manglar','sol']:
    root=group('Board-'+variant); roots.append((root,'board-'+variant))
    vertices=[];faces=[];n=64

    def outline(a, scale):
        x=sin(a)*(.69 if variant=='sol' else .66)*scale
        z=cos(a)*(2.04 if variant=='sol' else 1.92)*scale
        if variant=='manglar' and z>1.25:
            z-=.46*max(0,1-abs(x)/.38)**2
        return x,z

    def rocker(z): return max(0,-z-1.05)**2*.14

    for scale,height in [(.9,.1),(1,.16),(1,.25),(.92,.30)]:
        for i in range(n):
            x,z=outline(i*2*pi/n,scale)
            vertices.append((x,height+rocker(z),z))
    for ring in range(3):
        for i in range(n): faces.append((ring*n+i,ring*n+(i+1)%n,(ring+1)*n+(i+1)%n,(ring+1)*n+i))

    # Sample the raised nose across the deck, rather than a single fan from a
    # flat centre. The old fan lifted through artwork authored on the rocker.
    previous=3*n
    for scale in [.78,.64,.50,.36,.22,.08]:
        current=len(vertices)
        for i in range(n):
            x,z=outline(i*2*pi/n,scale)
            vertices.append((x,.30+rocker(z),z))
        for i in range(n):
            j=(i+1)%n
            faces.append((previous+i,previous+j,current+j,current+i))
        previous=current
    center=len(vertices);vertices.append((0,.30,0))
    for i in range(n):faces.append((center,previous+i,previous+(i+1)%n))
    center=len(vertices);vertices.append((0,.10,0))
    for i in range(n):faces.append((center,(i+1)%n,i))
    deck=geometry('Sculpted deck',vertices,faces,board_color,root)
    bpy.context.view_layer.update()
    artwork=group('DeckArtwork-'+variant,root)

    def deck_point(x,z):
        hit,point,normal,_=deck.ray_cast(coord((x,2,z)),Vector((0,0,-1)))
        if not hit:
            raise ValueError(f'{variant}: artwork outside deck at {x}, {z}')
        return (x,point.z+.0015,z)

    def ribbon(name,path,width,material):
        points,patches=[],[]
        for i,(x,z) in enumerate(path):
            before=Vector(path[max(0,i-1)]);after=Vector(path[min(len(path)-1,i+1)])
            direction=(after-before).normalized()
            across=Vector((-direction.y,direction.x))
            half=(width[i] if isinstance(width,list) else width)*.5
            for side in [-1,1]:
                edge=Vector((x,z))+across*half*side
                points.append(deck_point(edge.x,edge.y))
        for row in range(len(path)-1):
            a=row*2;patches.append((a,a+1,a+3,a+2))
        return geometry(name,points,patches,material,artwork)

    if variant=='manglar':
        for x in [-.24,0,.24]:
            ribbon('Reused wood inlay',[(x,-1.425+i*2.65/48) for i in range(49)],.085,wood)
        for x in [-.29,.29]: surf_fin(x,root,.86)
        for side in [-1,1]:
            tube('Repaired rail stitch', [[(side*.51,.31,-.72),(side*.55,.31,-.57)]], .009,cream,root)
    elif variant=='sol':
        ribbon('Sun medallion',[(.26*cos(a*2*pi/48),-.97+.26*sin(a*2*pi/48)) for a in range(49)],.052,sun)
        for a in range(8):
            ribbon('Sun ray',[(r*cos(a*pi/4),-.97+r*sin(a*pi/4)) for r in [.32,.38,.44]],.042,sun)
        for x in [-.4,.4]:
            ribbon('Longboard pinstripe',[(x,-.75+i*1.8/40) for i in range(41)],.04,cream)
    else:
        ribbon('Classic stringer',[(0,-1.70+i*3.28/64) for i in range(65)],.045,cream)
        for band in range(2):
            points=[];widths=[]
            for row in range(25):
                z=-1.66+row*.079
                taper=sqrt(max(0,1-(z/(1.92*.92))**2))
                center=((.20 if band==0 else -.22)+.18*sin(z*2.7+band*.5))*taper
                widths.append(2*(.065+.045*sin(row/24*pi))*taper)
                points.append((center,z))
            ribbon('Ivory flowing deck panel',points,widths,cream)

    # A thin rounded pad sits below the authored .305 m soles. Its previous
    # .339 m top buried the rear foot; the board/foot targets stay unchanged.
    pad=group('TractionPad-'+variant,root)
    vertices=[];faces=[];steps=48
    for height,scale in [(.3005,1),(.304,.997)]:
        for i in range(steps):
            a=i*2*pi/steps;c,s=cos(a),sin(a)
            vertices.append((.5*(1 if c>=0 else -1)*abs(c)**.45*scale,
                             height,.84+.44*(1 if s>=0 else -1)*abs(s)**.45*scale))
    for i in range(steps):
        j=(i+1)%steps;faces.append((i,steps+i,steps+j,j))
    faces.extend([tuple(range(steps)),tuple(steps+i for i in range(steps-1,-1,-1))])
    geometry('Rounded traction pad',vertices,faces,ink,pad)
    for i in range(6):
        for side in [-1,1]:
            a=Vector((side*.035,.53+i*.105));b=Vector((side*.42,.62+i*.105))
            direction=(b-a).normalized();across=Vector((-direction.y,direction.x))*.004
            corners=[a-across,a+across,b+across,b-across]
            geometry('Grip herringbone',[(p.x,.3042,p.y) for p in corners],[(0,1,2,3)],rubber,pad)
    if variant!='manglar': surf_fin(0,root)

for variant in ['red-base','red-reuso','red-marea','red-cobre','red-faro','red-aurora','red-sol']:
    root=group('Net-'+variant);roots.append((root,'net-'+variant))
    start=Vector((-.15,1.55,-.46));end=Vector((2.05,.34,-1.4));direction=end-start
    handle_mat=wood if variant=='red-reuso' else copper if variant=='red-cobre' else steel if variant in ['red-faro','red-aurora','red-sol'] else metal
    tube('Continuous handle',[[start,start+direction*.87]],.049,handle_mat,root)
    # Grips lie on the same pole used by the runtime hand targets.
    for t in [.15,.43]:
        tube('Grip sleeve',[[start+direction*(t-.055),start+direction*(t+.055)]],.072,ink,root)
        for offset in [-.048,0,.048]:tube('Grip stitch',[[start+direction*(t+offset-.005),start+direction*(t+offset+.005)]],.077,net_color,root)
    tube('Butt cap',[[start-direction*.015,start+direction*.016]],.069,ink,root)
    for t in [.59,.81]:
        tube('Recovered coupling',[[start+direction*(t-.026),start+direction*(t+.026)]],.073,handle_mat,root)
        tube('Coupling collar',[[start+direction*(t-.008),start+direction*(t+.008)]],.079,cream,root)
    if variant in ['red-faro','red-sol']:
        tube('Telescopic sleeve',[[start+direction*.61,start+direction*.79]],.066,handle_mat,root,sides=10)
    if variant=='red-aurora':
        axis=direction.normalized();side=axis.cross(Vector((0,1,0))).normalized()
        for sign in [-1,1]:tube('Twin protective rail',[[start+direction*.55+side*.072*sign,start+direction*.85+side*.072*sign]],.018,steel,root)
    if variant in ['red-reuso','red-cobre']:
        axis=direction.normalized();side=axis.cross(Vector((0,1,0))).normalized();up=axis.cross(side).normalized()
        wrap=[start+direction*(.60+i*.0025)+.058*(side*cos(i*.55)+up*sin(i*.55)) for i in range(48)]
        tube('Spiral repair binding',[wrap],.012,cream if variant=='red-reuso' else ink,root,sides=5)
    lights={'red-marea':(.67,.46,.95),'red-faro':(.35,.90,.83),'red-aurora':(.40,.60,1),'red-sol':(1,.68,.21)}
    glow_mat=mat('Signal '+variant,lights[variant],glow=1.8) if variant in lights else None
    if glow_mat:
        for t in [.60,.72,.82]:tube('Light band',[[start+direction*(t-.01),start+direction*(t+.01)]],.076,glow_mat,root)
    head=group('NetHead-'+variant,root,(2.05,.34,-1.4))
    def outline(a):
        if variant=='red-reuso':
            # Soft square silhouette, still rounded at every corner.
            return (.71*(1 if cos(a)>=0 else -1)*abs(cos(a))**.5,.71*(1 if sin(a)>=0 else -1)*abs(sin(a))**.5)
        if variant in ['red-cobre','red-faro']:
            n=6 if variant=='red-cobre' else 8
            sector=2*pi/n;radius=.79*cos(pi/n)/cos((a+pi/n)%sector-pi/n)
            return (radius*cos(a),radius*sin(a))
        if variant=='red-aurora':return (.74*cos(a)*(1+.16*sin(a)),.82*sin(a))
        if variant=='red-sol':return (.84*cos(a),.69*sin(a))
        return ((.69 if variant=='red-marea' else .78)*cos(a),(.88 if variant=='red-marea' else .78)*sin(a))
    lift=.38
    ring=[(outline(i*2*pi/48)[0],lift,outline(i*2*pi/48)[1]) for i in range(49)]
    tube('Open frame',[ring],.066,net_color,head)
    # Neck forks visibly connect the pole to the rim instead of ending in thin air.
    neck=-direction*.13
    tube('Neck fork',[[neck,(outline(a)[0],lift+.018,outline(a)[1])] for a in [2.55,2.10]],.046,handle_mat,head)
    tube('Neck socket',[[-direction*.19,-direction*.12]],.070,ink,head)
    if variant in ['red-marea','red-aurora','red-sol']:
        tube('Double rim', [[(x,lift-.10,z) for x,y,z in ring]],.026,cream,head)
        tube('Side braces', [[(-.66,lift,-.1),(-.50,lift-.26,-.1)],[(.66,lift,-.1),(.50,lift-.26,-.1)]],.036,metal,head)
    if glow_mat:
        paths=[]
        for sector in range(4):
            paths.append([(outline(a)[0],lift+.018,outline(a)[1]) for a in [sector*pi/2+.12+i*.045 for i in range(8)]])
        tube('Rim lights',paths,.076,glow_mat,head)
    depth=.96 if variant in ['red-marea','red-aurora'] else .86
    def point(a,d):
        x,z=outline(a);return (x*.94*cos(d),lift-depth*sin(d),z*.94*cos(d))
    vertices=[point(i*2*pi/32,j*pi/20) for j in range(11) for i in range(32)]
    faces=[(j*32+i,j*32+(i+1)%32,(j+1)*32+(i+1)%32,(j+1)*32+i) for j in range(10) for i in range(32)]
    geometry('Deep open pouch',vertices,faces,bag_mat,head)
    paths=[[point(i*2*pi/16+sign*j*.075,j*pi/20) for j in range(11)] for i in range(16) for sign in [-1,1]]
    paths += [[point(i*2*pi/32,j*pi/20) for i in range(33)] for j in [2,5,8]]
    tube('Diamond woven pouch',paths,.013,grid_mat,head,sides=5)
    # A visible bottom seam and lashings establish the depth of the U-shaped bag.
    tube('Bottom seam',[[(.15*cos(i*2*pi/24),lift-depth+.028,.15*sin(i*2*pi/24)) for i in range(25)]],.019,grid_mat,head)
    tube('Rim lashings',[[point(i*2*pi/12,0),point(i*2*pi/12,.12)] for i in range(12)],.023,cream,head)

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'equipment-kit.blend'))
for root,filename in roots:
    if BOARDS_ONLY and not filename.startswith('board-'):
        continue
    # Batch within each parent, preserving the head transform/contact anchor.
    batches={}
    for obj in list(root.children_recursive):
        if obj.type=='MESH': batches.setdefault((obj.parent,obj.data.materials[0].name),[]).append(obj)
    for (parent,name),objects in batches.items():
        for obj in objects:
            bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
            for modifier in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        bpy.context.object.name=name
    bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
    for child in root.children_recursive:child.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'dist'/'assets'/(filename+'.glb')),export_format='GLB',use_selection=True,export_animations=False)
print('COMPUNUBE_EQUIPMENT_READY')
