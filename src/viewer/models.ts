import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PickInfo } from './sceneBuilder';

/**
 * How a model is colored. Models are always decolorized: a matte `clay` neutral shaded by the
 * model's original brightness, so details stay readable. With an `accent` (the marker's color),
 * models that have accent parts (materials named `accent…`, e.g. the Gas kit) color only those
 * parts; other models are tinted whole.
 */
export interface ModelStyle {
  clay: THREE.Color;
  accent: THREE.Color | null;
  /** Color every material in `accent` (a state tint), not only accent parts. */
  whole?: boolean;
}

/** True for materials that take the accent color. */
const isAccentMaterial = (m: THREE.Material) => /^accent/i.test(m.name);

interface StyleUniforms {
  vlClay: { value: THREE.Color };
  vlAccent: { value: THREE.Color };
  vlAccentOn: { value: number };
}

// Runs after map/color sampling, on the linear diffuse color. Brightness is taken in a perceptual
// (gamma) space and compressed, so dark details read as soft shading rather than black.
const CLAY_GLSL = /* glsl */ `
#include <color_fragment>
float vlLum = pow(max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0), 1.0 / 2.2);
diffuseColor.rgb = (vlAccentOn > 0.5 ? vlAccent : vlClay) * mix(0.62, 1.0, smoothstep(0.02, 0.7, vlLum));
`;

/** Patch a model material once so its colors follow `uniforms` (shared program for all models). */
function patchMaterial(material: THREE.Material, uniforms: StyleUniforms): void {
  material.userData.vlStyle = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 vlClay;\nuniform vec3 vlAccent;\nuniform float vlAccentOn;')
      .replace('#include <color_fragment>', CLAY_GLSL);
  };
  material.customProgramCacheKey = () => 'vl-model-style';
  // Clay is matte.
  const std = material as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial) {
    std.roughness = 0.7;
    std.metalness = 0;
  }
}

/** Set the colors of a model instance (from `ModelCache.instantiate`) without recompiling. */
export function applyModelStyle(instance: THREE.Object3D, style: ModelStyle): void {
  let hasAccentParts = false;
  instance.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) hasAccentParts ||= (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(isAccentMaterial);
  });
  instance.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const u = m.userData.vlStyle as StyleUniforms | undefined;
      if (!u) continue;
      u.vlClay.value.copy(style.clay);
      const accent = hasAccentParts && !style.whole && !isAccentMaterial(m) ? null : style.accent;
      u.vlAccentOn.value = accent ? 1 : 0;
      if (accent) u.vlAccent.value.copy(accent);
    }
  });
}

/**
 * Loads glTF/GLB models once per URL and hands out instances. A template is normalized on load:
 * centered on the origin in x/z with its base at y = 0 (so it sits on the marker whatever the
 * file's pivot), and with unlit materials (`KHR_materials_unlit`) turned into lit ones so models
 * shade like the walls and floors.
 *
 * Instances share geometry and textures with the template (flagged `userData.sharedAsset`, see
 * `disposeObject`) but get their own materials, so hover highlighting stays per instance.
 */
export class ModelCache {
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<string, Promise<THREE.Object3D>>();
  private readonly loaded = new Set<THREE.Object3D>();
  private disposed = false;

  /**
   * The normalized template for `url`, loaded once. `mounted` keeps the file's height above its
   * origin (wall-mounted models) instead of setting the lowest point on the floor.
   */
  load(url: string, { mounted = false }: { mounted?: boolean } = {}): Promise<THREE.Object3D> {
    const key = mounted ? `mounted:${url}` : url;
    let entry = this.templates.get(key);
    if (!entry) {
      entry = this.loader.loadAsync(url).then((gltf) => {
        const template = normalize(gltf.scene, mounted);
        if (this.disposed) disposeTemplate(template);
        else this.loaded.add(template);
        return template;
      });
      entry.catch((err: unknown) => console.warn(`[floorview] could not load model ${url}:`, err));
      this.templates.set(key, entry);
    }
    return entry;
  }

  /** A copy of `template` with its own materials, every mesh tagged with `pick`, drawn in `style`. */
  instantiate(template: THREE.Object3D, pick: PickInfo, style: ModelStyle): THREE.Object3D {
    const instance = template.clone(true);
    instance.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const copy = (m: THREE.Material) => {
        const c = m.clone();
        patchMaterial(c, {
          vlClay: { value: new THREE.Color() },
          vlAccent: { value: new THREE.Color() },
          vlAccentOn: { value: 0 },
        });
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
      mesh.userData = { sharedAsset: true, pick: { ...pick } };
    });
    applyModelStyle(instance, style);
    return instance;
  }

  /** Free every loaded template (instances must already be disposed). */
  dispose(): void {
    this.disposed = true;
    for (const template of this.loaded) disposeTemplate(template);
    this.loaded.clear();
    this.templates.clear();
  }
}

function normalize(scene: THREE.Object3D, mounted: boolean): THREE.Object3D {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (m: THREE.Material): THREE.Material => {
      if (!(m as THREE.MeshBasicMaterial).isMeshBasicMaterial) return m;
      const basic = m as THREE.MeshBasicMaterial;
      const lit = new THREE.MeshStandardMaterial({
        name: basic.name,
        color: basic.color,
        map: basic.map,
        transparent: basic.transparent,
        opacity: basic.opacity,
        side: basic.side,
        vertexColors: basic.vertexColors,
        roughness: 0.85,
        metalness: 0,
      });
      basic.dispose();
      return lit;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.sub(new THREE.Vector3(center.x, mounted ? 0 : box.min.y, center.z));
  const root = new THREE.Group();
  root.add(scene);
  return root;
}

function disposeTemplate(template: THREE.Object3D): void {
  const seen = new Set<{ dispose(): void }>();
  template.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    seen.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      seen.add(m);
      for (const value of Object.values(m)) if ((value as THREE.Texture | null)?.isTexture) seen.add(value as THREE.Texture);
    }
  });
  seen.forEach((d) => d.dispose());
}
