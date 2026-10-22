# Preview renders of the exported farm models: each GLB re-imported (so what you see is what the web gets), M_* materials
# swapped for procedural stand-ins driven by the model's metre-scale UVs, a 1.7 m figure for scale, 3/4 front-right view.
# Writes <out_dir>/<name>.png and <out_dir>/contact_sheet.png.
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P apps/web/scripts/blender/preview_models.py -- <out_dir> [name ...]
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from farm_assets import MANIFEST, MATS, OUT, lin  # noqa: E402

W, H = 960, 720


CACHE = {}


def standin(key, cache=CACHE):
    """Procedural look-alike of what the web app will put on M_* (UVs are metres)."""
    if key in cache:
        return cache[key]
    hexc, rough, metal = MATS[key]
    m = bpy.data.materials.new('SI_' + key)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    L = nt.links.new
    uv = nt.nodes.new('ShaderNodeTexCoord').outputs['UV']
    base = (*lin(hexc), 1)
    bsdf.inputs['Base Color'].default_value = base
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal

    def noise_mix(c1, c2, scale, detail=6):
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = scale
        nz.inputs['Detail'].default_value = detail
        L(uv, nz.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (*lin(c1), 1)
        ramp.color_ramp.elements[1].color = (*lin(c2), 1)
        L(nz.outputs['Fac'], ramp.inputs['Fac'])
        L(ramp.outputs['Color'], bsdf.inputs['Base Color'])
        return nz

    def bump(src, strength, dist=0.01):
        b = nt.nodes.new('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = dist
        L(src, b.inputs['Height'])
        L(b.outputs['Normal'], bsdf.inputs['Normal'])

    if key == 'M_brick':
        br = nt.nodes.new('ShaderNodeTexBrick')
        L(uv, br.inputs['Vector'])
        br.inputs['Color1'].default_value = (*lin('#8f3f29'), 1)
        br.inputs['Color2'].default_value = (*lin('#a9573a'), 1)
        br.inputs['Mortar'].default_value = (*lin('#bcae98'), 1)
        br.inputs['Scale'].default_value = 1.0
        br.inputs['Mortar Size'].default_value = 0.011
        br.inputs['Brick Width'].default_value = 0.24
        br.inputs['Row Height'].default_value = 0.085
        L(br.outputs['Color'], bsdf.inputs['Base Color'])
        inv = nt.nodes.new('ShaderNodeMath')
        inv.operation = 'SUBTRACT'
        inv.inputs[0].default_value = 1.0
        L(br.outputs['Fac'], inv.inputs[1])
        bump(inv.outputs[0], 0.5)
    elif key in ('M_plaster', 'M_concrete'):
        c2 = '#d8ccb0' if key == 'M_plaster' else '#8e8b84'
        nz = noise_mix(hexc, c2, 2.5)
        bump(nz.outputs['Fac'], 0.15)
    elif key == 'M_corrugated':
        wv = nt.nodes.new('ShaderNodeTexWave')
        wv.wave_type = 'BANDS'
        wv.bands_direction = 'X'
        wv.inputs['Scale'].default_value = 2 * math.pi / (20 * 0.076)  # 76 mm pitch along U
        L(uv, wv.inputs['Vector'])
        bump(wv.outputs['Fac'], 0.9, 0.02)
        noise_mix('#9fa4a7', '#c3c7c9', 1.5)
    elif key == 'M_galv':
        nz = noise_mix('#a9aeb1', '#cfd2d3', 4.0)
        bump(nz.outputs['Fac'], 0.05)
    elif key == 'M_bark':
        nz = noise_mix('#3a2e24', '#6a5848', 6.0, 8)
        bump(nz.outputs['Fac'], 0.8, 0.02)
    elif key == 'M_wood':
        wv = nt.nodes.new('ShaderNodeTexWave')
        wv.inputs['Scale'].default_value = 3
        wv.inputs['Distortion'].default_value = 6
        L(uv, wv.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (*lin('#6e4e30'), 1)
        ramp.color_ramp.elements[1].color = (*lin('#9a7550'), 1)
        L(wv.outputs['Fac'], ramp.inputs['Fac'])
        L(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    elif key == 'M_glass':
        bsdf.inputs['Base Color'].default_value = (*lin('#22323a'), 1)
        bsdf.inputs['Roughness'].default_value = 0.03
        bsdf.inputs['Specular IOR Level'].default_value = 0.8
    elif key == 'M_emissive_light':
        bsdf.inputs['Emission Color'].default_value = base
        bsdf.inputs['Emission Strength'].default_value = 4.0
    elif key in ('M_rubber', 'M_plastic_black', 'M_tarp_blue', 'M_rust') or key.startswith('M_paint') or key == 'M_steel_dark':
        nz = noise_mix(hexc, '#%02x%02x%02x' % tuple(min(255, int(int(hexc[i:i + 2], 16) * 1.12)) for i in (1, 3, 5)), 3.0)
        nz.inputs['Detail'].default_value = 3
    cache[key] = m
    return m


def figure():
    """1.7 m scale figure (simple mannequin)."""
    mat = bpy.data.materials.new('figure')
    mat.use_nodes = True
    next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.25, 0.32, 0.45, 1)
    parts = []

    def add(kind, loc, scale, **kw):
        getattr(bpy.ops.mesh, 'primitive_' + kind + '_add')(location=loc, **kw)
        o = bpy.context.active_object
        o.scale = scale
        o.data.materials.append(mat)
        bpy.ops.object.shade_smooth()
        parts.append(o)

    for s in (-1, 1):
        add('cylinder', (s * 0.1, 0, 0.42), (0.075, 0.085, 0.42), vertices=12)
        add('cylinder', (s * 0.24, 0, 1.1), (0.045, 0.05, 0.33), vertices=10)
    add('cylinder', (0, 0, 1.13), (0.19, 0.12, 0.31), vertices=16)
    add('uv_sphere', (0, 0, 1.585), (0.1, 0.11, 0.115), segments=16, ring_count=10)
    add('cylinder', (0, 0, 1.46), (0.05, 0.05, 0.05), vertices=8)
    return parts


def setup_scene():
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 48
    s.cycles.use_denoising = True
    s.cycles.transparent_max_bounces = 48
    s.render.resolution_x, s.render.resolution_y = W, H
    s.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w')
    s.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.52, 0.66, 0.86, 1)
    bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.2
    sun.data.angle = math.radians(2.5)
    sun.rotation_euler = Vector((0.45, 0.65, -0.62)).to_track_quat('-Z', 'Y').to_euler()
    s.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=600)
    g = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    nt = gm.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 0.6
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*lin('#7d6a52'), 1)
    ramp.color_ramp.elements[1].color = (*lin('#9a8a70'), 1)
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95
    g.data.materials.append(gm)
    s.render.use_stamp = True
    for p in dir(s.render):
        if p.startswith('use_stamp_'):
            setattr(s.render, p, p == 'use_stamp_note')
    s.render.stamp_font_size = 22
    s.render.stamp_background = (0, 0, 0, 0.6)


def frame_camera(lo, hi, az=35, el=18):
    s = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    s.collection.objects.link(cam)
    s.camera = cam
    cam.data.lens = 50
    a, e = math.radians(az), math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    c = (lo + hi) / 2
    fwd = -d
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd)
    th, tv = 18 / 50, 18 / 50 * H / W
    D = 0.0
    for x in (lo.x, hi.x):
        for y in (lo.y, hi.y):
            for z in (lo.z, hi.z):
                q = Vector((x, y, z)) - c
                D = max(D, q.dot(d) + abs(q.dot(right)) / th, q.dot(d) + abs(q.dot(up)) / tv)
    cam.location = c + d * D * 1.06
    cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_end = 2000


def render(name, out_dir, info):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    CACHE.clear()
    setup_scene()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, name + '.glb'))
    objs = [o for o in bpy.data.objects if o not in before]
    for o in objs:
        for slot in o.material_slots:
            if slot.material and slot.material.name.split('.')[0] in MATS:
                slot.material = standin(slot.material.name.split('.')[0])
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == 'MESH' for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0.0))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    fx, fy = lo.x - 0.55, lo.y - 0.25  # front-left: never hides the model from the front-right camera
    for p in figure():
        p.location.x += fx
        p.location.y += fy
    lo2 = Vector((min(lo.x, fx - 0.3), min(lo.y, fy - 0.2), 0))
    hi2 = Vector((max(hi.x, fx + 0.3), max(hi.y, fy + 0.2), max(hi.z, 1.7)))
    frame_camera(lo2, hi2)
    s = bpy.context.scene
    s.render.stamp_note_text = f"{name}   {info.get('tris', '?')} tris   {info.get('bytes', 0) // 1024} KB"
    s.render.filepath = os.path.join(out_dir, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', s.render.filepath)


def contact_sheet(out_dir, names, cols=5, tw=480, th=360):
    rows = (len(names) + cols - 1) // cols
    sheet = np.ones((rows * th, cols * tw, 4), np.float32)
    for i, n in enumerate(names):
        p = os.path.join(out_dir, n + '.png')
        if not os.path.exists(p):
            continue
        img = bpy.data.images.load(p)
        img.scale(tw, th)
        px = np.array(img.pixels[:], np.float32).reshape(th, tw, 4)
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * th
        sheet[y0:y0 + th, c * tw:(c + 1) * tw] = px
    out = bpy.data.images.new('sheet', cols * tw, rows * th, alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.join(out_dir, 'contact_sheet.png')
    out.file_format = 'PNG'
    out.save()
    print('SHEET', out.filepath_raw)


def main():
    args = sys.argv[sys.argv.index('--') + 1:]
    out_dir, names = args[0], args[1:]
    os.makedirs(out_dir, exist_ok=True)
    with open(MANIFEST) as fh:
        man = json.load(fh)
    for n in names or list(man):
        render(n, out_dir, man.get(n, {}))
    contact_sheet(out_dir, list(man))


main()
