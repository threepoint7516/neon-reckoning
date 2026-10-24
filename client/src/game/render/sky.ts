import * as THREE from "three";

/**
 * The city is always at night: a deep-blue, moonlit sky with warm windows,
 * lamps and signs. Expressed as a time of day in [0,1) (0 = midnight).
 */
export const NIGHT_TOD = 0.97;

const C = (h: number) => new THREE.Color(h);
const DAY_TOP = C(0x3d9bff);
const DAY_HOR = C(0xc4ecff);
const SET_TOP = C(0x5b7fd8);
const SET_HOR = C(0xffa86b);
const NIGHT_TOP = C(0x0d1f4f);
const NIGHT_HOR = C(0x2a4f8a);

export interface Lighting {
  /** 0 = full day, 1 = full night. */
  night: number;
  /** Strength of the golden-hour tint (0..1). */
  dusk: number;
  sunDir: THREE.Vector3;
  horizon: THREE.Color;
}

/**
 * Sky dome + sun/moon/hemisphere lights + fog, all driven by one time-of-day
 * value. Everything else (window glow, neon, street-lamp halos) reads the
 * returned `night` factor.
 */
export class DayNight {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  private mat: THREE.ShaderMaterial;
  readonly state: Lighting = { night: 0, dusk: 0, sunDir: new THREE.Vector3(0, 1, 0), horizon: new THREE.Color() };

  constructor(scene: THREE.Scene, shadows: boolean) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHor: { value: new THREE.Color() },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uNight: { value: 0 },
        uDusk: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform float uNight; uniform float uDusk; uniform float uTime;
        varying vec3 vD;
        float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          float y = vD.y;
          vec3 c = mix(uHor, uTop, smoothstep(-0.05, 0.55, y));
          if (y < 0.0) c = mix(uHor, uHor*0.8, smoothstep(0.0,-0.3,y));
          // Sun disc + halo.
          float sd = dot(vD, normalize(uSun));
          vec3 sunCol = mix(vec3(1.0,0.97,0.85), vec3(1.0,0.6,0.3), uDusk);
          c += sunCol * (smoothstep(0.9985,0.9993,sd)*3.0 + pow(max(sd,0.0),64.0)*0.5 + pow(max(sd,0.0),6.0)*0.18*(1.0+uDusk)) * (1.0-uNight);
          // Moon opposite the sun.
          float md = dot(vD, normalize(-uSun + vec3(0.0,0.15,0.0)));
          c += vec3(0.85,0.9,1.0) * (smoothstep(0.9988,0.9993,md)*2.0 + pow(max(md,0.0),200.0)*0.4) * uNight;
          // Stars.
          vec3 sp = floor(vD*380.0);
          c += vec3(step(0.9972, h(sp.xy + sp.z*7.1)) * smoothstep(0.05,0.4,y)) * uNight * 0.9;
          // Drifting cartoon clouds.
          if (y > 0.0) {
            vec2 uv = vD.xz / (y + 0.12) * 1.6 + vec2(uTime*0.012, uTime*0.004);
            float d = fbm(uv);
            float cl = smoothstep(0.52, 0.72, d) * smoothstep(0.0, 0.18, y);
            vec3 cloud = mix(vec3(1.0), vec3(1.0,0.75,0.6), uDusk);
            cloud = mix(cloud, vec3(0.28,0.34,0.52), uNight);
            c = mix(c, cloud, cl * 0.92);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfe6ff, 0xb5a080, 1.2);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(this.hemi, this.ambient);
  }

  /** Updates lights, sky and fog. Returns the shared lighting state. */
  update(tod: number, time: number, cam: THREE.Vector3, scene: THREE.Scene, renderer: THREE.WebGLRenderer): Lighting {
    const a = (tod - 0.25) * Math.PI * 2;
    const sunDir = this.state.sunDir.set(Math.cos(a), Math.sin(a), 0.35).normalize();
    const elev = sunDir.y;
    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.22);
    const night = 1 - day;
    const dusk = Math.exp(-(((elev - 0.04) / 0.16) ** 2)) * (elev > -0.25 ? 1 : 0);
    const top = DAY_TOP.clone().lerp(SET_TOP, dusk * 0.6).lerp(NIGHT_TOP, night);
    const hor = DAY_HOR.clone().lerp(SET_HOR, dusk * 0.85).lerp(NIGHT_HOR, night);
    this.mat.uniforms.uTop!.value.copy(top);
    this.mat.uniforms.uHor!.value.copy(hor);
    this.mat.uniforms.uSun!.value.copy(sunDir);
    this.mat.uniforms.uNight!.value = night;
    this.mat.uniforms.uDusk!.value = dusk;
    this.mat.uniforms.uTime!.value = time;
    this.sky.position.copy(cam);

    // Sun by day, cool moonlight by night (light always comes from above).
    const lightDir = elev > 0 ? sunDir : new THREE.Vector3(-sunDir.x, -sunDir.y, sunDir.z);
    this.sun.position.copy(cam).addScaledVector(lightDir, 150);
    this.sun.target.position.copy(cam);
    const sunCol = new THREE.Color(0xfff4e0).lerp(new THREE.Color(0xffad66), dusk * 0.8);
    this.sun.color.copy(sunCol).lerp(new THREE.Color(0xd2dcf0), night);
    // Night is the permanent setting, so keep the moonlight bright enough to fight in.
    this.sun.intensity = THREE.MathUtils.lerp(2.6, 0.85, night) * (1 - dusk * 0.35);
    this.hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.55);
    this.hemi.groundColor.set(0xb5a080).lerp(new THREE.Color(0x4a4a52), night);
    this.hemi.intensity = THREE.MathUtils.lerp(1.25, 0.95, night);
    this.ambient.color.set(0xffffff).lerp(new THREE.Color(0xb4bccc), night);
    this.ambient.intensity = THREE.MathUtils.lerp(0.35, 0.6, night);
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.copy(hor);
      scene.fog.density = THREE.MathUtils.lerp(0.0026, 0.0042, night);
    }
    if (scene.background instanceof THREE.Color) scene.background.copy(hor);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.2, night);
    this.state.night = night;
    this.state.dusk = dusk;
    this.state.horizon.copy(hor);
    return this.state;
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.mat.dispose();
  }
}
