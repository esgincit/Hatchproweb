# Builds the realistic bird models for the live 3D farm (roadmap Phase 2) and exports public/models/{hen,chick}.glb.
# Run headless:  "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P apps/web/scripts/blender/birds.py
#
# Each bird = one smooth mesh (ellipsoid union → voxel remesh → smooth → decimate) + low-poly beak/comb/eyes/legs, one UV set, and
# baked textures: base colour (procedural feathers × baked AO) and a tangent-space normal map (feather relief).
# A custom vertex attribute `_anim` = (head, left leg, right leg) weights lets the web shader peck and step
# thousands of instances on the GPU without skeletons.
import math
import os
import bpy
import numpy as np

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'models'))
TEX = 1024
os.makedirs(OUT, exist_ok=True)

# Blender is Z-up with the bird facing -Y; glTF export turns that into Y-up facing +Z (what Scene.tsx expects).


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 32


def blob_mesh(name, blobs, voxel, faces):
    """blobs: (x, y, z, (rx, ry, rz), tilt_x) ellipsoids → voxel union → volume-preserving smooth (fillets) → decimate."""
    parts = []
    for i, (x, y, z, r, tilt) in enumerate(blobs):
        parts.append(add('uv_sphere', f'{name}{i}', (x, y, z), r, rot=(tilt, 0, 0), segments=24, ring_count=16))
    ob = join(parts, name)
    for kind, opts in (('REMESH', dict(mode='VOXEL', voxel_size=voxel)),
                       ('LAPLACIANSMOOTH', dict(iterations=12, lambda_factor=0.6, use_volume_preserve=True)),
                       ('DECIMATE', {})):
        md = ob.modifiers.new(kind.lower(), kind)
        for k, v in opts.items():
            setattr(md, k, v)
        if kind == 'DECIMATE':
            bpy.context.view_layer.update()
            md.ratio = min(1.0, faces / max(1, len(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.polygons)))
    bpy.context.view_layer.objects.active = ob
    for md in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.ops.object.shade_smooth()
    ob.select_set(False)
    return ob


def add(prim, name, loc, scale=(1, 1, 1), rot=(0, 0, 0), **kw):
    getattr(bpy.ops.mesh, 'primitive_' + prim + '_add')(location=loc, rotation=rot, **kw)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(scale=True, rotation=True, location=False)
    bpy.ops.object.shade_smooth()
    ob.select_set(False)
    return ob


def leg(name, x, hip_z, thick, mat, toe=0.05):
    """Shank + 3 forward toes + 1 back toe."""
    parts = [add('cylinder', name + '_shank', (x, 0.0, hip_z / 2), (thick, thick, hip_z / 2), vertices=8)]
    for i, a in enumerate((-0.45, 0.0, 0.45)):
        dx, dy = math.sin(a) * toe / 2, -math.cos(a) * toe / 2
        parts.append(add('cylinder', f'{name}_toe{i}', (x + dx, dy, thick * 0.7), (thick * 0.6, thick * 0.6, toe / 2),
                         rot=(math.pi / 2, 0, -a), vertices=6))
    parts.append(add('cylinder', name + '_toeb', (x, toe * 0.3, thick * 0.7), (thick * 0.5, thick * 0.5, toe * 0.3),
                     rot=(math.pi / 2, 0, 0), vertices=6))
    for p in parts:
        p.data.materials.append(mat)
    return parts


# ---------- materials (procedural; baked to textures before export) ----------

def node_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL').inputs['Surface'])
    return m, nt, bsdf


def flat_mat(name, rgb, rough=0.6):
    m, nt, bsdf = node_mat(name)
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    return m


def feather_mat(name, base, tip, scale, fluffy=False):
    """Overlapping feather 'scales': Voronoi cells stretched along the body, per-feather tint, vane streaks for relief."""
    m, nt, bsdf = node_mat(name)
    L = nt.links.new
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale, scale * 0.55, scale)  # elongated toward the tail
    L(tc.outputs['Object'], mp.inputs['Vector'])
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.feature = 'F1'
    L(mp.outputs['Vector'], vor.inputs['Vector'])
    edge = nt.nodes.new('ShaderNodeTexVoronoi')
    edge.feature = 'DISTANCE_TO_EDGE'
    L(mp.outputs['Vector'], edge.inputs['Vector'])
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale * (6 if fluffy else 3)
    noise.inputs['Detail'].default_value = 8
    L(tc.outputs['Object'], noise.inputs['Vector'])
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.inputs['Scale'].default_value = scale * 4
    wave.inputs['Distortion'].default_value = 4
    L(mp.outputs['Vector'], wave.inputs['Vector'])
    # colour: base↔tip by distance from feather centre
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*base, 1)
    ramp.color_ramp.elements[1].color = (*tip, 1)
    L(vor.outputs['Distance'], ramp.inputs['Fac'])
    L(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    # relief: feather edges + vane streaks (+ fluff for chicks)
    add_h = nt.nodes.new('ShaderNodeMath')
    add_h.operation = 'MULTIPLY_ADD'
    L(wave.outputs['Fac'], add_h.inputs[0])
    add_h.inputs[1].default_value = 0.15
    L(edge.outputs['Distance'], add_h.inputs[2])
    h = add_h.outputs['Value']
    if fluffy:
        mix = nt.nodes.new('ShaderNodeMath')
        mix.operation = 'MULTIPLY_ADD'
        L(noise.outputs['Fac'], mix.inputs[0])
        mix.inputs[1].default_value = 0.8
        L(h, mix.inputs[2])
        h = mix.outputs['Value']
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.55
    bump.inputs['Distance'].default_value = 0.004
    L(h, bump.inputs['Height'])
    L(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


# ---------- bake + export ----------

def bake_and_export(ob, out_name):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
    bpy.ops.object.mode_set(mode='OBJECT')

    imgs = {k: bpy.data.images.new(f'{out_name}_{k}', TEX, TEX) for k in ('col', 'ao', 'nrm')}
    imgs['nrm'].colorspace_settings.name = 'Non-Color'
    imgs['ao'].colorspace_settings.name = 'Non-Color'

    def target(img):
        for m in ob.data.materials:
            nt = m.node_tree
            node = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.label == 'bake'), None)
            if node is None:
                node = nt.nodes.new('ShaderNodeTexImage')
                node.label = 'bake'
            node.image = img
            nt.nodes.active = node

    bpy.context.scene.render.bake.margin = 6
    target(imgs['col'])
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True)
    target(imgs['ao'])
    bpy.ops.object.bake(type='AO', use_clear=True)
    target(imgs['nrm'])
    bpy.ops.object.bake(type='NORMAL', use_clear=True)

    # base colour × soft AO (creases under wings/neck read as real shadowing even under flat web lighting)
    col = np.array(imgs['col'].pixels[:]).reshape(-1, 4)
    ao = np.array(imgs['ao'].pixels[:]).reshape(-1, 4)[:, :1]
    col[:, :3] *= 0.72 + 0.28 * ao
    imgs['col'].pixels[:] = col.ravel()
    for k in ('col', 'nrm'):
        imgs[k].pack()

    # one baked material replaces the procedural ones
    m, nt, bsdf = node_mat(out_name + '_baked')
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = imgs['col']
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = imgs['nrm']
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.8
    ob.data.materials.clear()
    ob.data.materials.append(m)

    path = os.path.join(OUT, out_name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_attributes=True, export_image_format='JPEG', export_jpeg_quality=85,
        export_animations=False,
    )
    print(f'EXPORTED {path} tris={sum(len(p.vertices) - 2 for p in ob.data.polygons)} bytes={os.path.getsize(path)}')


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob


def anim_weights(ob, neck, hip_z, leg_x):
    """_anim = (head, left leg, right leg). Head ramps in up the neck; legs = everything below the hip, split by side."""
    ny, nz, span = neck
    attr = ob.data.attributes.new('_anim', 'FLOAT_VECTOR', 'POINT')
    for v in ob.data.vertices:
        x, y, z = v.co
        head = 0.0
        if y < ny + 0.03 and z > nz - 0.02:
            head = min(1.0, max(0.0, ((z - (nz - 0.02)) + (ny + 0.03 - y)) / span))
        legl = 1.0 if z < hip_z and x > leg_x * 0.3 else 0.0
        legr = 1.0 if z < hip_z and x < -leg_x * 0.3 else 0.0
        attr.data[v.index].vector = (head, legl, legr)


# ---------- the birds ----------

def build_hen():
    """Adult white broiler/layer hen (~0.42 m long). Neck pivot ≈ (0, -0.10, 0.28); hip height 0.085."""
    reset()
    feathers = feather_mat('feathers', (0.93, 0.92, 0.88), (0.98, 0.97, 0.94), 38)
    comb_m = flat_mat('comb', (0.62, 0.05, 0.04), 0.45)
    beak_m = flat_mat('beak', (0.85, 0.62, 0.22), 0.4)
    leg_m = flat_mat('leg', (0.86, 0.66, 0.25), 0.5)
    eye_m = flat_mat('eye', (0.03, 0.02, 0.01), 0.1)

    body = blob_mesh('body', [
        (0, 0.01, 0.19, (0.12, 0.17, 0.115), 0),        # torso (broiler: deep, wide)
        (0, -0.08, 0.185, (0.105, 0.09, 0.10), 0),      # breast
        (0, 0.09, 0.235, (0.09, 0.10, 0.08), 0),        # saddle rising to the tail
        (0, 0.15, 0.285, (0.045, 0.06, 0.075), -0.5),   # tail feathers
        (0.1, 0.01, 0.21, (0.035, 0.13, 0.07), 0.15),   # wings folded on the sides
        (-0.1, 0.01, 0.21, (0.035, 0.13, 0.07), 0.15),
        (0, -0.105, 0.285, (0.055, 0.06, 0.07), 0.3),   # neck hackles
        (0, -0.128, 0.33, (0.046, 0.05, 0.06), 0.2),
        (0, -0.145, 0.365, (0.044, 0.056, 0.045), 0),   # head
        (0.05, 0.0, 0.115, (0.04, 0.05, 0.05), 0),      # thighs
        (-0.05, 0.0, 0.115, (0.04, 0.05, 0.05), 0),
    ], voxel=0.005, faces=800)
    body.data.materials.append(feathers)

    parts = [body]
    beak = add('cone', 'beak', (0, -0.205, 0.365), (0.016, 0.016, 0.026), rot=(math.pi / 2, 0, 0), vertices=10)
    beak.data.materials.append(beak_m)
    parts.append(beak)
    for i, (dy, dz, r) in enumerate([(-0.17, 0.425, 0.013), (-0.155, 0.437, 0.016), (-0.137, 0.44, 0.016), (-0.12, 0.43, 0.014), (-0.105, 0.415, 0.011)]):
        c = add('uv_sphere', f'comb{i}', (0, dy, dz - 0.01), (0.35 * r, 1.3 * r, 1.25 * r), segments=8, ring_count=5)
        c.data.materials.append(comb_m)
        parts.append(c)
    for s in (-1, 1):
        w = add('uv_sphere', f'wattle{s}', (s * 0.008, -0.185, 0.33), (0.008, 0.01, 0.017), segments=8, ring_count=6)
        w.data.materials.append(comb_m)
        e = add('uv_sphere', f'eye{s}', (s * 0.034, -0.168, 0.375), (0.0065, 0.0065, 0.0065), segments=6, ring_count=4)
        e.data.materials.append(eye_m)
        parts += [w, e]
        parts += leg(f'leg{s}', s * 0.048, 0.09, 0.013, leg_m)
    hen = join(parts, 'hen')
    anim_weights(hen, neck=(-0.10, 0.28, 0.12), hip_z=0.085, leg_x=0.048)
    bake_and_export(hen, 'hen')


def build_chick():
    """Day-old chick (~0.1 m long), yellow down. Neck pivot ≈ (0, -0.02, 0.085); hip height 0.03."""
    reset()
    down = feather_mat('down', (0.92, 0.66, 0.12), (1.0, 0.84, 0.3), 90, fluffy=True)
    beak_m = flat_mat('beak', (0.88, 0.58, 0.2), 0.4)
    leg_m = flat_mat('leg', (0.93, 0.62, 0.36), 0.5)
    eye_m = flat_mat('eye', (0.02, 0.02, 0.02), 0.05)
    body = blob_mesh('body', [
        (0, 0.005, 0.055, (0.042, 0.05, 0.04), 0),
        (0, -0.018, 0.078, (0.028, 0.03, 0.03), 0),     # neck fluff
        (0, -0.03, 0.098, (0.03, 0.032, 0.03), 0),      # head
        (0.036, 0.005, 0.06, (0.012, 0.03, 0.022), 0.2),
        (-0.036, 0.005, 0.06, (0.012, 0.03, 0.022), 0.2),
        (0, 0.045, 0.068, (0.02, 0.02, 0.02), 0),       # tail fluff
    ], voxel=0.002, faces=600)
    body.data.materials.append(down)
    parts = [body]
    beak = add('cone', 'beak', (0, -0.064, 0.096), (0.007, 0.007, 0.009), rot=(math.pi / 2, 0, 0), vertices=8)
    beak.data.materials.append(beak_m)
    parts.append(beak)
    for s in (-1, 1):
        e = add('uv_sphere', f'eye{s}', (s * 0.022, -0.048, 0.103), (0.0042, 0.0042, 0.0042), segments=8, ring_count=6)
        e.data.materials.append(eye_m)
        parts.append(e)
        parts += leg(f'leg{s}', s * 0.015, 0.03, 0.005, leg_m, toe=0.02)
    chick = join(parts, 'chick')
    anim_weights(chick, neck=(-0.02, 0.085, 0.04), hip_z=0.025, leg_x=0.015)
    bake_and_export(chick, 'chick')


build_hen()
build_chick()
