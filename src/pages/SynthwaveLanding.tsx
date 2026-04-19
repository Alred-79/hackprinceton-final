import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export default function SynthwaveLanding() {
  const mountRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Scene & Camera
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.005);

    const camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // Post-processing
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.4, 0.1);
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // Neon texture
    function createThickNeonTexture() {
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(2, 5, 10, 0.9)";
      ctx.fillRect(0, 0, 512, 512);
      ctx.lineWidth = 15;
      ctx.strokeStyle = "rgba(0, 102, 255, 0.5)";
      ctx.strokeRect(0, 0, 512, 512);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#66aaff";
      ctx.strokeRect(0, 0, 512, 512);
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      return texture;
    }
    const neonTexture = createThickNeonTexture();

    // Starfield
    const starCount = 2000;
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 600;
      starPositions[i + 1] = (Math.random() - 0.5) * 600;
      starPositions[i + 2] = 20 - Math.random() * 800;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.6, transparent: true, opacity: 0.4 });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Node web
    const nodeCount = 1300;
    const maxConnectDistance = 9;
    const tunnelLength = 400;
    const nodeGeometry = new THREE.BufferGeometry();
    const nodePositions = new Float32Array(nodeCount * 3);
    const nodeVelocities: { x: number; y: number }[] = [];
    for (let i = 0; i < nodeCount * 3; i += 3) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2 + Math.random() * 15;
      nodePositions[i] = Math.cos(angle) * radius;
      nodePositions[i + 1] = Math.sin(angle) * radius;
      nodePositions[i + 2] = 20 - Math.random() * tunnelLength;
      nodeVelocities.push({ x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01 });
    }

    const circleCanvas = document.createElement("canvas");
    circleCanvas.width = 64; circleCanvas.height = 64;
    const cCtx = circleCanvas.getContext("2d")!;
    const grad = cCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    cCtx.fillStyle = grad;
    cCtx.fillRect(0, 0, 64, 64);
    const circleTexture = new THREE.CanvasTexture(circleCanvas);

    nodeGeometry.setAttribute("position", new THREE.BufferAttribute(nodePositions, 3));
    const nodeMaterial = new THREE.PointsMaterial({ color: 0x66ccff, size: 1.1, map: circleTexture, transparent: true, alphaTest: 0.05, depthWrite: false, opacity: 0.9 });
    const nodes = new THREE.Points(nodeGeometry, nodeMaterial);
    scene.add(nodes);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.35 });
    let linesMesh = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
    scene.add(linesMesh);

    // City blocks
    const blockCount = 3000;
    const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
    const blockMaterial = new THREE.MeshBasicMaterial({ map: neonTexture, transparent: true, opacity: 0.7, color: 0xdddddd });
    const instancedBlocks = new THREE.InstancedMesh(blockGeometry, blockMaterial, blockCount);
    const dummy = new THREE.Object3D();
    const blockData: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    for (let i = 0; i < blockCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 22 + Math.random() * 50;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const z = 20 - Math.random() * tunnelLength;
      const sx = 3 + Math.random() * 12;
      const sy = 3 + Math.random() * 12;
      const sz = 8 + Math.random() * 40;
      blockData.push({ x, y, z, sx, sy, sz });
      dummy.position.set(x, y, z);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      instancedBlocks.setMatrixAt(i, dummy.matrix);
    }
    scene.add(instancedBlocks);

    const forwardSpeed = 0.35;
    let animId: number;

    function animate() {
      animId = requestAnimationFrame(animate);

      const starPos = stars.geometry.attributes.position.array as Float32Array;
      for (let i = 2; i < starCount * 3; i += 3) {
        starPos[i] += forwardSpeed * 0.2;
        if (starPos[i] > 20) starPos[i] -= 800;
      }
      stars.geometry.attributes.position.needsUpdate = true;

      const positions = nodes.geometry.attributes.position.array as Float32Array;
      const linePositions: number[] = [];
      let vi = 0;
      for (let i = 0; i < nodeCount * 3; i += 3) {
        positions[i] += nodeVelocities[vi].x;
        positions[i + 1] += nodeVelocities[vi].y;
        positions[i + 2] += forwardSpeed;
        if (positions[i + 2] > 20) positions[i + 2] -= tunnelLength;
        for (let j = i + 3; j < nodeCount * 3; j += 3) {
          const dx = positions[i] - positions[j];
          const dy = positions[i + 1] - positions[j + 1];
          const dz = positions[i + 2] - positions[j + 2];
          if (dx * dx + dy * dy + dz * dz < maxConnectDistance * maxConnectDistance) {
            linePositions.push(positions[i], positions[i + 1], positions[i + 2], positions[j], positions[j + 1], positions[j + 2]);
          }
        }
        vi++;
      }
      nodes.geometry.attributes.position.needsUpdate = true;
      linesMesh.geometry.dispose();
      linesMesh.geometry = new THREE.BufferGeometry();
      linesMesh.geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));

      for (let i = 0; i < blockCount; i++) {
        const data = blockData[i];
        data.z += forwardSpeed;
        if (data.z > 20) data.z -= tunnelLength;
        dummy.position.set(data.x, data.y, data.z);
        dummy.scale.set(data.sx, data.sy, data.sz);
        dummy.updateMatrix();
        instancedBlocks.setMatrixAt(i, dummy.matrix);
      }
      instancedBlocks.instanceMatrix.needsUpdate = true;

      composer.render();
    }

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  const handleStart = () => {
    if (transitioning) return;
    setTransitioning(true);
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.transition = "opacity 0.4s ease-in";
      overlay.style.opacity = "1";
      setTimeout(() => navigate("/app"), 400);
    } else {
      navigate("/app");
    }
  };

  return (
    <div style={{ margin: 0, overflow: "hidden", backgroundColor: "#000000", width: "100vw", height: "100vh", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      <div ref={mountRef} style={{ position: "absolute", top: 0, left: 0, zIndex: 0 }} />

      {/* Flash overlay */}
      <div
        ref={overlayRef}
        style={{
          pointerEvents: "none",
          position: "fixed",
          inset: 0,
          background: "#000",
          opacity: 0,
          zIndex: 100,
        }}
      />

      {/* Content */}
      <div style={{
        position: "absolute",
        zIndex: 1,
        color: "#fff",
        textAlign: "center",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "rgba(0, 0, 0, 0.72)",
        padding: "3rem 4rem 2.8rem",
        borderRadius: "20px",
      }}>
        <h1 style={{
          fontSize: "4.5rem",
          margin: "0 0 1.2rem 0",
          letterSpacing: "6px",
          fontWeight: 700,
          textShadow: "0 0 12px rgba(0, 160, 255, 0.9), 0 0 35px rgba(0, 100, 255, 0.5), 0 0 70px rgba(0, 60, 255, 0.25)",
          color: "#eef6ff",
        }}>
          reAgent
        </h1>
        <p style={{
          fontSize: "0.85rem",
          fontWeight: 600,
          letterSpacing: "2px",
          color: "#88bbdd",
          margin: "0 auto 2.8rem auto",
          opacity: 0.95,
          maxWidth: "520px",
          lineHeight: 1.7,
          textShadow: "0 0 10px rgba(0, 120, 255, 0.5)",
        }}>
          topological architecture surveillance for deterministic compute arbitrage
        </p>
        <button
          onClick={handleStart}
          style={{
            display: "inline-block",
            padding: "0.9rem 3.8rem",
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: "0.95rem",
            fontWeight: 600,
            letterSpacing: "3px",
            color: "#bbd9ff",
            background: "rgba(0, 80, 255, 0.08)",
            border: "1px solid rgba(0, 150, 255, 0.65)",
            borderRadius: "999px",
            cursor: "pointer",
            transition: "background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s",
            boxShadow: "0 0 12px rgba(0, 120, 255, 0.2)",
          }}
          onMouseEnter={e => {
            const btn = e.currentTarget;
            btn.style.background = "rgba(0, 120, 255, 0.18)";
            btn.style.borderColor = "rgba(0, 180, 255, 1)";
            btn.style.color = "#ffffff";
            btn.style.boxShadow = "0 0 28px rgba(0, 140, 255, 0.5)";
          }}
          onMouseLeave={e => {
            const btn = e.currentTarget;
            btn.style.background = "rgba(0, 80, 255, 0.08)";
            btn.style.borderColor = "rgba(0, 150, 255, 0.65)";
            btn.style.color = "#bbd9ff";
            btn.style.boxShadow = "0 0 12px rgba(0, 120, 255, 0.2)";
          }}
        >
          start
        </button>
      </div>
    </div>
  );
}
