import * as THREE from 'three'
import { BlendFunction, Effect, ToneMappingMode } from 'postprocessing'
import {
  Bloom,
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
  Vignette,
  wrapEffect,
} from '@react-three/postprocessing'
import type { Quality } from './quality'

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uExpo;
uniform float uSat;
uniform float uVib;
uniform float uDarkSat;
uniform float uContrast;
uniform float uPivot;
uniform float uGrain;

float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * uExpo;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(c.r, max(c.g, c.b));
  float sat = (mx - min(c.r, min(c.g, c.b))) / max(mx, 1e-4);
  // sombras menos saturadas, colores apagados con un toque de vibrance
  float kDark = mix(uDarkSat, 1.0, smoothstep(0.004, 0.06, l));
  float kVib = 1.0 + uVib * (1.0 - sat) * smoothstep(0.02, 0.15, l) * (1.0 - smoothstep(0.6, 0.95, l));
  c = max(vec3(l) + (c - vec3(l)) * (uSat * kDark * kVib), 0.0);
  vec3 o = toSrgb(clamp(c, 0.0, 1.0));
  // curva S "de copia fotográfica": extremos fijos, medios más firmes, sin aplastar negros ni quemar luces
  o = clamp(o + uContrast * o * (1.0 - o) * (o - uPivot), 0.0, 1.0);
  // grano de película animado, más fuerte en medios tonos, + dither a 8 bits
  vec2 fc = gl_FragCoord.xy + vec2(fract(uTime * 7.31) * 517.0, fract(uTime * 3.17) * 311.0);
  float n = h12(fc) + h12(fc + 71.3) - 1.0;
  float lo = dot(o, vec3(0.333));
  o += n * uGrain * (0.3 + 0.7 * (1.0 - abs(lo - 0.45) * 1.6));
  o += (h12(gl_FragCoord.xy + 5.588) - 0.5) / 255.0;
  outputColor = vec4(toLin(clamp(o, 0.0, 1.0)), inputColor.a);
}
`

interface GradeOptions {
  expo?: number
  sat?: number
  vib?: number
  darkSat?: number
  contrast?: number
  pivot?: number
  grain?: number
}

class FilmGradeEffect extends Effect {
  constructor({ expo = 0.95, sat = 1.04, vib = 0.24, darkSat = 0.78, contrast = 0.5, pivot = 0.44, grain = 0.012 }: GradeOptions = {}) {
    super('FilmGradeEffect', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uTime', new THREE.Uniform(0)],
        ['uExpo', new THREE.Uniform(expo)],
        ['uSat', new THREE.Uniform(sat)],
        ['uVib', new THREE.Uniform(vib)],
        ['uDarkSat', new THREE.Uniform(darkSat)],
        ['uContrast', new THREE.Uniform(contrast)],
        ['uPivot', new THREE.Uniform(pivot)],
        ['uGrain', new THREE.Uniform(grain)],
      ]),
    })
  }
  update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt: number) {
    const u = this.uniforms.get('uTime')!
    u.value += dt
  }
}
const FilmGrade = wrapEffect(FilmGradeEffect)

/** Cadena de postprocesado: oclusión ambiental → bloom → tono → gradación de cine → viñeta → SMAA. */
const fxFlag = (name: string) => {
  try {
    const f = new URLSearchParams(location.search).get('fx')
    return f == null || f.split(',').includes(name)
  } catch {
    return true
  }
}

export function Post({ quality: _q }: { quality: Exclude<Quality, 'low'> }) {
  return (
    <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType} enableNormalPass={false}>
      {/* AO desactivada por defecto: N8AO dejaba un halo fantasma sobre la pared. Se activa con ?fx=ao,bloom,... */}
      {new URLSearchParams(location.search).get('fx')?.split(',').includes('ao') ? <N8AO aoRadius={0.9} distanceFalloff={0.35} intensity={1.8} quality="performance" halfRes /> : <></>}
      {fxFlag('bloom') ? <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.2} intensity={0.45} radius={0.75} /> : <></>}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      {fxFlag('grade') ? <FilmGrade /> : <></>}
      {fxFlag('vig') ? <Vignette offset={0.32} darkness={0.5} /> : <></>}
      {fxFlag('smaa') ? <SMAA /> : <></>}
    </EffectComposer>
  )
}
