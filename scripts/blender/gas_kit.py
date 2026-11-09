"""
Builds the Floorview "Gas" kit: industrial gas and cleanroom models, made from code.

    blender -b --factory-startup --python scripts/blender/gas_kit.py -- [model ...]

For each model it writes assets/gas/<model>.glb, a 128 px preview in assets/gas/previews/ and
then regenerates src/gas/catalog.ts (sizes measured from the mesh). Pass model ids to rebuild only
those (the catalog always lists every model).

Conventions (shared with the Kenney kits, see docs/assets.md):
- meters, origin at the footprint center with the base at z = 0;
- the front faces Blender -Y, which the glTF exporter turns into +Z (plan +y at rotation 0);
- materials: body, panel, metal, dark (glass, screens) and `accent`. In Floorview's clay look the
  body stays neutral and only `accent` parts take the marker color. Previews use PREVIEW_COLORS (clay).
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'gas')
CATALOG = os.path.join(ROOT, 'src', 'gas', 'catalog.ts')


def srgb(hex_color, alpha=1.0):
    h = hex_color.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return (*lin, alpha)


# name: (sRGB color, roughness, metallic) as exported to the GLB
MATERIALS = {
    'body': ('#eceff2', 0.55, 0.0),
    'panel': ('#d4d9df', 0.5, 0.0),
    'metal': ('#a9b1ba', 0.35, 0.6),
    'dark': ('#2b3138', 0.25, 0.0),
    'accent': ('#1fb3a6', 0.4, 0.0),
}

# Preview colors (Workbench viewport color): the viewer's default clay look, all light and neutral,
# with accent parts only slightly darker than the body and no teal.
PREVIEW_COLORS = {
    'body': '#eef1f5',
    'panel': '#e1e5ea',
    'metal': '#ccd2d8',
    'dark': '#8b939c',
    'accent': '#b9c2cb',
}


def material(name):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    color, rough, metal = MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = srgb(color)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    # Workbench (previews) reads the viewport display color, which the glTF exporter ignores.
    mat.diffuse_color = srgb(PREVIEW_COLORS[name])
    mat.roughness = rough
    mat.metallic = 0.0
    return mat


class Model:
    """Collects primitives in one bmesh; each face carries its material index."""

    def __init__(self):
        self.bm = bmesh.new()
        self.names = list(MATERIALS)
        self.center = False
        # Wall-mounted: modelled at its mounting height above z = 0 (the floor); the catalog marks
        # it `mounted` so the viewer keeps that height instead of setting the model on the floor.
        self.mounted = False

    def _tag(self, faces, mat):
        idx = self.names.index(mat)
        for f in faces:
            f.material_index = idx

    def box(self, w, d, h, x=0.0, y=0.0, z=0.0, mat='body', bevel=0.01, rx=0.0, rz=0.0, ry=0.0):
        """Box of size w (x) × d (y) × h (z), centered at x/y, base at z, optional tilt/turn."""
        m = (Matrix.Translation((x, y, z + h / 2)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(rx, 4, 'X')
             @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Diagonal((w, d, h, 1.0)))
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)['verts']
        faces = {f for v in verts for f in v.link_faces}
        self._tag(faces, mat)
        bevel = min(bevel, 0.3 * min(w, d, h))
        if bevel > 0.001:
            edges = list({e for v in verts for e in v.link_edges})
            res = bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=1,
                                  profile=0.5, affect='EDGES', clamp_overlap=True)
            self._tag(res['faces'], mat)

    def cyl(self, r, h, center, mat='body', axis='Z', r2=None, seg=24):
        """Cylinder (or cone with r2) of length h along `axis`, centered at `center`."""
        rot = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'),
               'Y': Matrix.Rotation(math.pi / 2, 4, 'X')}[axis]
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                                    radius2=r if r2 is None else r2, depth=h,
                                    matrix=Matrix.Translation(center) @ rot)
        self._tag({f for v in res['verts'] for f in v.link_faces}, mat)

    def vcyl(self, r, h, x, y, z0, mat='body', r2=None, seg=24):
        """Vertical cylinder standing at x/y on z0."""
        self.cyl(r, h, (x, y, z0 + h / 2), mat, 'Z', r2, seg)

    def sphere(self, r, center, mat='metal'):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=16, v_segments=8, radius=r,
                                        matrix=Matrix.Translation(center))
        self._tag({f for v in res['verts'] for f in v.link_faces}, mat)

    def ellipsoid(self, radii, center, mat='body', seg=24):
        """Ellipsoid with radii (x, y, z): vessel heads, domed tube ends."""
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=max(6, seg // 2), radius=1.0,
                                        matrix=Matrix.Translation(center) @ Matrix.Diagonal((*radii, 1.0)))
        self._tag({f for v in res['verts'] for f in v.link_faces}, mat)

    def strut(self, p0, p1, t, mat='metal'):
        """Square bar of thickness t from p0 to p1 (braces, handles)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        m = Matrix.Translation((p0 + p1) / 2) @ rot @ Matrix.Diagonal((t, t, d.length, 1.0))
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)['verts']
        self._tag({f for v in verts for f in v.link_faces}, mat)

    def build(self, name):
        bm = self.bm
        if self.center:
            # Move the footprint center to the origin (for models drawn off-center, e.g. vehicles).
            xs = [v.co.x for v in bm.verts]
            ys = [v.co.y for v in bm.verts]
            shift = Vector((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0))
            bmesh.ops.translate(bm, vec=shift, verts=bm.verts)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        # Smooth shading with sharp edges above 35° (auto smooth, baked as sharp edges).
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(math.pi) < math.radians(35)
        used = sorted({f.material_index for f in bm.faces})
        remap = {old: new for new, old in enumerate(used)}
        for f in bm.faces:
            f.material_index = remap[f.material_index]
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        for old in used:
            mesh.materials.append(material(self.names[old]))
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# --------------------------------------------------------------------------------- building blocks

def cylinder(m, x, y, z=0.0, h=1.45, r=0.115):
    """A gas cylinder (accent body, shoulder, valve and guard cap)."""
    m.vcyl(r * 0.9, 0.03, x, y, z, 'dark')
    m.vcyl(r, h - 0.22, x, y, z + 0.03, 'accent')
    m.vcyl(r, 0.1, x, y, z + h - 0.19, 'accent', r2=r * 0.4)
    m.vcyl(0.025, 0.05, x, y, z + h - 0.09, 'metal', seg=12)
    m.vcyl(0.05, 0.05, x, y, z + h - 0.05, 'metal', seg=16)


def valve(m, center, axis='X'):
    """Valve body on a pipe with an accent hand wheel on top."""
    x, y, z = center
    m.box(0.07, 0.07, 0.07, x, y, z - 0.035, 'metal', bevel=0.008)
    m.vcyl(0.01, 0.06, x, y, z + 0.035, 'metal', seg=8)
    m.vcyl(0.045, 0.012, x, y, z + 0.09, 'accent', seg=16)


# -------------------------------------------------------------------------------------- the models

def gas_cylinder():
    m = Model()
    cylinder(m, 0, 0)
    return m


def gas_cylinder_bank():
    m = Model()
    m.box(1.24, 0.66, 0.05, 0, 0, 0, 'metal', bevel=0.008)
    for x in (-0.6, 0.6):
        m.box(0.05, 0.05, 1.65, x, 0.29, 0.05, 'metal', bevel=0.006)
    m.box(1.25, 0.05, 0.05, 0, 0.29, 1.62, 'metal', bevel=0.006)
    for z in (0.75, 1.15):
        m.box(1.25, 0.03, 0.04, 0, -0.31, z, 'metal', bevel=0.005)
        for x in (-0.6, 0.6):
            m.box(0.03, 0.62, 0.04, x, -0.01, z, 'metal', bevel=0.005)
    for x in (-0.42, -0.14, 0.14, 0.42):
        for y in (-0.14, 0.14):
            cylinder(m, x, y, 0.05, h=1.42)
    # header with pigtails to the back row
    m.cyl(0.022, 1.2, (0, 0.29, 1.56), 'metal', axis='X', seg=12)
    for x in (-0.42, -0.14, 0.14, 0.42):
        m.cyl(0.01, 0.1, (x, 0.22, 1.56), 'metal', axis='Y', seg=8)
    return m


def gas_cabinet():
    m = Model()
    m.box(0.9, 0.6, 0.08, 0, 0, 0, 'dark', bevel=0.005)
    m.box(0.9, 0.6, 1.95, 0, 0, 0.08, 'body', bevel=0.02)
    m.box(0.78, 0.02, 1.55, 0, -0.305, 0.25, 'panel', bevel=0.004)
    m.box(0.36, 0.022, 0.32, -0.05, -0.31, 1.32, 'dark', bevel=0.004)
    m.box(0.03, 0.04, 0.26, 0.33, -0.33, 0.9, 'metal', bevel=0.006)
    m.box(0.22, 0.022, 0.16, 0.24, -0.31, 1.7, 'dark', bevel=0.004)
    for i, x in enumerate((0.17, 0.22, 0.27)):
        m.box(0.025, 0.012, 0.025, x, -0.322, 1.82, 'accent' if i == 0 else 'panel', bevel=0)
    # exhaust duct and process lines out of the roof
    m.vcyl(0.1, 0.32, -0.2, 0.05, 2.03, 'accent')
    m.vcyl(0.115, 0.04, -0.2, 0.05, 2.03, 'metal')
    for x in (0.15, 0.27):
        m.vcyl(0.022, 0.3, x, 0.12, 2.03, 'accent', seg=12)
    return m


def valve_manifold_panel():
    m = Model()
    for x in (-0.47, 0.47):
        m.box(0.06, 0.3, 0.04, x, 0, 0, 'metal', bevel=0.005)
        m.box(0.05, 0.05, 1.8, x, 0.05, 0.04, 'metal', bevel=0.006)
    m.box(1.0, 0.04, 0.95, 0, 0.05, 0.8, 'panel', bevel=0.01)
    for x in (-0.3, 0.0, 0.3):
        m.vcyl(0.022, 1.55, x, -0.04, 0.08, 'accent', seg=12)
        valve(m, (x, -0.04, 1.0))
        m.cyl(0.045, 0.03, (x, 0.015, 1.35), 'dark', axis='Y')
        m.cyl(0.05, 0.012, (x, 0.0, 1.35), 'metal', axis='Y')
    m.cyl(0.03, 0.82, (0, -0.04, 1.6), 'accent', axis='X', seg=12)
    for x in (-0.41, 0.41):
        m.sphere(0.035, (x, -0.04, 1.6))
    return m


def pipe_support(m, x, y, h=2.45):
    m.box(0.25, 0.25, 0.03, x, y, 0, 'metal', bevel=0.004)
    m.box(0.08, 0.08, h, x, y, 0.03, 'metal', bevel=0.008)
    m.box(0.12, 0.3, 0.06, x, y, h, 'metal', bevel=0.006)


PIPE_Z = 2.6
PIPE_R = 0.06


def pipe_run():
    m = Model()
    for x in (-0.75, 0.75):
        pipe_support(m, x, 0)
    m.cyl(PIPE_R, 2.0, (0, 0, PIPE_Z), 'accent', axis='X')
    for x in (-0.985, 0.985):
        m.cyl(PIPE_R + 0.025, 0.03, (x, 0, PIPE_Z), 'metal', axis='X')
    return m


def pipe_run_corner():
    m = Model()
    pipe_support(m, 0, 0)
    m.cyl(PIPE_R, 1.0, (0.5, 0, PIPE_Z), 'accent', axis='X')
    m.cyl(PIPE_R, 1.0, (0, -0.5, PIPE_Z), 'accent', axis='Y')
    m.sphere(PIPE_R + 0.02, (0, 0, PIPE_Z), 'accent')
    m.cyl(PIPE_R + 0.025, 0.03, (0.985, 0, PIPE_Z), 'metal', axis='X')
    m.cyl(PIPE_R + 0.025, 0.03, (0, -0.985, PIPE_Z), 'metal', axis='Y')
    return m


def pipe_run_tee():
    m = Model()
    pipe_support(m, 0, 0)
    m.cyl(PIPE_R, 2.0, (0, 0, PIPE_Z), 'accent', axis='X')
    m.cyl(PIPE_R, 1.0, (0, -0.5, PIPE_Z), 'accent', axis='Y')
    m.sphere(PIPE_R + 0.02, (0, 0, PIPE_Z), 'accent')
    valve(m, (0, -0.55, PIPE_Z + PIPE_R))
    for c, axis in (((0.985, 0, PIPE_Z), 'X'), ((-0.985, 0, PIPE_Z), 'X'), ((0, -0.985, PIPE_Z), 'Y')):
        m.cyl(PIPE_R + 0.025, 0.03, c, 'metal', axis=axis)
    return m


def pipe_riser():
    """A vertical drop from overhead to a valve station near the floor."""
    m = Model()
    m.box(0.3, 0.3, 0.04, 0, 0, 0, 'metal', bevel=0.004)
    m.vcyl(PIPE_R, PIPE_Z - 0.04, 0, 0, 0.04, 'accent')
    m.sphere(PIPE_R + 0.02, (0, 0, PIPE_Z), 'accent')
    m.cyl(PIPE_R, 0.5, (0, 0.25, PIPE_Z), 'accent', axis='Y')
    valve(m, (0, -0.07, 1.1))
    m.cyl(0.04, 0.03, (0.0, -0.07, 1.45), 'dark', axis='Y')
    return m


def scrubber_tower():
    m = Model()
    m.box(1.8, 1.8, 0.3, 0, 0, 0, 'panel', bevel=0.02)
    m.vcyl(0.7, 4.6, 0, 0, 0.3, 'body', seg=40)
    for z in (1.4, 2.6, 3.8):
        m.vcyl(0.72, 0.06, 0, 0, z, 'metal', seg=40)
    m.vcyl(0.7, 0.5, 0, 0, 4.9, 'body', r2=0.28, seg=40)
    m.vcyl(0.28, 0.9, 0, 0, 5.4, 'body', seg=24)
    m.vcyl(0.3, 0.05, 0, 0, 6.3, 'metal', seg=24)
    # inlet duct at the front, ladder at the back
    m.cyl(0.22, 0.6, (0, -0.95, 1.0), 'accent', axis='Y')
    m.cyl(0.26, 0.04, (0, -1.25, 1.0), 'metal', axis='Y')
    m.box(0.5, 0.5, 0.6, 0, -1.25, 0.3, 'panel', bevel=0.01)
    for x in (-0.2, 0.2):
        m.box(0.04, 0.04, 4.6, x, 0.74, 0.3, 'metal', bevel=0)
    for i in range(11):
        m.box(0.4, 0.03, 0.03, 0, 0.74, 0.6 + i * 0.4, 'metal', bevel=0)
    return m


def exhaust_stack():
    m = Model()
    m.box(1.3, 1.3, 0.4, 0, 0, 0, 'panel', bevel=0.02)
    m.vcyl(0.42, 7.4, 0, 0, 0.4, 'body', seg=36)
    for z in (1.8, 3.4, 5.0, 6.6):
        m.vcyl(0.44, 0.06, 0, 0, z, 'metal', seg=36)
    m.vcyl(0.47, 0.12, 0, 0, 7.8, 'metal', seg=36)
    m.cyl(0.22, 0.55, (0, -0.68, 1.1), 'accent', axis='Y')
    m.cyl(0.26, 0.04, (0, -0.95, 1.1), 'metal', axis='Y')
    return m


def process_tool():
    m = Model()
    m.box(1.2, 1.0, 0.1, 0, 0, 0, 'dark', bevel=0.005)
    m.box(1.2, 1.0, 1.7, 0, 0, 0.1, 'body', bevel=0.03)
    m.box(1.22, 1.02, 0.05, 0, 0, 1.5, 'accent', bevel=0.01)
    m.box(0.42, 0.025, 0.55, 0.28, -0.505, 0.65, 'dark', bevel=0.006)
    m.box(0.36, 0.2, 0.06, -0.3, -0.58, 1.08, 'panel', bevel=0.01)
    m.box(0.36, 0.03, 0.26, -0.3, -0.53, 1.18, 'dark', bevel=0.006, rx=math.radians(-18))
    m.vcyl(0.09, 0.35, 0.3, 0.2, 1.8, 'accent')
    m.vcyl(0.02, 0.22, -0.52, -0.42, 1.8, 'metal', seg=8)
    for i, mat in enumerate(('accent', 'panel', 'panel')):
        m.vcyl(0.032, 0.05, -0.52, -0.42, 2.02 + i * 0.05, mat, seg=12)
    return m


def lab_workbench():
    m = Model()
    for x in (-0.95, 0.95):
        for y in (-0.35, 0.35):
            m.box(0.05, 0.05, 0.86, x, y, 0, 'metal', bevel=0.006)
    m.box(1.9, 0.7, 0.03, 0, 0, 0.18, 'panel', bevel=0.004)
    m.box(2.0, 0.8, 0.05, 0, 0, 0.86, 'body', bevel=0.01)
    for x in (-0.97, 0.97):
        m.box(0.04, 0.04, 1.05, x, 0.36, 0.91, 'metal', bevel=0.005)
    m.box(2.0, 0.34, 0.03, 0, 0.23, 1.5, 'body', bevel=0.005)
    m.box(2.0, 0.04, 0.04, 0, 0.36, 1.92, 'metal', bevel=0.005)
    # gas outlets along the back
    m.cyl(0.016, 1.9, (0, 0.33, 1.2), 'accent', axis='X', seg=10)
    for x in (-0.6, 0.0, 0.6):
        m.box(0.08, 0.06, 0.1, x, 0.3, 1.15, 'accent', bevel=0.008)
        m.cyl(0.008, 0.06, (x, 0.25, 1.2), 'metal', axis='Y', seg=8)
    return m


def fume_hood():
    m = Model()
    m.box(1.5, 0.85, 0.85, 0, 0, 0, 'body', bevel=0.015)
    for x in (-0.36, 0.36):
        m.box(0.7, 0.02, 0.7, x, -0.425, 0.08, 'panel', bevel=0.004)
    m.box(1.5, 0.85, 0.04, 0, 0, 0.85, 'panel', bevel=0.005)
    for x in (-0.72, 0.72):
        m.box(0.06, 0.85, 1.0, x, 0, 0.89, 'body', bevel=0.01)
    m.box(1.5, 0.06, 1.0, 0, 0.395, 0.89, 'body', bevel=0.01)
    m.box(1.5, 0.85, 0.36, 0, 0, 1.89, 'body', bevel=0.015)
    m.box(1.38, 0.02, 0.62, 0, -0.39, 1.22, 'dark', bevel=0.004)
    m.box(1.38, 0.05, 0.05, 0, -0.4, 1.2, 'metal', bevel=0.006)
    m.box(0.2, 0.02, 0.12, 0.55, -0.43, 2.0, 'dark', bevel=0.003)
    m.vcyl(0.16, 0.4, 0, 0.1, 2.25, 'accent')
    m.vcyl(0.18, 0.04, 0, 0.1, 2.25, 'metal')
    return m


def lab_stool():
    m = Model()
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        m.box(0.42, 0.04, 0.03, 0.105 * math.cos(ang), 0.105 * math.sin(ang), 0.0, 'metal', bevel=0.004, rz=ang)
    m.vcyl(0.03, 0.56, 0, 0, 0.03, 'metal', seg=12)
    m.vcyl(0.16, 0.015, 0, 0, 0.28, 'metal', r2=0.16, seg=24)
    m.vcyl(0.19, 0.07, 0, 0, 0.59, 'body', seg=28)
    return m


def electrical_cabinet():
    m = Model()
    m.box(1.2, 0.5, 0.1, 0, 0, 0, 'dark', bevel=0.005)
    m.box(1.2, 0.5, 1.9, 0, 0, 0.1, 'body', bevel=0.02)
    for x in (-0.3, 0.3):
        m.box(0.56, 0.02, 1.75, x, -0.255, 0.17, 'panel', bevel=0.004)
        m.box(0.03, 0.04, 0.22, x + (0.24 if x < 0 else -0.24), -0.275, 1.0, 'metal', bevel=0.006)
        for i in range(4):
            m.box(0.3, 0.022, 0.02, x, -0.262, 0.3 + i * 0.05, 'dark', bevel=0)
    for i, mat in enumerate(('accent', 'accent', 'panel')):
        m.cyl(0.022, 0.02, (-0.45 + i * 0.07, -0.27, 1.8), mat, axis='Y', seg=12)
    m.box(0.2, 0.022, 0.12, 0.35, -0.262, 1.75, 'dark', bevel=0.003)
    m.box(0.4, 0.3, 0.2, 0, 0.0, 2.0, 'accent', bevel=0.01)
    return m


def cylinder_cart():
    m = Model()
    m.box(0.5, 0.36, 0.03, 0, -0.04, 0.04, 'metal', bevel=0.005)
    for x in (-0.22, 0.22):
        m.box(0.03, 0.03, 1.2, x, 0.15, 0.04, 'metal', bevel=0.004)
        m.cyl(0.12, 0.05, (x + (-0.04 if x < 0 else 0.04), 0.14, 0.12), 'dark', axis='X')
    m.box(0.47, 0.03, 0.03, 0, 0.15, 1.24, 'metal', bevel=0.004)
    m.box(0.47, 0.03, 0.03, 0, 0.15, 0.85, 'metal', bevel=0.004)
    m.cyl(0.015, 0.4, (0, 0.15, 1.36), 'metal', axis='X', seg=8)
    for x in (-0.11, 0.11):
        cylinder(m, x, -0.02, 0.07, h=1.1, r=0.095)
    return m


def tube_trailer():
    m = Model()
    m.box(2.0, 5.6, 0.22, 0, 0.15, 0.62, 'metal', bevel=0.02)
    for y in (1.4, 2.35):
        for x in (-0.95, 0.95):
            m.cyl(0.45, 0.32, (x, y, 0.45), 'dark', axis='X', seg=28)
            m.cyl(0.25, 0.34, (x, y, 0.45), 'panel', axis='X', seg=20)
    for x in (-0.7, 0.7):
        m.box(0.12, 0.12, 0.55, x, -2.1, 0.07, 'metal', bevel=0.01)
        m.box(0.3, 0.3, 0.05, x, -2.1, 0.02, 'metal', bevel=0.005)
    for y in (-2.45, 2.75):
        m.box(2.2, 0.16, 1.7, 0, y, 0.84, 'body', bevel=0.02)
    for x in (-0.58, 0.0, 0.58):
        for z in (1.2, 1.8):
            m.cyl(0.27, 5.0, (x, 0.15, z), 'accent', axis='Y', seg=28)
    m.box(2.2, 5.36, 0.06, 0, 0.15, 2.18, 'body', bevel=0.01)
    m.box(1.9, 0.6, 1.45, 0, -2.85, 0.84, 'body', bevel=0.02)
    m.box(1.4, 0.02, 0.6, 0, -3.155, 1.35, 'dark', bevel=0.004)
    for x in (-0.45, 0.0, 0.45):
        valve(m, (x, -3.2, 1.1))
    return m


# ------------------------------------------------------------------------------ more building blocks

def vessel(m, x, y, z0, r, h, mat='body', head=0.3, seg=32):
    """Vertical vessel: a cylinder of total height h (heads included) standing on z0, domed ends."""
    hz = r * head
    m.vcyl(r, h - 2 * hz, x, y, z0 + hz, mat, seg=seg)
    m.ellipsoid((r, r, hz), (x, y, z0 + hz), mat, seg=seg)
    m.ellipsoid((r, r, hz), (x, y, z0 + h - hz), mat, seg=seg)


def slats(m, w, h, x, y, z, n, mat='dark', t=0.02):
    """Louvre slats on a front face at y (w wide, h tall from z)."""
    step = h / n
    for i in range(n):
        m.box(w, t, step * 0.45, x, y, z + i * step + step * 0.25, mat, bevel=0)


def frame(m, w, d, h, x=0.0, y=0.0, z=0.0, t=0.05, mat='metal', top=True, bottom=True):
    """Open box frame: four posts (t square) and rails, rails slightly thinner so faces never coincide."""
    r = t * 0.8
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box(t, t, h, x + sx * (w - t) / 2, y + sy * (d - t) / 2, z, mat, bevel=0.004)
    levels = ([z] if bottom else []) + ([z + h - r] if top else [])
    for lz in levels:
        for sy in (-1, 1):
            m.box(w - t, r, r, x, y + sy * (d - t) / 2, lz, mat, bevel=0.003)
        for sx in (-1, 1):
            m.box(r, d - t, r, x + sx * (w - t) / 2, y, lz, mat, bevel=0.003)


def light_tower(m, x, y, z):
    m.vcyl(0.012, 0.12, x, y, z, 'metal', seg=8)
    for i, mat in enumerate(('accent', 'panel', 'panel')):
        m.vcyl(0.03, 0.05, x, y, z + 0.12 + i * 0.05, mat, seg=12)


def foup(m, x, y, z):
    """A load port: shelf with a FOUP (wafer carrier) on it, in front of a face at y."""
    m.box(0.42, 0.42, 0.06, x, y - 0.2, z, 'panel', bevel=0.008)
    m.box(0.36, 0.33, 0.32, x, y - 0.22, z + 0.06, 'body', bevel=0.03)
    m.box(0.3, 0.02, 0.26, x, y - 0.39, z + 0.09, 'panel', bevel=0.005)
    m.box(0.12, 0.04, 0.03, x, y - 0.22, z + 0.38, 'metal', bevel=0.005)


def drum(m, x, y, z=0.0):
    """A 200 l steel drum (accent) with rolling hoops and bungs."""
    r, h = 0.293, 0.88
    m.vcyl(r, h, x, y, z, 'accent', seg=32)
    for hz in (0.29, 0.57):
        m.vcyl(r + 0.01, 0.025, x, y, z + hz, 'accent', seg=32)
    m.vcyl(r + 0.006, 0.02, x, y, z + h - 0.01, 'metal', seg=32)
    m.vcyl(0.03, 0.015, x - 0.17, y, z + h + 0.01, 'metal', seg=12)
    m.vcyl(0.02, 0.015, x + 0.19, y, z + h + 0.01, 'metal', seg=12)


def fork_pockets(m, w, y, z, h, xs, mat='dark'):
    for x in xs:
        m.box(w, 0.01, h, x, y, z, mat, bevel=0)


# ------------------------------------------------------------------------------------- bulk supply

def bulk_tank():
    """Vertical vacuum-insulated cryogenic tank (LIN/LOX/LAR), 2.5 m wide, about 10 m tall."""
    m = Model()
    m.box(3.4, 3.4, 0.15, 0, 0, 0, 'panel', bevel=0.02)
    for a in range(4):
        ang = math.pi / 4 + a * math.pi / 2
        x, y = 0.95 * math.cos(ang), 0.95 * math.sin(ang)
        m.box(0.34, 0.34, 0.03, x, y, 0.15, 'metal', bevel=0.004)
        m.box(0.16, 0.16, 1.45, x, y, 0.18, 'metal', bevel=0.01)
    r = 1.25
    m.vcyl(r, 7.5, 0, 0, 1.5, 'body', seg=40)
    m.ellipsoid((r, r, 0.45), (0, 0, 1.5), 'body', seg=40)
    m.ellipsoid((r, r, 0.5), (0, 0, 9.0), 'body', seg=40)
    for z in (3.4, 6.2):
        m.vcyl(r + 0.02, 0.05, 0, 0, z, 'panel', seg=40)
    # level / fill lines up the front and the vent and relief valves on top
    for x in (-0.35, 0.35):
        m.vcyl(0.03, 7.55, x, -1.33, 1.5, 'accent', seg=12)
        m.cyl(0.03, 0.25, (x, -1.22, 9.03), 'accent', axis='Y', seg=12)
    m.vcyl(0.05, 0.45, 0.3, 0.2, 9.35, 'accent', seg=12)
    m.vcyl(0.035, 0.35, -0.3, -0.2, 9.35, 'accent', seg=12)
    # base piping: header, drops into the bottom head, valves, gauge board
    m.cyl(0.05, 2.0, (0, -1.5, 0.75), 'accent', axis='X', seg=16)
    for x in (-0.9, 0.9):
        m.vcyl(0.045, 1.0, x, -1.5, 0.15, 'metal', seg=12)
    for x in (-0.45, 0.45):
        m.vcyl(0.05, 0.85, x, -1.5, 0.75, 'accent', seg=16)
        m.sphere(0.06, (x, -1.5, 1.6), 'accent')
        m.cyl(0.05, 0.4, (x, -1.3, 1.6), 'accent', axis='Y', seg=16)
    for x in (-0.7, 0.0, 0.7):
        valve(m, (x, -1.5, 0.8))
    m.box(0.5, 0.05, 0.45, 0, -1.47, 1.15, 'panel', bevel=0.01)
    for x in (-0.12, 0.12):
        m.cyl(0.07, 0.02, (x, -1.505, 1.4), 'dark', axis='Y', seg=16)
    # pressure-building coil beside the tank
    m.box(0.5, 0.5, 0.06, 1.35, -1.25, 0.15, 'metal', bevel=0.005)
    for x in (1.23, 1.47):
        m.vcyl(0.035, 1.6, x, -1.25, 0.21, 'accent', seg=12)
        for k in range(2):
            m.box(0.2, 0.012, 1.4, x, -1.25, 0.3, 'body', bevel=0, rz=k * math.pi / 2)
    m.cyl(0.035, 0.28, (1.35, -1.25, 1.81), 'accent', axis='X', seg=12)
    return m


def ambient_vaporizer():
    """Bank of finned ambient-air vaporizer columns on a skid."""
    m = Model()
    m.box(2.0, 1.0, 0.12, 0, 0, 0, 'metal', bevel=0.01)
    frame(m, 2.0, 1.0, 4.9, 0, 0, 0.12, t=0.07, bottom=False)
    for x in (-0.72, -0.24, 0.24, 0.72):
        for y in (-0.24, 0.24):
            m.vcyl(0.045, 4.5, x, y, 0.22, 'accent', seg=12)
            for k in range(4):
                m.box(0.44, 0.014, 4.1, x, y, 0.42, 'body', bevel=0, rz=k * math.pi / 4)
    for y in (-0.24, 0.24):
        m.cyl(0.055, 1.6, (0, y, 4.75), 'accent', axis='X', seg=16)
        m.cyl(0.055, 1.6, (0, y, 0.3), 'accent', axis='X', seg=16)
    m.cyl(0.055, 0.6, (0.8, 0, 4.75), 'accent', axis='Y', seg=16)
    # inlet and outlet at the front
    for x, z in ((-0.85, 0.3), (0.85, 0.3)):
        m.cyl(0.05, 0.45, (x, -0.42, z), 'accent', axis='Y', seg=16)
        m.cyl(0.07, 0.03, (x, -0.64, z), 'metal', axis='Y', seg=16)
    return m


def iso_tube_container():
    """20 ft ISO frame with nine horizontal high-pressure tubes and a valve compartment (MEGC)."""
    m = Model()
    L, W, H = 6.06, 2.44, 2.59
    t = 0.16
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box(t, t, H, sx * (L - t) / 2, sy * (W - t) / 2, 0, 'metal', bevel=0.01)
    for z in (0.0, H - 0.15):
        for sy in (-1, 1):
            m.box(L - t, 0.13, 0.15, 0, sy * (W - t) / 2, z, 'metal', bevel=0.008)
        for sx in (-1, 1):
            m.box(0.13, W - t, 0.15, sx * (L - t) / 2, 0, z, 'metal', bevel=0.008)
    for x in (-1.5, 0.0, 1.5):
        m.box(0.12, W - t, 0.12, x, 0, 0.01, 'metal', bevel=0.006)
    for x in (-2.55, 1.95):
        m.box(0.08, W - 0.3, 2.15, x, 0, 0.15, 'metal', bevel=0.006)
    for y in (-0.66, 0.0, 0.66):
        for z in (0.55, 1.26, 1.97):
            m.cyl(0.3, 4.7, (-0.35, y, z), 'accent', axis='X', seg=28)
            m.ellipsoid((0.16, 0.3, 0.3), (-2.7, y, z), 'accent', seg=24)
            m.ellipsoid((0.16, 0.3, 0.3), (2.0, y, z), 'accent', seg=24)
            m.cyl(0.03, 0.3, (2.25, y, z), 'metal', axis='X', seg=10)
    # valve compartment at the +x end with a manifold behind a door
    m.box(0.55, 2.1, 2.2, 2.62, 0, 0.15, 'body', bevel=0.02)
    m.box(0.02, 1.7, 1.6, 2.9, 0, 0.45, 'panel', bevel=0.004)
    m.box(0.03, 0.05, 0.3, 2.915, 0.7, 1.1, 'metal', bevel=0.005)
    return m


def cylinder_bundle():
    """Twelve-cylinder bundle (MCP): cylinders in a steel frame on a pallet base, one outlet."""
    m = Model()
    m.box(1.0, 0.8, 0.12, 0, 0, 0, 'metal', bevel=0.01)
    fork_pockets(m, 0.22, -0.401, 0.02, 0.07, (-0.25, 0.25))
    frame(m, 1.0, 0.8, 1.85, 0, 0, 0.12, t=0.06, bottom=False)
    for z in (0.55, 1.2):
        for sy in (-1, 1):
            m.box(0.94, 0.04, 0.05, 0, sy * 0.38, z, 'metal', bevel=0.004)
        for sx in (-1, 1):
            m.box(0.04, 0.74, 0.05, sx * 0.48, 0, z, 'metal', bevel=0.004)
    xs = (-0.36, -0.12, 0.12, 0.36)
    ys = (-0.24, 0.0, 0.24)
    for x in xs:
        for y in ys:
            cylinder(m, x, y, 0.12, h=1.62, r=0.112)
    for y in ys:
        m.cyl(0.018, 0.86, (0, y, 1.82), 'accent', axis='X', seg=10)
        for x in xs:
            m.vcyl(0.008, 0.06, x, y, 1.76, 'metal', seg=6)
    m.cyl(0.02, 0.56, (0.43, 0.0, 1.82), 'accent', axis='Y', seg=10)
    m.vcyl(0.02, 0.85, 0.43, -0.3, 0.97, 'accent', seg=10)
    m.cyl(0.02, 0.06, (0.43, -0.27, 1.82), 'accent', axis='Y', seg=10)
    valve(m, (0.43, -0.3, 0.97))
    for x in (-0.3, 0.3):
        m.box(0.08, 0.02, 0.12, x, 0, 1.94, 'metal', bevel=0.004)
    m.box(0.94, 0.06, 0.04, 0, 0, 1.92, 'metal', bevel=0.004)
    return m


def cylinder_cage():
    """Mesh-fenced cylinder store with a gate, cylinders chained along the back."""
    m = Model()
    W, D, H = 3.0, 1.6, 2.2
    for x in (-1.5, -0.5, 0.5, 1.5):
        for y in (-0.8, 0.8):
            m.box(0.16, 0.16, 0.01, x * 0.98, y * 0.97, 0, 'metal', bevel=0)
            m.box(0.06, 0.06, H, x * 0.98, y * 0.97, 0.01, 'metal', bevel=0.004)
    xo, yo = 1.47, 0.776
    for z in (0.1, 1.15, 2.15):
        m.box(2 * xo, 0.04, 0.04, 0, yo, z, 'metal', bevel=0.004)
        for sx in (-1, 1):
            m.box(0.04, 2 * yo, 0.04, sx * xo, 0, z, 'metal', bevel=0.004)
        m.box(1.92, 0.04, 0.04, -0.5, -yo, z, 'metal', bevel=0.004)
    # mesh: thin vertical wires
    n = int(2 * xo / 0.1)
    for i in range(1, n):
        x = -xo + i * 2 * xo / n
        m.box(0.012, 0.012, 2.05, x, yo, 0.12, 'metal', bevel=0)
        if x < 0.44:
            m.box(0.012, 0.012, 2.05, x, -yo, 0.12, 'metal', bevel=0)
    n = int(2 * yo / 0.1)
    for i in range(1, n):
        y = -yo + i * 2 * yo / n
        for sx in (-1, 1):
            m.box(0.012, 0.012, 2.05, sx * xo, y, 0.12, 'metal', bevel=0)
    # gate (slightly proud of the fence), with a brace and a handle
    gx0, gx1, gy = 0.55, 1.42, -yo - 0.05
    for x in (gx0, gx1):
        m.box(0.04, 0.04, 2.0, x, gy, 0.1, 'metal', bevel=0.004)
    for z in (0.1, 2.06):
        m.box(gx1 - gx0, 0.04, 0.04, (gx0 + gx1) / 2, gy, z, 'metal', bevel=0.004)
    for i in range(1, 9):
        m.box(0.012, 0.012, 1.92, gx0 + i * (gx1 - gx0) / 9, gy, 0.14, 'metal', bevel=0)
    m.strut((gx0, gy - 0.01, 0.14), (gx1, gy - 0.01, 2.04), 0.03)
    m.box(0.04, 0.06, 0.18, gx0 + 0.06, gy - 0.05, 1.0, 'accent', bevel=0.006)
    # cylinders: a full back row and half a front row, with a restraint bar
    for i in range(11):
        cylinder(m, -1.3 + i * 0.26, 0.5, 0.0)
    for i in range(5):
        cylinder(m, -1.3 + i * 0.26, 0.2, 0.0)
    m.box(2.94, 0.04, 0.04, 0, 0.66, 1.0, 'metal', bevel=0.004)
    m.box(1.4, 0.03, 0.03, -0.75, 0.05, 1.0, 'metal', bevel=0.004)
    return m


def nitrogen_generator():
    """PSA nitrogen generator skid: two adsorber towers, buffer tank and controls."""
    m = Model()
    m.box(2.2, 1.2, 0.12, 0, 0, 0, 'metal', bevel=0.01)
    for x in (-0.75, -0.25):
        m.vcyl(0.16, 0.12, x, 0.15, 0.12, 'metal', seg=20)
        vessel(m, x, 0.15, 0.24, 0.22, 1.95, 'accent', head=0.4, seg=28)
        m.vcyl(0.035, 0.18, x, 0.15, 2.17, 'accent', seg=12)
    vessel(m, 0.65, 0.15, 0.3, 0.38, 1.8, 'body', head=0.35, seg=32)
    for a in range(3):
        ang = a * 2 * math.pi / 3 + math.pi / 2
        m.box(0.06, 0.06, 0.25, 0.65 + 0.3 * math.cos(ang), 0.15 + 0.3 * math.sin(ang), 0.12, 'metal', bevel=0.004)
    m.vcyl(0.035, 0.25, 0.65, 0.15, 2.05, 'accent', seg=12)
    m.cyl(0.035, 1.4, (-0.05, 0.15, 2.32), 'accent', axis='X', seg=12)
    for x in (-0.75, -0.25, 0.65):
        m.sphere(0.045, (x, 0.15, 2.32), 'accent')
    # inlet valve block at the tower feet
    m.box(0.75, 0.2, 0.25, -0.5, -0.2, 0.3, 'panel', bevel=0.01)
    for x in (-0.75, -0.25):
        m.cyl(0.035, 0.22, (x, -0.04, 0.42), 'accent', axis='Y', seg=12)
        valve(m, (x, -0.33, 0.62))
    # control cabinet at the front right
    m.box(0.55, 0.3, 1.3, 0.55, -0.4, 0.12, 'body', bevel=0.015)
    m.box(0.22, 0.02, 0.15, 0.55, -0.555, 1.1, 'dark', bevel=0.003)
    m.box(0.4, 0.02, 0.5, 0.55, -0.555, 0.35, 'panel', bevel=0.004)
    light_tower(m, 0.75, -0.4, 1.42)
    return m


def hydrogen_generator():
    """Electrolyser cabinet producing hydrogen, with vent stacks and louvred doors."""
    m = Model()
    m.box(2.4, 1.2, 0.1, 0, 0, 0, 'dark', bevel=0.005)
    m.box(2.4, 1.2, 2.0, 0, 0, 0.1, 'body', bevel=0.025)
    for x in (-0.8, 0.0, 0.8):
        m.box(0.74, 0.02, 1.8, x, -0.605, 0.2, 'panel', bevel=0.005)
        slats(m, 0.6, 0.45, x, -0.62, 0.3, 6)
        m.box(0.03, 0.04, 0.25, x + 0.3, -0.63, 1.0, 'metal', bevel=0.006)
    m.box(0.3, 0.022, 0.2, -0.8, -0.62, 1.4, 'dark', bevel=0.004)
    for i in range(3):
        m.box(0.03, 0.012, 0.03, -0.9 + i * 0.07, -0.62, 1.68, 'accent' if i == 0 else 'panel', bevel=0)
    m.box(2.44, 1.24, 0.06, 0, 0, 1.95, 'accent', bevel=0.01)
    # roof: ventilation hood and H2 / O2 vent stacks
    m.box(0.8, 0.6, 0.3, -0.5, 0.1, 2.1, 'panel', bevel=0.02)
    slats(m, 0.7, 0.24, -0.5, -0.205, 2.13, 4)
    m.vcyl(0.045, 1.2, 0.6, 0.35, 2.1, 'accent', seg=12)
    m.vcyl(0.06, 0.08, 0.6, 0.35, 3.3, 'accent', seg=12, r2=0.03)
    m.vcyl(0.035, 0.9, 0.85, 0.35, 2.1, 'accent', seg=12)
    # side connections: water in, hydrogen out
    for z, r in ((0.5, 0.025), (0.8, 0.03)):
        m.cyl(r, 0.3, (1.33, 0.2, z), 'accent', axis='X', seg=12)
        m.cyl(r + 0.02, 0.02, (1.48, 0.2, z), 'metal', axis='X', seg=12)
    return m


def air_compressor_skid():
    """Screw air compressor package with a refrigerant dryer and a vertical air receiver."""
    m = Model()
    m.box(1.5, 1.0, 0.08, -0.6, 0, 0, 'dark', bevel=0.005)
    m.box(1.5, 1.0, 1.5, -0.6, 0, 0.08, 'body', bevel=0.03)
    m.box(0.6, 0.02, 0.7, -0.95, -0.505, 0.3, 'panel', bevel=0.005)
    slats(m, 0.5, 0.6, -0.95, -0.52, 0.35, 8)
    m.box(0.25, 0.022, 0.18, -0.25, -0.51, 1.2, 'dark', bevel=0.004)
    m.cyl(0.03, 0.02, (-0.45, -0.51, 1.28), 'accent', axis='Y', seg=12)
    m.vcyl(0.3, 0.02, -0.7, 0.1, 1.58, 'dark', seg=28)
    m.vcyl(0.06, 0.04, -0.7, 0.1, 1.6, 'metal', seg=12)
    # dryer
    m.box(0.45, 0.6, 1.1, 0.42, -0.1, 0.0, 'body', bevel=0.02)
    m.box(0.3, 0.02, 0.12, 0.42, -0.405, 0.85, 'dark', bevel=0.003)
    slats(m, 0.35, 0.4, 0.42, -0.41, 0.15, 5)
    # receiver on three legs
    for a in range(3):
        ang = a * 2 * math.pi / 3 + math.pi / 2
        m.box(0.05, 0.05, 0.3, 1.05 + 0.25 * math.cos(ang), 0.15 + 0.25 * math.sin(ang), 0, 'metal', bevel=0.004)
    vessel(m, 1.05, 0.15, 0.2, 0.36, 1.8, 'accent', head=0.4, seg=32)
    m.cyl(0.08, 0.02, (1.05, -0.215, 1.1), 'panel', axis='Y', seg=16)
    m.vcyl(0.03, 0.2, 1.05, 0.15, 1.95, 'metal', seg=10)
    # piping: compressor → dryer → receiver
    m.vcyl(0.035, 0.3, 0.05, 0.3, 1.2, 'accent', seg=12)
    m.cyl(0.035, 0.25, (0.0, 0.3, 1.5), 'accent', axis='X', seg=12)
    m.sphere(0.04, (0.05, 0.3, 1.5), 'accent')
    m.vcyl(0.035, 0.4, 0.42, 0.3, 1.1, 'accent', seg=12)
    m.cyl(0.035, 0.37, (0.235, 0.3, 1.5), 'accent', axis='X', seg=12)
    m.sphere(0.04, (0.42, 0.3, 1.5), 'accent')
    m.cyl(0.035, 0.3, (0.57, 0.3, 0.8), 'accent', axis='X', seg=12)
    return m


def gas_purifier():
    """Open-frame point-of-use gas purifier: two purifier vessels, controller, valves."""
    m = Model()
    m.box(0.9, 0.6, 0.1, 0, 0, 0, 'dark', bevel=0.005)
    m.box(0.9, 0.6, 0.35, 0, 0, 0.1, 'body', bevel=0.02)
    m.box(0.9, 0.06, 1.55, 0, 0.27, 0.45, 'panel', bevel=0.01)
    for x in (-0.42, 0.42):
        m.box(0.05, 0.05, 1.55, x, -0.25, 0.45, 'metal', bevel=0.004)
    m.box(0.9, 0.6, 0.12, 0, 0, 2.0, 'body', bevel=0.015)
    for x in (-0.2, 0.2):
        vessel(m, x, 0.0, 0.45, 0.13, 1.15, 'accent', head=0.5, seg=24)
        m.vcyl(0.02, 0.4, x, 0.0, 1.6, 'accent', seg=10)
        valve(m, (x, -0.06, 1.8))
    m.cyl(0.02, 0.4, (0, 0.0, 1.92), 'accent', axis='X', seg=10)
    m.box(0.3, 0.02, 0.18, 0.0, -0.31, 0.15, 'dark', bevel=0.003)
    m.box(0.3, 0.12, 0.25, 0.0, 0.18, 1.55, 'body', bevel=0.01)
    m.vcyl(0.08, 0.12, -0.25, 0.1, 2.12, 'accent', seg=16)
    for x in (0.2, 0.3):
        m.vcyl(0.018, 0.3, x, 0.15, 2.12, 'accent', seg=10)
    return m


def bsgs_cabinet():
    """Bulk specialty gas system: a double-width gas cabinet with two exhaust ducts."""
    m = Model()
    m.box(1.8, 0.9, 0.08, 0, 0, 0, 'dark', bevel=0.005)
    m.box(1.8, 0.9, 2.05, 0, 0, 0.08, 'body', bevel=0.025)
    for x in (-0.45, 0.45):
        m.box(0.82, 0.02, 1.6, x, -0.455, 0.25, 'panel', bevel=0.005)
        m.box(0.42, 0.022, 0.36, x - 0.08, -0.46, 1.3, 'dark', bevel=0.004)
        m.box(0.03, 0.04, 0.26, x + (0.34 if x < 0 else -0.34), -0.48, 0.95, 'metal', bevel=0.006)
        m.box(0.2, 0.022, 0.14, x + 0.25, -0.46, 1.85, 'dark', bevel=0.003)
        m.vcyl(0.12, 0.35, x - 0.15, 0.1, 2.13, 'accent', seg=20)
        m.vcyl(0.135, 0.04, x - 0.15, 0.1, 2.13, 'metal', seg=20)
        for dx in (0.15, 0.27):
            m.vcyl(0.022, 0.3, x + dx, 0.2, 2.13, 'accent', seg=10)
    for i, mat in enumerate(('accent', 'panel', 'panel')):
        m.box(0.025, 0.012, 0.025, -0.08 + i * 0.08, -0.462, 1.98, mat, bevel=0)
    return m


# ------------------------------------------------------------------------------------ distribution

def valve_manifold_box():
    """Valve manifold box (VMB) on a floor stand, lines rising to the overhead header."""
    m = Model()
    m.box(0.45, 0.4, 0.02, 0, 0.05, 0, 'metal', bevel=0.003)
    m.box(0.08, 0.08, 1.1, 0, 0.12, 0.02, 'metal', bevel=0.006)
    m.box(0.6, 0.06, 0.06, 0, 0.12, 1.06, 'metal', bevel=0.005)
    m.box(0.6, 0.28, 0.65, 0, 0.0, 1.12, 'body', bevel=0.015)
    m.box(0.5, 0.02, 0.5, 0, -0.145, 1.19, 'panel', bevel=0.004)
    m.box(0.3, 0.022, 0.2, -0.05, -0.15, 1.42, 'dark', bevel=0.004)
    m.box(0.025, 0.04, 0.15, 0.2, -0.165, 1.35, 'metal', bevel=0.005)
    m.cyl(0.02, 0.012, (0.18, -0.16, 1.62), 'accent', axis='Y', seg=12)
    m.vcyl(0.07, 0.83, -0.18, 0.02, 1.77, 'accent', seg=16)
    m.vcyl(0.08, 0.03, -0.18, 0.02, 1.77, 'metal', seg=16)
    for x in (0.0, 0.12, 0.24):
        m.vcyl(0.018, 0.83, x, 0.04, 1.77, 'accent', seg=10)
    return m


def gas_mixing_panel():
    """Gas mixing panel: inlet lines, mass flow controllers, a mixing vessel and an outlet."""
    m = Model()
    for x in (-0.68, 0.68):
        m.box(0.08, 0.5, 0.04, x, 0.05, 0, 'metal', bevel=0.005)
        m.box(0.05, 0.05, 2.0, x, 0.15, 0.04, 'metal', bevel=0.006)
    m.box(1.4, 0.04, 1.4, 0, 0.15, 0.5, 'panel', bevel=0.01)
    m.box(1.31, 0.05, 0.05, 0, 0.15, 1.99, 'metal', bevel=0.005)
    xs = (-0.5, -0.3, -0.1)
    for x in xs:
        m.vcyl(0.016, 1.06, x, 0.08, 0.04, 'accent', seg=10)
        m.box(0.09, 0.08, 0.16, x, 0.08, 1.1, 'body', bevel=0.008)
        m.box(0.06, 0.012, 0.04, x, 0.035, 1.2, 'dark', bevel=0)
        valve(m, (x, 0.04, 0.75))
        m.vcyl(0.016, 0.2, x, 0.08, 1.26, 'accent', seg=10)
    m.cyl(0.02, 0.62, (-0.19, 0.08, 1.46), 'accent', axis='X', seg=10)
    for x in xs:
        m.sphere(0.022, (x, 0.08, 1.46), 'accent')
    vessel(m, 0.35, 0.0, 0.6, 0.12, 0.65, 'accent', head=0.5, seg=24)
    m.cyl(0.02, 0.24, (0.11 + 0.12, 0.08, 1.46), 'accent', axis='X', seg=10)
    m.vcyl(0.02, 0.21, 0.35, 0.05, 1.25, 'accent', seg=10)
    m.sphere(0.022, (0.35, 0.05, 1.46), 'accent')
    m.vcyl(0.02, 0.55, 0.55, 0.08, 1.46, 'accent', seg=10)
    m.cyl(0.02, 0.2, (0.45, 0.08, 1.46), 'accent', axis='X', seg=10)
    m.cyl(0.045, 0.025, (0.2, 0.05, 1.75), 'dark', axis='Y')
    m.cyl(0.05, 0.012, (0.2, 0.065, 1.75), 'metal', axis='Y')
    # controller with a screen at the top left
    m.box(0.4, 0.15, 0.3, -0.35, 0.06, 1.6, 'body', bevel=0.01)
    m.box(0.26, 0.02, 0.16, -0.35, -0.02, 1.67, 'dark', bevel=0.003)
    return m


def pipe_run_long():
    m = Model()
    for x in (-1.5, 0.0, 1.5):
        pipe_support(m, x, 0)
    m.cyl(PIPE_R, 4.0, (0, 0, PIPE_Z), 'accent', axis='X', seg=24)
    for x in (-1.985, 1.985):
        m.cyl(PIPE_R + 0.025, 0.03, (x, 0, PIPE_Z), 'metal', axis='X')
    return m


DUCT_W, DUCT_H, DUCT_Z = 0.6, 0.4, 2.8


def duct_support(m, x, y, along='X'):
    """Trapeze support: two posts beside the duct and a beam under it."""
    for s in (-1, 1):
        px, py = (x, y + s * 0.42) if along == 'X' else (x + s * 0.42, y)
        m.box(0.2, 0.2, 0.02, px, py, 0, 'metal', bevel=0.003)
        m.box(0.07, 0.07, DUCT_Z + 0.25, px, py, 0.02, 'metal', bevel=0.006)
    w, d = (0.1, 0.94) if along == 'X' else (0.94, 0.1)
    m.box(w, d, 0.08, x, y, DUCT_Z - 0.08, 'metal', bevel=0.006)


def duct_flange(m, x, y, along='X'):
    w, d = (0.04, DUCT_W + 0.05) if along == 'X' else (DUCT_W + 0.05, 0.04)
    m.box(w, d, DUCT_H + 0.05, x, y, DUCT_Z - 0.025, 'metal', bevel=0.004)


def exhaust_duct_run():
    m = Model()
    for x in (-1.4, 1.4):
        duct_support(m, x, 0)
    m.box(4.0, DUCT_W, DUCT_H, 0, 0, DUCT_Z, 'accent', bevel=0.012)
    for x in (-1.98, -0.67, 0.67, 1.98):
        duct_flange(m, x, 0)
    return m


def exhaust_duct_corner():
    m = Model()
    hw = DUCT_W / 2
    duct_support(m, 0.75, 0)
    duct_support(m, 0, -0.75, along='Y')
    m.box(1.0 + hw, DUCT_W, DUCT_H, (1.0 - hw) / 2, 0, DUCT_Z, 'accent', bevel=0.012)
    m.box(DUCT_W, 1.0 - hw, DUCT_H, 0, -(1.0 + hw) / 2, DUCT_Z, 'accent', bevel=0.012)
    duct_flange(m, 0.98, 0)
    duct_flange(m, 0, -0.98, along='Y')
    return m


def cable_tray_run():
    """4 m overhead ladder cable tray on cantilever floor posts, with cable bundles."""
    m = Model()
    z = 2.8
    for x in (-1.4, 1.4):
        m.box(0.22, 0.22, 0.02, x, 0.32, 0, 'metal', bevel=0.003)
        m.box(0.07, 0.07, z + 0.3, x, 0.32, 0.02, 'metal', bevel=0.006)
        m.box(0.06, 0.6, 0.06, x, 0.03, z - 0.06, 'metal', bevel=0.005)
    for y in (-0.22, 0.22):
        m.box(4.0, 0.02, 0.1, 0, y, z, 'metal', bevel=0.003)
    for i in range(14):
        m.box(0.03, 0.42, 0.02, -1.95 + i * 0.3, 0, z, 'metal', bevel=0)
    for j, (y, r) in enumerate(((-0.15, 0.025), (-0.08, 0.03), (0.0, 0.022), (0.07, 0.028), (0.15, 0.02))):
        m.cyl(r, 4.0, (0, y, z + 0.02 + r), 'accent', axis='X', seg=10)
    return m


# ------------------------------------------------------------------------------------------ safety

def gas_detection_post():
    """Gas detection controller on a floor post with a beacon and two sensor heads."""
    m = Model()
    m.box(0.3, 0.3, 0.02, 0, 0, 0, 'metal', bevel=0.003)
    m.box(0.06, 0.06, 2.0, 0, 0.05, 0.02, 'metal', bevel=0.005)
    m.box(0.36, 0.14, 0.45, 0, -0.05, 1.25, 'body', bevel=0.015)
    m.box(0.2, 0.02, 0.12, 0, -0.125, 1.5, 'dark', bevel=0.003)
    for i in range(4):
        m.box(0.025, 0.012, 0.025, -0.09 + i * 0.06, -0.125, 1.38, 'accent' if i < 2 else 'panel', bevel=0)
    m.vcyl(0.06, 0.04, 0, 0.05, 2.02, 'panel', seg=16)
    m.vcyl(0.055, 0.12, 0, 0.05, 2.06, 'accent', seg=16)
    m.vcyl(0.04, 0.02, 0, 0.05, 2.18, 'panel', seg=16)
    for z in (0.35, 1.9):
        m.box(0.08, 0.06, 0.08, 0, -0.01, z, 'body', bevel=0.008)
        m.vcyl(0.035, 0.1, 0, -0.03, z - 0.1, 'dark', seg=16)
        m.vcyl(0.04, 0.012, 0, -0.03, z - 0.112, 'accent', seg=16)
    return m


def emergency_shower():
    """Free-standing combination emergency shower and eyewash station."""
    m = Model()
    m.vcyl(0.16, 0.03, 0, 0.1, 0, 'metal', seg=24)
    m.vcyl(0.035, 2.25, 0, 0.1, 0.03, 'accent', seg=16)
    m.sphere(0.04, (0, 0.1, 2.28), 'accent')
    m.cyl(0.03, 0.55, (0, -0.175, 2.28), 'accent', axis='Y', seg=12)
    m.vcyl(0.16, 0.12, 0, -0.45, 2.1, 'accent', r2=0.04, seg=24)
    m.vcyl(0.165, 0.01, 0, -0.45, 2.09, 'panel', seg=24)
    # pull rod with a triangle handle
    m.vcyl(0.008, 0.6, 0, -0.2, 1.68, 'metal', seg=6)
    m.strut((0, -0.24, 1.68), (0, -0.16, 1.68), 0.015)
    m.strut((0, -0.24, 1.68), (0, -0.2, 1.6), 0.015)
    m.strut((0, -0.16, 1.68), (0, -0.2, 1.6), 0.015)
    # eyewash bowl with a push flag
    m.cyl(0.025, 0.25, (0, -0.06, 0.92), 'accent', axis='Y', seg=12)
    m.vcyl(0.06, 0.12, 0, -0.33, 0.85, 'accent', r2=0.17, seg=28)
    m.vcyl(0.15, 0.01, 0, -0.33, 0.975, 'dark', seg=28)
    m.box(0.16, 0.02, 0.12, 0, -0.06, 0.98, 'accent', bevel=0.005, rx=math.radians(-20))
    m.box(0.3, 0.02, 0.22, 0, 0.14, 1.45, 'panel', bevel=0.005)
    return m


def fire_extinguisher_stand():
    """Stand with two fire extinguishers and a sign board."""
    m = Model()
    m.box(0.6, 0.32, 0.05, 0, 0, 0, 'panel', bevel=0.01)
    for x in (-0.27, 0.27):
        m.box(0.04, 0.04, 1.45, x, 0.12, 0.05, 'metal', bevel=0.004)
    m.box(0.58, 0.03, 0.04, 0, 0.12, 0.85, 'metal', bevel=0.004)
    m.box(0.56, 0.025, 0.32, 0, 0.12, 1.2, 'body', bevel=0.006)
    m.box(0.16, 0.012, 0.16, 0, 0.105, 1.28, 'accent', bevel=0)
    for x in (-0.13, 0.13):
        m.vcyl(0.085, 0.48, x, -0.02, 0.05, 'accent', seg=24)
        m.vcyl(0.085, 0.08, x, -0.02, 0.53, 'accent', r2=0.035, seg=24)
        m.vcyl(0.025, 0.06, x, -0.02, 0.61, 'metal', seg=12)
        m.box(0.12, 0.03, 0.02, x + 0.03, -0.02, 0.66, 'metal', bevel=0.003)
        m.strut((x + 0.05, -0.04, 0.62), (x + 0.07, -0.11, 0.15), 0.018, 'dark')
    return m


def flammable_cabinet():
    """Fire-rated safety storage cabinet (flammables, chemicals) with two doors."""
    m = Model()
    m.box(1.2, 0.6, 0.1, 0, 0, 0, 'dark', bevel=0.005)
    m.box(1.2, 0.6, 1.85, 0, 0, 0.1, 'body', bevel=0.02)
    for x in (-0.3, 0.3):
        m.box(0.57, 0.02, 1.72, x, -0.305, 0.16, 'panel', bevel=0.004)
        m.box(0.03, 0.04, 0.22, x + (0.24 if x < 0 else -0.24), -0.325, 0.95, 'metal', bevel=0.006)
    for x in (-0.3, 0.3):
        m.box(0.13, 0.014, 0.13, x, -0.317, 1.45, 'accent', bevel=0, ry=math.pi / 4)
    m.box(1.0, 0.014, 0.06, 0, -0.317, 1.75, 'accent', bevel=0)
    m.vcyl(0.05, 0.12, -0.4, 0.1, 1.95, 'accent', seg=16)
    m.vcyl(0.06, 0.02, -0.4, 0.1, 1.95, 'metal', seg=16)
    return m


def esd_button_post():
    """Emergency shutdown (ESD / emergency stop) push-button station on a post."""
    m = Model()
    m.box(0.25, 0.25, 0.02, 0, 0, 0, 'metal', bevel=0.003)
    m.box(0.06, 0.06, 1.45, 0, 0.03, 0.02, 'metal', bevel=0.005)
    m.box(0.2, 0.12, 0.24, 0, -0.06, 1.0, 'accent', bevel=0.015)
    m.cyl(0.05, 0.02, (0, -0.13, 1.1), 'metal', axis='Y', seg=20)
    m.cyl(0.04, 0.04, (0, -0.16, 1.1), 'dark', axis='Y', seg=20)
    m.box(0.3, 0.02, 0.2, 0, -0.005, 1.3, 'panel', bevel=0.005)
    m.box(0.24, 0.012, 0.03, 0, -0.018, 1.42, 'accent', bevel=0)
    return m


# --------------------------------------------------------------------------------- cleanroom / fab

def wafer_stocker():
    """Automated wafer / FOUP stocker with front load ports and a window."""
    m = Model()
    m.box(3.0, 1.6, 0.1, 0, 0, 0, 'dark', bevel=0.005)
    m.box(3.0, 1.6, 3.0, 0, 0, 0.1, 'body', bevel=0.03)
    m.box(3.02, 1.62, 0.08, 0, 0, 2.6, 'accent', bevel=0.01)
    m.box(2.6, 0.02, 1.0, 0, -0.805, 1.45, 'dark', bevel=0.006)
    for x in (-0.95, -0.4):
        m.box(0.46, 0.02, 0.5, x, -0.805, 0.8, 'panel', bevel=0.004)
        foup(m, x, -0.8, 0.88)
    m.box(0.4, 0.2, 0.06, 0.8, -0.9, 1.05, 'panel', bevel=0.01)
    m.box(0.4, 0.03, 0.28, 0.8, -0.86, 1.13, 'dark', bevel=0.005, rx=math.radians(-15))
    m.box(2.6, 1.3, 0.2, 0, 0, 3.1, 'panel', bevel=0.015)
    light_tower(m, 1.3, -0.65, 3.1)
    return m


def process_tool_efem():
    """Cluster process tool: EFEM with load ports at the front, transfer chamber, four process chambers."""
    m = Model()
    # EFEM
    m.box(2.0, 0.9, 0.1, 0, -1.25, 0, 'dark', bevel=0.005)
    m.box(2.0, 0.9, 1.9, 0, -1.25, 0.1, 'body', bevel=0.025)
    m.box(2.02, 0.92, 0.07, 0, -1.25, 1.75, 'accent', bevel=0.01)
    m.box(1.9, 0.8, 0.25, 0, -1.25, 2.0, 'panel', bevel=0.015)
    for x in (-0.6, 0.0, 0.6):
        m.box(0.46, 0.02, 0.5, x, -1.705, 0.8, 'panel', bevel=0.004)
        foup(m, x, -1.7, 0.88)
    m.box(1.6, 0.02, 0.4, 0, -1.705, 1.35, 'dark', bevel=0.005)
    light_tower(m, 0.85, -1.5, 2.25)
    # load locks, transfer chamber and process chambers
    for x in (-0.35, 0.35):
        m.box(0.5, 0.62, 1.2, x, -0.5, 0, 'panel', bevel=0.02)
    m.vcyl(0.72, 1.35, 0, 0.55, 0, 'body', seg=8)
    m.vcyl(0.6, 0.08, 0, 0.55, 1.35, 'panel', seg=8)
    for x, y in ((-1.05, 0.5), (1.05, 0.5), (-0.55, 1.45), (0.55, 1.45)):
        m.box(0.8, 0.8, 1.3, x, y, 0, 'body', bevel=0.03)
        m.vcyl(0.3, 0.14, x, y, 1.3, 'accent', seg=28)
        m.vcyl(0.12, 0.25, x, y, 1.44, 'panel', seg=16)
    return m


def chemical_dispense_cabinet():
    """Chemical dispense / delivery cabinet: drum bay behind windowed doors, controls on top."""
    m = Model()
    m.box(1.5, 0.9, 0.1, 0, 0, 0, 'dark', bevel=0.005)
    m.box(1.5, 0.9, 1.95, 0, 0, 0.1, 'body', bevel=0.025)
    for x in (-0.37, 0.37):
        m.box(0.7, 0.02, 1.1, x, -0.455, 0.2, 'panel', bevel=0.004)
        m.box(0.5, 0.022, 0.5, x, -0.46, 0.55, 'dark', bevel=0.004)
        m.box(0.03, 0.04, 0.2, x + (0.3 if x < 0 else -0.3), -0.48, 0.7, 'metal', bevel=0.006)
    m.box(1.44, 0.02, 0.5, 0, -0.455, 1.42, 'panel', bevel=0.004)
    m.box(0.36, 0.022, 0.24, -0.4, -0.46, 1.55, 'dark', bevel=0.004)
    for i in range(3):
        m.cyl(0.02, 0.015, (0.3 + i * 0.09, -0.465, 1.75), 'accent' if i == 0 else 'panel', axis='Y', seg=12)
    m.box(1.52, 0.92, 0.05, 0, 0, 1.3, 'accent', bevel=0.008)
    m.vcyl(0.11, 0.35, -0.45, 0.15, 2.05, 'accent', seg=20)
    m.vcyl(0.125, 0.04, -0.45, 0.15, 2.05, 'metal', seg=20)
    for x in (0.2, 0.32, 0.44):
        m.vcyl(0.025, 0.35, x, 0.25, 2.05, 'accent', seg=10)
    return m


def pass_box():
    """Cleanroom pass box (pass-through chamber) on a stand, doors front and back."""
    m = Model()
    frame(m, 0.7, 0.7, 0.85, 0, 0, 0, t=0.04)
    m.box(0.62, 0.62, 0.02, 0, 0, 0.2, 'panel', bevel=0.003)
    m.box(0.7, 0.7, 0.7, 0, 0, 0.85, 'body', bevel=0.02)
    for s in (-1, 1):
        m.box(0.6, 0.02, 0.6, 0, s * 0.355, 0.9, 'panel', bevel=0.005)
        m.box(0.36, 0.022, 0.36, -0.05, s * 0.36, 1.02, 'dark', bevel=0.004)
        m.box(0.03, 0.04, 0.16, 0.22, s * 0.375, 1.1, 'metal', bevel=0.005)
        m.cyl(0.018, 0.012, (0.22, s * 0.364, 1.48), 'accent', axis='Y', seg=12)
    m.box(0.6, 0.6, 0.08, 0, 0, 1.55, 'panel', bevel=0.01)
    return m


def gowning_bench():
    """Cleanroom crossover / gowning bench with a shoe rack below."""
    m = Model()
    for x in (-0.7, 0.7):
        for y in (-0.15, 0.15):
            m.box(0.04, 0.04, 0.44, x, y, 0, 'metal', bevel=0.004)
    for y in (-0.15, 0.15):
        m.box(1.36, 0.03, 0.03, 0, y, 0.12, 'metal', bevel=0.003)
    for i in range(10):
        m.box(0.03, 0.27, 0.015, -0.6 + i * 0.133, 0, 0.135, 'metal', bevel=0)
    m.box(1.5, 0.4, 0.04, 0, 0, 0.44, 'body', bevel=0.01)
    return m


def laminar_flow_hood():
    """Laminar flow (clean air) workstation on a stand with a fan/filter plenum on top."""
    m = Model()
    frame(m, 1.3, 0.75, 0.75, 0, 0, 0, t=0.05)
    m.box(1.3, 0.75, 0.05, 0, 0, 0.75, 'panel', bevel=0.008)
    for x in (-0.63, 0.63):
        m.box(0.04, 0.75, 0.8, x, 0, 0.8, 'body', bevel=0.006)
    m.box(1.3, 0.04, 0.8, 0, 0.355, 0.8, 'body', bevel=0.006)
    m.box(1.22, 0.02, 0.35, 0, -0.36, 1.25, 'dark', bevel=0.004)
    m.box(1.32, 0.77, 0.06, 0, 0, 1.6, 'accent', bevel=0.008)
    m.box(1.3, 0.75, 0.45, 0, 0, 1.66, 'body', bevel=0.015)
    slats(m, 1.1, 0.3, 0, -0.38, 1.72, 5)
    return m


def chiller_unit():
    """Air-cooled process chiller with two top fans and supply / return connections."""
    m = Model()
    m.box(2.0, 1.0, 0.1, 0, 0, 0, 'dark', bevel=0.005)
    m.box(2.0, 1.0, 1.6, 0, 0, 0.1, 'body', bevel=0.025)
    slats(m, 1.7, 0.75, -0.0, -0.51, 0.75, 10)
    m.box(0.5, 0.02, 0.45, -0.6, -0.505, 0.2, 'panel', bevel=0.004)
    m.box(0.22, 0.022, 0.12, -0.6, -0.51, 0.5, 'dark', bevel=0.003)
    for x in (-0.48, 0.48):
        m.vcyl(0.42, 0.14, x, 0, 1.7, 'panel', seg=32)
        m.vcyl(0.36, 0.01, x, 0, 1.835, 'dark', seg=32)
        m.vcyl(0.07, 0.03, x, 0, 1.84, 'metal', seg=12)
        for k in range(2):
            m.box(0.74, 0.015, 0.015, x, 0, 1.84, 'metal', bevel=0, rz=k * math.pi / 2)
    for x in (0.5, 0.75):
        m.cyl(0.05, 0.25, (x, -0.62, 0.35), 'accent', axis='Y', seg=16)
        m.cyl(0.075, 0.03, (x, -0.75, 0.35), 'metal', axis='Y', seg=16)
        valve(m, (x, -0.66, 0.4))
    return m


def air_handling_unit():
    """Air handling unit (AHU): long sectioned casing on a base frame, supply and return ducts on top."""
    m = Model()
    L = 5.0
    m.box(L, 1.8, 0.15, 0, 0, 0, 'metal', bevel=0.01)
    m.box(L, 1.8, 2.0, 0, 0, 0.15, 'body', bevel=0.03)
    for x in (-1.5, -0.5, 0.7, 1.7):
        m.box(0.05, 1.84, 2.02, x, 0, 0.14, 'panel', bevel=0.006)
    for x, w in ((-2.0, 0.7), (0.1, 0.9), (1.2, 0.7)):
        m.box(w, 0.02, 1.6, x, -0.905, 0.35, 'panel', bevel=0.005)
        for z in (0.7, 1.6):
            m.box(0.12, 0.04, 0.04, x + w / 2 - 0.12, -0.92, z, 'metal', bevel=0.004)
    slats(m, 0.7, 0.9, -1.0, -0.91, 0.6, 8)
    m.box(0.28, 0.022, 0.2, 2.2, -0.91, 1.4, 'dark', bevel=0.004)
    for x in (-2.0, 2.0):
        m.box(0.9, 0.7, 0.75, x, 0.1, 2.15, 'accent', bevel=0.015)
        m.box(0.96, 0.76, 0.05, x, 0.1, 2.5, 'metal', bevel=0.005)
    return m


def exhaust_fan():
    """Centrifugal exhaust fan with motor on a concrete plinth, inlet and outlet ducts."""
    m = Model()
    m.box(1.6, 1.2, 0.2, 0, 0, 0, 'panel', bevel=0.02)
    m.box(0.5, 0.7, 0.35, -0.1, 0.05, 0.2, 'metal', bevel=0.01)
    m.cyl(0.6, 0.45, (-0.1, 0.05, 1.0), 'body', axis='X', seg=32)
    m.box(0.45, 0.5, 1.0, -0.1, -0.3, 1.0, 'body', bevel=0.015)
    m.box(0.4, 0.45, 0.6, -0.1, -0.3, 2.0, 'accent', bevel=0.012)
    m.box(0.46, 0.51, 0.04, -0.1, -0.3, 2.0, 'metal', bevel=0.004)
    m.cyl(0.32, 0.5, (-0.6, 0.05, 1.0), 'accent', axis='X', seg=28)
    m.cyl(0.36, 0.04, (-0.39, 0.05, 1.0), 'metal', axis='X', seg=28)
    # motor on a pedestal at the side, coupling to the fan shaft
    m.box(0.45, 0.45, 0.45, 0.48, 0.05, 0.2, 'metal', bevel=0.01)
    m.cyl(0.17, 0.42, (0.5, 0.05, 0.82), 'panel', axis='X', seg=24)
    m.box(0.22, 0.12, 0.38, 0.27, 0.05, 0.75, 'metal', bevel=0.01)
    return m


# -------------------------------------------------------------------------------------- logistics

def forklift():
    """Counterbalance forklift, forks to the front (-Y)."""
    m = Model()
    m.center = True
    # chassis: narrow frame between the wheels, wide deck and counterweight above them
    m.box(0.66, 2.0, 0.5, 0, 0.65, 0.12, 'accent', bevel=0.03)
    m.box(1.12, 2.0, 0.15, 0, 0.65, 0.62, 'accent', bevel=0.03)
    m.box(1.1, 0.5, 0.55, 0, 1.4, 0.77, 'accent', bevel=0.1)
    m.box(0.9, 0.85, 0.18, 0, 0.75, 0.77, 'panel', bevel=0.04)
    m.box(0.5, 0.45, 0.1, 0, 0.75, 0.95, 'dark', bevel=0.03)
    m.box(0.5, 0.08, 0.45, 0, 1.02, 0.98, 'dark', bevel=0.03, rx=math.radians(-10))
    m.box(0.9, 0.3, 0.35, 0, -0.18, 0.77, 'panel', bevel=0.04)
    m.strut((0, -0.1, 1.1), (0, 0.15, 1.3), 0.04, 'dark')
    m.cyl(0.16, 0.03, (0, 0.18, 1.31), 'dark', axis='Z', seg=20)
    for x in (-0.44, 0.44):
        m.cyl(0.3, 0.22, (x, -0.15, 0.3), 'dark', axis='X', seg=24)
        m.cyl(0.16, 0.24, (x, -0.15, 0.3), 'metal', axis='X', seg=16)
        m.cyl(0.24, 0.18, (x, 1.25, 0.24), 'dark', axis='X', seg=24)
        m.cyl(0.12, 0.2, (x, 1.25, 0.24), 'metal', axis='X', seg=16)
    # overhead guard
    for x in (-0.5, 0.5):
        m.box(0.06, 0.06, 1.33, x, -0.25, 0.77, 'metal', bevel=0.006)
        m.strut((x, 1.2, 1.32), (x, 1.05, 2.07), 0.06)
        m.box(0.05, 1.4, 0.06, x, 0.45, 2.06, 'metal', bevel=0.006)
    for y in (-0.25, 1.1):
        m.box(1.0, 0.05, 0.06, 0, y, 2.06, 'metal', bevel=0.006)
    for x in (-0.25, 0.0, 0.25):
        m.box(0.04, 1.3, 0.03, x, 0.42, 2.08, 'metal', bevel=0.004)
    # mast, carriage, load backrest, forks
    for x in (-0.25, 0.25):
        m.box(0.08, 0.12, 2.0, x, -0.52, 0.12, 'metal', bevel=0.008)
    for z in (0.95, 2.0):
        m.box(0.42, 0.08, 0.08, 0, -0.52, z, 'metal', bevel=0.006)
    m.vcyl(0.04, 1.6, 0, -0.5, 0.3, 'panel', seg=12)
    m.box(0.95, 0.06, 0.4, 0, -0.62, 0.15, 'metal', bevel=0.01)
    for x in (-0.44, -0.22, 0.0, 0.22, 0.44):
        m.box(0.03, 0.03, 0.75, x, -0.63, 0.55, 'metal', bevel=0.003)
    m.box(0.95, 0.035, 0.04, 0, -0.63, 1.28, 'metal', bevel=0.004)
    for x in (-0.3, 0.3):
        m.box(0.12, 0.05, 0.55, x, -0.675, 0.0, 'metal', bevel=0.006)
        m.box(0.12, 1.1, 0.045, x, -1.25, 0.0, 'metal', bevel=0.006)
    return m


def pallet_jack():
    """Hand pallet truck: two forks, hydraulic pump unit, steering wheels and handle."""
    m = Model()
    m.center = True
    for x in (-0.19, 0.19):
        m.box(0.16, 1.15, 0.08, x, -0.3, 0.005, 'metal', bevel=0.008)
        m.cyl(0.035, 0.07, (x, -0.8, 0.04), 'dark', axis='X', seg=12)
    m.box(0.54, 0.25, 0.22, 0, 0.38, 0.03, 'accent', bevel=0.03)
    m.vcyl(0.065, 0.32, 0, 0.42, 0.25, 'accent', seg=16)
    for x in (-0.07, 0.07):
        m.cyl(0.09, 0.05, (x, 0.45, 0.09), 'dark', axis='X', seg=20)
    m.box(0.12, 0.08, 0.06, 0, 0.42, 0.57, 'metal', bevel=0.008)
    for x in (-0.04, 0.04):
        m.strut((x, 0.42, 0.6), (x, 0.72, 1.12), 0.03)
    m.box(0.3, 0.06, 0.03, 0, 0.74, 1.14, 'dark', bevel=0.008)
    for x in (-0.15, 0.15):
        m.strut((x, 0.74, 1.15), ((x * 0.25), 0.72, 1.06), 0.025, 'dark')
    return m


def ibc_tote():
    """1000 l IBC tote: plastic tank in a steel cage on a pallet, top cap and bottom valve."""
    m = Model()
    m.box(1.2, 1.0, 0.15, 0, 0, 0, 'panel', bevel=0.01)
    fork_pockets(m, 0.3, -0.501, 0.02, 0.09, (-0.32, 0.32))
    m.box(1.12, 0.92, 0.88, 0, 0, 0.16, 'body', bevel=0.08)
    xo, yo, z0, z1 = 0.585, 0.485, 0.15, 1.12
    for x in (-xo, xo):
        for i in range(6):
            y = -yo + i * 2 * yo / 5
            m.box(0.025, 0.025, z1 - z0, x, y, z0, 'metal', bevel=0)
    for y in (-yo, yo):
        for i in range(1, 6):
            x = -xo + i * 2 * xo / 6
            m.box(0.025, 0.025, z1 - z0, x, y, z0, 'metal', bevel=0)
    for z in (0.45, 0.78, z1 - 0.025):
        for y in (-yo, yo):
            m.box(2 * xo, 0.03, 0.025, 0, y, z, 'metal', bevel=0)
        for x in (-xo, xo):
            m.box(0.03, 2 * yo, 0.025, x, 0, z, 'metal', bevel=0)
    m.vcyl(0.13, 0.06, 0, 0, 1.04, 'accent', seg=24)
    m.cyl(0.05, 0.12, (0, -0.48, 0.28), 'accent', axis='Y', seg=16)
    m.box(0.14, 0.06, 0.03, 0, -0.52, 0.33, 'accent', bevel=0.005)
    return m


def drum_single():
    m = Model()
    drum(m, 0, 0)
    return m


def drum_spill_pallet():
    """Spill containment pallet with grating, carrying four drums."""
    m = Model()
    m.box(1.3, 1.3, 0.26, 0, 0, 0, 'body', bevel=0.03)
    fork_pockets(m, 0.25, -0.651, 0.03, 0.09, (-0.3, 0.3))
    for i in range(12):
        m.box(0.02, 1.24, 0.03, -0.605 + i * 0.11, 0, 0.26, 'metal', bevel=0)
    for x in (-0.32, 0.32):
        for y in (-0.32, 0.32):
            drum(m, x, y, 0.29)
    return m


# id, display name, builder, description (for search and AI assistants)
# ----------------------------------------------------------------- dewar and pipeline entry

def dewar():
    """Portable cryogenic liquid cylinder (~200 l): accent shell, handling ring, valve cluster, castors."""
    m = Model()
    r, z0, shell = 0.29, 0.1, 1.17
    m.vcyl(r * 0.92, 0.035, 0, 0, 0.065, 'dark', seg=32)                      # castor base ring
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        x, y = 0.2 * math.cos(ang), 0.2 * math.sin(ang)
        m.box(0.05, 0.05, 0.04, x, y, 0.035, 'metal', bevel=0.005)
        m.cyl(0.035, 0.03, (x, y, 0.035), 'dark', axis='X', seg=12)          # castor wheels
    m.vcyl(r, 0.05, 0, 0, z0, 'accent', r2=r * 0.97, seg=40)                  # lower knuckle
    m.vcyl(r, shell, 0, 0, z0 + 0.05, 'accent', seg=40)                       # vessel shell
    for z in (0.45, 0.95):
        m.vcyl(r + 0.008, 0.03, 0, 0, z, 'metal', seg=40)                     # rolling bands
    m.vcyl(r, 0.1, 0, 0, z0 + 0.05 + shell, 'accent', r2=r * 0.55, seg=40)   # domed head
    top = z0 + 0.15 + shell
    m.vcyl(0.14, 0.03, 0, 0, top, 'metal', seg=24)                            # head plate
    # handling ring on four posts
    ring_z, ring_r = top + 0.22, r * 0.95
    for a in range(4):
        ang = a * math.pi / 2
        m.strut((ring_r * 0.75 * math.cos(ang), ring_r * 0.75 * math.sin(ang), top - 0.08),
                (ring_r * math.cos(ang), ring_r * math.sin(ang), ring_z), 0.03)
    n = 16
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        m.strut((ring_r * math.cos(a0), ring_r * math.sin(a0), ring_z),
                (ring_r * math.cos(a1), ring_r * math.sin(a1), ring_z), 0.035)
    # valve and gauge cluster (front faces -Y)
    m.vcyl(0.02, 0.12, 0, 0, top + 0.03, 'metal', seg=10)
    m.vcyl(0.035, 0.012, 0, 0, top + 0.15, 'panel', seg=16)                   # vent valve wheel
    for x in (-0.09, 0.09):
        m.box(0.04, 0.04, 0.05, x, -0.02, top + 0.03, 'metal', bevel=0.004)
        m.vcyl(0.008, 0.04, x, -0.02, top + 0.08, 'metal', seg=8)
        m.vcyl(0.03, 0.01, x, -0.02, top + 0.12, 'panel', seg=16)             # liquid / gas use valves
    m.cyl(0.04, 0.03, (0.0, -0.09, top + 0.13), 'dark', axis='Y', seg=20)      # contents gauge
    m.cyl(0.033, 0.004, (0.0, -0.106, top + 0.13), 'body', axis='Y', seg=20)
    m.vcyl(0.01, 0.1, 0.0, -0.06, top + 0.03, 'metal', seg=8)
    m.cyl(0.012, 0.12, (0.15, 0.06, top + 0.07), 'metal', axis='X', seg=8)    # relief valve
    m.vcyl(0.02, 0.05, 0.21, 0.06, top + 0.07, 'metal', seg=10)
    return m


def pipeline_entry():
    """Gas service entry: riser from the ground, shut-off valve, regulator with gauge, meter box."""
    m = Model()
    r = 0.04
    m.box(0.62, 0.42, 0.05, 0, 0, 0, 'panel', bevel=0.01)                     # plinth
    m.vcyl(0.075, 0.02, -0.2, 0, 0.05, 'metal', seg=20)                       # ground sleeve
    m.vcyl(r, 1.0, -0.2, 0, 0.05, 'accent', seg=20)                           # riser
    # shut-off valve on the riser with a hand wheel facing front
    m.box(0.1, 0.1, 0.12, -0.2, 0, 0.42, 'metal', bevel=0.01)
    m.cyl(0.012, 0.08, (-0.2, -0.09, 0.48), 'metal', axis='Y', seg=8)
    m.cyl(0.07, 0.015, (-0.2, -0.135, 0.48), 'accent', axis='Y', seg=20)
    for z in (0.4, 0.56):
        m.vcyl(r + 0.022, 0.025, -0.2, 0, z, 'metal', seg=20)                 # flanges
    # elbow and horizontal run through the regulator
    zt = 1.05
    m.sphere(r + 0.01, (-0.2, 0, zt), 'accent')
    m.cyl(r, 0.42, (0.01, 0, zt), 'accent', axis='X', seg=20)
    m.cyl(0.07, 0.12, (0.0, 0, zt), 'metal', axis='X', seg=24)                # regulator body
    m.vcyl(0.09, 0.08, 0.0, 0, zt + 0.06, 'metal', r2=0.08, seg=28)           # diaphragm housing
    m.vcyl(0.03, 0.12, 0.0, 0, zt + 0.14, 'metal', seg=12)                    # spring bonnet
    m.vcyl(0.045, 0.04, 0.0, 0, zt + 0.26, 'panel', seg=12)
    m.vcyl(0.008, 0.08, 0.12, -0.02, zt, 'metal', seg=8)                      # gauge
    m.cyl(0.045, 0.03, (0.12, -0.04, zt + 0.12), 'dark', axis='Y', seg=20)
    m.cyl(0.038, 0.004, (0.12, -0.057, zt + 0.12), 'body', axis='Y', seg=20)
    # outlet down into the meter box and out toward the building (+X)
    m.sphere(r + 0.01, (0.22, 0, zt), 'accent')
    m.vcyl(r, 0.35, 0.22, 0, zt - 0.35, 'accent', seg=20)
    m.box(0.2, 0.16, 0.26, 0.22, 0.0, 0.42, 'body', bevel=0.012)              # meter box
    m.box(0.1, 0.012, 0.06, 0.22, -0.085, 0.58, 'dark', bevel=0.002)          # meter window
    m.vcyl(r, 0.3, 0.22, 0, 0.12, 'accent', seg=20)
    m.cyl(r, 0.1, (0.27, 0, 0.12), 'accent', axis='X', seg=20)
    m.cyl(r + 0.022, 0.025, (0.31, 0, 0.12), 'metal', axis='X', seg=20)       # outlet flange
    return m


# ------------------------------------------------------------------- wall-mounted regulators

MOUNT_Z = 1.3  # center height of wall-mounted regulators


def regulator(m, x, z, y0=-0.012):
    """Pressure regulator with two gauges, standing off a wall/plate at y0 (front faces -Y)."""
    m.box(0.07, 0.03, 0.07, x, y0 - 0.015, z - 0.035, 'metal', bevel=0.006)              # mounting boss
    m.cyl(0.046, 0.08, (x, y0 - 0.07, z), 'accent', axis='Y', seg=24)                     # body
    m.cyl(0.038, 0.06, (x, y0 - 0.14, z - 0.01), 'accent', axis='Y', r2=0.03, seg=24)     # bonnet
    m.cyl(0.05, 0.05, (x, y0 - 0.195, z - 0.015), 'accent', axis='Y', seg=12)             # knob (ridged)
    m.cyl(0.022, 0.006, (x, y0 - 0.223, z - 0.015), 'panel', axis='Y', seg=16)            # knob cap
    for side in (-1, 1):                                                                 # gauges
        gx = x + side * 0.05
        m.cyl(0.008, 0.05, (gx, y0 - 0.07, z + 0.06), 'metal', seg=8)
        m.cyl(0.04, 0.032, (gx, y0 - 0.08, z + 0.115), 'accent', axis='Y', seg=24)
        m.cyl(0.033, 0.004, (gx, y0 - 0.098, z + 0.115), 'body', axis='Y', seg=24)
        m.box(0.004, 0.003, 0.026, gx, y0 - 0.1, z + 0.105, 'dark', bevel=0, ry=side * 0.6)
    m.cyl(0.009, 0.06, (x, y0 - 0.07, z - 0.075), 'metal', seg=8)                         # outlet stub


def regulator_panel(n, plate_w):
    m = Model()
    m.mounted = True
    m.box(plate_w, 0.012, 0.32, 0, -0.006, MOUNT_Z - 0.17, 'panel', bevel=0.004)
    for x in (-plate_w / 2 + 0.03, plate_w / 2 - 0.03):                                   # mounting slots
        for dz in (-0.12, 0.1):
            m.box(0.012, 0.003, 0.05, x, -0.013, MOUNT_Z + dz, 'dark', bevel=0)
    pitch = (plate_w - 0.1) / n
    for i in range(n):
        x = -plate_w / 2 + 0.05 + pitch * (i + 0.5)
        z = MOUNT_Z + (0.03 if i % 2 else -0.03)                                         # staggered, as on real panels
        regulator(m, x, z)
    return m


def cylinder_regulator():
    """Dual-gauge cylinder regulator with inlet nut, outlet valve and hose barb, on a wall bracket."""
    m = Model()
    m.mounted = True
    z = MOUNT_Z
    m.box(0.09, 0.01, 0.16, 0, -0.005, z - 0.09, 'metal', bevel=0.003)                    # bracket
    regulator(m, 0, z, y0=-0.01)
    y = -0.08
    m.cyl(0.011, 0.11, (0.1, y, z), 'metal', axis='X', seg=10)                            # inlet stem
    m.cyl(0.024, 0.045, (0.17, y, z), 'accent', axis='X', seg=6)                          # inlet hex nut
    m.cyl(0.011, 0.05, (0.215, y, z), 'metal', axis='X', seg=10)
    m.cyl(0.011, 0.1, (-0.09, y, z - 0.06), 'accent', axis='X', seg=10)                   # outlet line
    m.box(0.035, 0.035, 0.035, -0.12, y, z - 0.078, 'accent', bevel=0.004)                # outlet valve
    m.box(0.012, 0.012, 0.07, -0.12, y, z - 0.13, 'accent', bevel=0.002, rx=0.5)          # valve lever
    m.cyl(0.011, 0.05, (-0.16, y, z - 0.06), 'metal', axis='X', seg=10)
    m.cyl(0.013, 0.05, (-0.205, y, z - 0.06), 'accent', axis='X', r2=0.006, seg=10)       # hose barb
    return m


def regulator_panel_4():
    return regulator_panel(4, 0.8)


def regulator_panel_2():
    return regulator_panel(2, 0.45)


def point_of_use_regulator():
    return regulator_panel(1, 0.24)


MODELS = [
    ('gas-cylinder', 'Gas cylinder', gas_cylinder,
     'Single compressed-gas cylinder (about 0.23 m wide, 1.45 m tall) with valve and cap; drawn as a small circle, often in rows along walls or in cylinder stores. Synonyms: gas bottle, gas tank.'),
    ('gas-cylinder-bank', 'Cylinder bank', gas_cylinder_bank,
     'Rack of eight gas cylinders (2 rows of 4) with restraint bars and a header manifold, about 1.25 × 0.66 m; drawn as a grid of small circles in a rectangle. Typical in gas stores, cylinder yards and supply rooms.'),
    ('gas-cabinet', 'Gas cabinet', gas_cabinet,
     'Ventilated gas cabinet (0.9 × 0.6 m, 2 m tall) with a window door and an exhaust duct on the roof, housing toxic or flammable gas cylinders; drawn as a small rectangle against a wall, often in a row. Synonyms: gas enclosure, GC.'),
    ('valve-manifold-panel', 'Valve manifold panel', valve_manifold_panel,
     'Free-standing valve panel (1 m wide) with vertical gas lines, valves, gauges and a header; distributes gas from a source to consumers. Drawn as a thin rectangle with valve symbols. Synonyms: gas panel, VMP, distribution panel.'),
    ('pipe-run', 'Pipe run (2 m)', pipe_run,
     'Straight 2 m section of overhead gas or process pipe on two floor supports, pipe at 2.6 m; chain several for long runs. Drawn as a line along a route. Synonyms: pipe rack, gas line, header.'),
    ('pipe-run-corner', 'Pipe corner', pipe_run_corner,
     'Overhead pipe turning 90° on one floor support, 1 m arms; joins pipe runs at a corner of a route.'),
    ('pipe-run-tee', 'Pipe tee', pipe_run_tee,
     'Overhead pipe tee with a branch valve on one floor support: a 2 m main line with a 1 m branch; joins a branch line to a header.'),
    ('pipe-riser', 'Pipe riser', pipe_riser,
     'Vertical pipe drop from the overhead line to a valve and gauge near the floor; feeds a consumer such as a tool or a bench.'),
    ('scrubber-tower', 'Scrubber tower', scrubber_tower,
     'Large exhaust gas scrubber column (about 1.8 m footprint, 6.3 m tall) with an inlet duct and ladder; usually outdoors or in a utility yard next to exhaust stacks. Drawn as a large circle. Synonyms: wet scrubber, abatement tower.'),
    ('exhaust-stack', 'Exhaust stack', exhaust_stack,
     'Tall exhaust chimney (about 1.3 m footprint, 7.9 m tall) with a duct inlet; outdoors next to scrubbers or on a roof. Drawn as a circle. Synonyms: chimney, vent stack, flue.'),
    ('process-tool', 'Process tool', process_tool,
     'Production or process machine (1.2 × 1.0 m, 1.8 m tall) with a control screen, viewing window, accent band and exhaust; drawn as a rectangle, often in rows in a cleanroom or fab bay. Synonyms: tool, equipment, wafer tool, analyzer.'),
    ('lab-workbench', 'Lab workbench', lab_workbench,
     'Laboratory bench (2 × 0.8 m) with a lower shelf, an upper reagent shelf and gas outlets along the back; drawn as a long rectangle, often back to back in rows. Synonyms: lab bench, work table.'),
    ('fume-hood', 'Fume hood', fume_hood,
     'Laboratory fume hood (1.5 × 0.85 m, 2.6 m with duct) with a glass sash and base cabinet; drawn as a rectangle against a wall, sometimes with an X or hatched. Synonyms: fume cupboard, extraction hood.'),
    ('lab-stool', 'Lab stool', lab_stool,
     'Round laboratory stool (0.4 m) with a footrest; drawn as a small circle at benches.'),
    ('electrical-cabinet', 'Electrical cabinet', electrical_cabinet,
     'Two-door electrical or control cabinet (1.2 × 0.5 m, 2.2 m tall) with vents, indicators and a cable tray on top; drawn as a rectangle against a wall, often labelled MCC, DB or panel. Synonyms: switchboard, distribution board, control panel.'),
    ('cylinder-cart', 'Cylinder cart', cylinder_cart,
     'Two-wheel hand cart carrying two gas cylinders (0.55 × 0.45 m); for moving cylinders between stores and use points.'),
    ('tube-trailer', 'Tube trailer', tube_trailer,
     'Bulk gas tube trailer (2.2 × 6.3 m) with six horizontal high-pressure tubes and a valve cabinet at the front; parked outdoors at a gas yard or loading bay. Synonyms: bulk gas trailer, gas tube skid.'),
    # bulk supply
    ('bulk-tank', 'Cryogenic bulk tank', bulk_tank,
     'Vertical vacuum-insulated cryogenic liquid tank (2.5 m diameter, about 10 m tall) on legs on a 3.4 m concrete pad, with fill and vent piping, valves and a pressure-building coil at the base; stores liquid nitrogen, oxygen or argon outdoors in a gas yard. Drawn as a large circle on a square pad. Synonyms: VIE tank, LIN/LOX tank, bulk liquid tank, cryo tank.'),
    ('ambient-vaporizer', 'Ambient air vaporizer', ambient_vaporizer,
     'Bank of eight finned ambient-air vaporizer columns (2 × 1 m, 5 m tall) with headers; turns cryogenic liquid from a bulk tank into gas, placed next to the tank outdoors. Drawn as a rectangle with a grid of small squares or crosses. Synonyms: atmospheric vaporizer, finned vaporizer, evaporator.'),
    ('iso-tube-container', 'ISO tube container', iso_tube_container,
     '20 ft ISO frame container (6.1 × 2.4 m, 2.6 m tall) holding nine horizontal high-pressure gas tubes, with a valve compartment at one end; delivers bulk hydrogen, helium or nitrogen and is parked at a gas yard or decanting station. Drawn as a long rectangle. Synonyms: MEGC, tube skid, gas container, tube module.'),
    ('cylinder-bundle', 'Cylinder bundle', cylinder_bundle,
     'Twelve-cylinder bundle (1 × 0.8 m, 2 m tall): gas cylinders in a steel frame on a pallet base, manifolded to one outlet valve; moved by forklift, stands in gas stores and supply areas. Drawn as a small rectangle with a 3 × 4 grid of circles. Synonyms: MCP, multi-cylinder pallet, cylinder pack, cylinder quad.'),
    ('cylinder-cage', 'Cylinder storage cage', cylinder_cage,
     'Mesh-fenced cylinder storage cage (3 × 1.6 m, 2.2 m tall) with a gate and gas cylinders chained along the back; outdoors or in a gas store. Drawn as a rectangle with a fence line, a gate swing and rows of small circles. Synonyms: gas cage, cylinder compound, bottle store.'),
    ('nitrogen-generator', 'Nitrogen generator', nitrogen_generator,
     'PSA nitrogen generator skid (2.2 × 1.2 m, 2.4 m tall) with two adsorber towers, a buffer tank and a control cabinet; on-site nitrogen supply in a utility room, often next to an air compressor. Drawn as a rectangle with two small and one larger circle. Synonyms: N2 generator, PSA unit, nitrogen skid.'),
    ('hydrogen-generator', 'Hydrogen generator', hydrogen_generator,
     'Electrolyser cabinet (2.4 × 1.2 m, about 2.2 m tall plus vent stacks) that produces hydrogen from water, with louvred doors, a roof ventilation hood and H2 / O2 vent pipes; in a utility room or outdoor enclosure. Drawn as a rectangle. Synonyms: electrolyzer, H2 generator, hydrogen plant.'),
    ('air-compressor-skid', 'Air compressor skid', air_compressor_skid,
     'Compressed air station (2.6 × 1 m, 2 m tall): screw compressor package, refrigerant dryer and a vertical air receiver tank, piped together; in a compressor or utility room. Drawn as a rectangle with a circle for the receiver. Synonyms: air compressor, CDA supply, compressed dry air, receiver.'),
    ('gas-purifier', 'Gas purifier', gas_purifier,
     'Gas purifier unit (0.9 × 0.6 m, 2.2 m tall) with two purifier vessels, valves and a controller in an open frame on a base cabinet; cleans bulk or specialty gas before distribution, in a gas room or fab subfloor. Drawn as a small rectangle. Synonyms: purifier cabinet, point-of-use purifier, getter.'),
    ('bsgs-cabinet', 'BSGS cabinet', bsgs_cabinet,
     'Bulk specialty gas system (1.8 × 0.9 m, 2.5 m with ducts): a double-width ventilated gas cabinet with two windowed doors and two exhaust ducts, holding large specialty gas cylinders or tonners; in a gas room. Drawn as a rectangle against a wall. Synonyms: BSGS, double gas cabinet, bulk gas cabinet.'),
    # distribution
    ('valve-manifold-box', 'Valve manifold box', valve_manifold_box,
     'Valve manifold box (0.6 × 0.4 m) on a floor stand, with an exhaust duct and gas lines rising to the overhead header at 2.6 m; splits one gas line to several tools. Drawn as a small rectangle near tools or in a corridor. Synonyms: VMB, gas distribution box, valve box.'),
    ('gas-mixing-panel', 'Gas mixing panel', gas_mixing_panel,
     'Free-standing gas mixing panel (1.4 m wide, 2 m tall) with three inlet lines, mass flow controllers, a mixing vessel and an outlet; blends gases for welding, labs or processes. Drawn as a thin rectangle. Synonyms: gas mixer, blending panel, mixing station.'),
    ('pipe-run-long', 'Pipe run (4 m)', pipe_run_long,
     'Straight 4 m section of overhead gas or process pipe on three floor supports, pipe at 2.6 m; chain with the 2 m run, corner and tee for long routes. Drawn as a line along a route. Synonyms: pipe rack, gas line, header.'),
    ('exhaust-duct-run', 'Exhaust duct (4 m)', exhaust_duct_run,
     'Straight 4 m overhead rectangular exhaust duct (0.6 × 0.4 m, at 2.8 m) on two trapeze floor supports; carries extracted air from gas cabinets, hoods and tools to a scrubber or fan. Drawn as a wide double line. Synonyms: ductwork, extract duct, ventilation duct.'),
    ('exhaust-duct-corner', 'Exhaust duct corner', exhaust_duct_corner,
     'Overhead rectangular exhaust duct turning 90°, about 1 m arms, on two trapeze supports; joins exhaust duct runs at a corner of a route.'),
    ('cable-tray-run', 'Cable tray (4 m)', cable_tray_run,
     'Straight 4 m overhead ladder cable tray (0.45 m wide, at 2.8 m) with cable bundles, on two cantilever floor posts; routes power and signal cables. Drawn as a double line, sometimes dashed. Synonyms: cable ladder, cable rack, wireway.'),
    # safety
    ('gas-detection-post', 'Gas detection post', gas_detection_post,
     'Gas detection station on a floor post (0.4 × 0.3 m, 2.2 m tall): controller with display, a beacon on top and sensor heads near the floor and up high; placed near gas cabinets, tanks and stores. Drawn as a small symbol or dot labelled GD. Synonyms: gas detector, gas monitor, leak detector.'),
    ('emergency-shower', 'Emergency shower', emergency_shower,
     'Free-standing combination emergency shower and eyewash station (about 0.3 × 0.7 m, 2.3 m tall) with a pull-rod shower head and an eyewash bowl; near chemical and gas handling areas. Drawn as a small circle or square with a shower symbol. Synonyms: safety shower, eyewash, deluge shower.'),
    ('fire-extinguisher-stand', 'Fire extinguisher stand', fire_extinguisher_stand,
     'Stand with two portable fire extinguishers and a sign board (0.6 × 0.3 m, 1.5 m tall); along escape routes, at exits and next to hazardous equipment. Drawn as a small symbol labelled FE. Synonyms: extinguisher point, fire point.'),
    ('flammable-cabinet', 'Safety storage cabinet', flammable_cabinet,
     'Fire-rated safety storage cabinet (1.2 × 0.6 m, 2 m tall) with two doors, hazard labels and a vent connection, for flammable liquids or chemicals; against a wall in labs and workshops. Drawn as a rectangle. Synonyms: flammables cabinet, chemical cabinet, hazmat locker, COSHH cabinet.'),
    ('esd-button-post', 'ESD push-button post', esd_button_post,
     'Emergency shutdown push-button station on a floor post (0.3 × 0.25 m, 1.5 m tall) with a sign; stops gas supply or equipment, placed at exits and near gas systems. Drawn as a small symbol labelled ESD or E-stop. Synonyms: emergency stop, gas shut-off button, EPO.'),
    # cleanroom / fab
    ('wafer-stocker', 'Wafer stocker', wafer_stocker,
     'Automated wafer stocker (3 × 1.6 m, 3.3 m tall) with two front load ports holding FOUP carriers, a window and a fan filter unit on top; stores wafer lots in a fab bay. Drawn as a large rectangle. Synonyms: stocker, FOUP stocker, lot storage.'),
    ('process-tool-efem', 'Cluster tool', process_tool_efem,
     'Semiconductor cluster process tool (2.9 × 3.8 m, 2.3 m tall): an EFEM with three load ports at the front, load locks, a central transfer chamber and four process chambers; in rows in a fab bay. Drawn as a rectangle with smaller chamber squares around a polygon. Synonyms: process tool, cluster tool, etch / deposition tool, wafer tool.'),
    ('chemical-dispense-cabinet', 'Chemical dispense cabinet', chemical_dispense_cabinet,
     'Chemical dispense cabinet (1.5 × 0.9 m, 2.4 m with ducts) with a drum bay behind windowed doors, controls on top, an exhaust duct and chemical supply lines; in a chemical room or fab subfloor. Drawn as a rectangle against a wall. Synonyms: chemical delivery system, CDS, dispense unit.'),
    ('pass-box', 'Pass box', pass_box,
     'Cleanroom pass box (0.7 × 0.7 m, 1.6 m tall) on a stand, with interlocked windowed doors front and back; passes materials between rooms of different cleanliness, usually in or next to a wall. Drawn as a small square across a wall line. Synonyms: pass-through, transfer hatch, pass-through chamber.'),
    ('gowning-bench', 'Gowning bench', gowning_bench,
     'Cleanroom crossover / gowning bench (1.5 × 0.4 m, 0.48 m tall) with a shoe rack below; separates the clean and dirty sides of a gowning room. Drawn as a narrow rectangle across the room. Synonyms: crossover bench, step-over bench, changing bench.'),
    ('laminar-flow-hood', 'Laminar flow hood', laminar_flow_hood,
     'Laminar flow clean bench (1.3 × 0.75 m, 2.1 m tall) on a stand, with a fan/filter plenum on top and a front sash; gives a particle-free work area in labs and cleanrooms. Drawn as a rectangle against a wall. Synonyms: clean bench, LAF hood, laminar flow cabinet, biosafety cabinet.'),
    ('chiller-unit', 'Chiller', chiller_unit,
     'Air-cooled process chiller (2 × 1 m, 1.85 m tall) with two fans on top and supply / return water connections; cools process tools, outdoors or in a plant room. Drawn as a rectangle with two circles. Synonyms: process chiller, cooling unit, PCW chiller.'),
    ('air-handling-unit', 'Air handling unit', air_handling_unit,
     'Air handling unit (5 × 1.8 m, 2.65 m with ducts): a long sectioned casing with access doors on a base frame, supply and return ducts on top; on a roof or in a plant room. Drawn as a long rectangle labelled AHU. Synonyms: AHU, air handler, ventilation unit, MAU.'),
    ('exhaust-fan', 'Exhaust fan', exhaust_fan,
     'Centrifugal exhaust fan (1.6 × 1.2 m plinth, 2.6 m tall) with a motor, a side inlet duct and a vertical outlet; draws exhaust from ducts to a stack, on a roof or in a fan yard next to scrubbers. Drawn as a rectangle with a circle. Synonyms: extract fan, blower, exhaust blower.'),
    # logistics
    ('forklift', 'Forklift', forklift,
     'Counterbalance forklift truck (1.1 × 3.4 m including forks, 2.1 m tall) with mast, forks and overhead guard; moves pallets and cylinder bundles in warehouses, gas yards and loading bays. Drawn as a rectangle with two prongs. Synonyms: fork truck, lift truck, FLT.'),
    ('pallet-jack', 'Pallet jack', pallet_jack,
     'Hand pallet truck (0.55 × 1.55 m, 1.2 m tall handle) with two forks and a hydraulic pump; moves pallets by hand in stores and loading areas. Drawn as a small two-prong shape. Synonyms: pallet truck, hand truck, pump truck.'),
    ('ibc-tote', 'IBC tote', ibc_tote,
     '1000 l intermediate bulk container (1.2 × 1 m, 1.16 m tall): a plastic tank in a steel cage on a pallet, with a top cap and bottom valve; stores liquids and chemicals in stores and yards. Drawn as a square. Synonyms: IBC, tote tank, bulk container.'),
    ('drum', 'Drum', drum_single,
     'Standard 200 l steel drum (0.6 m diameter, 0.9 m tall) with rolling hoops; for oils, solvents and chemicals. Drawn as a small circle. Synonyms: barrel, 55 gallon drum, oil drum.'),
    ('drum-spill-pallet', 'Drums on spill pallet', drum_spill_pallet,
     'Spill containment pallet (1.3 × 1.3 m) with grating carrying four 200 l drums, 1.2 m tall; in chemical stores and workshops. Drawn as a square with four circles. Synonyms: spill pallet, bunded pallet, drum sump.'),
    ('dewar', 'Dewar', dewar,
     'Portable cryogenic liquid cylinder (about 0.58 m diameter, 1.6 m tall, 180–230 l) for liquid nitrogen, oxygen, argon or CO2: an insulated vessel on a castor base with a top handling ring and a valve and contents-gauge cluster. Drawn as a circle, often in a row in a gas store or next to a lab or process tool. Synonyms: dewar, liquid cylinder, LC, cryo cylinder, portable cryogenic container.'),
    ('pipeline-entry', 'Pipeline entry', pipeline_entry,
     'Gas service entry where a supply line enters the site from a utility main or external pipeline (about 0.6 × 0.4 m, 1.3 m tall): a pipe rising from the ground with a shut-off valve, a pressure regulator with gauge and a meter box, continuing toward the building. Drawn as a small symbol at a site boundary or outer wall, often labelled with the gas. Synonyms: gas service entry, pipeline inlet, supply station, pressure reduction station, PRS, meter set.'),
    ('cylinder-regulator', 'Cylinder regulator', cylinder_regulator,
     'Wall-mounted dual-gauge gas pressure regulator (about 0.45 m wide) on a bracket at 1.3 m, with an inlet nut, an outlet valve and a hose barb; reduces cylinder pressure for a line or instrument. Drawn as a small symbol on a wall, often next to a cylinder. Synonyms: pressure regulator, pressure reducer, cylinder regulator.'),
    ('regulator-panel-4', 'Regulator panel (4)', regulator_panel_4,
     'Wall-mounted gas regulator panel: a slotted backplate (0.8 m wide) at 1.3 m with four pressure regulators, each with two gauges; supplies several gas lines at controlled pressure in labs and gas rooms. Drawn as a short line along a wall with regulator symbols. Synonyms: gas panel, pressure reducing station, regulator station.'),
    ('regulator-panel-2', 'Regulator panel (2)', regulator_panel_2,
     'Wall-mounted backplate (0.45 m wide) at 1.3 m with two pressure regulators and their gauges; a two-gas or duty/standby supply point. Synonyms: gas panel, twin regulator, changeover panel.'),
    ('point-of-use-regulator', 'Point-of-use regulator', point_of_use_regulator,
     'Single pressure regulator with two gauges on a small wall plate at 1.3 m; final pressure control next to a bench, tool or instrument. Synonyms: POU regulator, line regulator, outlet point.'),
]


# ---------------------------------------------------------------------------------- export, render

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_materials='EXPORT', export_cameras=False,
                              export_lights=False)


def render_preview(obj, path):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'MATERIAL'
    shading.show_cavity = True
    shading.cavity_type = 'WORLD'
    shading.show_shadows = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.exposure = 0.8  # studio light is dim; lift to the viewer's near-white clay
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 128
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = path

    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    center = (lo + hi) / 2
    size = (hi - lo).length
    cam_data = bpy.data.cameras.new('preview')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = size * 1.02
    cam = bpy.data.objects.new('preview', cam_data)
    scene.collection.objects.link(cam)
    # From the front right, slightly above (the model's front faces -Y).
    direction = Vector((0.85, -1.25, 0.9)).normalized()
    cam.location = center + direction * size * 3
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.clip_end = size * 10
    scene.camera = cam
    bpy.ops.render.render(write_still=True)


def measure(obj):
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    ext = [max(c[i] for c in corners) - min(c[i] for c in corners) for i in range(2)]
    top = max(c[2] for c in corners)  # height of the top above the floor (= extent for floor models)
    return [round(v, 2) for v in (*ext, top)]  # width (x), depth (y = plan y), height


def ts_string(text):
    return "'" + text.replace('\\', '\\\\').replace("'", "\\'") + "'"


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = set(argv)
    os.makedirs(os.path.join(OUT, 'previews'), exist_ok=True)
    rows = []
    for model_id, name, build, description in MODELS:
        reset()
        model = build()
        mounted = model.mounted
        obj = model.build(model_id)
        w, d, h = measure(obj)
        if not only or model_id in only:
            export(obj, os.path.join(OUT, f'{model_id}.glb'))
            render_preview(obj, os.path.join(OUT, 'previews', f'{model_id}.png'))
            print(f'built {model_id}: {w} × {d} × {h} m')
        flag = ', true' if mounted else ''
        rows.append(f"  [{ts_string(model_id)}, {ts_string(name)}, {w}, {d}, {h}, {ts_string(description)}{flag}],")
    os.makedirs(os.path.dirname(CATALOG), exist_ok=True)
    with open(CATALOG, 'w') as f:
        f.write('// Generated by scripts/blender/gas_kit.py. Do not edit by hand.\n\n')
        f.write('/** [model file name, display name, width (x), depth (plan y), height (top above the floor), description, mounted?], meters. */\n')
        f.write('export const GAS_MODELS: readonly (readonly [string, string, number, number, number, string, boolean?])[] = [\n')
        f.write('\n'.join(rows) + '\n];\n')
    print(f'{len(rows)} models in catalog → {os.path.relpath(CATALOG, ROOT)}')


if __name__ == '__main__':
    main()
