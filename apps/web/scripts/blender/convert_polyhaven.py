# Converts CC0 Poly Haven props into game-ready farm props -> public/3d/models/<name>.glb (+ manifest.json entry).
# Downloads the 1k glTF of each asset once into apps/web/scripts/.cache/polyhaven/<id>/, then: join, metres,
# front -> glTF +Z, origin at the base centre, collapse-decimate to the triangle budget, textures down to 512 px JPEG.
# Run headless (Blender 5.2):
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P apps/web/scripts/blender/convert_polyhaven.py -- all
#   ... -- chair crate
import json
import math
import os
import sys
import urllib.request

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from farm_assets import OUT, SHARP, record, reset  # noqa: E402

CACHE = os.path.abspath(os.path.join(HERE, '..', '.cache', 'polyhaven'))
API = 'https://api.polyhaven.com/files/'
TEX = 512
# name: (Poly Haven id, triangle budget, turn about the up axis in degrees so the front faces glTF +Z)
PROPS = {
    'feed_bag': ('cement_bag', 300, 0),
    'gas_cylinder': ('propane_tank', 1000, 0),
    'crate': ('plastic_crate_01', 1000, 0),
    'barrel': ('barrel_03', 1000, 0),
    'chair': ('plastic_monobloc_chair_01', 600, 90),
    'panel_box': ('power_box_01', 1000, 0),
}
CLOSED = ('power_box_01_door',)  # parts posed open in the source scene: back to their rest (closed) rotation


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'hatchpro-farm-assets/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def fetch(asset):
    """Download (once) the 1k glTF + its include files; returns the local .gltf path."""
    d = os.path.join(CACHE, asset)
    meta = os.path.join(d, 'files.json')
    if not os.path.exists(meta):
        os.makedirs(d, exist_ok=True)
        with open(meta, 'wb') as fh:
            fh.write(get(API + asset))
    with open(meta) as fh:
        g = json.load(fh)['gltf']['1k']['gltf']
    files = {os.path.basename(g['url']): g['url'], **{k: v['url'] for k, v in g['include'].items()}}
    for rel, url in files.items():
        dst = os.path.normpath(os.path.join(d, rel))
        if not dst.startswith(d + os.sep):  # untrusted listing: stay inside the cache dir
            raise ValueError(f'bad include path {rel!r}')
        if not os.path.exists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, 'wb') as fh:
                fh.write(get(url))
    return os.path.join(d, os.path.basename(g['url']))


def feed_sack(img):
    """Repaint the cement-bag print as a plain woven-PP feed sack: off-white weave, green band, print blocks
    (the scan's normal + ARM maps keep the folds)."""
    w, h = img.size
    v, u = np.mgrid[0:h, 0:w].astype(np.float32)
    weave = 0.035 * np.sign(np.sin(u * math.pi / 2.5)) * np.sign(np.sin(v * math.pi / 2.5))
    rng = np.random.default_rng(4)
    col = np.empty((h, w, 4), np.float32)
    col[..., :3] = np.array([0.86, 0.85, 0.8]) + weave[..., None] + rng.normal(0, 0.012, (h, w, 1))
    col[..., 3] = 1
    u, v = u / w, v / h
    panels = (u > 0.05) & (u < 0.61) & (((v > 0.45) & (v < 0.87)) | ((v > 0.02) & (v < 0.44)))
    col[panels & (u > 0.37) & (u < 0.45), :3] = (0.14, 0.42, 0.2)
    for u0, u1, v0, v1 in ((0.15, 0.22, 0.52, 0.8), (0.24, 0.27, 0.56, 0.76), (0.5, 0.53, 0.55, 0.78),
                           (0.15, 0.22, 0.09, 0.37), (0.24, 0.27, 0.13, 0.33), (0.5, 0.53, 0.12, 0.35)):
        col[(u > u0) & (u < u1) & (v > v0) & (v < v1), :3] = (0.1, 0.3, 0.15)
    img.pixels.foreach_set(np.clip(col, 0, 1).ravel())


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def convert(name, asset, budget, turn):
    reset()
    bpy.ops.import_scene.gltf(filepath=fetch(asset))
    for o in bpy.context.scene.objects:
        if o.name.split('.')[0] in CLOSED:
            o.rotation_mode = 'QUATERNION'
            o.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:  # bake the node transforms (glTF import parents everything under empties)
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    me = ob.data
    me.transform(Matrix.Rotation(math.radians(turn), 4, 'Z'))
    lo = Vector([min(v.co[i] for v in me.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in me.vertices) for i in range(3)])
    me.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
    src = tri_count(ob)
    for _ in range(4):  # collapse decimation (UV-aware) until within budget
        t = tri_count(ob)
        if t <= budget:
            break
        md = ob.modifiers.new('dec', 'DECIMATE')
        md.ratio = budget / t * 0.97
        md.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=md.name)
    if me.has_custom_normals:  # decimation invalidates the scanned split normals: re-derive by angle
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) != 2 or e.link_faces[0].normal.angle(e.link_faces[1].normal, 0) <= SHARP
    bm.to_mesh(me)
    bm.free()
    if name == 'feed_bag':
        for mt in me.materials:
            bsdf = next(n for n in mt.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            feed_sack(bsdf.inputs['Base Color'].links[0].from_node.image)
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > TEX:
            img.scale(TEX, max(1, round(TEX * h / w)))
    mats = [s.material for s in ob.material_slots if s.material]
    for i, mt in enumerate(mats):
        mt.name = name if len(mats) == 1 else f'{name}_{i}'
        mt.use_backface_culling = True
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_image_format='JPEG', export_image_quality=85, export_animations=False,
                              export_cameras=False, export_lights=False)
    record(name, path, [ob], tri_count(ob), {}, None, f'Poly Haven "{asset}" (CC0), decimated from {src} tris')


def main(names):
    if names == ['all']:
        names = list(PROPS)
    for n in names:
        if n not in PROPS:
            raise SystemExit(f'unknown prop {n!r}; choose from: all {" ".join(PROPS)}')
    for n in names:
        convert(n, *PROPS[n])


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['all'])
