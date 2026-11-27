"use client";

/**
 * 开屏页：一条环形回廊，两侧挂着真实播客的封面。
 * 滚轮 / 拖拽往前走，点封面会滑过去停在正面，再点一次进书斋。
 *
 * 用的是本地 public/vendor/three.module.js（不依赖 CDN），
 * 所有贴图都是 public/covers 下的本地图，没有跨域问题。
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window { __THREE__?: unknown }
}

const COVERS = [
  // 商业 / 时事 / 人文优先
  { src: "/covers/splash-01.jpg", name: "纵横四海" },
  { src: "/covers/splash-02.jpg", name: "声动早咖啡" },
  { src: "/covers/splash-21.jpg", name: "HBG 品牌增长" },
  { src: "/covers/splash-26.jpg", name: "小Lin说财经" },
  { src: "/covers/splash-07.jpg", name: "Round Table" },
  { src: "/covers/splash-15.jpg", name: "资讯早7点" },
  { src: "/covers/splash-30.jpg", name: "World Today" },
  { src: "/covers/splash-20.jpg", name: "硅谷101" },
  { src: "/covers/splash-19.jpg", name: "忽左忽右" },
  { src: "/covers/splash-03.jpg", name: "岩中花述" },
  { src: "/covers/splash-16.jpg", name: "文化有限" },
  { src: "/covers/splash-04.jpg", name: "壮游者" },
  { src: "/covers/splash-25.jpg", name: "日谈公园" },
  { src: "/covers/splash-23.jpg", name: "不把天聊Si" },
  { src: "/covers/splash-22.jpg", name: "自习室" },
  { src: "/covers/splash-24.jpg", name: "人物访谈" },
  { src: "/covers/splash-05.jpg", name: "凹凸电波" },
  { src: "/covers/splash-06.jpg", name: "沈奕斐的播客" },
  { src: "/covers/splash-27.jpg", name: "TED" },
  { src: "/covers/splash-31.jpg", name: "賢者時間" },
  { src: "/covers/splash-12.jpg", name: "Self Evolution" },
  { src: "/covers/splash-13.jpg", name: "放学以后" },
  { src: "/covers/splash-17.jpg", name: "滑滑梯" },
  { src: "/covers/splash-18.jpg", name: "猫与播客" },
  { src: "/covers/splash-08.jpg", name: "Mantra" },
  // 英语类放后面
  { src: "/covers/splash-09.jpg", name: "anything goes" },
  { src: "/covers/splash-10.jpg", name: "Luke's English" },
  { src: "/covers/splash-11.jpg", name: "潘吉Jenny" },
  { src: "/covers/splash-28.jpg", name: "6 Minute English" },
  { src: "/covers/splash-14.jpg", name: "All Ears English" },
  { src: "/covers/splash-29.jpg", name: "IELTS Energy" },
];

declare global {
  interface Window { gsap?: any }
}

type Pose = { th: number; r: number; yaw: number; y: number; pitch: number };

const WALK: Pose = { th: 0, r: 15.6, yaw: -0.30, y: 1.92, pitch: -0.12 };
const STEP = (Math.PI * 2) / 36;

export default function SplashPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [autoWalk, setAutoWalk] = useState(true);
  const autoRef = useRef(true);
  const lastInputRef = useRef(0);
  const rootRef = useRef<HTMLElement>(null);
  const stateRef = useRef({ focus: -1, walking: true });
  const labelRef = useRef<HTMLDivElement>(null);

  /** 从开屏"走进"书斋：GSAP 时间线，先压暗画面再拉开幕布 */
  function enterApp() {
    const gsap = window.gsap;
    const el = rootRef.current;
    const go = () => {
      try { sessionStorage.setItem("pm_paper_in", "1"); } catch { /* 忽略 */ }
      router.push("/dashboard");
    };
    if (!gsap || !el) { go(); return; }
    if (el.dataset.leaving === "1") return;
    el.dataset.leaving = "1";
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    // 品牌元素先淡出（0.3s），画面同时轻微收拢
    tl.to(".splash-caption, .splash-pill", { opacity: 0, y: -10, duration: 0.3, stagger: 0.03 })
      .to(".splash-nav", { opacity: 0, duration: 0.25 }, 0.05)
      .to(".splash-canvas", { scale: 1.03, opacity: 0.55, duration: 0.55 }, 0)
      // 纸页从下往上铺开，铺满时跳转（首页接同一张纸，所以不会闪白）
      .to(".splash-paper", { clipPath: "inset(0% 0% 0% 0%)", duration: 0.42, ease: "power2.inOut" }, 0.14)
      .to({}, { duration: 0.06, onComplete: go });
  }

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      // 1) 注入 three（本地文件，module 形式）
      if (!window.__THREE__) {
        const s = document.createElement("script");
        s.type = "module";
        s.textContent = `import * as THREE from "/vendor/three.module.js"; window.__THREE__ = THREE; window.dispatchEvent(new Event("three-ready"));`;
        document.head.appendChild(s);
        await new Promise<void>((resolve) => {
          if (window.__THREE__) return resolve();
          const t = setTimeout(resolve, 8000);
          window.addEventListener("three-ready", () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
      const THREE = window.__THREE__ as any | undefined;
      if (!THREE || disposed) { setFailed(!THREE); return; }

      const canvas = canvasRef.current;
      if (!canvas) return;

      // 2) 渲染器 / 场景 / 相机
      let renderer: any;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      } catch {
        setFailed(true);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#F3F3ED");
      scene.fog = new THREE.Fog("#F3F3ED", 10, 46);

      const camera = new THREE.PerspectiveCamera(56, 1, 0.05, 100);
      let vw = window.innerWidth, vh = window.innerHeight;
      camera.fov = vw >= vh ? 56 : 70;
      camera.aspect = vw / vh;

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const small = window.matchMedia("(max-width: 819px), (orientation: portrait) and (max-width: 1100px)").matches;

      // 3) 墙面 / 地面 / 天花板：全部用 canvas 渐变，不挂外链
      function gradientTexture(stops: [number, string][], vertical = true) {
        const c = document.createElement("canvas");
        c.width = vertical ? 4 : 1024;
        c.height = vertical ? 256 : 1024;
        const ctx = c.getContext("2d")!;
        const g = vertical ? ctx.createLinearGradient(0, 0, 0, c.height) : ctx.createRadialGradient(512, 512, 0, 512, 512, 512);
        stops.forEach(([p, col]) => g.addColorStop(p, col));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.width, c.height);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      }

      const R = 18, RIN = 12.2, H = 6.2;
      const outer = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, H, 160, 1, true),
        new THREE.MeshBasicMaterial({
          side: THREE.BackSide,
          map: gradientTexture([[0, "#F5EBD8"], [0.2, "#FBF3E3"], [0.6, "#FBF3E3"], [0.86, "#F8EDD9"], [1, "#EFDFC4"]]),
        })
      );
      outer.position.y = H / 2;
      scene.add(outer);

      const inner = new THREE.Mesh(
        new THREE.CylinderGeometry(RIN, RIN, H, 120, 1, true),
        new THREE.MeshBasicMaterial({
          side: THREE.FrontSide,
          map: gradientTexture([[0, "#F7EEDD"], [0.3, "#FFFAF0"], [0.8, "#FDF5E6"], [1, "#F1E1C6"]]),
        })
      );
      inner.position.y = H / 2;
      scene.add(inner);

      const floorTex = (() => {
        const c = document.createElement("canvas");
        c.width = 1024; c.height = 1024;
        const ctx = c.getContext("2d")!;
        const g = ctx.createRadialGradient(512, 512, 512 * (12.2 / 18), 512, 512, 512);
        g.addColorStop(0, "#EDD6B0");
        g.addColorStop(0.55, "#F3E1C3");
        g.addColorStop(1, "#EFDAB8");
        ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 1024);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(R, 160),
        new THREE.MeshBasicMaterial({ map: floorTex })
      );
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);

      const ceiling = new THREE.Mesh(
        new THREE.CircleGeometry(R, 160),
        new THREE.MeshBasicMaterial({ color: "#FAF1E0", side: THREE.BackSide })
      );
      ceiling.rotation.x = -Math.PI / 2;
      ceiling.position.y = H;
      scene.add(ceiling);

      // 4) 封面：等 9 张图都 load 完再挂上去
      const loader = new THREE.TextureLoader();
      const textures = await Promise.all(
        COVERS.map(
          (c) =>
            new Promise<any>((resolve, reject) => {
              loader.load(c.src, (t: any) => {
                t.colorSpace = THREE.SRGBColorSpace;
                t.anisotropy = renderer.capabilities.getMaxAnisotropy();
                resolve(t);
              }, undefined, reject);
            })
        )
      ).catch(() => [] as any[]);
      if (disposed) return;
      if (!textures.length) { setFailed(true); return; }

      const PW = 1.36, PH = 1.36, PY = 1.95;

      function labelTexture(name: string) {
        const c = document.createElement("canvas");
        c.width = 640; c.height = 200;
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, 640, 200);
        ctx.fillStyle = "#3A3550";
        ctx.font = '600 62px "PingFang SC", "Hiragino Sans GB", sans-serif';
        ctx.textBaseline = "middle";
        ctx.fillText(name, 8, 70);
        ctx.fillStyle = "rgba(58,53,80,.6)";
        ctx.font = '400 34px "PingFang SC", sans-serif';
        ctx.fillText("PODCAST", 8, 140);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      }

      const halo = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const ctx = c.getContext("2d")!;
        const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        g.addColorStop(0, "rgba(255,255,255,.95)");
        g.addColorStop(0.35, "rgba(255,255,255,.5)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
        return new THREE.CanvasTexture(c);
      })();
      const shadowTex = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const ctx = c.getContext("2d")!;
        const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        g.addColorStop(0, "rgba(120,90,50,.28)");
        g.addColorStop(0.25, "rgba(120,90,50,.2)");
        g.addColorStop(1, "rgba(120,90,50,0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
        return new THREE.CanvasTexture(c);
      })();

      const printMeshes: any[] = [];

      function makeGroup(index: number) {
        const g = new THREE.Group();
        const tex = textures[index % textures.length];

        const h = new THREE.Mesh(
          new THREE.PlaneGeometry(PW * 2.1, PH * 1.75),
          new THREE.MeshBasicMaterial({ map: halo, transparent: true, depthWrite: false, fog: true })
        );
        h.position.set(0, PY + 0.05, 0.005);
        g.add(h);

        const sh = new THREE.Mesh(
          new THREE.PlaneGeometry(PW * 1.25, PH * 1.18),
          new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
        );
        sh.position.set(0.05, PY - 0.06, 0.01);
        g.add(sh);

        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(PW + 0.07, PH + 0.07, 0.06),
          new THREE.MeshBasicMaterial({ color: "#D3AA72" })
        );
        frame.position.set(0, PY, 0.045);
        g.add(frame);

        const print = new THREE.Mesh(
          new THREE.PlaneGeometry(PW, PH),
          new THREE.MeshBasicMaterial({ map: tex })
        );
        print.position.set(0, PY, 0.077);
        print.userData.index = index;
        g.add(print);
        printMeshes.push(print);

        const label = new THREE.Mesh(
          new THREE.PlaneGeometry(0.92, 0.29),
          new THREE.MeshBasicMaterial({
            map: labelTexture(COVERS[index % COVERS.length].name),
            transparent: true,
            depthWrite: false,
          })
        );
        label.position.set(-PW / 2 + 0.46, PY - PH / 2 - 0.34, 0.02);
        g.add(label);

        return { group: g, print };
      }

      const outerGroups: any[] = [];
      const innerGroups: any[] = [];
      const HALF = 3;
      // 开场镜头从第 19 个位置往前看，索引是递减的，
      // 所以用「减法」把商业/时事那一段排到镜头前。
      const ANCHOR = 19;
      const coverAt = (i: number) => ((ANCHOR - i) % COVERS.length + COVERS.length) % COVERS.length; // 两墙只错开 3 个位置：视野里不撞图，同时两墙都从「商业/时事」那一段开始
      // 每墙 48 个位置：比素材多，所以走起来像"一直蔓延"；
      // 内墙用不同的起点与步长，保证同一视角左右不会是同一张。
      const PER_WALL = 48;
      const STRIDE = 1;
      for (let s = 0; s < PER_WALL; s++) {
        const { group } = makeGroup(coverAt(s));
        const a = (s * Math.PI * 2) / PER_WALL;
        group.position.set(Math.cos(a) * 17.98, 0, Math.sin(a) * 17.98);
        group.lookAt(0, 0, 0);
        scene.add(group);
        outerGroups.push(group);
      }
      for (let k = 0; k < PER_WALL; k++) {
        const { group } = makeGroup(coverAt(k * STRIDE + HALF));
        const a = (k + 0.5) * (Math.PI * 2 / PER_WALL);
        group.position.set(Math.cos(a) * 12.22, 0, Math.sin(a) * 12.22);
        group.lookAt(Math.cos(a) * 24, 0, Math.sin(a) * 24);
        scene.add(group);
        innerGroups.push(group);
      }

      // 5) 相机姿态 + 滑动
      const D = small ? 0.14 + 0.9 * STEP : 0.14;
      const pose = { ...WALK, th: WALK.th + D };
      let target = pose.th;
      let glide: { from: Pose; to: Pose; t0: number; dur: number } | null = null;
      let focusAngle: { side: "out" | "in"; angle: number; name: string } | null = null;

      const easeQuart = (t: number) => 1 - Math.pow(1 - t, 4);
      const easeCubic = (t: number) => 1 - Math.pow(1 - t, 3);
      const easeQuad = (t: number) => 1 - Math.pow(1 - t, 2);

      function applyPose(p: Pose) {
        const cx = Math.cos(p.th), cz = Math.sin(p.th);
        camera.position.set(p.r * cx, p.y, p.r * cz);
        const tx = Math.sin(p.th), tz = -Math.cos(p.th);
        const nx = Math.cos(p.th), nz = Math.sin(p.th);
        const dx = Math.cos(p.yaw) * tx + Math.sin(p.yaw) * nx;
        const dz = Math.cos(p.yaw) * tz + Math.sin(p.yaw) * nz;
        camera.lookAt(camera.position.x + dx, p.y + p.pitch, camera.position.z + dz);
      }

      function focusPose(side: "out" | "in", angle: number): Pose {
        const base = small
          ? { r: side === "out" ? 18 - 5.2 : 12.2 + 5.2, y: PY - 1.05 }
          : { r: side === "out" ? 18 - 4.26 : 12.2 + 4.26, y: PY - 0.52 };
        return { th: angle, r: base.r, yaw: side === "out" ? Math.PI / 2 : -Math.PI / 2, y: base.y, pitch: 0 };
      }

      function nearestAngle(angle: number, from: number) {
        let a = angle;
        while (a - from > Math.PI) a -= Math.PI * 2;
        while (a - from < -Math.PI) a += Math.PI * 2;
        return a;
      }

      function glideTo(to: Pose, dur = reduced ? 0 : 950) {
        if (dur === 0) { Object.assign(pose, to); target = to.th; applyPose(pose); return; }
        glide = { from: { ...pose }, to, t0: performance.now(), dur };
      }

      function stepBack() {
        const walk: Pose = { ...WALK, th: pose.th + D };
        focusAngle = null;
        stateRef.current.focus = -1;
        setFocused(null);
        glideTo(walk);
      }

      // 6) 交互：滚轮 / 拖拽 / 方向键 / 点击
      let dragging = false;
      let dragX = 0, dragY = 0, downX = 0, downY = 0, draggingMoved = false;

      function walkBy(d: number) {
        if (glide) return;
        target -= d;
      }

      function touchInput() { lastInputRef.current = performance.now(); }

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        touchInput();
        if (focusAngle) { stepBack(); return; }
        const unit = e.deltaMode === 1 ? 33 : 1;
        walkBy(e.deltaY * 0.0016 * unit);
      };

      function onPointerDown(e: PointerEvent) {
        if (e.button !== 0) return;
        touchInput();
        dragging = true; draggingMoved = false;
        downX = e.clientX; downY = e.clientY;
        dragX = e.clientX; dragY = e.clientY;
        canvas!.setPointerCapture(e.pointerId);
      }
      function onPointerMove(e: PointerEvent) {
        if (!dragging) return;
        const dx = e.clientX - dragX, dy = e.clientY - dragY;
        if (!draggingMoved && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) draggingMoved = true;
        if (draggingMoved) {
          if (focusAngle) { stepBack(); }
          const d = Math.abs(e.clientX - downX) > Math.abs(e.clientY - downY) ? dx : dy;
          walkBy(d * (small ? 0.0042 : 0.0022));
        }
        dragX = e.clientX; dragY = e.clientY;
        // 悬停提示
        hoverProbe(e.clientX, e.clientY);
      }
      function onPointerUp(e: PointerEvent) {
        if (!dragging) return;
        dragging = false;
        if (!draggingMoved) {
          // 点任意地方都能进去：先落一个涟漪，再走转场
          ripple(e.clientX, e.clientY);
          window.setTimeout(() => enterApp(), 170);
        }
      }

      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      function pick(x: number, y: number): number | null {
        const r = canvas!.getBoundingClientRect();
        ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(printMeshes, false);
        for (const hit of hits) {
          const idx = hit.object.userData.index as number;
          if (typeof idx === "number") return idx;
        }
        return null;
      }

      function hoverProbe(x: number, y: number) {
        const idx = pick(x, y);
        const label = labelRef.current;
        if (!label) return;
        if (idx === null) { label.style.opacity = "0"; return; }
        label.style.opacity = "1";
        label.textContent = focusAngle ? "点开这一期 →" : `${COVERS[idx % COVERS.length].name} · 点一下靠近`;
        label.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
      }

      function ripple(x: number, y: number) {
        const el = document.createElement("span");
        el.className = "splash-ripple";
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        document.body.appendChild(el);
        const g = window.gsap;
        if (g) {
          g.fromTo(el, { scale: 0.2, opacity: 0.85 }, {
            scale: 30, opacity: 0, duration: 0.85, ease: "power2.out",
            onComplete: () => el.remove(),
          });
        } else {
          window.setTimeout(() => el.remove(), 900);
        }
      }

      function clickProbe(x: number, y: number) {
        const idx = pick(x, y);
        if (idx === null) {
          if (focusAngle) stepBack();
          return;
        }
        const name = COVERS[idx % COVERS.length].name;
        // 判断在内外哪面墙：找离相机最近的那面
        const camR = Math.hypot(camera.position.x, camera.position.z);
        const side: "out" | "in" = camR > 15.1 ? "out" : "in";
        if (focusAngle && focusAngle.name === name) {
          enterApp();
          return;
        }
        // 找到这个封面对应的角度：就近取
        let best = 0, bestD = Infinity;
        const camTh = Math.atan2(camera.position.z, camera.position.x);
        const lists = side === "out" ? [36, 0] : [24, 0];
        for (let i = 0; i < lists[0]; i++) {
          const a = side === "out" ? (i * Math.PI * 2) / 36 : (i + 0.5) * (Math.PI * 2 / 24);
          const d = Math.abs(nearestAngle(a, camTh) - camTh);
          if (d < bestD) { bestD = d; best = a; }
        }
        focusAngle = { side, angle: best, name };
        stateRef.current.focus = idx;
        setFocused(name);
        glideTo(focusPose(side, nearestAngle(best, pose.th)));
        labelRef.current && (labelRef.current.style.opacity = "0");
      }

      const onKey = (e: KeyboardEvent) => {
        touchInput();
        if (e.key === "Escape") { stepBack(); return; }
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          if (!glide) target = (Math.round((target - D) / STEP) + 1) * STEP + D;
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          if (!glide) target = (Math.round((target - D) / STEP) - 1) * STEP + D;
        }
      };

      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      window.addEventListener("keydown", onKey);

      function resize() {
        vw = window.innerWidth; vh = window.innerHeight;
        renderer.setSize(vw, vh, false);
        camera.aspect = vw / vh;
        camera.fov = vw >= vh ? 56 : 70;
        camera.updateProjectionMatrix();
      }
      resize();
      window.addEventListener("resize", resize);

      // 7) 开场：相机从背后一点推进来
      const introStart = performance.now();
      const from: Pose = { ...WALK, th: WALK.th + D + 0.16, r: WALK.r - 0.35, yaw: WALK.yaw + 0.02 };
      applyPose(from);
      setReady(true);

      let raf = 0;
      let last = performance.now();
      function frame(now: number) {
        if (disposed) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        // 入场 1.4s
        if (!reduced && now - introStart < 1400) {
          const t = (now - introStart) / 1400;
          const k = 1 - Math.pow(2, -10 * t);
          const p: Pose = {
            th: from.th + (WALK.th + D - from.th) * k,
            r: from.r + (WALK.r - from.r) * k,
            yaw: from.yaw + (WALK.yaw - from.yaw) * k,
            y: from.y + (WALK.y - from.y) * k,
            pitch: from.pitch + (WALK.pitch - from.pitch) * k,
          };
          applyPose(p);
          target = p.th;
        } else if (glide) {
          const t = Math.min(1, (now - glide.t0) / glide.dur);
          const a = glide.from, b = glide.to;
          applyPose({
            th: a.th + (b.th - a.th) * easeQuart(t),
            r: a.r + (b.r - a.r) * easeCubic(t),
            yaw: a.yaw + (b.yaw - a.yaw) * easeQuad(t),
            y: a.y + (b.y - a.y) * easeCubic(t),
            pitch: a.pitch + (b.pitch - a.pitch) * easeCubic(t),
          });
          if (t >= 1) { glide = null; Object.assign(pose, b); }
        } else {
          // 自动漫游：一段时间没操作，画廊会自己缓慢往前转
          if (!reduced && autoRef.current && focusAngle === null && !dragging && now - lastInputRef.current > 1200) {
            target -= 0.00075 * (dt * 60);
          }
          if (reduced) pose.th = target;
          else pose.th += (target - pose.th) * (1 - Math.exp(-dt / 0.36));
          applyPose(pose);
          if (focusAngle) target = pose.th;
        }

        renderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        window.removeEventListener("keydown", onKey);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        renderer.dispose();
      };
    })();

    return () => { disposed = true; cleanup(); };
  }, [router]);

  return (
    <main ref={rootRef} className={`splash ${ready ? "is-ready" : ""}`}>
      <canvas ref={canvasRef} className="splash-canvas" />
      {!ready && !failed && <div className="splash-veil" />}

      <header className="splash-nav">
        <span className="splash-logo">Podcast Mantra</span>
        <span className="splash-links">
          <button onClick={enterApp}>进入书斋</button>
          <button className={`splash-auto ${autoWalk ? "on" : ""}`} onClick={() => { setAutoWalk((v) => { autoRef.current = !v; return !v; }); }}>
            {autoWalk ? "自动漫游 · 开" : "自动漫游 · 关"}
          </button>
        </span>
      </header>

      <div ref={labelRef} className="splash-pill" />

      <div className="splash-caption">
        <span className="splash-kicker"><i className="mask"><i>WHERE EVERY VOICE BECOMES YOUR MANTRA</i></i></span>
        <h1 className="splash-title">
          <span className="mask"><span>Podcast</span></span>
          <span className="mask"><span>Mantra</span></span>
        </h1>
        <button className="splash-cta" onClick={enterApp}>
          ENTER THE COLLECTION →
        </button>
      </div>



      {focused && <div className="splash-focus">{focused} · 再点一次进入书斋</div>}

      {/* 纸页：从下往上铺满，接续首页 */}
      <div className="splash-paper" />

      {failed && (
        <div className="splash-fallback">
          <h2>Podcast Mantra</h2>
          <p>这台设备的浏览器没能启动 3D 回廊，直接进书斋吧。</p>
          <button onClick={enterApp}>进入书斋 →</button>
        </div>
      )}
    </main>
  );
}
