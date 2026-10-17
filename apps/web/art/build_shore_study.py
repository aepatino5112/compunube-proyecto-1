"""Editable village/mangrove banks for the illustrated scene and race scenery."""
from pathlib import Path
from math import sin, cos, pi
from mathutils import Vector, Matrix
import bpy

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0

def material(name,color):
    value=tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in color)
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*value,1)
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=m.diffuse_color;p.inputs['Roughness'].default_value=.86
    return m

sand=material('Study warm sand',(.87,.73,.47))
wood=material('Study warm wood',(.45,.30,.16))
leaves=[material('Study foliage '+str(i),c) for i,c in enumerate([(.31,.60,.15),(.45,.70,.20),(.64,.79,.28)])]
turquoise=material('Study turquoise house',(.09,.53,.59))
yellow=material('Study ochre house',(.87,.53,.16))
roof=material('Study coral roof',(.76,.30,.18))
trim=material('Study ivory trim',(.95,.85,.62))
dark=material('Study window shade',(.035,.13,.14))
painted_leaves=material('Study painted foliage', (1,1,1))
leaf_image=bpy.data.images.load(str(ROOT/'art'/'textures'/'foliage-atlas-v1.png'),check_existing=True)
leaf_image.pack()
leaf_texture=painted_leaves.node_tree.nodes.new('ShaderNodeTexImage');leaf_texture.image=leaf_image
leaf_texture.interpolation='Linear';leaf_texture.extension='CLIP'
leaf_shader=painted_leaves.node_tree.nodes.get('Principled BSDF')
leaf_clip=painted_leaves.node_tree.nodes.new('ShaderNodeMath');leaf_clip.operation='GREATER_THAN';leaf_clip.inputs[1].default_value=.45
painted_leaves.node_tree.links.new(leaf_texture.outputs['Alpha'],leaf_clip.inputs[0])
painted_leaves.node_tree.links.new(leaf_clip.outputs[0],leaf_shader.inputs['Alpha'])
painted_leaves.surface_render_method='DITHERED';painted_leaves.use_backface_culling=False

root=bpy.data.objects.new('MaracaiboStudyShore',None);bpy.context.collection.objects.link(root)
def coord(p):return Vector((p[0],-p[2],p[1]))
def mesh(name,vertices,faces,mat,smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata([coord(p) for p in vertices],[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.parent=root;data.materials.append(mat)
    for face in data.polygons:face.use_smooth=smooth
    return o

def box(name,p,size,mat,bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1);o=bpy.context.object;o.name=name;o.parent=root;o.location=coord(p);o.dimensions=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
    if bevel:
        mod=o.modifiers.new('Worn edges','BEVEL');mod.width=bevel;mod.segments=2;o.modifiers.new('Face normals','WEIGHTED_NORMAL')
    return o

def tube(name,path,radii,mat):
    vertices=[];faces=[];sides=10
    for i,p in enumerate(path):
        tangent=Vector(path[min(i+1,len(path)-1)])-Vector(path[max(0,i-1)]);tangent.normalize()
        across=tangent.cross(Vector((0,0,1)))
        if across.length<.01:across=tangent.cross(Vector((0,1,0)))
        across.normalize();other=tangent.cross(across)
        for j in range(sides):
            a=j*2*pi/sides;vertices.append(Vector(p)+radii[i]*(across*cos(a)+other*sin(a)))
    for i in range(len(path)-1):
        for j in range(sides):
            a=i*sides+j;b=i*sides+(j+1)%sides;faces.append((a,b,b+sides,a+sides))
    faces+=[tuple(range(sides-1,-1,-1)),tuple((len(path)-1)*sides+j for j in range(sides))]
    return mesh(name,vertices,faces,mat,True)

# An elongated, scalloped bank with a shallow sloping sand shelf.
vertices=[(0,.7,0)];faces=[];n=64
for r,y in [(.30,.73),(.64,.58),(.90,.05),(1.0,-.35)]:
    for i in range(n):
        a=i*2*pi/n;edge=1+.13*sin(a*3+.7)+.07*cos(a*5)
        vertices.append((cos(a)*8.3*r*edge,y,sin(a)*22*r*edge))
for i in range(n):faces.append((0,1+(i+1)%n,1+i))
for row in range(3):
    for i in range(n):
        a=1+row*n+i;b=1+row*n+(i+1)%n;faces.append((a,b,b+n,a+n))
mesh('Sculpted sand shelf',vertices,faces,sand,True)

def leaf(name,a,b,width,mat):
    a,b=Vector(a),Vector(b);axis=b-a;side=axis.cross(Vector((0,1,0))).normalized()
    vertices=[];faces=[]
    for i in range(5):
        t=i/4;p=a+axis*t;p.y+=.16*sin(t*pi)
        w=width*sin(t*pi)**.75
        vertices.extend([p-side*w,p+Vector((0,.06,0)),p+side*w])
    for i in range(4):
        k=i*3;faces.extend([(k,k+3,k+4,k+1),(k+1,k+4,k+5,k+2)])
    # glTF exports the leaf material double-sided; duplicate coplanar faces are
    # invalid mesh topology and would cause unnecessary overdraw.
    mesh(name,vertices,faces,mat)

def palm(x,z,height,lean,phase):
    path=[(x+lean*(t/6)**2,.55+height*t/6,z+.3*sin(t/6*pi)) for t in range(7)]
    tube('Curved palm trunk',path,[.23-t*.014 for t in range(7)],wood)
    top=Vector(path[-1])
    for f in range(8):
        a=f*2*pi/8+phase;radial=Vector((cos(a),0,sin(a)));length=2.7+.45*sin(f*1.7+phase)
        stem=[top+radial*(length*t/7)+Vector((0,.55*sin(t/7*pi)-.9*(t/7)**2,0)) for t in range(8)]
        tube('Palm leaf spine',stem,[.037-t*.0038 for t in range(8)],leaves[1])
        tangent=Vector((-sin(a),0,cos(a)))
        for j in range(1,7):
            t=j/7;p=stem[j];span=.66*sin(t*pi)+.14
            for side in [-1,1]:
                leaf('Broad palm leaflet',p,p+tangent*side*span+radial*.52+Vector((0,-.23,0)),.21,leaves[(j+f)%3])

def painted_spray(p,angle,tilt,index,width=2.45,height=2.0):
    # Bowed, crossed sprays wrap the supporting crown instead of a single
    # camera-facing billboard. All four atlas cells share one material/batch.
    vertices=[];faces=[];uvs=[];rows=4;columns=4;p=Vector(p)
    across=Vector((cos(angle),0,sin(angle)));normal=Vector((-sin(angle),0,cos(angle)))
    up=Vector((0,1,0));cell=index%4;left=(cell%2)*.5;bottom=(1-cell//2)*.5
    for row in range(rows):
        v=row/(rows-1)
        for column in range(columns):
            u=column/(columns-1);horizontal=(u-.5)*width;vertical=(v-.5)*height
            position=p+across*(horizontal*cos(tilt)-vertical*sin(tilt))+up*(horizontal*sin(tilt)+vertical*cos(tilt))
            position+=normal*(.16*sin(u*pi)*sin(v*pi))
            vertices.append(position);uvs.append((left+.002+u*.496,bottom+.002+v*.496))
    for row in range(rows-1):
        for column in range(columns-1):
            a=row*columns+column;faces.append((a,a+1,a+columns+1,a+columns))
    obj=mesh('Painted mangrove spray',vertices,faces,painted_leaves,True)
    uv=obj.data.uv_layers.new(name='Foliage atlas')
    for loop in obj.data.loops:uv.data[loop.index].uv=uvs[loop.vertex_index]
    return obj

def foliage_crown(p,phase,index,size=1.0):
    # Tapered, offset lobes give the canopy a designed outline rather than spheres.
    p=Vector(p);vertices=[];faces=[];n=12
    width=1.1+.22*sin(index*1.7+phase);depth=1.06+.20*cos(index*1.3)
    for y,radius in [(-.75,.18),(-.40,.38),(.04,.50),(.42,.40),(.73,.17)]:
        for j in range(n):
            a=j*2*pi/n
            edge=1+.20*sin(a*3+phase)+.10*cos(a*5+index)
            vertices.append(p+Vector((cos(a)*width*radius*edge+.16*y,y,sin(a)*depth*radius*edge+.10*y))*size)
    for row in range(4):
        for j in range(n):
            a=row*n+j;b=row*n+(j+1)%n;faces.append((a,a+n,b+n,b))
    vertices.extend([p+Vector((-.09,-.87,.02))*size,p+Vector((.16,.87,.08))*size])
    for j in range(n):
        faces.append((5*n,j,(j+1)%n))
        faces.append((5*n+1,4*n+(j+1)%n,4*n+j))
    crown=mesh('Sculpted foliage lobe',vertices,faces,leaves[index%3],True)
    for layer in range(6):
        angle=phase+index*.37+layer*pi/3
        offset=Vector((-sin(angle)*.60,.12+sin(index*2.3)*.1,cos(angle)*.60))*size
        painted_spray(p+offset,angle,.10*sin(index+layer),index+layer,2.45*size,2.0*size)
    return crown

def mangrove(x,z,height,phase,cluster):
    existing=set(root.children)
    trunk_scale=1.2 if height>5 else 1
    tube('Leaning mangrove trunk',[(x,.1,z),(x+.12,1.3,z),(x-.28,height*.7,z+.1),(x-.15,height,z)], [r*trunk_scale for r in [.23,.20,.17,.08]],wood)
    for i in range(7):
        a=i*2*pi/7+phase
        tube('Exposed mangrove root',[(x,1.4,z),(x+cos(a)*.5,.9,z+sin(a)*.5),(x+cos(a)*1.1,.25,z+sin(a)*1.1),(x+cos(a)*1.65,-.06,z+sin(a)*1.65)],[.14,.12,.065,.025],wood)
    for i in range(5):
        a=i*2*pi/5+phase;p=(x+cos(a)*.82,height+.15*cos(i),z+sin(a)*.8)
        tube('Canopy branch',[(x-.15,height*.65,z),p],[.11,.045],wood)
        foliage_crown(p,phase,i,1.3 if height>5 else 1.15)
        for j in range(5):
            b=j*2*pi/5+a;start=Vector(p)+Vector((cos(b)*.6,.05,sin(b)*.6))
            leaf('Canopy leaf accent',start,start+Vector((cos(b)*.75,.12,sin(b)*.75)),.22,leaves[(i+j)%3])
    if height>5:
        for i in range(3):
            a=i*2*pi/3+phase;p=(x+cos(a)*1.1,height*.70,z+sin(a)*.9)
            tube('Lower canopy fork',[(x-.1,height*.47,z),p],[.14,.05],wood)
            foliage_crown(p,phase+.4,i+1,1.25)
    for obj in set(root.children)-existing:obj['shore_cluster']=cluster

for args in [(3.8,12,6.5,-.65,.3),(-2.6,-13,7.5,.85,1.0),(4,-8,5.8,-.35,1.7)]:palm(*args)
for cluster,args in enumerate([(-4.1,7,3.3,.3),(3.5,-16,3.6,1.4),(-4.0,-6,3.0,.7),(4.3,17,3.5,2.1),(-2.8,11,8.1,1.1),(-3.2,-4,7.3,2.4),(1.3,-17,8.3,.8)]):mangrove(*args,cluster)

# Low plants join the tall canopy into composed groups. The near sand edge
# remains open; these silhouettes stay inside the decorative bank.
for index,(x,z) in enumerate([(-3.5,10),(2.4,15),(3.0,-13),(-2.8,-17),(-4.5,-3),(4.0,4),(2.8,-2)]):
    for j in range(7):
        angle=j*2*pi/7+index*.6;start=(x,.63,z)
        tip=(x+.8*cos(angle),.85+.4*sin(j*1.8)**2,z+.8*sin(angle))
        leaf('Broad ground plant',start,tip,.24,leaves[(index+j)%3])
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=coord((x,.9,z)))
    shrub=bpy.context.object;shrub.name='Designed shrub';shrub.parent=root;shrub.scale=(.55,.7,.40);shrub.data.materials.append(leaves[index%3])
    for j in range(3):
        angle=index*.61+j*2*pi/3
        painted_spray(Vector((x,.97,z))+Vector((-sin(angle)*.35,0,cos(angle)*.35)),angle,-.08,index+j,1.6,1.14)

def house(x,z,color):
    existing=set(root.children)
    for sx in [-1.25,1.25]:
        for sz in [-1.25,1.25]:box('House piling',(x+sx,.95,z+sz),(.17,2.25,.17),wood)
    box('Stilt deck',(x,1.85,z),(3.35,.13,3.25),wood)
    box('Porch extension',(x,1.85,z-1.8),(3.35,.13,.85),wood)
    for sx in [-1.45,1.45]:
        box('Porch post',(x+sx,2.2,z-2.15),(.10,.75,.10),trim)
    box('Porch rail',(x,2.5,z-2.15),(3.0,.075,.07),trim)
    for offset in [-1.12,-.55,.55,1.12]:box('Porch baluster',(x+offset,2.19,z-2.15),(.065,.54,.065),trim,.015)
    for i in range(12):box('Deck plank',(x,1.94,z-2.08+i*.30),(3.3,.045,.28),wood,.012)
    for i in range(6):box('Porch step',(x,1.66-i*.25,z-2.5-i*.22),(1.0,.10,.33),wood,.018)
    for sx in [-.48,.48]:tube('Stair stringer',[(x+sx,1.65,z-2.36),(x+sx,.42,z-3.72)],[.075,.075],wood)
    box('Painted house walls',(x,3.05,z),(2.85,2.3,2.6),color)
    for i in range(11):
        plank=box('Painted facade plank',(x,2.03+i*.20,z-1.33),(2.80,.188,.050),color,.012)
        plank['paint_tone']=.92+.10*(sin(i*2.3)*.5+.5)
    mesh('Gabled roof',[(x-1.7,4.15,z-1.6),(x+1.7,4.15,z-1.6),(x,5.1,z-1.6),(x-1.7,4.15,z+1.6),(x+1.7,4.15,z+1.6),(x,5.1,z+1.6)],[(0,3,5,2),(2,5,4,1),(0,2,1),(3,4,5)],roof)
    for sx in [-1.425,1.425]:box('Corner trim',(x+sx,3.05,z-1.325),(.08,2.30,.07),trim)
    offset=.68
    box('Window interior',(x+offset,3.18,z-1.40),(.67,.76,.03),dark,.006)
    for sx in [-.37,.37]:box('Window side frame',(x+offset+sx,3.18,z-1.425),(.09,.93,.08),trim,.014)
    for sy in [-.43,.43]:box('Window sill',(x+offset,3.18+sy,z-1.425),(.83,.10,.10),trim,.014)
    box('Window mullion',(x+offset,3.18,z-1.448),(.055,.80,.05),trim,.01)
    box('Window crossbar',(x+offset,3.18,z-1.452),(.72,.055,.05),trim,.01)
    box('Door interior',(x-.62,2.67,z-1.40),(.65,1.43,.04),wood,.018)
    for sx in [-.38,.38]:box('Door casing',(x-.62+sx,2.70,z-1.42),(.09,1.57,.10),trim,.012)
    box('Door lintel',(x-.62,3.48,z-1.42),(.85,.10,.10),trim,.015)
    box('Door handle',(x-.43,2.65,z-1.46),(.04,.14,.06),trim,.015)
    tube('Roof ridge',[(x,5.11,z-1.67),(x,5.11,z+1.67)],[.05,.05],roof)
    for i in range(7):
        seam=tube('Roof standing seam',[(x-1.70,4.17,z-1.5+i*.5),(x,5.12,z-1.5+i*.5),(x+1.70,4.17,z-1.5+i*.5)],[.025,.032,.025],roof)
        seam['paint_tone']=1.14
    tube('Front gable trim',[(x-1.71,4.16,z-1.62),(x,5.12,z-1.62),(x+1.71,4.16,z-1.62)],[.038,.038,.038],trim)
    center=coord((x,0,z))
    transform=Matrix.Translation(center) @ Matrix.Rotation(-pi/2,4,'Z') @ Matrix.Translation(-center)
    for obj in set(root.children)-existing:
        obj.matrix_world=transform @ obj.matrix_world;obj['shore_house']=True

house(1.2,1,turquoise);house(.4,-10,yellow)

# Paint broad colour gradients on editable components. This is vertex colour,
# shared by both bank instances, with no photographic textures or new materials.
bpy.context.view_layer.update()
for obj in list(root.children):
    if obj.type!='MESH':continue
    obj.data.update()
    colour=obj.data.color_attributes.new(name='Painted gradient',type='FLOAT_COLOR',domain='POINT')
    heights=[v.co.z for v in obj.data.vertices];low,high=min(heights),max(heights)
    mat=obj.data.materials[0];name=mat.name;base=mat.diffuse_color[:3]
    for i,v in enumerate(obj.data.vertices):
        h=(v.co.z-low)/max(.001,high-low)
        brush=.5+.5*sin(v.co.x*2.6+v.co.y*1.8)
        if 'foliage' in name:
            value=.62+.32*h+.04*brush;rgb=(value*.96,value,min(1.,value*.82))
        elif 'wood' in name:
            value=.72+.22*h+.03*brush;rgb=(value,value*.94,value*.88)
        else:
            value=.82+.15*h+.025*brush;rgb=(value,value,value)
        tone=obj.get('paint_tone',1)
        colour.data[i].color=(*(min(1,rgb[channel]*base[channel]*tone) for channel in range(3)),1)
for mat in {obj.data.materials[0] for obj in root.children if obj.type=='MESH'}:
    colour=mat.node_tree.nodes.new('ShaderNodeVertexColor');colour.layer_name='Painted gradient'
    shader=mat.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(1,1,1,1)
    if mat==painted_leaves:
        multiply=mat.node_tree.nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1
        mat.node_tree.links.new(leaf_texture.outputs['Color'],multiply.inputs[1]);mat.node_tree.links.new(colour.outputs['Color'],multiply.inputs[2]);mat.node_tree.links.new(multiply.outputs[0],shader.inputs['Base Color'])
    else:mat.node_tree.links.new(colour.outputs['Color'],shader.inputs['Base Color'])
    mat.diffuse_color=(1,1,1,1)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'shore-study.blend'))

def export_bank(filename,source):
    # Export copies so all authored parts/modifiers remain intact for the other
    # variant. Material batches are shared by all placements in the browser.
    copies=[];batches={}
    for original in source:
        obj=original.copy();obj.data=original.data.copy();bpy.context.collection.objects.link(obj)
        copies.append(obj);batches.setdefault(obj.data.materials[0].name,[]).append(obj)
    for name,objects in batches.items():
        for obj in objects:
            bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
            for modifier in list(obj.modifiers):bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        bpy.context.object.name=name
    # Joined copies remain direct children of the shared root; select those
    # explicitly instead of recursively exporting the editable source as well.
    bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
    copied_names={obj.name for obj in root.children if obj not in source_parts}
    for obj in root.children:
        if obj.name in copied_names:obj.select_set(True)
    result=bpy.ops.export_scene.gltf(filepath=str(ROOT/'dist'/'assets'/(filename+'.glb')),export_format='GLB',use_selection=True,export_animations=False,export_vertex_color='NAME',export_vertex_color_name='Painted gradient')
    if result!={'FINISHED'}:raise RuntimeError(filename+' export failed')
    for obj in list(root.children):
        if obj not in source_parts:bpy.data.objects.remove(obj,do_unlink=True)

source_parts=set(root.children)
export_bank('shore-study',list(source_parts))
export_bank('shore-mangrove',[obj for obj in source_parts if not obj.get('shore_house') and obj.get('shore_cluster') not in (1,3)])
print('COMPUNUBE_SHORES_READY',[(name,(ROOT/'dist'/'assets'/(name+'.glb')).stat().st_size) for name in ['shore-study','shore-mangrove']])
