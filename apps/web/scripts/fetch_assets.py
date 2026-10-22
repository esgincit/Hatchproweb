# Downloads the CC0 textures + HDRIs the live 3D farm uses (Poly Haven) into public/3d/, as compact WebP.
# Run from anywhere:  python apps/web/scripts/fetch_assets.py      (re-run is cheap: existing files are skipped)
# Maps per texture: _diff (sRGB colour), _nor (OpenGL normal), _arm (R = AO, G = roughness, B = metalness — the
# channel layout three.js expects for aoMap / roughnessMap / metalnessMap).
import io
import json
import os
import sys
import urllib.request

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', '3d'))
API = 'https://api.polyhaven.com/files/'

# local name → Poly Haven id
TEXTURES = {
    'roof_gi': 'corrugated_iron_02',
    'panel': 'box_profile_metal_sheet',
    'brick': 'brick_wall_005',
    'concrete': 'concrete_floor_02',
    'plaster': 'painted_plaster_wall',
    'soil': 'red_laterite_soil_stones',
    'grass': 'sparse_grass',
    'yard': 'dry_ground_01',
    'gravel': 'gravel_ground_01',
    'field': 'farm_soil',
    'litter': 'coast_sand_01',
    'rust': 'rusty_metal_02',
    'shutter': 'painted_metal_shutter',
    'planks': 'brown_planks_05',
    'bark': 'bark_brown_02',
}
HDRIS = {'day': ('farm_field_puresky', '2k'), 'night': ('qwantani_night_puresky', '1k')}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'HatchPro-asset-fetch'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def webp(data, path, quality):
    im = Image.open(io.BytesIO(data))
    im = im.convert('RGB')
    im.save(path, 'WEBP', quality=quality, method=6)


def main():
    os.makedirs(os.path.join(ROOT, 'tex'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'hdri'), exist_ok=True)
    for name, pid in TEXTURES.items():
        files = json.loads(get(API + pid))
        for key, suffix, q in (('Diffuse', 'diff', 82), ('nor_gl', 'nor', 90), ('arm', 'arm', 82)):
            out = os.path.join(ROOT, 'tex', f'{name}_{suffix}.webp')
            if os.path.exists(out):
                continue
            webp(get(files[key]['1k']['jpg']['url']), out, q)
            print('tex', os.path.basename(out), os.path.getsize(out))
    for name, (pid, res) in HDRIS.items():
        out = os.path.join(ROOT, 'hdri', f'{name}.hdr')
        if os.path.exists(out):
            continue
        files = json.loads(get(API + pid))
        open(out, 'wb').write(get(files['hdri'][res]['hdr']['url']))
        print('hdri', os.path.basename(out), os.path.getsize(out))
    total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(ROOT) for f in fs if d.endswith(('tex', 'hdri')))
    print(f'total tex+hdri: {total / 1e6:.1f} MB')


if __name__ == '__main__':
    sys.exit(main())
