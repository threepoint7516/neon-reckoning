import * as THREE from "three";
import { WEAPONS, weaponFromIndex } from "@neon/shared";
import { textTexture } from "./textures";

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function part(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export interface AvatarState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: boolean;
  downed: boolean;
  alive: boolean;
  speed: number;
  weapon: number;
  revealed: boolean;
  protectedSpawn: boolean;
  gliding: boolean;
  sliding: boolean;
}

/**
 * Procedural armoured runner. Team colour drives visor, shoulder and strip
 * emissives so friend/foe reads instantly at range (colour-blind palette
 * supported).
 */
export class Avatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private head: THREE.Group;
  private gun: THREE.Mesh;
  private gunGlow: THREE.Mesh;
  private torso: THREE.Mesh;
  private glider: THREE.Mesh;
  private ghost: THREE.Mesh;
  private tag: THREE.Sprite | null = null;
  private mats: THREE.Material[] = [];
  private phase = 0;
  private deadT = 0;
  private teamMat: THREE.MeshBasicMaterial;

  constructor(teamColor: number, name: string, showTag: boolean, isBot: boolean) {
    const armor = new THREE.MeshStandardMaterial({ color: 0x23232f, roughness: 0.45, metalness: 0.7 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x15151d, roughness: 0.8, metalness: 0.2 });
    this.teamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor).multiplyScalar(2.2), toneMapped: false });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.4, metalness: 0.8 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mats.push(armor, suit, this.teamMat, gunMat, glowMat);

    this.legL = part(0.22, 0.85, 0.24, suit, -0.13, -0.42, 0);
    this.legR = part(0.22, 0.85, 0.24, suit, 0.13, -0.42, 0);
    const hips = new THREE.Group();
    hips.position.y = 0.88;
    const legLPivot = new THREE.Group();
    legLPivot.add(this.legL);
    legLPivot.position.x = 0;
    const legRPivot = new THREE.Group();
    legRPivot.add(this.legR);
    hips.add(legLPivot, legRPivot);
    this.legL.userData.pivot = legLPivot;
    this.legR.userData.pivot = legRPivot;
    this.body.add(hips);

    this.torso = part(0.52, 0.62, 0.3, armor, 0, 1.2, 0);
    this.body.add(this.torso);
    this.body.add(part(0.54, 0.06, 0.32, this.teamMat, 0, 1.36, 0));
    this.body.add(part(0.18, 0.3, 0.12, suit, 0, 1.15, 0.2)); // backpack
    this.body.add(part(0.04, 0.22, 0.02, this.teamMat, 0, 1.18, 0.265));

    this.head = new THREE.Group();
    this.head.position.y = 1.6;
    this.head.add(part(0.28, 0.3, 0.3, armor, 0, 0, 0));
    this.head.add(part(0.24, 0.07, 0.04, this.teamMat, 0, 0.02, -0.16));
    this.body.add(this.head);

    const arm = (side: number) => {
      const g = new THREE.Group();
      g.position.set(side * 0.33, 1.42, 0);
      g.add(part(0.14, 0.15, 0.15, this.teamMat, 0, 0.04, 0));
      const a = part(0.13, 0.55, 0.14, suit, 0, -0.26, 0);
      g.add(a);
      return g;
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    this.body.add(this.armL, this.armR);
    this.gun = part(0.09, 0.12, 0.7, gunMat, 0.12, 1.22, -0.38);
    this.gunGlow = part(0.02, 0.03, 0.5, glowMat, 0.12, 1.29, -0.38);
    this.body.add(this.gun, this.gunGlow);

    // Insertion glider wing.
    this.glider = part(2.2, 0.05, 0.7, this.teamMat, 0, 2.3, 0.1);
    this.glider.visible = false;
    this.body.add(this.glider);

    // See-through silhouette for revealed enemies (recon pulse / radar sweep).
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, toneMapped: false });
    this.mats.push(ghostMat);
    this.ghost = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 8), ghostMat);
    this.ghost.position.y = 0.9;
    this.ghost.renderOrder = 10;
    this.ghost.visible = false;
    this.root.add(this.ghost);

    this.root.add(this.body);
    if (showTag) {
      const t = textTexture(name, isBot ? "#c8c8ff" : "#ffffff", { w: 256, h: 48, glow: false, bg: "rgba(5,5,15,0.55)" });
      const sm = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false });
      this.mats.push(sm);
      this.tag = new THREE.Sprite(sm);
      this.tag.scale.set(1.4, 0.26, 1);
      this.tag.position.y = 2.15;
      this.tag.renderOrder = 11;
      this.root.add(this.tag);
    }
  }

  setTeamColor(c: number): void {
    this.teamMat.color.setHex(c).multiplyScalar(2.2);
  }

  update(s: AvatarState, dt: number, time: number): void {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    if (!s.alive) {
      this.deadT += dt;
      this.body.rotation.x = Math.min(Math.PI / 2, this.deadT * 5);
      this.body.position.y = -Math.min(0.4, this.deadT);
      this.root.visible = this.deadT < 1.4;
      this.ghost.visible = false;
      return;
    }
    this.deadT = 0;
    this.root.visible = true;
    this.body.position.y = 0;
    this.body.rotation.x = s.downed ? Math.PI / 2.2 : 0;
    if (s.downed) this.body.position.y = 0.25;
    const crouch = s.crouch || s.sliding ? 1 : 0;
    this.body.scale.y = 1 - crouch * 0.33;
    // Gait.
    this.phase += dt * Math.min(14, s.speed * 1.7);
    const swing = s.speed > 0.5 && !s.gliding ? Math.sin(this.phase) * Math.min(0.8, s.speed * 0.1) : 0;
    (this.legL.userData.pivot as THREE.Group).rotation.x = swing;
    (this.legR.userData.pivot as THREE.Group).rotation.x = -swing;
    this.armL.rotation.x = -0.9 - s.pitch * 0.8;
    this.armR.rotation.x = -1.1 - s.pitch * 0.8;
    this.head.rotation.x = s.pitch * 0.6;
    this.gun.rotation.x = s.pitch * 0.7;
    this.gunGlow.rotation.x = s.pitch * 0.7;
    const w = weaponFromIndex(s.weapon);
    if (w) {
      (this.gunGlow.material as THREE.MeshBasicMaterial).color.setHex(WEAPONS[w].color).multiplyScalar(2);
      this.gun.scale.z = w === "phantom" ? 0.35 : w === "longshot" || w === "railspike" ? 1.25 : w === "titan" || w === "nova" ? 1.05 : 0.8;
    }
    this.glider.visible = s.gliding;
    this.ghost.visible = s.revealed;
    if (s.protectedSpawn) this.body.visible = Math.sin(time * 30) > -0.3;
    else this.body.visible = true;
  }

  dispose(): void {
    for (const m of this.mats) {
      if ((m as THREE.SpriteMaterial).map) (m as THREE.SpriteMaterial).map!.dispose();
      m.dispose();
    }
    this.ghost.geometry.dispose();
  }
}
