# Builds the realistic site models for the 3D farm (realistic-3d plan, phase 2) -> public/3d/models/<name>.glb
# and updates public/3d/models/manifest.json.
# Run headless (Blender 5.2):
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P apps/web/scripts/blender/farm_assets.py -- all
#   ... -P apps/web/scripts/blender/farm_assets.py -- feed_silo water_tank
#
# Conventions the web scene depends on:
# - Built Z-up with the front (door / entrance / nose / ladder) facing -Y; the glTF exporter turns that into Y-up with
#   the front facing +Z. Metres. Origin = ground level at the centre of the footprint.
# - Shared surface materials are named M_* (MATS below); the app replaces them by name with tiled PBR textures, so
#   their UVs are world scale (1 UV unit = 1 m): box projection per part, unrolled (arc length) on round parts,
#   true-scale planar on roof slopes (U along the ridge, V up the slope). Other materials embed their own texture.
# - Every part is generated in python (verts/faces), bevelled + UV'd in its own bmesh, then merged into one mesh per
#   node (one draw call per material). Weighted normals make the small bevels read as rounded edges.
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'public', '3d', 'models'))
MANIFEST = os.path.join(OUT, 'manifest.json')
SHARP = math.radians(46)  # auto-smooth threshold: 8-sided tubes + 45 deg chamfers smooth, box corners sharp

# name: (sRGB hex fallback colour, roughness, metallic)
MATS = {
    'M_brick': ('#9c4f36', 0.9, 0.0),
    'M_plaster': ('#e6dcc3', 0.88, 0.0),
    'M_concrete': ('#a19e96', 0.9, 0.0),
    'M_corrugated': ('#a9aeb1', 0.42, 0.85),
    'M_galv': ('#b7bbbe', 0.38, 0.9),
    'M_steel_dark': ('#30353a', 0.55, 0.2),
    'M_rust': ('#7b4126', 0.9, 0.3),
    'M_wood': ('#8a6642', 0.8, 0.0),
    'M_bark': ('#4b3c2e', 0.95, 0.0),
    'M_rubber': ('#1b1b1b', 0.88, 0.0),
    'M_glass': ('#1d2c33', 0.06, 0.0),
    'M_chrome': ('#dcdcdc', 0.12, 1.0),
    'M_plastic_black': ('#151515', 0.42, 0.0),
    'M_paint_white': ('#ecebe6', 0.4, 0.0),
    'M_paint_yellow': ('#e3ac14', 0.4, 0.0),
    'M_paint_blue': ('#1f4f9c', 0.38, 0.0),
    'M_paint_red': ('#b01a1e', 0.35, 0.0),
    'M_paint_green': ('#2e6a3a', 0.45, 0.0),
    'M_paint_orange': ('#de651c', 0.4, 0.0),
    'M_paint_grey': ('#7f8487', 0.5, 0.0),
    'M_tarp_blue': ('#1d5ea6', 0.8, 0.0),
    'M_emissive_light': ('#fff2d4', 0.5, 0.0),
    'M_skin': ('#8a5a3c', 0.6, 0.0),  # person only
    'M_cloth_shirt': ('#d9d3c3', 0.85, 0.0),
    'M_cloth_lower': ('#3d3b39', 0.85, 0.0),
}


def lin(hexc):
    c = [int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def node_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL').inputs['Surface'])
    m.use_backface_culling = True  # glTF doubleSided = False (closed meshes)
    return m, nt, bsdf


def get_mat(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    hexc, rough, metal = MATS[name]
    m, nt, bsdf = node_mat(name)
    bsdf.inputs['Base Color'].default_value = (*lin(hexc), 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if name == 'M_emissive_light':
        bsdf.inputs['Emission Color'].default_value = (*lin(hexc), 1)
        bsdf.inputs['Emission Strength'].default_value = 3.0
    return m


def image(name, rgba, alpha=False):
    """numpy (h, w, 4) float sRGB 0..1, row 0 = bottom -> packed Blender image (exported as JPEG, or PNG if alpha)."""
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=alpha)
    img.pixels.foreach_set(np.ascontiguousarray(rgba, dtype=np.float32).ravel())
    img.pack()
    return img


def tex_mat(name, img, rough=0.8, metal=0.0, alpha=False):
    m, nt, bsdf = node_mat(name)
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    t.interpolation = 'Linear'
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if alpha:  # Math:Round on alpha -> glTF alphaMode MASK (cutoff 0.5)
        r = nt.nodes.new('ShaderNodeMath')
        r.operation = 'ROUND'
        nt.links.new(t.outputs['Alpha'], r.inputs[0])
        nt.links.new(r.outputs[0], bsdf.inputs['Alpha'])
        m.use_backface_culling = False
    return m


# ---------- geometry: pure python (verts, faces[, uvs]) in local coordinates ----------

def rect(w, d, z=0.0, cx=0.0, cy=0.0):
    return [(cx - w / 2, cy - d / 2, z), (cx + w / 2, cy - d / 2, z), (cx + w / 2, cy + d / 2, z), (cx - w / 2, cy + d / 2, z)]


def loft(rings, closed=True, cap0=False, cap1=False):
    """Quads between consecutive rings (CCW seen from +Z when the rings go up -> outward normals)."""
    n = len(rings[0])
    verts = [tuple(p) for r in rings for p in r]
    faces = []
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        for j in range(n if closed else n - 1):
            k = (j + 1) % n
            faces.append((a + j, a + k, b + k, b + j))
    if cap0:
        faces.append(tuple(reversed(range(n))))
    if cap1:
        faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    return verts, faces


def box(sx, sy, sz, z0=None):
    """Box centred on the origin; with z0 it spans z0..z0+sz."""
    zb = -sz / 2 if z0 is None else z0
    return loft([rect(sx, sy, zb), rect(sx, sy, zb + sz)], cap0=True, cap1=True)


def prism(poly, h, cap0=True, cap1=True):
    """2D polygon (CCW) extruded along +Z from 0 to h."""
    return loft([[(x, y, 0) for x, y in poly], [(x, y, h) for x, y in poly]], cap0=cap0, cap1=cap1)


def revolve(profile, n=16, cap0=False, cap1=False, a0=0.0):
    """Lathe a (r, z) profile listed bottom -> top along the outer surface. r=0 at an end = pole (triangle fan);
    cap0/cap1 close the first/last ring with an n-gon. UVs: u = arc length (angle * ring radius), v = profile length."""
    verts, faces, uvs, rings, vs = [], [], [], [], []
    s = 0.0
    for i, (r, z) in enumerate(profile):
        if i:
            s += math.hypot(r - profile[i - 1][0], z - profile[i - 1][1])
        vs.append(s)
        if r < 1e-7:
            rings.append([len(verts)])
            verts.append((0.0, 0.0, z))
        else:
            rings.append([len(verts) + j for j in range(n)])
            verts += [(r * math.cos(a0 + 2 * math.pi * j / n), r * math.sin(a0 + 2 * math.pi * j / n), z) for j in range(n)]
    rr = [r for r, _ in profile]

    def u(j, r):
        return 2 * math.pi * j / n * r

    for i in range(len(rings) - 1):
        A, B, ra, rb = rings[i], rings[i + 1], rr[i], rr[i + 1]
        for j in range(n):
            k = (j + 1) % n
            if len(A) == 1 and len(B) == 1:
                break
            if len(A) == 1:
                faces.append((A[0], B[k], B[j]))
                uvs.append([(u(j + 0.5, rb), vs[i]), (u(j + 1, rb), vs[i + 1]), (u(j, rb), vs[i + 1])])
            elif len(B) == 1:
                faces.append((A[j], A[k], B[0]))
                uvs.append([(u(j, ra), vs[i]), (u(j + 1, ra), vs[i]), (u(j + 0.5, ra), vs[i + 1])])
            else:
                faces.append((A[j], A[k], B[k], B[j]))
                uvs.append([(u(j, ra), vs[i]), (u(j + 1, ra), vs[i]), (u(j + 1, rb), vs[i + 1]), (u(j, rb), vs[i + 1])])
    for flag, ring, rev in ((cap0, rings[0], True), (cap1, rings[-1], False)):
        if flag and len(ring) > 2:
            f = tuple(reversed(ring)) if rev else tuple(ring)
            faces.append(f)
            uvs.append([(verts[v][0], verts[v][1] * (-1 if rev else 1)) for v in f])
    return verts, faces, uvs


def cyl(r, h, n=12, cap0=True, cap1=True, r1=None, z0=0.0):
    """Cylinder / frustum along +Z from z0 to z0+h (top radius r1)."""
    return revolve([(r, z0), (r if r1 is None else r1, z0 + h)], n, cap0, cap1)


def sweep(path, radius, n=8, cap0=True, cap1=True, a0=None):
    """Tube along a polyline (mitred corners). radius: float or per-point list. UVs: u around, v along (metres)."""
    P = [Vector(p) for p in path]
    m = len(P)
    rad = list(radius) if isinstance(radius, (list, tuple)) else [radius] * m
    T = []
    for i in range(m):
        if i == 0:
            t = P[1] - P[0]
        elif i == m - 1:
            t = P[-1] - P[-2]
        else:
            t = (P[i] - P[i - 1]).normalized() + (P[i + 1] - P[i]).normalized()
        T.append(t.normalized())
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.95 else Vector((1, 0, 0))
    N = (up - T[0] * up.dot(T[0])).normalized()
    if a0 is None:
        a0 = math.pi / n  # flat face on top for even n
    verts, rings, vlen = [], [], []
    L = 0.0
    for i in range(m):
        if i:
            L += (P[i] - P[i - 1]).length
            ax = T[i - 1].cross(T[i])
            if ax.length > 1e-8:
                N = Matrix.Rotation(T[i - 1].angle(T[i]), 3, ax.normalized()) @ N
        B = T[i].cross(N)
        k, s = None, 1.0
        if 0 < i < m - 1:
            din, dout = (P[i] - P[i - 1]).normalized(), (P[i + 1] - P[i]).normalized()
            if (dout - din).length > 1e-6:
                k = (dout - din).normalized()
                s = 1.0 / max(0.25, din.dot(T[i]))
        ring = []
        for j in range(n):
            a = a0 + 2 * math.pi * j / n
            off = (N * math.cos(a) + B * math.sin(a)) * rad[i]
            if k is not None:
                off = off + k * off.dot(k) * (s - 1)
            ring.append(len(verts))
            verts.append(tuple(P[i] + off))
        rings.append(ring)
        vlen.append(L)
    faces, uvs = [], []
    for i in range(m - 1):
        A, Bq = rings[i], rings[i + 1]
        ra, rb = rad[i], rad[i + 1]
        for j in range(n):
            kk = (j + 1) % n
            faces.append((A[j], A[kk], Bq[kk], Bq[j]))
            ca, cb = 2 * math.pi * ra / n, 2 * math.pi * rb / n
            uvs.append([(j * ca, vlen[i]), ((j + 1) * ca, vlen[i]), ((j + 1) * cb, vlen[i + 1]), (j * cb, vlen[i + 1])])
    for flag, ring, rev, rr in ((cap0, rings[0], True, rad[0]), (cap1, rings[-1], False, rad[-1])):
        if flag:
            f = tuple(reversed(ring)) if rev else tuple(ring)
            faces.append(f)
            uvs.append([(rr * math.cos(a0 + 2 * math.pi * ring.index(v) / n), rr * math.sin(a0 + 2 * math.pi * ring.index(v) / n)) for v in f])
    return verts, faces, uvs


def footing(w, h):
    """Concrete pedestal w x w from just below ground to h (no bottom face)."""
    return loft([rect(w, w, -0.05), rect(w * 0.92, w * 0.92, h)], cap1=True)


def L_profile(a, t):
    """Equal angle section (CCW), corner at the origin, legs along +X and +Y."""
    return [(0, 0), (a, 0), (a, t), (t, t), (t, a), (0, a)]


def C_profile(h, b, t):
    """Channel: web along Y (height h), flanges toward +X (width b)."""
    return [(0, -h / 2), (b, -h / 2), (b, -h / 2 + t), (t, -h / 2 + t), (t, h / 2 - t), (b, h / 2 - t), (b, h / 2), (0, h / 2)]


def frame_to(p0, p1, up=(0, 0, 1)):
    """Rotation mapping local +X to p1-p0, local +Z as close to `up` as possible."""
    d = (Vector(p1) - Vector(p0)).normalized()
    upv = Vector(up)
    if abs(d.dot(upv)) > 0.999:
        upv = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    s = upv.cross(d).normalized()  # local +Y
    u = d.cross(s)
    return Matrix((d, s, u)).transposed()


def cut(geo, boxes, solids=()):
    """Closed mesh minus axis-aligned boxes [((sx, sy, sz), (x, y, z) centre), ...] and closed solids
    [(verts, faces), ...] (world coordinates) via an exact boolean."""
    def mk(name, g):
        me = bpy.data.meshes.new(name)
        me.from_pydata(g[0], [], g[1])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob

    base = mk('cut_base', geo)
    cv, cf = [], []
    for (sx, sy, sz), (x, y, z) in boxes:
        v, f = box(sx, sy, sz)
        o = len(cv)
        cv += [(a + x, b + y, c + z) for a, b, c in v]
        cf += [tuple(i + o for i in ff) for ff in f]
    for v, f in solids:
        o = len(cv)
        cv += [tuple(a) for a in v]
        cf += [tuple(i + o for i in ff) for ff in f]
    tool = mk('cut_tool', (cv, cf))
    md = base.modifiers.new('b', 'BOOLEAN')
    md.operation, md.object, md.solver = 'DIFFERENCE', tool, 'EXACT'
    ev = base.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    out = ([tuple(v.co) for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
    ev.to_mesh_clear()
    for ob in (base, tool):
        bpy.data.objects.remove(ob)
    return out


def quad(w, h):
    """Vertical w x h quad in the XZ plane facing -Y, bottom centre at the origin."""
    return [(-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, h), (-w / 2, 0, h)], [(0, 1, 2, 3)]


def bars(w, h):
    """Open square tube (no end caps) along Z, w x w section, height h."""
    return loft([rect(w, w, 0), rect(w, w, h)])


# ---------- model: parts -> per-node meshes -> GLB + manifest ----------

def _uv_box(bm, uvl, off):
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            p = lp.vert.co + off
            if ax == 0:
                lp[uvl].uv = ((p.y if n.x > 0 else -p.y), p.z)
            elif ax == 1:
                lp[uvl].uv = ((-p.x if n.y > 0 else p.x), p.z)
            else:
                lp[uvl].uv = (p.x, (p.y if n.z > 0 else -p.y))


def _uv_planar(bm, uvl, off):
    """True-scale per-face projection: U horizontal along the face, V up the face (roof slopes, sloped walls)."""
    zup = Vector((0, 0, 1))
    for f in bm.faces:
        n = f.normal
        if abs(n.z) > 0.999:
            U, Vv = Vector((1, 0, 0)), Vector((0, 1 if n.z > 0 else -1, 0))
        else:
            U = zup.cross(n).normalized()
            Vv = n.cross(U)
        for lp in f.loops:
            p = lp.vert.co + off
            lp[uvl].uv = (p.dot(U), p.dot(Vv))


class Model:
    def __init__(self, name):
        self.name = name
        self.nodes = {}
        self.attach = {}
        self.footprint = None  # [w, d] override (default: bounding box)
        self.notes = ''
        self.node(name)

    def node(self, name, origin=(0, 0, 0), normals='weighted'):
        """Start / switch to a named node. origin = node pivot (e.g. a gate hinge)."""
        if name not in self.nodes:
            self.nodes[name] = dict(V=[], F=[], UV=[], M=[], sharp=set(), mats=[], origin=Vector(origin),
                                    normals=normals, CN=[], attrs={})
        self.cur = name
        return name

    def add(self, geo, mat, loc=(0, 0, 0), rot=None, uv='box', smooth=None, bevel=0.0, node=None, normals=None):
        """geo = (verts, faces[, uvs]). rot = Euler tuple (rad) or 3x3 Matrix. uv: 'box' | 'planar' | explicit in geo.
        smooth: None = auto by angle, True / False = all smooth / all sharp. bevel = chamfer width (1 segment)."""
        verts, faces = geo[0], geo[1]
        uvs = geo[2] if len(geo) > 2 else None
        R = Matrix.Identity(3) if rot is None else (rot if isinstance(rot, Matrix) else Euler(rot, 'XYZ').to_matrix())
        t = Vector(loc)
        bm = bmesh.new()
        bv = [bm.verts.new(v) for v in verts]
        for f in faces:
            bm.faces.new([bv[i] for i in f])
        uvl = bm.loops.layers.uv.new('UVMap')
        if uvs is not None and not bevel:
            for f, fuv in zip(bm.faces, uvs):
                for lp, c in zip(f.loops, fuv):
                    lp[uvl].uv = c
        bm.normal_update()
        if bevel:  # chamfer only real corners (not the facets of round parts)
            edges = [e for e in bm.edges if len(e.link_faces) != 2 or e.calc_face_angle(0) > math.radians(30)]
            bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect='EDGES', profile=0.5, clamp_overlap=True)
            bm.normal_update()
        if uvs is None or bevel:
            (_uv_planar if uv == 'planar' else _uv_box)(bm, uvl, R.transposed() @ t)
        for v in bm.verts:
            v.co = R @ v.co + t
        bm.normal_update()
        for e in bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = smooth if smooth is not None else e.link_faces[0].normal.angle(e.link_faces[1].normal, 0) <= SHARP
        nd = self.nodes[node or self.cur]
        base = len(nd['V'])
        bm.verts.index_update()
        nd['V'] += [tuple(v.co) for v in bm.verts]
        def mindex(name):
            if name not in nd['mats']:
                nd['mats'].append(name)
            return nd['mats'].index(name)

        fixed = None if callable(mat) else mindex(mat)  # mat may be f(face centre, normal) -> name
        for f in bm.faces:
            nd['F'].append([base + v.index for v in f.verts])
            nd['UV'].append([tuple(lp[uvl].uv) for lp in f.loops])
            nd['M'].append(fixed if fixed is not None else mindex(mat(f.calc_center_median(), f.normal)))
            if normals is not None:
                nd['CN'] += [tuple((R @ Vector(normals[v.index])).normalized()) for v in f.verts]
        for e in bm.edges:
            if not e.smooth:
                nd['sharp'].add(tuple(sorted((base + e.verts[0].index, base + e.verts[1].index))))
        bm.free()

    # convenience parts
    def beam(self, p0, p1, w, h, mat, up=(0, 0, 1), caps=True, **kw):
        """Rectangular bar from p0 to p1, w across (local Y), h along `up` (local Z)."""
        L = (Vector(p1) - Vector(p0)).length
        g = loft([[(0, -w / 2, -h / 2), (0, w / 2, -h / 2), (0, w / 2, h / 2), (0, -w / 2, h / 2)],
                  [(L, -w / 2, -h / 2), (L, w / 2, -h / 2), (L, w / 2, h / 2), (L, -w / 2, h / 2)]], cap0=caps, cap1=caps)
        self.add(g, mat, loc=p0, rot=frame_to(p0, p1, up), **kw)

    def tube(self, pts, r, mat, n=8, caps=True, **kw):
        self.add(sweep(pts, r, n, caps, caps), mat, **kw)

    def build(self):
        objs = []
        for name, nd in self.nodes.items():
            if not nd['F']:
                continue
            o = nd['origin']
            me = bpy.data.meshes.new(name)
            me.from_pydata([(x - o.x, y - o.y, z - o.z) for x, y, z in nd['V']], [], nd['F'])
            uvl = me.uv_layers.new(name='UVMap')
            uvl.data.foreach_set('uv', [c for f in nd['UV'] for uv in f for c in uv])
            for mn in nd['mats']:
                me.materials.append(get_mat(mn))
            me.polygons.foreach_set('material_index', nd['M'])
            me.polygons.foreach_set('use_smooth', [True] * len(nd['F']))
            ek = {tuple(sorted(e.vertices)): e.index for e in me.edges}
            sharp = [False] * len(me.edges)
            for k in nd['sharp']:
                if k in ek:
                    sharp[ek[k]] = True
            me.edges.foreach_set('use_edge_sharp', sharp)
            ob = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(ob)
            ob.location = o
            for an, vals in nd['attrs'].items():  # per-vertex float vec4, exported because the name starts with '_'
                at = me.attributes.new(an, 'QUATERNION', 'POINT')  # (not FLOAT_COLOR: that also leaks out as COLOR_n)
                at.data.foreach_set('value', [c for v in vals for c in v])
            if nd['normals'] == 'custom':
                me.normals_split_custom_set(nd['CN'])
            else:
                md = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
                md.mode = 'FACE_AREA'
                md.keep_sharp = True
            objs.append(ob)
        return objs

    def export(self):
        objs = self.build()
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, self.name + '.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                                  export_attributes=True, export_image_format='JPEG', export_image_quality=85,
                                  export_animations=False, export_cameras=False, export_lights=False)
        tris = sum(len(f) - 2 for nd in self.nodes.values() for f in nd['F'])
        record(self.name, path, objs, tris, self.attach, self.footprint, 'procedural (original)', self.notes)
        return path


def gl(p):
    """Blender (x, y, z) -> glTF (x, z, -y)."""
    return [round(p[0], 3), round(p[2], 3), round(-p[1] + 0.0, 3)]


def record(name, path, objs, tris, attach, footprint, source, notes=''):
    """Write the manifest entry (glTF coordinates) and print the EXPORTED line."""
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = os.path.getsize(path)
    mats = sorted({s.material.name for o in objs for s in o.material_slots if s.material})
    entry = dict(
        name=name, file=f'{name}.glb', tris=tris, bytes=size,
        footprint=[round(v, 2) for v in (footprint or [hi.x - lo.x, hi.y - lo.y])],
        height=round(hi.z, 2),
        bounds=dict(min=gl((lo.x, hi.y, lo.z)), max=gl((hi.x, lo.y, hi.z))),
        nodes=[o.name for o in objs], materials=mats,
        attach={k: ([gl(p) for p in v] if isinstance(v[0], (list, tuple)) else gl(v)) for k, v in attach.items()},
        source=source,
    )
    if notes:
        entry['notes'] = notes
    data = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as fh:
            data = json.load(fh)
    data[name] = entry
    with open(MANIFEST, 'w') as fh:
        json.dump(dict(sorted(data.items())), fh, indent=2)
    print(f'EXPORTED {name} tris={tris} bytes={size}')


# ---------- models ----------

def build_feed_silo():
    """Galvanised bulk feed bin: Ø2.7 x 4.5 m body ("SiloBody"), 60° hopper to a Ø0.4 outlet 1 m up, 6 legs,
    caged ladder (front-right), roof cone + lid, flex auger leaving the boot at 30° toward the front (+Z glTF)."""
    m = Model('feed_silo')
    R, r_out, z_out = 1.35, 0.2, 1.0
    z1 = z_out + (R - r_out) * math.tan(math.radians(60))  # body bottom ~2.99
    z2 = z1 + 4.5
    N = 32
    m.node('SiloBody')
    prof, sheets, lip = [], 4, 0.012
    for i in range(sheets):  # bolted sheet rings: each lower edge laps over the sheet below
        za, zb = z1 + 4.5 * i / sheets, z1 + 4.5 * (i + 1) / sheets
        prof += [(R + lip, za), (R, zb)]
    m.add(revolve(prof, N), 'M_galv')
    ha = math.radians(-35)
    m.add(box(0.5, 0.05, 0.42), 'M_galv', loc=(R * math.cos(ha), R * math.sin(ha), z1 + 0.65),
          rot=(0, 0, ha + math.pi / 2))  # inspection hatch next to the ladder

    m.node('feed_silo')
    zr = z2 + (R + 0.07 - 0.33) * math.tan(math.radians(36))
    m.add(revolve([(R - 0.02, z2 - 0.1), (R + 0.07, z2 - 0.07), (R + 0.07, z2 + 0.02), (0.33, zr)], N, cap1=True), 'M_galv')
    m.add(revolve([(0.36, zr - 0.03), (0.36, zr + 0.09), (0.0, zr + 0.2)], 12), 'M_galv')  # lid
    for i in range(8):  # roof sheet ribs
        a = 2 * math.pi * (i + 0.5) / 8
        p0 = Vector((math.cos(a) * (R + 0.04), math.sin(a) * (R + 0.04), z2 + 0.05))
        p1 = Vector((math.cos(a) * 0.38, math.sin(a) * 0.38, zr + 0.01))
        m.beam(p0, p1, 0.05, 0.035, 'M_galv', caps=False)
    # hopper + transition ring + outlet collar + boot
    m.add(revolve([(r_out, z_out), (R, z1 - 0.01)], 24), 'M_galv')
    m.add(revolve([(R - 0.01, z1 - 0.07), (R + 0.035, z1 - 0.07), (R + 0.035, z1 + 0.12)], 24), 'M_galv')
    m.add(cyl(r_out + 0.025, 0.14, 12, cap0=False, cap1=False, z0=z_out - 0.13), 'M_galv')
    m.add(box(0.36, 0.36, 0.3, z0=z_out - 0.43), 'M_galv')
    m.add(box(0.5, 0.06, 0.06), 'M_steel_dark', loc=(0.3, 0, z_out - 0.2))  # slide-gate handle
    # 6 legs (equal angles) on footings, bracing (front bay left open for the auger)
    legs = [math.radians(30 + 60 * i) for i in range(6)]  # bays centred on 0°, 60° … ; -90° (front) is a bay
    zt = z1 + 0.12
    for a in legs:
        c = Vector((math.cos(a), math.sin(a), 0))
        p = c * (R + 0.045)
        rot = math.atan2(c.y, c.x) + math.radians(135)
        m.add(prism(L_profile(0.1, 0.01), zt - 0.15), 'M_galv', loc=(p.x + c.x * 0.05, p.y + c.y * 0.05, 0.15),
              rot=(0, 0, rot))
        m.add(footing(0.42, 0.15), 'M_concrete', loc=(p.x + c.x * 0.03, p.y + c.y * 0.03, 0))
    for i in range(6):
        a0, a1 = legs[i], legs[(i + 1) % 6]
        mid = (a0 + a1) / 2 if a1 > a0 else (a0 + a1 + 2 * math.pi) / 2
        q0 = Vector((math.cos(a0), math.sin(a0), 0)) * (R + 0.09)
        q1 = Vector((math.cos(a1), math.sin(a1), 0)) * (R + 0.09)
        m.beam(q0 + Vector((0, 0, 0.35)), q1 + Vector((0, 0, 0.35)), 0.05, 0.05, 'M_galv', caps=False)  # ground girt
        if abs(math.sin(mid) + 1) < 0.05:  # front bay: auger passes through
            continue
        m.beam(q0 + Vector((0, 0, 0.4)), q1 + Vector((0, 0, z1 - 0.35)), 0.05, 0.008, 'M_galv',
               up=tuple(Vector((math.cos(mid), math.sin(mid), 0))), caps=False)
        m.beam(q1 + Vector((0, 0, 0.4)), q0 + Vector((0, 0, z1 - 0.35)), 0.05, 0.008, 'M_galv',
               up=tuple(Vector((math.cos(mid), math.sin(mid), 0))), caps=False)
    # caged ladder at -60° (front-right), standoff 0.22 m
    a = math.radians(-60)
    c, tng = Vector((math.cos(a), math.sin(a), 0)), Vector((-math.sin(a), math.cos(a), 0))
    lc = c * (R + 0.24)
    ztop = z2 + 0.75
    for s in (-1, 1):
        m.beam(lc + tng * 0.22 * s, lc + tng * 0.22 * s + Vector((0, 0, ztop)), 0.014, 0.06, 'M_galv', up=tuple(c))
    zz = 0.3
    while zz < ztop - 0.2:
        m.add(sweep([lc - tng * 0.22 + Vector((0, 0, zz)), lc + tng * 0.22 + Vector((0, 0, zz))], 0.013, 3, False, False),
              'M_galv', smooth=True)
        zz += 0.3
    hz = 2.3
    while hz < ztop:  # cage hoops
        pts = [lc + tng * 0.24 * math.cos(t) + c * (0.36 * math.sin(t)) + Vector((0, 0, hz))
               for t in (math.pi * i / 6 for i in range(7))]
        m.tube([tuple(p) for p in pts], 0.012, 'M_galv', n=3, caps=False, smooth=True)
        hz += 1.1
    for t in (math.pi * 0.2, math.pi * 0.5, math.pi * 0.8):  # cage straps
        p = lc + tng * 0.24 * math.cos(t) + c * (0.36 * math.sin(t))
        m.beam(p + Vector((0, 0, 2.3)), p + Vector((0, 0, ztop - 0.05)), 0.04, 0.008, 'M_galv', up=tuple(c), caps=False)
    for s in (-1, 1):  # roof ladder up the cone to the lid
        e0 = c * (R + 0.08) + tng * 0.2 * s + Vector((0, 0, z2 + 0.06))
        e1 = c * 0.45 + tng * 0.2 * s + Vector((0, 0, zr - 0.06))
        m.beam(e0, e1, 0.05, 0.012, 'M_galv', caps=False)
    for f in (0.25, 0.5, 0.75):
        e = c * (R + 0.08 + (0.45 - R - 0.08) * f) + Vector((0, 0, z2 + 0.11 + (zr - z2 - 0.12) * f))
        m.beam(e - tng * 0.2, e + tng * 0.2, 0.024, 0.024, 'M_galv', caps=False)
    # flex auger: boot -> 30° up toward -Y (glTF +Z), motor head at the far end, A-frame stand
    d = Vector((0, -math.cos(math.radians(30)), math.sin(math.radians(30))))
    a0 = Vector((0, -0.18, z_out - 0.3))
    a1 = a0 + d * 3.6
    m.tube([tuple(a0), tuple(a1)], 0.065, 'M_galv', n=12)
    m.add(box(0.26, 0.34, 0.3), 'M_steel_dark', loc=tuple(a1 + Vector((0, -0.05, 0.1))))  # gearbox head
    m.add(cyl(0.11, 0.34, 10), 'M_steel_dark', loc=tuple(a1 + Vector((0.13, -0.05, 0.12))), rot=(0, math.pi / 2, 0))
    m.tube([tuple(a1 + Vector((0, -0.12, -0.05))), tuple(a1 + Vector((0, -0.12, -0.6)))], 0.06, 'M_galv', n=10)
    mid = a0 + d * 2.2
    for s in (-1, 1):
        m.beam((s * 0.45, mid.y - 0.1, 0.0), (0.0, mid.y, mid.z - 0.07), 0.04, 0.04, 'M_galv')
    m.attach['auger_end'] = tuple(a1 + Vector((0, -0.12, -0.6)))
    m.footprint = [2 * (R + 0.25), 2 * (R + 0.25)]
    m.notes = 'origin = silo axis; footprint = leg circle; the auger reaches 3.3 m toward +Z (see bounds).'
    return m


def build_water_tank():
    """5000 L black ribbed plastic tank ("Tank", Ø1.9 x 2.1) on a 4 m galvanised angle tower with bracing, platform,
    ladder (front), GI inlet up a leg, white PVC outlet + overflow down."""
    m = Model('water_tank')
    H = 4.0
    b0, b1 = 2.35, 2.0  # leg spread at ground / top
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    for sx, sy in corners:  # equal-angle legs, L opening inward, raked in toward the top
        p0 = Vector((sx * b0 / 2, sy * b0 / 2, 0.15))
        p1 = Vector((sx * b1 / 2, sy * b1 / 2, H))
        rz = Matrix.Rotation(math.atan2(-sy, -sx) - math.radians(45), 3, 'Z')
        tilt = Matrix.Rotation(math.atan2((b0 - b1) / 2 * math.sqrt(2), H - 0.15), 3, Vector((sy, -sx, 0)).normalized())
        m.add(prism(L_profile(0.075, 0.008), (p1 - p0).length), 'M_galv', loc=tuple(p0), rot=tilt @ rz)
        m.add(footing(0.4, 0.15), 'M_concrete', loc=(sx * b0 / 2, sy * b0 / 2, 0))

    def leg_at(sx, sy, z):
        f = (z - 0.15) / (H - 0.15)
        w = b0 + (b1 - b0) * f
        return Vector((sx * w / 2, sy * w / 2, z))

    levels = [0.45, 2.2, H - 0.06]
    for i in range(4):
        (ax, ay), (bx, by) = corners[i], corners[(i + 1) % 4]
        out = Vector(((ax + bx) / 2, (ay + by) / 2, 0)).normalized()
        for z in levels:
            m.beam(leg_at(ax, ay, z), leg_at(bx, by, z), 0.06, 0.06, 'M_galv', up=(0, 0, 1))
        for za, zb in ((levels[0], levels[1]), (levels[1], levels[2])):
            m.beam(leg_at(ax, ay, za + 0.05), leg_at(bx, by, zb - 0.05), 0.05, 0.007, 'M_galv', up=tuple(out), caps=False)
            m.beam(leg_at(bx, by, za + 0.05), leg_at(ax, ay, zb - 0.05), 0.05, 0.007, 'M_galv', up=tuple(out), caps=False)
    m.add(box(b1 + 0.16, b1 + 0.16, 0.06, z0=H), 'M_galv', bevel=0.01)  # chequered-plate deck
    # ladder on the front (-Y)
    ly = -(b0 / 2 + 0.12)
    for s in (-1, 1):
        m.beam((s * 0.22, ly, 0.0), (s * 0.22, -(b1 / 2 + 0.12), H + 0.9), 0.012, 0.06, 'M_galv', up=(0, -1, 0))
    for k in range(1, 15):
        z = 0.3 * k
        if z > H + 0.7:
            break
        y = ly + (-(b1 / 2 + 0.12) - ly) * (z / (H + 0.9))
        m.beam((-0.22, y, z), (0.22, y, z), 0.024, 0.024, 'M_galv', caps=False)
    # tank
    m.node('Tank')
    z0 = H + 0.06
    prof = [(0.88, z0), (0.95, z0 + 0.07)]
    for zg in (0.45, 0.85, 1.25, 1.65):  # moulded ribs
        prof += [(0.95, z0 + zg - 0.06), (0.975, z0 + zg - 0.025), (0.975, z0 + zg + 0.025), (0.95, z0 + zg + 0.06)]
    prof += [(0.95, z0 + 1.88), (0.86, z0 + 2.0), (0.6, z0 + 2.08), (0.26, z0 + 2.11)]
    m.add(revolve(prof, 24, cap0=True), 'M_plastic_black')
    m.add(revolve([(0.27, z0 + 2.1), (0.27, z0 + 2.17), (0.24, z0 + 2.19), (0.0, z0 + 2.2)], 16), 'M_plastic_black')
    m.node('water_tank')
    # pipes: GI inlet up the back-right into the lid, PVC outlet (gate valve) + overflow down inside the tower
    m.tube([(0.9, 0.95, 0.0), (0.9, 0.95, z0 + 2.3), (0.3, 0.32, z0 + 2.3), (0.3, 0.32, z0 + 2.13)], 0.03, 'M_galv')
    m.tube([(-0.6, -0.72, z0 + 0.12), (-0.78, -0.93, z0 + 0.12), (-0.78, -0.93, 0.35), (-0.78, -1.6, 0.35),
            (-0.78, -1.6, -0.05)], 0.032, 'M_paint_white')
    vrot = (0, 0, math.atan2(-0.21, -0.18))
    m.add(box(0.15, 0.1, 0.1), 'M_steel_dark', loc=(-0.69, -0.825, z0 + 0.12), rot=vrot)  # gate valve
    m.add(cyl(0.012, 0.08, 6), 'M_steel_dark', loc=(-0.69, -0.825, z0 + 0.17))
    m.add(cyl(0.065, 0.014, 12), 'M_paint_red', loc=(-0.69, -0.825, z0 + 0.25))  # handwheel
    m.tube([(0.62, -0.68, z0 + 1.9), (0.8, -0.88, z0 + 1.9), (0.8, -0.88, 0.3), (0.8, -1.5, 0.3), (0.8, -1.5, -0.05)],
           0.022, 'M_paint_white', n=6)
    m.footprint = [b0 + 0.4, b0 + 0.4]
    m.attach['inlet'] = (0.9, 0.95, 0.0)
    m.attach['outlet'] = (-0.78, -1.6, 0.0)
    return m


def build_electric_pole():
    """Indian 9 m PSC pole (1.5 m planted -> 7.5 m above ground), tapered I-section, galvanised channel crossarm
    with two pin insulators + one top-pin insulator. Wires run along glTF Z; attach = insulator neck positions."""
    m = Model('electric_pole')
    H = 7.5

    m.add(loft([psc_ring(0.0, H), psc_ring(H, H)], cap1=True), 'M_concrete')
    za = H - 0.32
    hy = 0.08 + (0.055 - 0.08) * za / H
    # channel crossarm bolted across the front face: web outward, flanges against the pole
    cm = Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0))).transposed()  # local X->+Y, Y->+Z, Z(extrusion)->+X
    m.add(prism(C_profile(0.1, 0.05, 0.006), 1.5), 'M_galv', loc=(-0.75, -hy - 0.05, za), rot=cm)
    m.add(box(0.24, 0.012, 0.12), 'M_galv', loc=(0, hy + 0.006, za))  # back clamp plate
    m.add(box(0.07, 0.15, 0.2), 'M_galv', loc=(0, 0, H + 0.08))  # top-pin clamp
    yc = -hy - 0.025
    seats = [(-0.65, yc, za + 0.05), (0.65, yc, za + 0.05), (0.0, 0.0, H + 0.18)]
    prof = [(0.03, 0.0), (0.078, 0.03), (0.05, 0.055), (0.064, 0.085), (0.036, 0.125), (0.042, 0.15), (0.0, 0.16)]
    attach = []
    for (x, y, z) in seats:
        m.add(cyl(0.012, 0.05, 6, cap0=False, cap1=False), 'M_galv', loc=(x, y, z))
        m.add(revolve(prof, 7), 'M_paint_white', loc=(x, y, z + 0.04), smooth=True)
        attach.append((x, y, z + 0.04 + 0.135))
    m.attach['wires'] = attach
    m.notes = 'Crossarm along X; wires run along glTF Z. attach.wires = [left, right, top] insulator necks.'
    return m


# ---------- building kit ----------

FACE_ROT = {'-y': 0.0, '+x': math.pi / 2, '+y': math.pi, '-x': -math.pi / 2}


def on_wall(face, along, z, hx, hy, c=(0, 0)):
    """Point on the outer face of a 2hx x 2hy building centred at c (+ rotation: local -Y = outward, +X = right)."""
    R = Matrix.Rotation(FACE_ROT[face], 3, 'Z')
    f = {'-y': (0, -hy), '+y': (0, hy), '+x': (hx, 0), '-x': (-hx, 0)}[face]
    return Vector((c[0] + f[0], c[1] + f[1], z)) + R @ Vector((along, 0, 0)), R


def recess(p, R, w, h, depth):
    """Axis-aligned cutter for a w x h recess `depth` into the wall at p (bottom centre on the face)."""
    c = p + R @ Vector((0, (depth - 0.02) / 2, h / 2))
    along_x = abs((R @ Vector((1, 0, 0))).x) > 0.5
    return ((w, depth + 0.02, h) if along_x else (depth + 0.02, w, h)), tuple(c)


def placer(m, p, R):
    def put(geo, mat, lx, ly, lz, rot=None, **kw):
        Rl = R if rot is None else R @ Euler(rot, 'XYZ').to_matrix()
        m.add(geo, mat, loc=tuple(p + R @ Vector((lx, ly, lz))), rot=Rl, **kw)
    return put


def window(m, face, along, zs, w, h, hx, hy, depth=0.12, chajja=0.55, grill=True, frame='M_steel_dark', c=(0, 0)):
    """Steel window in a plastered wall: recess, glass, frame with mullion + ventilator transom, MS grill, sill,
    RCC chajja (sunshade). Returns the recess cutter."""
    p, R = on_wall(face, along, zs, hx, hy, c)
    put = placer(m, p, R)
    put(quad(w, h), 'M_glass', 0, depth - 0.03, 0)
    fy, fw = depth - 0.05, 0.05
    for lz in (fw / 2, h - fw / 2, h - 0.38):
        put(box(w, 0.04, fw), frame, 0, fy, lz)
    for lx in (-w / 2 + fw / 2, 0, w / 2 - fw / 2):
        put(box(fw, 0.04, h - 2 * fw), frame, lx, fy, h / 2)
    if grill:
        n = max(2, round(w / 0.11))
        for i in range(1, n):
            put(bars(0.014, h), frame, -w / 2 + w * i / n, 0.03, 0)
        for lz in (h / 3, 2 * h / 3):
            put(loft([rect(w, 0.006, lz - 0.015), rect(w, 0.006, lz + 0.015)]), frame, 0, 0.03, 0)
    put(box(w + 0.12, 0.12, 0.05), 'M_plaster', 0, -0.03, -0.025)
    if chajja:
        put(box(w + 0.3, chajja, 0.08), 'M_plaster', 0, -chajja / 2, h + 0.19)
    return recess(p, R, w, h, depth)


def door(m, face, along, zs, w, h, hx, hy, depth=0.1, chajja=0.75, mat='M_steel_dark', c=(0, 0), chajja_mat='M_plaster'):
    """Pressed-steel door with stiffener ribs, frame, handle and chajja. Returns the recess cutter."""
    p, R = on_wall(face, along, zs, hx, hy, c)
    put = placer(m, p, R)
    put(box(w - 0.08, 0.04, h - 0.04), mat, 0, depth - 0.04, (h - 0.04) / 2)
    for lx in (-w / 2 + 0.025, w / 2 - 0.025):
        put(box(0.05, 0.06, h), mat, lx, depth - 0.035, h / 2)
    put(box(w, 0.06, 0.05), mat, 0, depth - 0.035, h - 0.025)
    for lz in (0.3, h * 0.5, h - 0.3):
        put(box(w - 0.18, 0.02, 0.05), mat, 0, depth - 0.07, lz)
    put(box(0.03, 0.06, 0.18), mat, w / 2 - 0.16, depth - 0.09, 1.0)
    if chajja:
        put(box(w + 0.6, chajja, 0.09), chajja_mat, 0, -chajja / 2, h + 0.2)
    return recess(p, R, w, h, depth)


def vent(m, face, along, zs, w, h, hx, hy, depth=0.15, c=(0, 0)):
    """High-level ventilator: recess with three precast louvre slats."""
    p, R = on_wall(face, along, zs, hx, hy, c)
    put = placer(m, p, R)
    for f in (0.2, 0.5, 0.8):
        put(box(w, 0.13, 0.025), 'M_concrete', 0, 0.07, h * f, rot=(math.radians(-40), 0, 0))
    put(box(w + 0.1, 0.08, 0.05), 'M_concrete', 0, -0.02, -0.025)
    return recess(p, R, w, h, depth)


def pyramid(w, h):
    return rect(w, w, 0) + [(0, 0, h)], [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]


def ring_band(w, d, z0, z1, out):
    """Projecting horizontal band around a w x d block (underside + face + top)."""
    return loft([rect(w, d, z0), rect(w + 2 * out, d + 2 * out, z0), rect(w + 2 * out, d + 2 * out, z1), rect(w, d, z1)])


def solar_texture():
    """72-cell mono panel 1 x 2 m: dark blue cells, white gaps, busbars, aluminium frame border."""
    w, h, cols, rows, fr = 256, 512, 6, 12, 8
    img = np.ones((h, w, 4), np.float32)
    img[..., :3] = (0.78, 0.8, 0.81)
    yy, xx = np.mgrid[0:h, 0:w]
    cw, ch = (w - 2 * fr) / cols, (h - 2 * fr) / rows
    inner = (xx >= fr) & (xx < w - fr) & (yy >= fr) & (yy < h - fr)
    cx, cy = (xx - fr) % cw, (yy - fr) % ch
    gap = (cx < 1.6) | (cy < 1.6)
    ci = np.clip(((xx - fr) // cw).astype(int), 0, cols - 1)
    cj = np.clip(((yy - fr) // ch).astype(int), 0, rows - 1)
    tint = np.random.default_rng(7).uniform(0.9, 1.1, (rows, cols))
    cell = inner & ~gap
    img[cell, :3] = np.array([0.06, 0.09, 0.19]) * tint[cj[cell], ci[cell]][:, None]
    q = cw / 4
    bus = cell & (np.abs(cx / q - np.round(cx / q)) * q < 0.7) & (np.round(cx / q) % 4 != 0)
    img[bus, :3] = (0.42, 0.45, 0.5)
    img[inner & gap, :3] = (0.86, 0.88, 0.9)
    return image('solar_cells', img)


def ribbed_tank(r, h, n=16, grooves=(), lid=0.16):
    """Black roto-moulded water tank (Sintex type) with moulded grooves and a screw lid -> (body, lid)."""
    prof = [(r - 0.04, 0.0), (r, 0.05)]
    for zg in grooves:
        prof += [(r, zg - 0.04), (r - 0.018, zg), (r, zg + 0.04)]
    prof += [(r, h - 0.13), (r - 0.07, h - 0.04), (lid + 0.02, h)]
    return revolve(prof, n, cap0=True), revolve([(lid, h - 0.01), (lid, h + 0.05), (0.0, h + 0.07)], 12)


def build_office():
    """Single-storey farm office 8 x 6 m: plinth, plastered walls, RCC roof (3.2 m) with 0.9 m parapet + coping,
    slab band, steel windows with MS grills + glass + chajjas, steel door with steps, roof water tank, 2 solar panels."""
    m = Model('office')
    W, D, t = 8.0, 6.0, 0.23
    zp, zr, zt = 0.45, 3.2, 4.1
    hx, hy = W / 2, D / 2
    m.add(loft([rect(W + 0.1, D + 0.1, -0.05), rect(W + 0.1, D + 0.1, zp)], cap1=True), 'M_concrete')
    cuts = [door(m, '-y', 0.0, zp, 1.05, 2.1, hx, hy)]
    cuts += [window(m, '-y', x, zp + 0.9, 1.2, 1.2, hx, hy) for x in (-2.5, 2.5)]
    cuts += [window(m, '+y', x, zp + 0.9, 1.2, 1.2, hx, hy) for x in (-2.0, 2.0)]
    cuts += [window(m, f, 0.0, zp + 0.9, 1.2, 1.2, hx, hy) for f in ('-x', '+x')]
    shell = loft([rect(W, D, zp), rect(W, D, zt), rect(W - 2 * t, D - 2 * t, zt), rect(W - 2 * t, D - 2 * t, zr)],
                 cap0=True, cap1=True)
    m.add(cut(shell, cuts), lambda c, n: 'M_concrete' if n.z > 0.9 and c.z < zr + 0.01 else 'M_plaster')
    m.add(ring_band(W, D, zr - 0.16, zr, 0.05), 'M_plaster')  # slab edge band
    m.add(loft([rect(W, D, zt), rect(W + 0.06, D + 0.06, zt), rect(W + 0.06, D + 0.06, zt + 0.06),
                rect(W - 2 * t - 0.06, D - 2 * t - 0.06, zt + 0.06), rect(W - 2 * t - 0.06, D - 2 * t - 0.06, zt),
                rect(W - 2 * t, D - 2 * t, zt)]), 'M_plaster')  # parapet coping
    for i in range(3):  # entrance steps
        dd = 0.3 * (3 - i)
        m.add(loft([rect(1.8, dd, -0.05), rect(1.8, dd, 0.15 * (i + 1))], cap1=True), 'M_concrete',
              loc=(0, -hy - 0.05 - dd / 2, 0))
    m.add(box(0.22, 0.09, 0.12), 'M_emissive_light', loc=(0.95, -hy - 0.045, zp + 2.3))  # door lamp
    # roof: 1000 L tank on a pedestal, PVC down-take through the parapet
    tx, ty = -2.4, 1.5
    m.add(loft([rect(1.3, 1.3, zr), rect(1.3, 1.3, zr + 0.3)], cap1=True), 'M_concrete', loc=(tx, ty, 0))
    body, lid = ribbed_tank(0.55, 1.2, 16, (0.45,))
    m.add(body, 'M_plastic_black', loc=(tx, ty, zr + 0.3))
    m.add(lid, 'M_plastic_black', loc=(tx, ty, zr + 0.3))
    m.tube([(tx + 0.53, ty + 0.12, zr + 0.42), (tx + 0.53, hy + 0.08, zr + 0.42), (tx + 0.53, hy + 0.08, 0.25),
            (tx + 0.53, hy + 0.3, -0.02)], 0.03, 'M_plastic_black', n=6)
    # two 72-cell panels on a tilted frame facing the front
    tex_mat('SolarPanel', solar_texture(), rough=0.25)
    C = Vector((2.0, -0.6, zr + 0.55))
    Rx = Matrix.Rotation(math.radians(17), 3, 'X')
    pv, pf = box(1.0, 2.0, 0.04)
    puv = [[(0.01, 0.01)] * 4] * 5 + [[(0, 0), (1, 0), (1, 1), (0, 1)]]
    for sx in (-0.52, 0.52):
        m.add((pv, pf, puv), 'SolarPanel', loc=tuple(C + Rx @ Vector((sx, 0, 0))), rot=Rx)
    for ly in (-0.55, 0.55):
        a = C + Rx @ Vector((-1.1, ly, -0.05))
        b = C + Rx @ Vector((1.1, ly, -0.05))
        m.beam(a, b, 0.05, 0.05, 'M_steel_dark', up=tuple(Rx @ Vector((0, 0, 1))))
        for e in (a, b):
            m.beam((e.x, e.y, zr), (e.x, e.y, e.z - 0.025), 0.05, 0.05, 'M_steel_dark', caps=False)
    m.footprint = [W + 0.1, D + 0.1]
    m.notes = 'Footprint = plinth; entrance steps add 0.95 m toward +Z. Roof slab 3.2 m, parapet 4.1 m, roof tank top 4.77 m.'
    return m


def build_godown():
    """Feed godown 15 x 10 m: brick walls 4 m with piers and RCC eaves band, gable GI roof (18 deg) with overhangs,
    purlins, ridge cap + barge flashing, rolling shutter (ribbed curtain, hood, guides) on the front, ramp,
    high-level louvre ventilators, staff door on the left gable, wall lamps."""
    m = Model('godown')
    L, Wd = 15.0, 10.0
    hx, hy = L / 2, Wd / 2
    zp, ze = 0.45, 4.0
    pt = math.radians(18)
    zr = ze + hy * math.tan(pt)
    m.add(loft([rect(L + 0.1, Wd + 0.1, -0.05), rect(L + 0.1, Wd + 0.1, zp)], cap1=True), 'M_concrete')
    prof = [(-hy, zp), (hy, zp), (hy, ze), (0, zr), (-hy, ze)]
    mass = loft([[(-hx, y, z) for y, z in prof], [(hx, y, z) for y, z in prof]], cap0=True, cap1=True)
    cuts = [vent(m, '-y', x, 3.2, 0.6, 0.45, hx, hy) for x in (-4.5, 4.5)]
    cuts += [vent(m, '+y', x, 3.2, 0.6, 0.45, hx, hy) for x in (-4.5, -1.5, 1.5, 4.5)]
    cuts += [vent(m, f, 0.0, 4.3, 0.6, 0.45, hx, hy) for f in ('-x', '+x')]
    cuts.append(door(m, '-x', 2.0, zp, 1.0, 2.1, hx, hy, chajja=0.6, chajja_mat='M_concrete'))
    m.add(cut(mass, cuts), 'M_brick')
    for side, xs in ((-1, (-6, -3, 3, 6)), (1, (-6, -3, 0, 3, 6))):  # brick piers carrying the trusses
        for x in xs:
            m.add(loft([rect(0.35, 0.14, zp), rect(0.35, 0.14, ze)], cap1=True), 'M_brick', loc=(x, side * (hy + 0.05), 0))
    m.add(ring_band(L, Wd, ze - 0.14, ze, 0.03), 'M_concrete')
    m.add(loft([[(x, y, z) for y, z in ((-hy - 2.0, 0.0), (-hy - 0.05, 0.0), (-hy - 0.05, zp))] for x in (2.1, -2.1)],
               cap0=True, cap1=True), 'M_concrete')  # loading ramp
    # rolling shutter
    zs = 3.42
    nz = round((zs - zp) / 0.1)
    curtain = [(-hy - (0.06 if i % 2 == 0 else 0.085), zp + (zs - zp) * i / (2 * nz)) for i in range(2 * nz + 1)]
    m.add(loft([[(x, y, z) for y, z in curtain] for x in (1.75, -1.75)], closed=False), 'M_galv')
    for sx in (-1, 1):
        m.add(box(0.07, 0.1, zs - zp, z0=zp), 'M_steel_dark', loc=(sx * 1.8, -hy - 0.05, 0))
        m.add(box(0.05, 0.05, 0.1), 'M_galv', loc=(sx * 0.6, -hy - 0.14, zp + 0.25))  # lift handles
        m.add(box(0.2, 0.08, 0.12), 'M_emissive_light', loc=(sx * 2.4, -hy - 0.04, 3.05))
    m.add(box(3.5, 0.08, 0.07), 'M_steel_dark', loc=(0, -hy - 0.075, zp + 0.035))
    m.add(box(3.8, 0.45, 0.42), 'M_galv', loc=(0, -hy - 0.225, zs + 0.21), bevel=0.03)  # shutter hood
    # roof: sheets on purlins, ridge cap, barge flashing
    tk, ove, ovg = 0.03, 0.6, 0.45
    Ls, Lx = (hy + ove) / math.cos(pt), L + 2 * ovg
    for side in (0, 1):
        Rr = Matrix.Rotation(math.pi * side, 3, 'Z') @ Matrix.Rotation(pt, 3, 'X')
        m.add(loft([rect(Lx, Ls, 0, 0, -Ls / 2), rect(Lx, Ls, tk, 0, -Ls / 2)], cap0=True, cap1=True), 'M_corrugated',
              loc=(0, 0, zr), rot=Rr, uv='planar')
        for sd in (0.25, 1.55, 2.85, 4.15, 5.45):
            a = Rr @ Vector((-Lx / 2, -sd, -0.05))
            b = Rr @ Vector((Lx / 2, -sd, -0.05))
            m.beam(a + Vector((0, 0, zr)), b + Vector((0, 0, zr)), 0.06, 0.1, 'M_steel_dark',
                   up=tuple(Rr @ Vector((0, 0, 1))))
        for ex in (-Lx / 2, Lx / 2):
            a = Rr @ Vector((ex, 0, tk - 0.04)) + Vector((0, 0, zr))
            b = Rr @ Vector((ex, -Ls, tk - 0.04)) + Vector((0, 0, zr))
            m.beam(a, b, 0.025, 0.13, 'M_galv', up=tuple(Rr @ Vector((0, 0, 1))))
    ridge = [(-0.26, -0.087), (0, -0.002), (0.26, -0.087), (0.26, -0.075), (0, 0.01), (-0.26, -0.075)]
    m.add(loft([[(x, y, z + zr + tk + 0.06) for y, z in ridge] for x in (-Lx / 2 - 0.02, Lx / 2 + 0.02)],
               cap0=True, cap1=True), 'M_galv')
    m.footprint = [L + 0.1, Wd + 0.1]
    m.notes = ('Footprint = plinth; loading ramp adds 2 m toward +Z, roof overhangs 0.6 m (eaves) / 0.45 m (gables). '
               'Ridge along glTF X; rolling shutter on the front (+Z); staff door on the -X gable.')
    return m


def build_gate():
    """7 m farm entrance: two plastered pillars 0.6 x 0.6 x 2.4 with caps, MS arch on steel columns with the
    farm-name "SignBoard" (6 x 1.1, beam at 4.5 m), lanterns, and two swing leaves "GateLeafL"/"GateLeafR"
    (frame, bars with spear tops, kick plate, hinges, support wheel) pivoting at their hinge (node origin)."""
    m = Model('gate')
    hx = 3.5
    px = hx + 0.3
    sq = [(0.74, -0.05), (0.74, 0.3), (0.6, 0.36), (0.6, 2.4), (0.78, 2.4), (0.78, 2.5), (0.66, 2.56), (0.66, 2.62)]
    for s in (-1, 1):
        x = s * px
        m.add(loft([rect(w, w, z) for w, z in sq], cap1=True), lambda c, n: 'M_concrete' if c.z < 0.34 else 'M_plaster',
              loc=(x, 0, 0))
        m.add(box(0.2, 0.2, 3.43, z0=2.62), 'M_steel_dark', loc=(x, 0, 0))
        m.add(box(0.34, 0.34, 0.02, z0=2.62), 'M_steel_dark', loc=(x, 0, 0))
        m.beam((x, 0, 3.9), (s * (px - 0.75), 0, 4.5), 0.07, 0.07, 'M_steel_dark')  # knee braces
        m.add(box(0.24, 0.24, 0.32, z0=6.05), 'M_emissive_light', loc=(x, 0, 0))  # lanterns
        m.add(pyramid(0.34, 0.16), 'M_steel_dark', loc=(x, 0, 6.37))
    m.add(box(2 * px + 0.2, 0.15, 0.25), 'M_steel_dark', loc=(0, 0, 4.625))
    m.add(box(2 * px + 0.2, 0.12, 0.15), 'M_steel_dark', loc=(0, 0, 5.925))
    archp = [(-px + 2 * px * i / 14, 0, 6.02 + 0.55 * (1 - ((-px + 2 * px * i / 14) / px) ** 2)) for i in range(15)]
    m.tube(archp, 0.05, 'M_steel_dark', n=4, smooth=False)
    for xh in (-2.4, -1.2, 0.0, 1.2, 2.4):
        m.add(bars(0.04, 0.55 * (1 - (xh / px) ** 2) + 0.02), 'M_steel_dark', loc=(xh, 0, 6.0))
    for z in (4.725, 5.875):
        m.add(box(6.1, 0.06, 0.05), 'M_steel_dark', loc=(0, -0.08, z))
    for x in (-3.025, 3.025):
        m.add(box(0.05, 0.06, 1.2), 'M_steel_dark', loc=(x, -0.08, 5.3))
    m.node('SignBoard')
    sm, _, sb = node_mat('SignBoard')
    sb.inputs['Base Color'].default_value = (*lin('#f3f0e6'), 1)
    sb.inputs['Roughness'].default_value = 0.6
    sv, sf = box(6.0, 0.04, 1.1)
    suv = [[(0.0, 0.0)] * 4 for _ in range(6)]
    suv[0] = [(0, 0), (1, 0), (1, 1), (0, 1)]  # face 0 of the loft = the -Y (front) side
    m.add((sv, sf, suv), 'SignBoard', loc=(0, -0.08, 5.3))
    for s, name in ((-1, 'GateLeafL'), (1, 'GateLeafR')):
        xh, xf = s * (hx - 0.01), s * 0.015
        m.node(name, origin=(xh, 0, 0))
        wdt = abs(xh - xf)
        xc = (xh + xf) / 2
        for xe in (xh - s * 0.03, xf + s * 0.03):
            m.add(box(0.06, 0.06, 1.64, z0=0.08), 'M_steel_dark', loc=(xe, 0, 0))
        for z in (0.12, 0.8, 1.5):
            m.add(box(wdt - 0.12, 0.05, 0.05), 'M_steel_dark', loc=(xc, 0, z))
        m.add(box(wdt - 0.12, 0.012, 0.62), 'M_steel_dark', loc=(xc, 0.012, 0.46))  # kick plate
        n = round((wdt - 0.12) / 0.12)
        for i in range(1, n):
            xb = xh - s * 0.06 - s * (wdt - 0.12) * i / n
            m.add(bars(0.016, 1.6), 'M_steel_dark', loc=(xb, 0, 0.12))
            m.add(pyramid(0.03, 0.08), 'M_steel_dark', loc=(xb, 0, 1.72))
        for z in (0.3, 1.4):
            m.add(cyl(0.025, 0.12, 8), 'M_steel_dark', loc=(xh, 0.0, z - 0.06))
        m.add(cyl(0.065, 0.035, 12), 'M_rubber', loc=(xf + s * 0.12, -0.0175, 0.065), rot=(math.pi / 2, 0, 0))
        m.add(box(0.03, 0.06, 0.12), 'M_steel_dark', loc=(xf + s * 0.12, 0, 0.13))
    m.attach['sign_centre'] = (0, -0.1, 5.3)
    m.notes = ('Leaves swing about their node origin (the hinge, glTF Y axis); closed = rotation 0. '
               'SignBoard front face UV 0..1 (u left->right, v bottom->top seen from +Z).')
    return m


# ---------- vegetation ----------

def _leaflet(img, x0, y0, ang, L, W, col, curve=0.12, serr=0.0, rib=0.25):
    """Rasterise one lanceolate (optionally falcate, serrated) leaf blade into img (rows = +y)."""
    ca, sa = math.cos(ang), math.sin(ang)
    ext = L + W + abs(curve) * L
    h, w = img.shape[:2]
    bx0, bx1 = int(max(0, x0 - ext)), int(min(w, x0 + ext + 1))
    by0, by1 = int(max(0, y0 - ext)), int(min(h, y0 + ext + 1))
    if bx0 >= bx1 or by0 >= by1:
        return
    yy, xx = np.mgrid[by0:by1, bx0:bx1].astype(np.float32)
    dx, dy = xx - x0, yy - y0
    t = (dx * ca + dy * sa) / L
    v = (-dx * sa + dy * ca) - curve * L * t * t
    tc = np.clip(t, 0, 1)
    wd = W * np.sin(np.pi * tc) ** 0.75 * (1 + serr * np.sin(tc * 46))
    inside = (t > 0) & (t < 1) & (np.abs(v) < wd)
    if not inside.any():
        return
    q = np.abs(v) / np.maximum(wd, 1e-3)
    side = np.sign(v)
    shade = (1.0 - 0.28 * q ** 1.5) * (1 + 0.07 * side)
    c = np.asarray(col, np.float32)[None, None, :] * shade[..., None]
    if rib:
        mid = np.abs(v) < max(0.9, W * 0.07)
        c[mid] = np.asarray(col, np.float32) * (1 + rib)
    reg = img[by0:by1, bx0:bx1]
    reg[inside, :3] = c[inside]
    reg[inside, 3] = 1.0


def _stroke(img, pts, width, col):
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        L = math.hypot(bx - ax, by - ay)
        if L > 0.5:
            _leaflet(img, ax, ay, math.atan2(by - ay, bx - ax), L * 1.15, width, col, curve=0, rib=0)


def leaf_atlas(kind, size=1024, seed=1):
    """2x2 atlas of leaf sprays (RGBA, sRGB, row 0 = bottom), twig at the bottom centre of each tile.
    kind 'neem': pinnate compound leaves with falcate serrated leaflets; 'shrub': small glossy ovate leaves."""
    S = size * 2
    img = np.zeros((S, S, 4), np.float32)
    rng = np.random.default_rng(seed)
    T = S // 2
    for ti in range(4):
        tile = np.zeros((T, T, 4), np.float32)  # each spray drawn in its own tile (no bleed into neighbours)
        bx, by = T * 0.5, T * 0.03
        if kind == 'neem':
            tw = [(bx, by), (bx + rng.uniform(-0.03, 0.03) * T, T * 0.14)]
            _stroke(tile, tw, T * 0.008, (0.33, 0.26, 0.17))
            for k in range(rng.integers(10, 14)):
                wide = rng.random() < 0.35
                a = math.radians(90 + (rng.uniform(-80, 80) if wide else rng.uniform(-45, 45)))
                Ll = T * (rng.uniform(0.34, 0.44) if wide else rng.uniform(0.55, 0.78))
                base = (tw[1][0] + rng.uniform(-0.02, 0.02) * T, tw[1][1] + rng.uniform(-0.05, 0.03) * T)
                col = np.array([0.24, 0.42, 0.11]) * rng.uniform(0.82, 1.12) + rng.uniform(0, 0.06)
                if rng.random() < 0.15:
                    col = np.array([0.42, 0.56, 0.17])  # fresh flush
                bend = rng.uniform(-0.35, 0.35)
                rach = [(base[0] + Ll * tt * math.cos(a + bend * tt), base[1] + Ll * tt * math.sin(a + bend * tt))
                        for tt in np.linspace(0, 1, 9)]
                _stroke(tile, rach, T * 0.0035, (0.42, 0.45, 0.2))
                pairs = rng.integers(6, 9)
                for j in range(pairs):
                    tt = 0.18 + 0.78 * j / (pairs - 1)
                    px = base[0] + Ll * tt * math.cos(a + bend * tt)
                    py = base[1] + Ll * tt * math.sin(a + bend * tt)
                    at = a + bend * tt
                    lf = T * 0.115 * (1.1 - 0.35 * tt) * (Ll / (0.6 * T)) ** 0.5
                    for sd in (-1, 1):
                        _leaflet(tile, px, py, at + sd * rng.uniform(0.75, 1.05), lf, lf * 0.18,
                                 col * rng.uniform(0.9, 1.08), curve=-sd * 0.14, serr=0.12)
                _leaflet(tile, rach[-1][0], rach[-1][1], a + bend, T * 0.075, T * 0.013, col, curve=0.05, serr=0.12)
        else:
            tw = [(bx, by), (bx + rng.uniform(-0.05, 0.05) * T, T * 0.5)]
            _stroke(tile, tw, T * 0.01, (0.3, 0.24, 0.16))
            for k in range(rng.integers(55, 70)):
                py = T * rng.uniform(0.12, 0.92)
                px = bx + rng.normal(0, 0.2) * T * min(1.0, py / (0.5 * T))
                a = math.atan2(py - by, px - bx) + rng.uniform(-0.7, 0.7)
                col = np.array([0.13, 0.33, 0.09]) * rng.uniform(0.8, 1.3)
                lf = T * rng.uniform(0.11, 0.16)
                _leaflet(tile, px, py, a, lf, lf * 0.3, col, curve=rng.uniform(-0.1, 0.1), rib=0.35)
        ox, oy = (ti % 2) * T, (ti // 2) * T
        img[oy:oy + T, ox:ox + T] = tile
    img = img.reshape(size, 2, size, 2, 4).mean(axis=(1, 3))
    a = img[..., 3:4]
    leaf = a[..., 0] > 0.02
    img[..., :3] = np.where(a > 0.02, img[..., :3] / np.maximum(a, 1e-4), 0)
    img[~leaf, :3] = img[leaf, :3].mean(axis=0)  # bleed colour under the cut-out (no dark mip halos)
    return np.clip(img, 0, 1)


def _perp(d, rng):
    t = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
    e = d.cross(t)
    return e.normalized() if e.length > 1e-4 else d.orthogonal().normalized()


def _rot_away(d, ang, rng):
    return (Matrix.Rotation(ang, 3, _perp(d, rng)) @ d).normalized()


def leaf_cards(m, clusters, rng, n_total, size=(0.55, 0.9), flat=0.75, up=0.3, tiles=4):
    """Alpha leaf cards around cluster centres; vertex normals follow the crown ellipsoid (soft volume shading)."""
    cs = [c for c, _ in clusters]
    cc = sum(cs, Vector()) / len(cs)
    ext = Vector([max(abs(c[i] - cc[i]) for c in cs) + 1.0 for i in range(3)])
    per = max(4, n_total // len(clusters))
    V, F, UV, N = [], [], [], []
    for C, rc in clusters:
        for _ in range(per):
            o = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1) * flat)).normalized()
            P = C + o * rc * rng.uniform(0.25, 1.0)
            out = P - cc
            d = (o * 0.6 + out.normalized() * 0.4 + Vector((0, 0, up))
                 + Vector((rng.uniform(-.3, .3), rng.uniform(-.3, .3), rng.uniform(-.3, .3)))).normalized()
            e = _perp(d, rng)
            sz = rng.uniform(*size)
            B = P - d * sz * 0.35
            k = len(V)
            V += [B - e * sz / 2, B + e * sz / 2, B + e * sz / 2 + d * sz, B - e * sz / 2 + d * sz]
            F.append((k, k + 1, k + 2, k + 3))
            ti = rng.randrange(tiles)
            tu, tv = (ti % 2) * 0.5, (ti // 2) * 0.5
            UV.append([(tu + 0.005, tv + 0.005), (tu + 0.495, tv + 0.005), (tu + 0.495, tv + 0.495), (tu + 0.005, tv + 0.495)])
            for q in V[k:]:
                g = Vector(((q.x - cc.x) / ext.x ** 2, (q.y - cc.y) / ext.y ** 2, (q.z - cc.z) / ext.z ** 2))
                N.append((g.normalized() + Vector((0, 0, 0.25))).normalized())
    m.add(([tuple(v) for v in V], F, UV), m.leaf_mat, normals=N, smooth=True)
    return cc, ext


def build_tree_neem(variant):
    """Neem (broadleaf, mango-like) tree 7-10 m: flared trunk, scaffold limbs, branches and twigs (M_bark, smooth
    tapered tubes) + "Canopy" of alpha leaf cards (procedural pinnate-leaf atlas) clumped at the twig ends."""
    name = f'tree_neem_{variant}'
    m = Model(name)
    rng = random.Random(1000 + variant)
    th, tr, nlimb, llen, height_bias = ((2.4, 0.25, 4, 3.5, 0.0), (1.9, 0.21, 3, 3.6, 0.3))[variant - 1]
    m.leaf_mat = 'NeemLeaves'
    tex_mat('NeemLeaves', image('neem_leaves', leaf_atlas('neem', 1024, seed=variant), alpha=True), rough=0.7, alpha=True)
    wood, clusters = [], []

    def limb(p0, d, length, r0, r1, nseg, sides, wob, lift):
        pts, rad = [Vector(p0)], [r0]
        p, dd = Vector(p0), Vector(d).normalized()
        for i in range(1, nseg + 1):
            dd = (dd + Vector((rng.uniform(-wob, wob), rng.uniform(-wob, wob), rng.uniform(-wob, wob) + lift))).normalized()
            p = p + dd * (length / nseg)
            pts.append(p.copy())
            rad.append(r0 + (r1 - r0) * i / nseg)
        wood.append((pts, rad, sides))
        return pts, rad

    def at(pts, rad, t):
        f = t * (len(pts) - 1)
        i = min(int(f), len(pts) - 2)
        u = f - i
        return pts[i].lerp(pts[i + 1], u), rad[i] + (rad[i + 1] - rad[i]) * u, (pts[i + 1] - pts[i]).normalized()

    lean = Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 1)).normalized()
    tp, trad = limb((0, 0, 0), lean, th, tr * 1.25, tr * 0.8, 4, 8, 0.05, 0.0)
    for k in range(4):  # root flare
        a = 2 * math.pi * (k + rng.uniform(-0.2, 0.2)) / 4
        c, sn = math.cos(a), math.sin(a)
        wood.append(([Vector((0, 0, 0.45)), Vector((0.28 * c, 0.28 * sn, 0.12)), Vector((0.62 * c, 0.62 * sn, -0.03))],
                     [tr * 0.55, tr * 0.38, 0.03], 5))
    a0 = rng.uniform(0, 2 * math.pi)
    for i in range(nlimb):
        a = a0 + 2 * math.pi * i / nlimb + rng.uniform(-0.35, 0.35)
        e = math.radians(rng.uniform(30, 50) + height_bias * 20)
        base, br, _ = at(tp, trad, rng.uniform(0.85, 1.0))
        d = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
        lp, lr = limb(base, d, llen * rng.uniform(0.85, 1.1), br * 0.72, br * 0.25, 4, 6, 0.18, 0.06)
        for t2 in (0.38, 0.58, 0.78, 1.0):
            b2, r2, d2 = at(lp, lr, t2)
            dd2 = _rot_away(d2, math.radians(rng.uniform(25, 50)), rng)
            dd2 = (dd2 + Vector((0, 0, 0.25))).normalized()
            l2 = llen * rng.uniform(0.45, 0.62) * (1.15 - 0.3 * t2)
            p2, rr2 = limb(b2, dd2, l2, max(0.03, r2 * 0.7), 0.025, 3, 5, 0.25, 0.08)
            clusters.append((p2[-1] + dd2 * 0.3, rng.uniform(1.1, 1.4)))
            for t3 in (0.5, 0.8, 1.0):
                b3, r3, d3 = at(p2, rr2, t3)
                dd3 = (_rot_away(d3, math.radians(rng.uniform(30, 55)), rng) + Vector((0, 0, 0.2))).normalized()
                p3, _ = limb(b3, dd3, l2 * rng.uniform(0.4, 0.55), max(0.018, r3 * 0.7), 0.01, 1, 3, 0.2, 0.05)
                clusters.append((p3[-1] + dd3 * 0.25, rng.uniform(0.9, 1.15)))
    wood_tris = 0
    for pts, rad, sides in wood:
        g = sweep([tuple(q) for q in pts], rad, sides, cap0=False, cap1=False)
        wood_tris += 2 * len(g[1])
        m.add(g, 'M_bark', smooth=True)
    m.node('Canopy', normals='custom')
    cc, ext = leaf_cards(m, clusters, rng, (3950 - wood_tris) // 2, size=(0.85, 1.35))
    m.attach['crown_centre'] = tuple(cc)
    m.footprint = [1.2, 1.2]
    m.notes = ('Footprint = trunk zone (crown spreads ~%.0f m, see bounds). Canopy: alpha-MASK double-sided cards with '
               'outward crown normals -- render without the back-face normal flip (or accept darker backs).' % (2 * ext.x - 2))
    return m


def palm_atlas(size=1024, seed=3):
    """Palmyra atlas: u 0-0.44 green fan leaf, 0.44-0.88 dry fan leaf (u = across the fan, v = hastula -> tips),
    0.88-1 trunk strip (u = around, v = ground -> crown: ringed grey bark, leaf-base boot at the top)."""
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 4), np.float32)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    v = yy / (size - 1)
    for u0, u1, base, dry in ((0.0, 0.44, (0.27, 0.42, 0.18), False), (0.44, 0.88, (0.48, 0.37, 0.22), True)):
        x0, x1 = int(u0 * size), int(u1 * size)
        u = (xx[:, x0:x1] - x0) / (x1 - x0)
        vv = v[:, x0:x1]
        nseg = 46
        sidx = np.minimum((u * nseg).astype(int), nseg - 1)
        f = u * nseg - sidx
        split = 0.5 + 0.12 * rng.random(nseg)[sidx] - (0.12 if dry else 0)
        tip = 0.9 + 0.1 * rng.random(nseg)[sidx] - (0.15 * rng.random(nseg)[sidx] if dry else 0)
        k = np.clip((vv - split) / np.maximum(tip - split, 1e-3), 0, 1)
        halfw = 0.5 - 0.42 * k ** 1.3
        alpha = ((vv < split) | (np.abs(f - 0.5) < halfw)) & (vv < tip) & (vv > 0.015)
        if dry:
            alpha &= rng.random(nseg)[sidx] > 0.12
        fold = 0.82 + 0.3 * np.abs(f - 0.5) * 2 * np.where(sidx % 2 == 0, 1.0, -0.6)
        col = np.asarray(base, np.float32)[None, None, :] * fold[..., None]
        col *= (0.75 + 0.35 * vv)[..., None]
        if dry:
            col *= (0.85 + 0.3 * rng.random(nseg)[sidx])[..., None]
        rib = np.abs(f - 0.5) < 0.05
        col[rib] *= 1.18
        img[:, x0:x1, :3] = col
        img[:, x0:x1, 3] = alpha
    x0 = int(0.88 * size)
    tv = v[:, x0:]
    tu = (xx[:, x0:] - x0) / (size - x0)
    ring = np.abs(np.sin(tv * math.pi * 75 + 0.15 * np.sin(tu * 2 * math.pi * 2))) < 0.22
    bark = np.full(tv.shape + (3,), 0.24, np.float32) * (0.85 + 0.25 * rng.random(tv.shape))[..., None]
    bark[ring] *= 0.6
    boot = tv > 0.87
    cross = (np.abs(np.sin((tu * 9 + tv * 60) * math.pi)) < 0.35) | (np.abs(np.sin((tu * 9 - tv * 60) * math.pi)) < 0.35)
    bootc = np.where(cross[..., None], np.array([0.2, 0.16, 0.12]), np.array([0.32, 0.26, 0.18]))
    bark[boot] = bootc[boot]
    img[:, x0:, :3] = bark
    img[:, x0:, 3] = 1.0
    leaf = img[..., 3] > 0.5
    img[~leaf, :3] = img[leaf, :3].mean(axis=0)
    return np.clip(img, 0, 1)


def build_palm_palmyra(variant):
    """Palmyra palm (Borassus) 10-14 m: swollen-based, slightly curved ringed trunk with a leaf-base boot under the
    crown, ~28 pleated fan leaves on spiny petioles in a spherical crown, dry brown leaves hanging below."""
    name = f'palm_palmyra_{variant}'
    m = Model(name)
    rng = random.Random(2000 + variant)
    H, lean = ((11.2, 0.55), (9.6, 0.9))[variant - 1]
    tex_mat('PalmyraAtlas', image('palmyra_atlas', palm_atlas(1024, seed=variant), alpha=True), rough=0.75, alpha=True)
    az = rng.uniform(0, 2 * math.pi)
    ld = Vector((math.cos(az), math.sin(az), 0))
    nr, sides = 14, 8
    pts, rad = [], []
    for i in range(nr + 1):
        t = i / nr
        p = ld * lean * t * t + Vector((0, 0, H * t))
        r = 0.42 - 0.1 * min(1, t / 0.12) + 0.03 * math.sin(math.pi * t) + (0.12 if t > 0.88 else 0)
        pts.append(p)
        rad.append(r)
    g = sweep([tuple(q) for q in pts], rad, sides, cap0=False, cap1=True)
    tu0, tu1, Ht = 0.885, 0.995, pts[-1].z
    fuv = []  # trunk strip of the atlas: u around, v = height fraction (rings + leaf-base boot baked in)
    for fi, face in enumerate(g[1]):
        if len(face) == 4:
            i, j = divmod(fi, sides)
            va, vb = 0.995 * pts[i].z / Ht, 0.995 * pts[i + 1].z / Ht
            ua, ub = tu0 + (tu1 - tu0) * j / sides, tu0 + (tu1 - tu0) * (j + 1) / sides
            fuv.append([(ua, va), (ub, va), (ub, vb), (ua, vb)])
        else:
            fuv.append([(0.94, 0.99)] * len(face))
    m.add((g[0], g[1], fuv), 'PalmyraAtlas', smooth=True)
    top = pts[-1] + Vector((0, 0, 0.15))

    def fan(origin, d, R, spread, green, droop):
        """Pleated, cupped fan leaf on a petiole from `origin` along d."""
        side = d.cross(Vector((0, 0, 1)))
        side = side.normalized() if side.length > 1e-3 else Vector((1, 0, 0))
        nrm = side.cross(d).normalized()
        if nrm.z < 0:
            nrm = -nrm
        pl = rng.uniform(1.0, 1.4)
        pe = origin + d * pl - nrm * 0.12 * pl * droop
        pg = sweep([tuple(origin), tuple(origin + d * pl * 0.5 - nrm * 0.03 * droop), tuple(pe)], [0.035, 0.03, 0.025],
                   4, False, False)
        stem = (0.2, 0.05) if green else (0.66, 0.05)
        m.add((pg[0], pg[1], [[stem] * len(f) for f in pg[1]]), 'PalmyraAtlas', smooth=True)
        ns, rings = 12, (0.06, 0.5, 1.0)
        V, F, UV = [], [], []
        ua, ub = (0.0, 0.44) if green else (0.44, 0.88)
        for i in range(ns + 1):
            ph = -spread / 2 + spread * i / ns
            for r in rings:
                rr = r * R
                z = (0.05 * rr if i % 2 else -0.02 * rr) - droop * 0.32 * rr * r - 0.12 * rr * abs(math.sin(ph)) * r
                q = pe + d * (math.cos(ph) * rr) + side * (math.sin(ph) * rr) + nrm * z
                V.append(tuple(q))
                UV.append((ua + (ub - ua) * (0.02 + 0.96 * i / ns), 0.02 + 0.97 * r))
        for i in range(ns):
            for j in range(len(rings) - 1):
                a, b = i * 3 + j, (i + 1) * 3 + j
                F.append((a, b, b + 1, a + 1))
        m.add((V, F, [[UV[k] for k in f] for f in F]), 'PalmyraAtlas', smooth=True)

    golden = math.pi * (3 - math.sqrt(5))
    n = 28
    for k in range(n):
        el = math.radians(80 - 115 * (k / (n - 1)) ** 0.85 + rng.uniform(-6, 6))
        a = k * golden + rng.uniform(-0.2, 0.2)
        d = Vector((math.cos(el) * math.cos(a), math.cos(el) * math.sin(a), math.sin(el)))
        fan(top, d, rng.uniform(1.1, 1.3), math.radians(rng.uniform(190, 220)), True, 0.45 + 0.45 * (1 - math.sin(max(0, el))))
    for k in range(6):
        a = rng.uniform(0, 2 * math.pi)
        el = math.radians(rng.uniform(-82, -65))
        d = Vector((math.cos(el) * math.cos(a), math.cos(el) * math.sin(a), math.sin(el)))
        fan(top - Vector((0, 0, 0.35)), d, rng.uniform(0.9, 1.05), math.radians(rng.uniform(110, 150)), False, 0.2)
    m.footprint = [1.0, 1.0]
    m.attach['crown_centre'] = tuple(top)
    m.notes = 'Footprint = trunk; crown ~4.5 m across (see bounds). One alpha-MASK double-sided atlas material.'
    return m


def build_shrub():
    """1.2 m flowering-hedge type bush: a few woody stems + mound of small glossy leaf cards."""
    m = Model('shrub')
    rng = random.Random(3000)
    m.leaf_mat = 'ShrubLeaves'
    tex_mat('ShrubLeaves', image('shrub_leaves', leaf_atlas('shrub', 512, seed=5), alpha=True), rough=0.55, alpha=True)
    clusters = []
    for k in range(5):
        a = 2 * math.pi * k / 5 + rng.uniform(-0.3, 0.3)
        d = Vector((0.35 * math.cos(a), 0.35 * math.sin(a), 1)).normalized()
        tip = d * rng.uniform(0.6, 0.8)
        m.tube([(0, 0, 0), tuple(tip * 0.5), tuple(tip)], [0.025, 0.018, 0.01], 'M_bark', n=3, caps=False, smooth=True)
        clusters.append((tip, 0.42))
    for k in range(6):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.25, 0.5)
        clusters.append((Vector((r * math.cos(a), r * math.sin(a), rng.uniform(0.35, 0.75))), 0.4))
    m.node('Canopy', normals='custom')
    leaf_cards(m, clusters, rng, 340, size=(0.4, 0.6), flat=0.85, up=0.2)
    m.notes = 'Canopy: alpha-MASK double-sided cards with outward normals.'
    return m


# ---------- utility buildings ----------

def psc_ring(z, H):
    """Tapered I-section of an Indian PSC pole (broad faces +-Y recessed) at height z of an H tall pole."""
    f = z / H
    hx, hy = 0.14 + (0.075 - 0.14) * f, 0.08 + (0.055 - 0.08) * f
    fl, e = 0.035 - 0.012 * f, 0.016 - 0.006 * f
    return [(hx, -hy, z), (hx, hy, z), (hx - fl, hy, z), (hx - fl, hy - e, z), (-hx + fl, hy - e, z), (-hx + fl, hy, z),
            (-hx, hy, z), (-hx, -hy, z), (-hx + fl, -hy, z), (-hx + fl, -hy + e, z), (hx - fl, -hy + e, z), (hx - fl, -hy, z)]


def small_room(m, cx, cy, W, D, zp, zr, cuts, wall='M_brick', slab=0.15, over=0.15):
    """Load-bearing room: plinth, walls (with recess cuts), projecting RCC roof slab."""
    m.add(loft([rect(W + 0.1, D + 0.1, -0.05), rect(W + 0.1, D + 0.1, zp)], cap1=True), 'M_concrete', loc=(cx, cy, 0))
    walls = loft([rect(W, D, zp, cx, cy), rect(W, D, zr - slab, cx, cy)], cap0=True, cap1=True)
    m.add(cut(walls, cuts) if cuts else walls, wall)
    m.add(box(W + 2 * over, D + 2 * over, slab, z0=zr - slab), 'M_concrete', loc=(cx, cy, 0))
    m.add(ring_band(W - 0.1, D - 0.1, zr, zr + 0.12, 0.04), 'M_concrete', loc=(cx, cy, 0))  # roof parapet kerb


def mesh_door(m, face, along, zs, w, h, hx, hy, c=(0, 0), depth=0.08):
    """Double-leaf steel frame door with welded-mesh infill (grid of rods)."""
    p, R = on_wall(face, along, zs, hx, hy, c)
    put = placer(m, p, R)
    y = depth - 0.03
    for lx in (-w / 2 + 0.03, 0.0, w / 2 - 0.03):
        put(box(0.05 if lx else 0.07, 0.05, h), 'M_steel_dark', lx, y, h / 2)
    for lz in (0.03, h * 0.45, h - 0.03):
        put(box(w, 0.05, 0.05), 'M_steel_dark', 0, y, lz)
    for i in range(1, 14):
        put(bars(0.012, h - 0.06), 'M_steel_dark', -w / 2 + w * i / 14, y + 0.012, 0.03)
    for i in range(1, 18):
        lz = 0.03 + (h - 0.06) * i / 18
        put(loft([rect(w - 0.06, 0.008, lz - 0.006), rect(w - 0.06, 0.008, lz + 0.006)]), 'M_steel_dark', 0, y + 0.02, 0)
    put(box(0.04, 0.06, 0.16), 'M_steel_dark', 0.08, y - 0.04, 1.05)
    return recess(p, R, w, h, depth)


def build_generator_room():
    """4 x 3 m brick generator room with RCC roof and a welded-mesh double door; beside it the "DGSet": yellow
    acoustic canopy 2.6 x 1.1 x 1.5 on a base skid, louvres, control-panel door, exhaust up past the roof + rain cap."""
    m = Model('generator_room')
    W, D, zp, zr = 4.0, 3.0, 0.3, 3.0
    cx = -0.75
    hx, hy = W / 2, D / 2
    cuts = [mesh_door(m, '-y', 0.0, zp, 1.6, 2.2, hx, hy, c=(cx, 0)),
            vent(m, '+y', 0.8, 2.2, 0.9, 0.45, hx, hy, c=(cx, 0))]
    small_room(m, cx, 0, W, D, zp, zr, cuts)
    m.add(box(0.22, 0.09, 0.12), 'M_emissive_light', loc=(cx + 1.05, -hy - 0.045, zp + 2.45))
    # DG set beside the room (control end to the front)
    m.node('DGSet')
    gx, L, Wc, Hc = cx + hx + 0.55 + 0.55, 2.6, 1.1, 1.5
    m.add(loft([rect(Wc + 0.1, L + 0.1, 0.0), rect(Wc + 0.1, L + 0.1, 0.16)], cap1=True), 'M_steel_dark', loc=(gx, 0, 0))
    m.add(box(Wc, L, Hc - 0.16, z0=0.16), 'M_paint_yellow', loc=(gx, 0, 0), bevel=0.035)
    for sx in (-1, 1):  # side intake louvres
        for yc in (-0.55, 0.55):
            put = placer(m, Vector((gx + sx * (Wc / 2 + 0.002), yc, 0.45)), Matrix.Rotation(sx * math.pi / 2, 3, 'Z'))
            put(quad(0.8, 0.7), 'M_steel_dark', 0, 0, 0)
            for k in range(6):
                put(box(0.82, 0.07, 0.015), 'M_paint_yellow', 0, -0.025, 0.08 + k * 0.11, rot=(math.radians(35), 0, 0))
    put = placer(m, Vector((gx, L / 2 + 0.002, 0.35)), Matrix.Rotation(math.pi, 3, 'Z'))  # radiator outlet louvre
    put(quad(0.85, 0.9), 'M_steel_dark', 0, 0, 0)
    for k in range(8):
        put(box(0.87, 0.07, 0.015), 'M_paint_yellow', 0, -0.025, 0.07 + k * 0.11, rot=(math.radians(35), 0, 0))
    put = placer(m, Vector((gx, -L / 2 - 0.002, 0.3)), Matrix.Identity(3))  # control-panel door
    put(box(0.8, 0.02, 1.0), 'M_paint_yellow', 0, -0.01, 0.5, bevel=0.008)
    put(box(0.26, 0.012, 0.16), 'M_steel_dark', 0, -0.026, 0.78)  # controller display window
    put(box(0.03, 0.04, 0.14), 'M_steel_dark', 0.32, -0.04, 0.5)
    for zh in (0.15, 0.85):
        put(cyl(0.012, 0.06, 6), 'M_steel_dark', -0.41, -0.02, zh)
    for yl in (-0.85, 0.85):  # lifting eyes
        m.add(sweep([(gx - 0.06, yl, Hc - 0.01), (gx - 0.06, yl, Hc + 0.07), (gx + 0.06, yl, Hc + 0.07), (gx + 0.06, yl, Hc - 0.01)],
                    0.012, 4, False, False), 'M_steel_dark')
    ex = Vector((gx + 0.25, 0.75, Hc))
    m.add(cyl(0.09, 0.06, 10, cap1=False), 'M_steel_dark', loc=tuple(ex))  # exhaust flange
    m.tube([tuple(ex), tuple(ex + Vector((0, 0, 0.5))), (ex.x, 1.15, Hc + 0.9), (ex.x, 1.15, zr + 1.1)], 0.055, 'M_rust', n=10)
    cap_p = Vector((ex.x, 1.15, zr + 1.1))
    m.add(cyl(0.065, 0.006, 10), 'M_steel_dark', loc=tuple(cap_p + Vector((0, 0.0, 0.03))), rot=(math.radians(-30), 0, 0))
    m.tube([(gx - Wc / 2 - 0.05, -0.3, 0.12), (cx + hx + 0.06, -0.3, 0.12), (cx + hx + 0.06, -0.3, 0.9)], 0.03, 'M_steel_dark', n=6)
    m.notes = 'DGSet (separate node) beside the room on +X; control door faces +Z; exhaust stack top ~%.1f m.' % (zr + 1.15)
    return m


def build_pump_house():
    """2.5 x 2.5 m brick pump room, RCC roof, steel door; outside: borewell head (casing, cap, GI delivery with
    gate valve, non-return valve, pressure gauge) running into the wall, and a starter box with conduit on the wall."""
    m = Model('pump_house')
    W, D, zp, zr = 2.5, 2.5, 0.3, 2.8
    cx = -0.55
    hx, hy = W / 2, D / 2
    cuts = [door(m, '-y', 0.0, zp, 0.9, 2.0, hx, hy, chajja=0.5, c=(cx, 0), chajja_mat='M_concrete')]
    small_room(m, cx, 0, W, D, zp, zr, cuts)
    wx = cx + hx  # +X wall face
    bx, by = 1.35, -0.55
    m.add(loft([rect(1.0, 1.0, -0.05), rect(0.96, 0.96, 0.15)], cap1=True), 'M_concrete', loc=(bx, by, 0))
    m.add(cyl(0.085, 0.42, 14, z0=0.15), 'M_galv', loc=(bx, by, 0))  # 6" casing
    m.add(cyl(0.13, 0.05, 14, z0=0.57), 'M_galv', loc=(bx, by, 0))  # well cap flange
    zp_ = 0.62
    m.tube([(bx, by, zp_), (bx, by, 0.95), (bx - 0.15, by, 0.95), (wx + 0.05, by, 0.95)], 0.032, 'M_galv', n=8)
    vx = bx - 0.45
    m.add(box(0.14, 0.12, 0.13), 'M_steel_dark', loc=(vx, by, 0.95))  # gate valve
    m.add(cyl(0.012, 0.12, 6), 'M_steel_dark', loc=(vx, by, 0.95))
    m.add(cyl(0.075, 0.016, 12), 'M_paint_red', loc=(vx, by, 1.08))  # handwheel
    m.add(cyl(0.055, 0.16, 10), 'M_steel_dark', loc=(bx - 0.2, by, 0.95), rot=(0, math.pi / 2, 0))  # NRV
    m.add(cyl(0.008, 0.1, 6), 'M_galv', loc=(bx - 0.78, by, 0.97))
    m.add(cyl(0.045, 0.025, 12), 'M_galv', loc=(bx - 0.78, by - 0.0, 1.09), rot=(math.pi / 2, 0, 0))  # gauge
    # starter box (DOL starter) with rain hood + conduits
    sy = -0.5
    m.add(box(0.2, 0.42, 0.55), 'M_paint_grey', loc=(wx + 0.1, sy, 1.55), bevel=0.012)
    m.add(box(0.28, 0.5, 0.025), 'M_paint_grey', loc=(wx + 0.13, sy, 1.85), rot=(0, math.radians(-12), 0))
    m.add(cyl(0.022, 0.03, 8), 'M_paint_red', loc=(wx + 0.2, sy - 0.08, 1.62), rot=(0, math.pi / 2, 0))
    m.add(cyl(0.022, 0.03, 8), 'M_galv', loc=(wx + 0.2, sy + 0.08, 1.62), rot=(0, math.pi / 2, 0))
    m.tube([(wx + 0.07, sy, 1.27), (wx + 0.07, sy, 0.12), (bx - 0.1, sy, 0.12), (bx - 0.1, by + 0.1, 0.16)], 0.016,
           'M_steel_dark', n=6)
    m.tube([(wx + 0.07, sy + 0.12, 1.83), (wx + 0.07, sy + 0.12, zr - 0.25), (wx + 0.25, sy + 0.12, zr - 0.25)], 0.012,
           'M_steel_dark', n=6)
    m.attach['delivery'] = (bx, by, 0.95)
    m.notes = 'Borewell head on the front-right; delivery pipe enters the +X wall at 0.95 m.'
    return m


def build_security_cabin():
    """2.4 x 2.4 m plastered security cabin: plinth + step, windows with grills on the front and both sides, door on
    the front, mono-pitch GI roof (falls to the back) with overhangs and fascia, lamp."""
    m = Model('security_cabin')
    W, D, zp = 2.4, 2.4, 0.3
    hx, hy = W / 2, D / 2
    zf, zb = 2.85, 2.55
    m.add(loft([rect(W + 0.1, D + 0.1, -0.05), rect(W + 0.1, D + 0.1, zp)], cap1=True), 'M_concrete')
    m.add(loft([rect(1.0, 0.35, -0.05), rect(1.0, 0.35, 0.15)], cap1=True), 'M_concrete', loc=(-0.55, -hy - 0.225, 0))
    cuts = [door(m, '-y', -0.55, zp, 0.8, 2.0, hx, hy, chajja=0)]
    cuts.append(window(m, '-y', 0.5, zp + 0.85, 0.9, 1.0, hx, hy, chajja=0))
    cuts += [window(m, f, 0.0, zp + 0.85, 1.2, 1.0, hx, hy, chajja=0) for f in ('-x', '+x')]
    prof = [(-hy, zp), (hy, zp), (hy, zb), (-hy, zf)]
    mass = loft([[(-hx, y, z) for y, z in prof], [(hx, y, z) for y, z in prof]], cap0=True, cap1=True)
    m.add(cut(mass, cuts), 'M_plaster')
    pt = math.atan2(zf - zb, D)
    of, ob, osd = 0.55, 0.3, 0.3
    Ls = (D + of + ob) / math.cos(pt)
    Rr = Matrix.Rotation(-pt, 3, 'X')
    y0 = -hy - of
    top0 = Vector((0, y0, zf + of * math.tan(pt) + 0.06))
    m.add(loft([rect(W + 2 * osd, Ls, 0, 0, Ls / 2), rect(W + 2 * osd, Ls, 0.03, 0, Ls / 2)], cap0=True, cap1=True),
          'M_corrugated', loc=tuple(top0), rot=Rr, uv='planar')
    for sd in (0.4, Ls / 2, Ls - 0.35):  # purlins
        a = top0 + Rr @ Vector((-(W / 2 + osd), sd, -0.04))
        b = top0 + Rr @ Vector((W / 2 + osd, sd, -0.04))
        m.beam(a, b, 0.05, 0.07, 'M_steel_dark', up=tuple(Rr @ Vector((0, 0, 1))))
    m.add(box(W + 2 * osd + 0.02, 0.025, 0.14), 'M_steel_dark', loc=tuple(top0 + Vector((0, -0.01, -0.04))))  # fascia
    m.add(box(0.22, 0.09, 0.12), 'M_emissive_light', loc=(-0.55, -hy - 0.045, zp + 2.2))
    m.notes = 'Door + window on the front (+Z), windows on both sides; roof falls to the back.'
    return m


def build_transformer():
    """Double-pole (2 x 9 m PSC, 2.5 m apart) distribution transformer structure: channel platform at 3 m with a
    100 kVA transformer (tank, radiator fins, HV/LV bushings, conservator, breather), AB switch with operating rod,
    drop-out fuses, lightning arresters, top crossarm with pin insulators, jumpers and LT box with cable."""
    m = Model('transformer')
    H, sx = 7.5, 1.25
    for x in (-sx, sx):
        m.add(loft([psc_ring(0.0, H), psc_ring(H, H)], cap1=True), 'M_concrete', loc=(x, 0, 0))
    cm = Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0))).transposed()  # channel along X, flanges toward +Y (the poles)

    def arm(z, y, length=3.2):
        m.add(prism(C_profile(0.1, 0.05, 0.006), length), 'M_galv', loc=(-length / 2, y, z), rot=cm)

    zpf = 3.0
    hy0 = 0.08 + (0.055 - 0.08) * zpf / H
    arm(zpf, -hy0 - 0.05)
    m.add(prism(C_profile(0.1, 0.05, 0.006), 3.2), 'M_galv', loc=(3.2 / 2, hy0 + 0.05, zpf),
          rot=Matrix(((0, -1, 0), (0, 0, 1), (-1, 0, 0))).transposed())
    for x in (-0.45, 0.45):
        m.beam((x, -0.75, zpf + 0.05), (x, 0.75, zpf + 0.05), 0.08, 0.08, 'M_galv')
    for x in (-sx, sx):
        for yy in (-hy0 - 0.03, hy0 + 0.03):
            m.beam((x, yy, 2.2), (x * 0.55, yy, zpf - 0.04), 0.05, 0.05, 'M_galv', up=(0, 1, 0))
    # transformer
    tz = zpf + 0.1
    m.add(box(0.95, 0.62, 0.95, z0=tz - 0.06), 'M_paint_grey')
    m.add(box(1.03, 0.7, 0.05, z0=tz + 0.89), 'M_paint_grey')
    for side in (-1, 1):  # radiator fins
        for k in range(7):
            m.add(loft([rect(0.025, 0.2, tz + 0.05, 0, 0), rect(0.025, 0.2, tz + 0.8, 0, 0)]), 'M_paint_grey',
                  loc=(-0.39 + k * 0.13, side * 0.41, 0))
    ztop = tz + 0.94
    hvb = [(-0.3, 0.12), (0.0, 0.12), (0.3, 0.12)]
    for x, y in hvb:
        m.add(revolve([(0.06, 0.0), (0.085, 0.07), (0.045, 0.14), (0.075, 0.22), (0.02, 0.33)], 6), 'M_paint_white',
              loc=(x, y, ztop), smooth=True)
    for k in range(4):
        m.add(cyl(0.035, 0.13, 6, cap0=False, r1=0.015), 'M_paint_white', loc=(-0.3 + 0.2 * k, -0.2, ztop), smooth=True)
    m.add(cyl(0.13, 0.7, 10), 'M_paint_grey', loc=(-0.35, 0.18, ztop + 0.38), rot=(0, math.pi / 2, 0))  # conservator
    for x in (-0.25, 0.25):
        m.add(box(0.04, 0.04, 0.26, z0=ztop), 'M_paint_grey', loc=(x, 0.18, 0))
    m.add(cyl(0.035, 0.18, 8), 'M_paint_grey', loc=(0.42, 0.18, ztop + 0.05))  # silica-gel breather
    # crossarms: drop-out fuses (4.4 m), lightning arresters (5.2 m), AB switch (6.2 m), line arm (7.2 m)
    for z in (4.4, 5.2, 6.2):
        hyz = 0.08 + (0.055 - 0.08) * z / H
        m.add(box(3.2, 0.06, 0.08), 'M_galv', loc=(0, -hyz - 0.03, z))
    arm(H - 0.3, -(0.08 + (0.055 - 0.08) * (H - 0.3) / H) - 0.05)
    yc = lambda z: -(0.08 + (0.055 - 0.08) * z / H) - 0.075
    for x in (-0.6, 0.0, 0.6):
        z = 4.4 + 0.05
        m.add(revolve([(0.035, 0.0), (0.055, 0.05), (0.03, 0.14)], 5), 'M_paint_white', loc=(x, yc(4.4), z), smooth=True)
        m.add(cyl(0.025, 0.34, 6), 'M_steel_dark', loc=(x, yc(4.4) - 0.07, z + 0.12), rot=(math.radians(18), 0, 0))
        m.add(revolve([(0.04, 0.0), (0.058, 0.07), (0.04, 0.15), (0.02, 0.24)], 5), 'M_steel_dark', loc=(x, yc(5.2), 5.25),
              smooth=True)  # lightning arrester
        for dx in (-0.12, 0.12):  # AB switch posts
            m.add(revolve([(0.04, 0.0), (0.055, 0.07), (0.03, 0.18)], 5), 'M_paint_white', loc=(x + dx, yc(6.2), 6.25),
                  smooth=True)
        m.add(box(0.3, 0.02, 0.03), 'M_galv', loc=(x, yc(6.2), 6.45))
        m.add(revolve([(0.03, 0.0), (0.075, 0.03), (0.05, 0.055), (0.064, 0.085), (0.036, 0.125), (0.0, 0.15)], 6),
              'M_paint_white', loc=(x * 1.6, yc(H - 0.3), H - 0.25), smooth=True)
    m.tube([(sx + 0.12, -0.1, 6.25), (sx + 0.12, -0.1, 1.2)], 0.014, 'M_galv', n=4)  # AB operating rod
    m.add(box(0.05, 0.3, 0.05), 'M_galv', loc=(sx + 0.12, -0.25, 1.2))
    jump = []
    for k, x in enumerate((-0.6, 0.0, 0.6)):  # jumpers: line -> AB -> fuse -> HV bushing
        m.tube([(x * 1.6, yc(H) , H - 0.12), (x, yc(6.2) - 0.02, 6.45), (x, yc(5.2), 5.5), (x, yc(4.4) - 0.1, 4.62),
                (x * 0.6, yc(4.4) - 0.1, 4.3), (hvb[k][0], hvb[k][1], ztop + 0.33)], 0.008, 'M_plastic_black', n=4,
               caps=False)
    m.add(box(0.7, 0.3, 0.85), 'M_paint_grey', loc=(0, -0.3, 1.45))  # LT distribution box
    m.add(box(0.8, 0.38, 0.03), 'M_paint_grey', loc=(0, -0.32, 1.9))
    m.tube([(0.15, -0.3, 1.88), (0.15, -0.3, 2.4), (0.25, -0.25, 3.0), (0.0, -0.25, ztop + 0.12), (-0.1, -0.2, ztop + 0.14)],
           0.022, 'M_plastic_black', n=4, caps=False, smooth=True)
    m.tube([(-0.15, -0.3, 1.02), (-0.15, -0.3, 0.05), (-0.15, -0.8, -0.05)], 0.025, 'M_plastic_black', n=4, caps=False,
           smooth=True)
    m.attach['wires'] = [(x * 1.6, yc(H - 0.3), H - 0.25 + 0.135) for x in (-0.6, 0.0, 0.6)]
    m.notes = 'Poles along X (2.5 m apart); line arrives along glTF Z onto attach.wires (insulator necks).'
    return m


# ---------- vehicles ----------

def xform(geo, loc=(0, 0, 0), rot=None):
    """Geometry with its verts moved into place (for boolean cutters)."""
    R = Matrix.Identity(3) if rot is None else (rot if isinstance(rot, Matrix) else Euler(rot, 'XYZ').to_matrix())
    t = Vector(loc)
    return [tuple(R @ Vector(v) + t) for v in geo[0]], geo[1]


def wheel(m, c, r, w, rim_r, side, rim_mat='M_paint_grey', n=22, rim=True, hub=0.3, R=None):
    """Tyre with a dished steel rim; axle along X, outer face toward side (+1 = +X, -1 = -X); R overrides."""
    R = R or Matrix.Rotation(side * math.pi / 2, 3, 'Y')
    prof = [(rim_r, -w * 0.45), (r - 0.05, -w / 2), (r - 0.012, -w / 2 + 0.016), (r, -w / 2 + 0.05),
            (r, w / 2 - 0.05), (r - 0.012, w / 2 - 0.016), (r - 0.05, w / 2), (rim_r, w * 0.45)]
    m.add(revolve(prof, n), 'M_rubber', loc=c, rot=R)
    if rim:
        rp = [(rim_r + 0.012, w * 0.45), (rim_r - 0.015, w * 0.36), (rim_r * 0.78, w * 0.22), (rim_r * hub + 0.04, w * 0.26),
              (rim_r * hub, w * 0.36), (0.0, w * 0.38)]
        m.add(revolve(rp, n), rim_mat, loc=c, rot=R)


def plate_glyphs(img, x0, y0, x1, y1, rows, rng):
    """Black character-like blocks on a number plate region (rows of 'AB 12' style groups)."""
    H = (y1 - y0) / len(rows)
    for ri, text in enumerate(rows):
        n = len(text)
        cw = (x1 - x0) / (n + 1)
        for k, ch in enumerate(text):
            if ch == ' ':
                continue
            cx = x0 + cw * (k + 1)
            yb, yt = y1 - H * (ri + 0.85), y1 - H * (ri + 0.15)
            img[int(yb):int(yt), int(cx - cw * 0.32):int(cx + cw * 0.32), :3] = 0.06
            if ch.isdigit() and rng.random() < 0.6:  # counters so digits don't read as solid bars
                img[int(yb + (yt - yb) * 0.3):int(yb + (yt - yb) * 0.7), int(cx - cw * 0.1):int(cx + cw * 0.1), :3] = 0.95


def vehicle_decal(kind):
    """512 x 512 decal atlas (sRGB, row 0 = bottom):
    [0,.5]x[.5,1] grille | [.5,.75]x[.5,1] headlamp | [.75,1]x[.5,1] tail lamp
    [0,.5]x[0,.5] yellow commercial number plate | [.5,.75]x[0,.5] amber indicator | [.75,1]x[0,.5] matt black."""
    S = 512
    img = np.ones((S, S, 4), np.float32)
    rng = np.random.default_rng(11)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    g = img[S // 2:, :S // 2]
    gy, gx = np.mgrid[0:S // 2, 0:S // 2].astype(np.float32)
    if kind == 'truck':  # horizontal slats in a chrome surround
        g[..., :3] = 0.07
        g[(gy % 22) < 9, :3] = 0.2
        g[(gx < 10) | (gx > S // 2 - 11) | (gy < 10) | (gy > S // 2 - 11), :3] = 0.75
    else:  # Bolero-style vertical chrome slats on black
        g[..., :3] = 0.05
        g[((gx % 24) < 10) & (gy > 14) & (gy < S // 2 - 14), :3] = 0.78
        g[(gy < 14) | (gy > S // 2 - 14), :3] = 0.12
    hl = img[S // 2:, S // 2:3 * S // 4]
    hy, hx = np.mgrid[0:S // 2, 0:S // 4].astype(np.float32)
    d = np.hypot(hx - S / 8, (hy - S / 4) * 0.5)
    hl[..., :3] = 0.82
    hl[(d % 14) < 2, :3] = 0.62
    hl[d < 18, :3] = 0.95
    hl[(hx < 4) | (hx > S // 4 - 5) | (hy < 4) | (hy > S // 2 - 5), :3] = 0.25
    tl = img[S // 2:, 3 * S // 4:]
    tl[..., :3] = (0.62, 0.04, 0.03)
    tl[:S // 6, :, :3] = (0.95, 0.5, 0.05)
    tl[S // 6:S // 6 + 6, :, :3] = 0.15
    pl = img[:S // 2, :S // 2]
    pl[..., :3] = (0.98, 0.8, 0.08)
    py, px = np.mgrid[0:S // 2, 0:S // 2]
    pl[(px < 8) | (px > S // 2 - 9) | (py < 8) | (py > S // 2 - 9), :3] = 0.06
    plate_glyphs(pl, 20, 20, S // 2 - 20, S // 2 - 20, ['TS 07', 'UA 4521'], rng)
    img[:S // 2, S // 2:3 * S // 4, :3] = (0.98, 0.55, 0.05)
    img[:S // 2, 3 * S // 4:, :3] = 0.04
    return img


# decal atlas UV rects (u0, v0, u1, v1)
D_GRILLE, D_HEAD, D_TAIL = (0.01, 0.51, 0.49, 0.99), (0.51, 0.51, 0.74, 0.99), (0.76, 0.51, 0.99, 0.99)
D_PLATE, D_AMBER, D_BLACK = (0.01, 0.01, 0.49, 0.49), (0.51, 0.01, 0.74, 0.49), (0.8, 0.1, 0.95, 0.4)


def decal_box(sx, sy, sz, rect_uv):
    """Box whose -Y face shows rect_uv of the decal atlas (other faces sample its border)."""
    v, f = box(sx, sy, sz)
    u0, v0, u1, v1 = rect_uv
    edge = [(u0 + 0.002, v0 + 0.002)] * 4
    uvs = [edge for _ in f]
    uvs[0] = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    return v, f, uvs


def side_loft(prof, x0, x1):
    """Side-view polygon prof [(y, z) CCW seen from +X] extruded across X from x0 to x1 (closed)."""
    return loft([[(x0, y, z) for y, z in prof], [(x1, y, z) for y, z in prof]], cap0=True, cap1=True)


def build_truck_407():
    """Tata 407-type light truck (5.4 x 2.0 m, cab 2.4 m): semi-forward cab with raked windscreen, sun visor, doors,
    mirrors, grille + headlamps (decal atlas), bumper; ladder chassis, fuel tank, exhaust, spare wheel; dropside
    cargo body with headboard and tailgate; 7.50-16 tyres, dual rear wheels."""
    m = Model('truck_407')
    tex_mat('Truck407Decal', image('truck407_decal', vehicle_decal('truck')), rough=0.35)
    BODY, CH = 'M_paint_blue', 'M_steel_dark'
    r, tw = 0.4, 0.2
    yf, yr = -1.72, 1.23  # axles (wheelbase 2.95)
    cab = [(-2.55, 0.62), (-1.05, 0.62), (-1.05, 2.38), (-2.22, 2.4), (-2.32, 2.32), (-2.5, 1.42), (-2.56, 1.3)]
    arch = xform(cyl(0.47, 2.4, 20, z0=-1.2), (0, yf, r), (0, math.pi / 2, 0))
    body = cut(side_loft(cab, -0.95, 0.95), [], [arch])
    m.add(body, BODY, bevel=0.035)
    # glass
    m.add(([(-0.85, -2.505, 1.48), (0.85, -2.505, 1.48), (0.83, -2.335, 2.28), (-0.83, -2.335, 2.28)], [(0, 1, 2, 3)]), 'M_glass')
    for sx in (-1, 1):
        x = sx * 0.957
        win = [(x, -2.38, 1.5), (x, -1.25, 1.5), (x, -1.25, 2.25), (x, -2.24, 2.25)]
        m.add((win if sx > 0 else win[::-1], [(0, 1, 2, 3)]), 'M_glass')
        for (ya, za), (yb, zb) in (((-2.42, 0.66), (-2.42, 2.3)), ((-1.2, 0.66), (-1.2, 2.3)), ((-2.42, 0.66), (-1.2, 0.66))):
            m.beam((x, ya, za), (x, yb, zb), 0.012, 0.012, 'M_rubber', caps=False)  # door shut lines
        m.add(box(0.03, 0.14, 0.035), 'M_paint_grey', loc=(sx * 0.97, -1.42, 1.38))
        m.beam((sx * 0.96, -2.3, 2.05), (sx * 1.18, -2.32, 2.0), 0.025, 0.025, 'M_paint_grey')  # mirror arm
        m.add(box(0.05, 0.13, 0.32), CH, loc=(sx * 1.2, -2.32, 1.92), bevel=0.01)
        m.add(box(0.36, 0.25, 0.04), CH, loc=(sx * 0.72, -1.95, 0.48))  # door step
        m.add(decal_box(0.26, 0.03, 0.17, D_HEAD), 'Truck407Decal', loc=(sx * 0.68, -2.565, 0.88))
        m.add(decal_box(0.12, 0.03, 0.07, D_AMBER), 'Truck407Decal', loc=(sx * 0.68, -2.565, 1.04))
        m.add(decal_box(0.05, 0.12, 0.08, D_AMBER), 'Truck407Decal', loc=(sx * 0.955, -2.45, 1.05), rot=(0, 0, sx * math.pi / 2))
        m.beam((sx * 0.75, -2.51, 1.47), (sx * 0.12, -2.49, 1.56), 0.012, 0.012, CH)  # wipers
    m.add(decal_box(1.1, 0.03, 0.4, D_GRILLE), 'Truck407Decal', loc=(0, -2.565, 1.05))
    m.add(box(1.96, 0.16, 0.2), CH, loc=(0, -2.6, 0.55), bevel=0.02)  # bumper
    m.add(decal_box(0.5, 0.02, 0.12, D_PLATE), 'Truck407Decal', loc=(0, -2.69, 0.55))
    m.add(box(1.95, 0.32, 0.035), BODY, loc=(0, -2.38, 2.43), rot=(math.radians(-12), 0, 0))  # sun visor
    m.add(decal_box(0.4, 0.02, 0.25, D_BLACK), 'Truck407Decal', loc=(0, -1.04, 1.95), rot=(0, 0, math.pi))  # rear window
    # chassis
    for sx in (-1, 1):
        # C rail along Y, flanges inward; the extrusion runs -Y on the left so the frame stays right-handed
        m.add(prism(C_profile(0.2, 0.07, 0.006), 5.2), CH, loc=(sx * 0.42, -2.45 if sx > 0 else 2.75, 0.62),
              rot=Matrix(((-sx, 0, 0), (0, 0, 1), (0, sx, 0))).transposed())
    for y in (-2.2, -0.9, 0.3, 2.0, 2.75):
        m.add(box(0.84, 0.08, 0.12), CH, loc=(0, y, 0.62))
    m.add(box(0.5, 0.36, 0.36), CH, loc=(-0.72, -0.35, 0.58), bevel=0.03)  # fuel tank
    m.add(box(0.36, 0.3, 0.26), CH, loc=(0.7, -0.4, 0.6))  # battery box
    m.tube([(0.3, -1.3, 0.45), (0.55, -0.9, 0.4), (0.62, 0.5, 0.4), (0.75, 0.75, 0.38)], 0.035, CH, n=8)
    # axles + differential
    m.add(cyl(0.05, 1.7, 8), CH, loc=(-0.85, yr, r), rot=(0, math.pi / 2, 0))
    m.add(revolve([(0.0, -0.16), (0.12, -0.13), (0.17, 0.0), (0.12, 0.13), (0.0, 0.16)], 10), CH, loc=(0, yr, r),
          rot=(math.pi / 2, 0, 0))
    m.add(box(1.5, 0.1, 0.1), CH, loc=(0, yf, r - 0.05))
    wheel(m, (0, 2.3, 0.62), r, tw, 0.21, 1, R=Matrix.Identity(3))  # spare carried flat under the rear overhang
    # wheels
    for sx in (-1, 1):
        wheel(m, (sx * 0.8, yf, r), r, tw, 0.21, sx)
        wheel(m, (sx * 0.66, yr, r), r, tw, 0.21, sx, rim=False)
        wheel(m, (sx * 0.89, yr, r), r, tw, 0.21, sx)
    # cargo body
    zd = 1.0
    y0, y1 = -0.88, 2.85
    m.add(box(2.0, y1 - y0, 0.07, z0=zd), BODY, loc=(0, (y0 + y1) / 2, 0))
    for y in np.linspace(y0 + 0.2, y1 - 0.2, 7):
        m.add(box(2.0, 0.08, 0.1), CH, loc=(0, float(y), zd - 0.05))
    for x in (-0.36, 0.36):
        m.add(box(0.1, y1 - y0, 0.12), CH, loc=(x, (y0 + y1) / 2, zd - 0.12))
    for sx in (-1, 1):  # dropsides: panel + rails + stakes
        m.add(box(0.04, y1 - y0, 0.62, z0=zd + 0.07), BODY, loc=(sx * 0.98, (y0 + y1) / 2, 0))
        for z in (zd + 0.1, zd + 0.38, zd + 0.66):
            m.add(box(0.06, y1 - y0, 0.05), BODY, loc=(sx * 1.0, (y0 + y1) / 2, z))
        for y in np.linspace(y0 + 0.05, y1 - 0.05, 5):
            m.add(box(0.07, 0.06, 0.64, z0=zd + 0.06), BODY, loc=(sx * 1.0, float(y), 0))
        for y in (y0 + 1.4, y0 + 2.6):
            m.add(box(0.03, 0.08, 0.05), 'M_paint_grey', loc=(sx * 1.035, y, zd + 0.62))  # side latches
        m.add(box(0.3, 0.012, 0.32), 'M_rubber', loc=(sx * 0.78, yr + 0.55, 0.32))  # mud flap
        m.add(decal_box(0.2, 0.04, 0.12, D_TAIL), 'Truck407Decal', loc=(sx * 0.82, y1 + 0.02, 0.78), rot=(0, 0, math.pi))
    m.add(box(1.96, 0.05, 1.25, z0=zd + 0.07), BODY, loc=(0, y0 - 0.02, 0))  # headboard
    m.add(box(2.0, 0.08, 0.06), BODY, loc=(0, y0 - 0.02, zd + 1.33))
    for x in (-0.95, -0.32, 0.32, 0.95):
        m.add(box(0.06, 0.07, 1.3, z0=zd + 0.06), BODY, loc=(x, y0 - 0.03, 0))
    m.add(box(1.92, 0.04, 0.62, z0=zd + 0.07), BODY, loc=(0, y1 - 0.02, 0))  # tailgate
    for z in (zd + 0.1, zd + 0.38, zd + 0.66):
        m.add(box(1.96, 0.06, 0.05), BODY, loc=(0, y1, z))
    for x in (-0.6, 0.6):
        m.add(box(0.08, 0.03, 0.05), 'M_paint_grey', loc=(x, y1 + 0.03, zd + 0.62))
    m.add(decal_box(0.5, 0.02, 0.12, D_PLATE), 'Truck407Decal', loc=(0, y1 + 0.03, 0.78), rot=(0, 0, math.pi))
    m.add(box(1.7, 0.08, 0.08), CH, loc=(0, y1 - 0.05, 0.55))  # under-run bar
    m.notes = 'Nose toward +Z. Wheel radius 0.40, axles at z=0.40 (front x=+-0.80, rear duals x=+-0.66/+-0.89).'
    return m


def band(pts, w, t, out):
    """Closed thin flat band along a polyline (mudguards): width w across X, thickness t toward out(p)."""
    X = Vector((1, 0, 0))
    rings = []
    for q in pts:
        q = Vector(q)
        n = out(q)
        rings.append([q - X * w / 2, q + X * w / 2, q + X * w / 2 + n * t, q - X * w / 2 + n * t])
    nrm = sum(((a - rings[0][0]).cross(b - rings[0][0]) for a, b in zip(rings[0][1:], rings[0][2:])), Vector())
    if nrm.dot(sum(rings[1], Vector()) - sum(rings[0], Vector())) < 0:  # loft wants CCW seen from the advance direction
        rings = [r[::-1] for r in rings]
    return loft([[tuple(v) for v in r] for r in rings], cap0=True, cap1=True)


def build_pickup_bolero():
    """Mahindra Bolero Pik-Up type (5.2 x 1.7 x 1.9 m): boxy bonnet + single cab (tumblehome greenhouse), vertical-slat
    grille + headlamps (decal), black bumpers/cladding/mirrors, flat-deck dropside cargo bed, ladder chassis,
    spare + fuel tank, 215/75 R15 wheels on silver steel rims."""
    m = Model('pickup_bolero')
    tex_mat('PickupDecal', image('pickup_decal', vehicle_decal('pickup')), rough=0.35)
    BODY, BLK = 'M_paint_white', 'M_plastic_black'
    r, tw = 0.355, 0.215
    yf, yr = -1.75, 1.51
    lower = [(-2.62, 0.42), (-0.05, 0.42), (-0.05, 1.13), (-2.56, 1.08), (-2.63, 0.98)]
    arch = xform(cyl(0.43, 2.0, 20, z0=-1.0), (0, yf, r), (0, math.pi / 2, 0))
    m.add(cut(side_loft(lower, -0.85, 0.85), [], [arch]), BODY, bevel=0.04)
    m.add(side_loft([(-1.36, 1.12), (-0.07, 1.12), (-0.09, 1.86), (-0.93, 1.88)], -0.79, 0.79), BODY, bevel=0.04)
    a, b = Vector((-1.36, 1.12)), Vector((-0.93, 1.88))
    dn = (b - a).normalized()
    nn = Vector((-dn.y, dn.x)) * 0.008
    p0, p1 = a + dn * 0.06 + nn, a + dn * 0.72 + nn
    m.add(([(-0.7, p0.x, p0.y), (0.7, p0.x, p0.y), (0.66, p1.x, p1.y), (-0.66, p1.x, p1.y)], [(0, 1, 2, 3)]), 'M_glass')
    for sx in (-1, 1):
        x = sx * 0.796
        win = [(x, -1.24, 1.2), (x, -0.16, 1.2), (x, -0.17, 1.79), (x, -0.95, 1.79)]
        m.add((win if sx > 0 else win[::-1], [(0, 1, 2, 3)]), 'M_glass')
        m.add(box(0.012, 0.07, 0.62), BLK, loc=(sx * 0.799, -0.55, 1.5))  # B-pillar
        for (ya, za), (yb, zb) in (((-1.3, 0.46), (-1.3, 1.12)), ((-0.14, 0.46), (-0.14, 1.12))):
            m.beam((sx * 0.856, ya, za), (sx * 0.856, yb, zb), 0.01, 0.01, 'M_rubber', caps=False)
        m.add(box(0.03, 0.12, 0.035), BLK, loc=(sx * 0.865, -0.42, 1.0))  # door handle
        m.add(box(0.012, 1.15, 0.09), BLK, loc=(sx * 0.857, -0.72, 0.6))  # side rubbing strip
        m.beam((sx * 0.8, -1.22, 1.22), (sx * 0.93, -1.24, 1.25), 0.03, 0.03, BLK)
        m.add(box(0.05, 0.13, 0.19), BLK, loc=(sx * 0.95, -1.24, 1.3), bevel=0.012)  # mirror
        m.add(sweep([(sx * 0.862, yf + 0.47 * math.cos(t), r + 0.47 * math.sin(t)) for t in np.linspace(0.12, math.pi - 0.12, 9)],
                    0.03, 4, False, False), BLK)  # arch flare
        m.add(decal_box(0.34, 0.03, 0.19, D_HEAD), 'PickupDecal', loc=(sx * 0.63, -2.64, 0.87))
        m.add(decal_box(0.14, 0.03, 0.06, D_AMBER), 'PickupDecal', loc=(sx * 0.72, -2.73, 0.6))
        m.add(decal_box(0.06, 0.06, 0.32, D_TAIL), 'PickupDecal', loc=(sx * 0.83, 2.63, 1.06), rot=(0, 0, math.pi))
        m.beam((sx * 0.72, -1.33, 1.13), (sx * 0.12, -1.32, 1.2), 0.012, 0.012, BLK)  # wipers
    m.add(decal_box(0.84, 0.03, 0.28, D_GRILLE), 'PickupDecal', loc=(0, -2.64, 0.86))
    m.add(box(1.78, 0.22, 0.24), BLK, loc=(0, -2.67, 0.53), bevel=0.03)  # front bumper
    m.add(decal_box(0.5, 0.02, 0.12, D_PLATE), 'PickupDecal', loc=(0, -2.79, 0.53))
    m.add(decal_box(0.5, 0.02, 0.25, D_BLACK), 'PickupDecal', loc=(0, -0.045, 1.5), rot=(0, 0, math.pi))  # rear glass
    # cargo bed: deck, dropsides, headboard + cab guard, tailgate
    zd, y0, y1 = 0.82, -0.02, 2.6
    m.add(box(1.72, y1 - y0, 0.06, z0=zd), BODY, loc=(0, (y0 + y1) / 2, 0))
    for sx in (-1, 1):
        m.add(box(0.04, y1 - y0, 0.44, z0=zd + 0.05), BODY, loc=(sx * 0.84, (y0 + y1) / 2, 0), bevel=0.012)
        m.add(box(0.06, y1 - y0, 0.04), BODY, loc=(sx * 0.845, (y0 + y1) / 2, zd + 0.49))
        for yy in (0.6, 1.3, 2.0):
            m.add(box(0.05, 0.06, 0.4, z0=zd + 0.07), BODY, loc=(sx * 0.86, yy, 0))
        m.add(box(0.03, 0.06, 0.04), 'M_rubber', loc=(sx * 0.875, 1.95, zd + 0.42))
    m.add(box(1.72, 0.04, 0.5, z0=zd + 0.05), BODY, loc=(0, y0 + 0.02, 0))
    m.tube([(-0.8, y0 + 0.03, zd + 0.55), (-0.8, y0 + 0.03, 1.66), (0.8, y0 + 0.03, 1.66), (0.8, y0 + 0.03, zd + 0.55)],
           0.022, BLK, n=6)  # cab guard
    for xg in (-0.4, 0.0, 0.4):
        m.add(bars(0.018, 1.66 - zd - 0.55), BLK, loc=(xg, y0 + 0.03, zd + 0.55))
    m.add(box(1.68, 0.04, 0.44, z0=zd + 0.05), BODY, loc=(0, y1 - 0.02, 0), bevel=0.012)
    m.add(decal_box(0.5, 0.02, 0.12, D_PLATE), 'PickupDecal', loc=(0, y1 + 0.01, zd + 0.25), rot=(0, 0, math.pi))
    m.add(box(1.5, 0.12, 0.1), BLK, loc=(0, y1 - 0.02, 0.55))  # rear step bumper
    # chassis + underbody
    for sx in (-1, 1):
        m.add(prism(C_profile(0.17, 0.06, 0.006), 4.95), BLK, loc=(sx * 0.42, -2.45 if sx > 0 else 2.5, 0.64),
              rot=Matrix(((-sx, 0, 0), (0, 0, 1), (0, sx, 0))).transposed())
    for y in (0.4, 1.0, 2.0, 2.45):
        m.add(box(0.84, 0.07, 0.1), BLK, loc=(0, y, 0.66))
    m.add(box(0.55, 0.4, 0.3), BLK, loc=(-0.6, 0.45, 0.55), bevel=0.03)  # fuel tank
    m.tube([(0.25, -1.2, 0.38), (0.55, -0.6, 0.36), (0.55, 2.3, 0.4), (0.6, 2.62, 0.42)], 0.028, BLK, n=8)
    m.add(cyl(0.05, 1.5, 8), BLK, loc=(-0.75, yr, r), rot=(0, math.pi / 2, 0))
    m.add(revolve([(0.0, -0.15), (0.11, -0.12), (0.15, 0.0), (0.11, 0.12), (0.0, 0.15)], 10), BLK, loc=(0, yr, r),
          rot=(math.pi / 2, 0, 0))
    wheel(m, (0, 2.15, 0.52), r, tw, 0.2, 1, R=Matrix.Identity(3))  # spare, flat under the deck
    for sx in (-1, 1):
        for y in (yf, yr):
            wheel(m, (sx * 0.725, y, r), r, tw, 0.2, sx, hub=0.35)
    m.notes = 'Nose toward +Z. Wheel radius 0.355 at x=+-0.725; deck floor 0.82 m.'
    return m


def build_motorbike():
    """Commuter motorcycle (Splendor type, ~2 m) parked on its side stand (leans 10 deg left, bars on left lock):
    tubular frame, red tank / side panels / tail, black seat + carrier, spoked drum-brake wheels, telescopic fork,
    round headlamp, mirrors, chrome exhaust + silencer, finned engine, chain guard, crash guard, rear shocks."""
    m = Model('motorbike')
    RED, BLK, CHR, STL = 'M_paint_red', 'M_plastic_black', 'M_chrome', 'M_steel_dark'
    R0, TW = 0.3, 0.075
    yf, yr = -0.68, 0.6
    piv = Vector((0, -0.5, 0.72))  # steering head bottom; axis toward the head top
    S = Matrix.Rotation(math.radians(-22), 3, (Vector((0, -0.4, 0.92)) - piv).normalized())

    def put(geo, mat, loc=(0, 0, 0), rot=None, front=False, **kw):
        Rl = Matrix.Identity(3) if rot is None else (rot if isinstance(rot, Matrix) else Euler(rot, 'XYZ').to_matrix())
        t = Vector(loc)
        if front:
            t, Rl = S @ (t - piv) + piv, S @ Rl
        m.add(geo, mat, loc=tuple(t), rot=Rl, **kw)

    def tube(pts, rad, mat, n=6, front=False, caps=True, **kw):
        q = [Vector(v) for v in pts]
        if front:
            q = [S @ (v - piv) + piv for v in q]
        m.add(sweep([tuple(v) for v in q], rad, n, caps, caps), mat, smooth=True, **kw)

    def spoked(y, front):
        c = Vector((0, y, R0))
        Rw = Matrix.Rotation(math.pi / 2, 3, 'Y')
        put(revolve([(0.245, -TW * 0.4), (R0 - 0.03, -TW / 2), (R0, -TW * 0.15), (R0, TW * 0.15), (R0 - 0.03, TW / 2),
                     (0.245, TW * 0.4)], 20), 'M_rubber', c, Rw, front=front)
        put(revolve([(0.25, TW * 0.32), (0.232, TW * 0.15), (0.232, -TW * 0.15), (0.25, -TW * 0.32)], 20), CHR, c, Rw,
            front=front, smooth=True)
        put(cyl(0.065, 0.1, 12, z0=-0.05), STL, c, Rw, front=front)
        for k in range(16):
            a = 2 * math.pi * k / 16
            sd = 0.035 if k % 2 else -0.035
            h = c + Vector((sd, 0.05 * math.cos(a + 0.4), 0.05 * math.sin(a + 0.4)))
            e = c + Vector((0, 0.232 * math.cos(a), 0.232 * math.sin(a)))
            tube([h, e], 0.0035, CHR, n=3, front=front, caps=False)

    spoked(yf, True)
    spoked(yr, False)
    # front end (steered): fork, mudguard, headlamp, handlebar, mirrors, speedo
    for sx in (-1, 1):
        tube([(sx * 0.07, -0.47, 0.98), (sx * 0.07, -0.55, 0.62)], 0.018, CHR, front=True)
        tube([(sx * 0.07, -0.55, 0.64), (sx * 0.07, yf - 0.01, R0 + 0.02)], 0.024, BLK, front=True)
        tube([(sx * 0.33, -0.36, 0.99), (sx * 0.42, -0.34, 0.985)], 0.017, BLK, front=True)  # grips
        tube([(sx * 0.24, -0.4, 1.0), (sx * 0.29, -0.37, 1.17)], 0.006, CHR, n=4, front=True)  # mirror stalk
        put(cyl(0.052, 0.02, 12, z0=-0.01), CHR, (sx * 0.295, -0.365, 1.19), (math.radians(80), 0, 0), front=True)
        put(box(0.11, 0.02, 0.012), BLK, (sx * 0.31, -0.42, 0.99), (0, 0, sx * 0.25), front=True)  # levers
    tube([(-0.34, -0.36, 0.99), (-0.2, -0.42, 1.0), (0.0, -0.44, 0.985), (0.2, -0.42, 1.0), (0.34, -0.36, 0.99)], 0.011, CHR,
         front=True)
    put(box(0.2, 0.1, 0.06), BLK, (0, -0.47, 0.96), front=True)  # top yoke
    put(revolve([(0.0, -0.11), (0.06, -0.1), (0.09, -0.04), (0.09, 0.03), (0.08, 0.04)], 14), BLK, (0, -0.6, 0.88),
        (math.pi / 2, 0, 0), front=True)  # headlamp shell (faces -Y)
    put(revolve([(0.082, 0.04), (0.06, 0.045), (0.0, 0.05)], 14), 'M_glass', (0, -0.6, 0.88), (math.pi / 2, 0, 0),
        front=True, smooth=True)
    put(revolve([(0.091, 0.03), (0.091, 0.05), (0.083, 0.052)], 14), CHR, (0, -0.6, 0.88), (math.pi / 2, 0, 0), front=True)
    put(cyl(0.05, 0.05, 12), BLK, (0, -0.5, 1.02), (math.radians(-30), 0, 0), front=True)  # speedometer
    for sx in (-1, 1):
        put(box(0.06, 0.04, 0.035), CHR, (sx * 0.14, -0.58, 0.9), front=True)  # clear-lens indicators
    c0 = Vector((0, yf, R0))
    put(band([(0, yf + 0.36 * math.cos(t), R0 + 0.36 * math.sin(t)) for t in np.linspace(0.35, 2.3, 8)], 0.11, 0.006,
             lambda q: (q - c0).normalized()), RED, front=True, smooth=True)  # front mudguard
    # frame, tank, seat, panels, tail, carrier
    tube([(0, -0.47, 0.86), (0, -0.25, 0.8), (0, 0.05, 0.62), (0, 0.18, 0.4)], 0.025, STL, n=8)
    for sx in (-1, 1):
        tube([(sx * 0.07, 0.0, 0.66), (sx * 0.085, 0.55, 0.77), (sx * 0.07, 0.8, 0.8)], 0.014, STL)
        tube([(sx * 0.1, 0.12, 0.42), (sx * 0.1, yr, R0)], 0.018, STL)  # swingarm
        tube([(sx * 0.12, 0.5, 0.34), (sx * 0.11, 0.42, 0.72)], 0.03, CHR, n=8)  # rear shock spring
        tube([(sx * 0.12, 0.48, 0.38), (sx * 0.115, 0.44, 0.62)], 0.022, BLK, n=8)
        tube([(sx * 0.12, 0.02, 0.3), (sx * 0.24, 0.02, 0.3)], 0.012, BLK)  # footrests
        put(box(0.035, 0.32, 0.22), RED, (sx * 0.11, 0.24, 0.6), bevel=0.012)  # side panels
    secs = [(-0.43, 0.075, 0.74, 0.86), (-0.36, 0.11, 0.71, 0.93), (-0.22, 0.135, 0.68, 0.95), (-0.08, 0.13, 0.68, 0.93),
            (0.02, 0.1, 0.7, 0.88), (0.06, 0.07, 0.72, 0.83)]
    rings = []
    for y, hw, zb, zt in secs:
        cz, hh = (zb + zt) / 2, (zt - zb) / 2
        rings.append([(hw * math.copysign(abs(math.cos(a)) ** 0.6, math.cos(a)), y,
                       cz + hh * math.copysign(abs(math.sin(a)) ** 0.6, math.sin(a))) for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)])
    rings = [[(x, y, z) for x, y, z in rg[::-1]] for rg in rings]
    tank = loft([[(x, y, z) for x, y, z in rg] for rg in rings], cap0=True, cap1=True)
    m.add(tank, RED, rot=None, smooth=True)
    put(cyl(0.04, 0.02, 10), CHR, (0, -0.22, 0.945))  # tank cap
    seat = [(0.04, 0.12, 0.74, 0.82), (0.2, 0.125, 0.74, 0.8), (0.45, 0.12, 0.75, 0.81), (0.62, 0.09, 0.76, 0.81)]
    srings = []
    for y, hw, zb, zt in seat:
        cz, hh = (zb + zt) / 2, (zt - zb) / 2
        srings.append([(hw * math.copysign(abs(math.cos(a)) ** 0.4, math.cos(a)), y,
                        cz + hh * math.copysign(abs(math.sin(a)) ** 0.4, math.sin(a))) for a in np.linspace(0, 2 * math.pi, 10, endpoint=False)][::-1])
    m.add(loft(srings, cap0=True, cap1=True), BLK, smooth=True)
    m.add(loft([rect(0.18, 0.1, 0, 0, 0), rect(0.14, 0.1, 0.12, 0, 0.05)], cap0=False, cap1=True), RED, loc=(0, 0.72, 0.64),
          rot=(math.radians(-70), 0, 0), bevel=0.01)  # tail cowl
    put(box(0.12, 0.03, 0.05), RED, (0, 0.86, 0.69))  # tail lamp lens
    tube([(-0.11, 0.5, 0.84), (-0.11, 0.86, 0.84), (0.11, 0.86, 0.84), (0.11, 0.5, 0.84)], 0.01, BLK, n=4)  # carrier
    for k in range(3):
        tube([(-0.11, 0.58 + 0.1 * k, 0.84), (0.11, 0.58 + 0.1 * k, 0.84)], 0.007, BLK, n=4, caps=False)
    c1 = Vector((0, yr, R0))
    m.add(band([(0, yr + 0.36 * math.cos(t), R0 + 0.36 * math.sin(t)) for t in np.linspace(0.6, 2.4, 7)], 0.1, 0.006,
               lambda q: (q - c1).normalized()), BLK, smooth=True)  # rear mudguard
    # engine, exhaust, chain guard, crash guard, kick + gear levers
    put(box(0.26, 0.34, 0.24), STL, (0, -0.08, 0.38), bevel=0.03)
    put(cyl(0.065, 0.2, 10), STL, (0, -0.2, 0.47), (math.radians(60), 0, 0))  # cylinder inclined forward
    for k in range(4):
        put(cyl(0.085, 0.008, 10), STL, (0, -0.24 - 0.025 * k * 1.7, 0.5 + 0.025 * k), (math.radians(60), 0, 0))
    put(revolve([(0.11, 0.0), (0.1, 0.03), (0.06, 0.05), (0.0, 0.055)], 12), CHR, (0.13, -0.05, 0.36), (0, math.pi / 2, 0))
    tube([(0.03, -0.36, 0.55), (0.06, -0.38, 0.38), (0.12, -0.28, 0.24), (0.15, 0.1, 0.24), (0.16, 0.24, 0.28)], 0.022, CHR)
    put(revolve([(0.0, 0.0), (0.045, 0.02), (0.052, 0.1), (0.052, 0.42), (0.04, 0.5), (0.0, 0.51)], 12), CHR,
        (0.17, 0.22, 0.28), (math.radians(-75), 0, 0), smooth=True)  # silencer
    put(box(0.02, 0.5, 0.07), BLK, (-0.13, 0.36, 0.38), (math.radians(14), 0, 0))  # chain guard
    tube([(-0.05, -0.33, 0.62), (-0.24, -0.32, 0.45), (-0.24, -0.26, 0.28), (-0.06, -0.1, 0.24)], 0.014, CHR, n=6)
    tube([(0.05, -0.33, 0.62), (0.24, -0.32, 0.45), (0.24, -0.26, 0.28), (0.06, -0.1, 0.24)], 0.014, CHR, n=6)
    tube([(0.16, 0.02, 0.42), (0.17, 0.2, 0.33)], 0.01, STL, n=4)  # kick lever
    tube([(-0.15, -0.08, 0.32), (-0.16, -0.2, 0.34)], 0.009, STL, n=4)  # gear lever
    # park on the side stand: lean 10 deg left about the tyre contact line, then the stand to the ground
    nd = m.nodes['motorbike']
    Lr = Matrix.Rotation(math.radians(-10), 3, 'Y')
    nd['V'] = [tuple(Lr @ Vector(v)) for v in nd['V']]
    top = Lr @ Vector((-0.1, 0.02, 0.33))
    m.add(sweep([tuple(top), (-0.31, 0.06, 0.012)], [0.012, 0.009], 6, True, True), STL, smooth=True)
    m.footprint = [0.75, 2.0]
    m.notes = 'Nose toward +Z; leans 10 deg toward -X on its side stand, bars on left lock.'
    return m


def build_wheelbarrow():
    """Steel-tray builder's/farm wheelbarrow: galvanised pan with rolled rim, tubular frame with legs, pneumatic
    wheel on a red rim, rubber grips. Wheel toward +Z (glTF)."""
    m = Model('wheelbarrow')

    def rr(w, d, z, cy, k=0.07):
        """Rounded-rectangle ring (CCW), 12 points."""
        pts = []
        for cx_, cy_, a0 in ((w / 2 - k, d / 2 - k, 0), (-w / 2 + k, d / 2 - k, 90), (-w / 2 + k, -d / 2 + k, 180),
                             (w / 2 - k, -d / 2 + k, 270)):
            for t in (0, 45, 90):
                a = math.radians(a0 + t)
                pts.append((cx_ + k * math.cos(a), cy + cy_ + k * math.sin(a), z))
        return pts

    bot = rr(0.4, 0.42, 0.36, -0.05)
    top = rr(0.64, 0.86, 0.62, -0.12)
    ib, it = rr(0.37, 0.39, 0.375, -0.05), rr(0.61, 0.83, 0.62, -0.12)
    m.add(loft([bot, top], cap0=True), 'M_galv')
    m.add(loft([it, ib], cap1=True), 'M_galv')
    m.add(sweep(top + top[:1], 0.012, 6, False, False), 'M_galv', smooth=True)
    yw, rw = -0.62, 0.2
    wheel(m, (0, yw, rw), rw, 0.085, 0.1, 1, rim_mat='M_paint_red', n=14, hub=0.4)
    m.add(cyl(0.012, 0.2, 6), 'M_steel_dark', loc=(-0.1, yw, rw), rot=(0, math.pi / 2, 0))
    for sx in (-1, 1):
        tube = [(sx * 0.09, yw, rw), (sx * 0.17, -0.35, 0.33), (sx * 0.22, 0.2, 0.38), (sx * 0.28, 0.72, 0.6)]
        m.add(sweep(tube, 0.016, 6), 'M_steel_dark', smooth=True)
        m.add(sweep([(sx * 0.28, 0.66, 0.585), (sx * 0.29, 0.86, 0.64)], 0.02, 6), 'M_rubber', smooth=True)  # grip
        m.add(sweep([(sx * 0.2, 0.06, 0.37), (sx * 0.23, 0.12, 0.0), (sx * 0.23, 0.26, 0.0)], 0.013, 6), 'M_steel_dark',
              smooth=True)  # leg + foot
        m.add(sweep([(sx * 0.16, -0.3, 0.33), (sx * 0.12, -0.32, 0.5)], 0.01, 4), 'M_steel_dark', smooth=True)  # nose stay
    m.add(sweep([(-0.2, 0.08, 0.37), (0.2, 0.08, 0.37)], 0.012, 4), 'M_steel_dark', smooth=True)
    m.notes = 'Wheel toward +Z, handles toward -Z.'
    return m


def build_person():
    """1.7 m farm worker (half-sleeve shirt, trousers), arms down, facing +Z. Body = ellipsoid/sphere union ->
    voxel remesh -> volume-preserving smooth -> decimate (birds.py method); materials by region. Vertex attribute
    _anim = (legL, legR, armL, armR) weights for a GPU walk cycle; pivots in attach (hips / shoulders)."""
    m = Model('person')
    blobs = [((0, 0.0, 1.585), (0.076, 0.094, 0.112)), ((0, -0.025, 1.505), (0.058, 0.065, 0.05)),
             ((0, 0.005, 1.455), (0.054, 0.054, 0.06)), ((0, 0.0, 1.27), (0.158, 0.105, 0.165)),
             ((0, 0.0, 1.07), (0.142, 0.097, 0.13)), ((0, 0.005, 0.925), (0.168, 0.108, 0.1))]

    def seg(a, b, r0, r1, n):
        n = max(n, round((Vector(b) - Vector(a)).length / (0.3 * min(r0, r1))))  # dense chain = smooth limb
        for k in range(n + 1):
            t = k / n
            r = r0 + (r1 - r0) * t
            blobs.append((tuple(Vector(a).lerp(Vector(b), t)), (r, r, r)))

    for sx in (-1, 1):
        blobs.append(((sx * 0.155, 0, 1.36), (0.065, 0.062, 0.055)))
        seg((sx * 0.19, 0, 1.37), (sx * 0.215, 0.01, 1.12), 0.047, 0.04, 4)
        seg((sx * 0.215, 0.01, 1.12), (sx * 0.228, 0.0, 0.86), 0.038, 0.03, 4)
        blobs.append(((sx * 0.232, -0.005, 0.79), (0.024, 0.045, 0.068)))
        seg((sx * 0.09, 0, 0.86), (sx * 0.095, 0.0, 0.49), 0.078, 0.055, 5)
        seg((sx * 0.095, 0.0, 0.49), (sx * 0.095, 0.015, 0.1), 0.052, 0.035, 5)
        blobs.append(((sx * 0.097, -0.045, 0.045), (0.045, 0.125, 0.04)))
    bm = bmesh.new()
    for c, r in blobs:
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.0,
                                  matrix=Matrix.Translation(c) @ Matrix.Diagonal((*r, 1.0)))
    me = bpy.data.meshes.new('person_src')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('person_src', me)
    bpy.context.scene.collection.objects.link(ob)
    for kind, opts in (('REMESH', dict(mode='VOXEL', voxel_size=0.011)),
                       ('LAPLACIANSMOOTH', dict(iterations=18, lambda_factor=0.5, use_volume_preserve=True))):
        md = ob.modifiers.new(kind.lower(), kind)
        for k, v in opts.items():
            setattr(md, k, v)
    dg = bpy.context.evaluated_depsgraph_get()
    n = len(ob.evaluated_get(dg).data.polygons)
    md = ob.modifiers.new('dec', 'DECIMATE')
    md.ratio = 800 / max(1, n)  # n counts remesh quads; collapse ends near 2 x 800 triangles
    dg.update()
    fm = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bm = bmesh.new()  # cut along the hem / sleeve / collar heights so material borders are straight lines
    bm.from_mesh(fm)
    for z in (0.88, 1.13, 1.465):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z), plane_no=(0, 0, 1))
    bm.to_mesh(fm)
    bm.free()
    nd = m.nodes['person']
    nd['V'] = [tuple(v.co) for v in fm.vertices]
    mats = ['M_skin', 'M_cloth_shirt', 'M_cloth_lower']
    nd['mats'] = mats
    for poly in fm.polygons:
        c = poly.center
        ax = abs(c.x)
        mi = 0 if c.z > 1.465 or (ax > 0.17 and 0.7 < c.z < 1.13) else (2 if c.z < 0.88 and ax < 0.19 else 1)
        nd['F'].append(list(poly.vertices))
        nd['M'].append(mi)
        nrm = poly.normal
        a = max(range(3), key=lambda i: abs(nrm[i]))
        nd['UV'].append([(fm.vertices[i].co.y, fm.vertices[i].co.z) if a == 0 else
                         (fm.vertices[i].co.x, fm.vertices[i].co.z) if a == 1 else
                         (fm.vertices[i].co.x, fm.vertices[i].co.y) for i in poly.vertices])
    anim = []
    for v in fm.vertices:
        x, z = v.co.x, v.co.z
        leg = min(1.0, max(0.0, (0.9 - z) / 0.1)) if abs(x) < 0.18 else 0.0
        arm = min(1.0, max(0.0, (abs(x) - 0.155) / 0.04)) if 0.66 < z < 1.45 else 0.0
        anim.append((leg if x > 0 else 0.0, leg if x < 0 else 0.0, arm if x > 0 else 0.0, arm if x < 0 else 0.0))
    nd['attrs']['_anim'] = anim
    bpy.data.meshes.remove(fm)
    m.attach.update(hip_L=(0.09, 0, 0.88), hip_R=(-0.09, 0, 0.88), shoulder_L=(0.19, 0, 1.4), shoulder_R=(-0.19, 0, 1.4))
    m.notes = ('Faces +Z. _anim (three: geometry.attributes._anim, vec4) = legL, legR, armL, armR weights; rotate those '
               'vertices about attach hip_* / shoulder_* (glTF X axis) for a walk cycle. Left = +X.')
    return m


BUILDERS = {
    'feed_silo': build_feed_silo,
    'water_tank': build_water_tank,
    'electric_pole': build_electric_pole,
    'office': build_office,
    'godown': build_godown,
    'gate': build_gate,
    'tree_neem_1': lambda: build_tree_neem(1),
    'tree_neem_2': lambda: build_tree_neem(2),
    'palm_palmyra_1': lambda: build_palm_palmyra(1),
    'palm_palmyra_2': lambda: build_palm_palmyra(2),
    'shrub': build_shrub,
    'generator_room': build_generator_room,
    'transformer': build_transformer,
    'pump_house': build_pump_house,
    'security_cabin': build_security_cabin,
    'truck_407': build_truck_407,
    'pickup_bolero': build_pickup_bolero,
    'motorbike': build_motorbike,
    'wheelbarrow': build_wheelbarrow,
    'person': build_person,
}


def main(names):
    if names == ['all']:
        names = list(BUILDERS)
    for n in names:
        if n not in BUILDERS:
            raise SystemExit(f'unknown model {n!r}; choose from: all {" ".join(BUILDERS)}')
    for n in names:
        reset()
        random.seed(n)
        BUILDERS[n]().export()


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['all'])
