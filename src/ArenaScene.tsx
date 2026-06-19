import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Direction, GamePhase, ShotZone } from "./game";

type ArenaSceneProps = {
  momentum: number;
  phase: GamePhase;
  direction: Direction | null;
  shotZone: ShotZone;
  keeperZone: ShotZone;
  goal: boolean | null;
};

export function ArenaScene({
  momentum,
  phase,
  direction,
  shotZone,
  keeperZone,
  goal,
}: ArenaSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef({ momentum, phase, direction, shotZone, keeperZone, goal });

  useEffect(() => {
    stateRef.current = { momentum, phase, direction, shotZone, keeperZone, goal };
  }, [direction, goal, keeperZone, momentum, phase, shotZone]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x08100b, 13, 38);

    const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.set(0, 6.4, 13.8);
    camera.lookAt(0, 1.5, -2.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xb8fff2, 0.52);
    scene.add(ambient);

    const key = new THREE.SpotLight(0xb7ff4a, 5.2, 36, Math.PI / 5, 0.5, 1.1);
    key.position.set(-5, 10, 8);
    key.castShadow = true;
    scene.add(key);

    const rim = new THREE.PointLight(0x65d8ff, 2.4, 22);
    rim.position.set(5, 5, -8);
    scene.add(rim);

    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 28, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x0b2617, roughness: 0.92, metalness: 0.02 }),
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.z = -3;
    pitch.receiveShadow = true;
    scene.add(pitch);

    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xdfffe8, transparent: true, opacity: 0.58 });
    const penaltyBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(11, 0.04, 7)),
      lineMaterial,
    );
    penaltyBox.position.set(0, 0.04, -8.2);
    scene.add(penaltyBox);

    const goalGroup = new THREE.Group();
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f4f5, roughness: 0.42 });
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.12, 0.12), postMaterial);
    crossbar.position.set(0, 3.3, -10.3);
    const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.13, 3.3, 0.13), postMaterial);
    leftPost.position.set(-4.3, 1.65, -10.3);
    const rightPost = leftPost.clone();
    rightPost.position.x = 4.3;
    goalGroup.add(crossbar, leftPost, rightPost);
    scene.add(goalGroup);

    const netMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
      wireframe: true,
    });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 3.2, 9, 5), netMaterial);
    net.position.set(0, 1.72, -10.46);
    scene.add(net);

    const striker = new THREE.Group();
    const kit = new THREE.MeshStandardMaterial({ color: 0xc8ff3d, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1, 7, 12), kit);
    body.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 20), new THREE.MeshStandardMaterial({ color: 0xffd7b1 }));
    head.position.y = 1.82;
    const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.78, 5, 10), dark);
    leftLeg.position.set(-0.14, 0.42, 0.05);
    leftLeg.rotation.z = 0.16;
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.16;
    rightLeg.rotation.z = -0.18;
    striker.add(body, head, leftLeg, rightLeg);
    striker.position.set(-1.7, 0, 4.25);
    striker.traverse((object) => {
      object.castShadow = true;
    });
    scene.add(striker);

    const keeper = new THREE.Group();
    const keeperMat = new THREE.MeshStandardMaterial({ color: 0x6dd6ff, roughness: 0.46 });
    const keeperBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.95, 7, 12), keeperMat);
    keeperBody.position.y = 1.35;
    const keeperHead = new THREE.Mesh(new THREE.SphereGeometry(0.23, 18, 18), new THREE.MeshStandardMaterial({ color: 0xf1c7a4 }));
    keeperHead.position.y = 2.05;
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0xf6b73c, roughness: 0.38 });
    const leftGlove = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), gloveMat);
    leftGlove.position.set(-0.58, 1.52, 0.02);
    const rightGlove = leftGlove.clone();
    rightGlove.position.x = 0.58;
    keeper.add(keeperBody, keeperHead, leftGlove, rightGlove);
    keeper.position.set(0, 0, -9.7);
    keeper.traverse((object) => {
      object.castShadow = true;
    });
    scene.add(keeper);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 28, 28),
      new THREE.MeshStandardMaterial({ color: 0xf4f4f5, roughness: 0.34 }),
    );
    ball.position.set(0, 0.2, 2.45);
    ball.castShadow = true;
    scene.add(ball);

    const spot = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.36, 42),
      new THREE.MeshBasicMaterial({ color: 0xb7ff4a, transparent: true, opacity: 0.85 }),
    );
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, 0.035, 2.45);
    scene.add(spot);

    const crowd = new THREE.Group();
    for (let index = 0; index < 80; index += 1) {
      const light = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.045, 0.045),
        new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? 0xb7ff4a : 0xeff6ff }),
      );
      light.position.set((Math.random() - 0.5) * 18, 3.2 + Math.random() * 2, -12 - Math.random() * 7);
      crowd.add(light);
    }
    scene.add(crowd);

    const zoneToX = (zone: ShotZone) => (zone === "left" ? -2.65 : zone === "right" ? 2.65 : 0);
    const clock = new THREE.Clock();
    let kickStart = 0;
    let previousPhase = stateRef.current.phase;
    let frame = 0;

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (renderer.domElement.width <= 1 || renderer.domElement.height <= 1) resize();
      const elapsed = clock.getElapsedTime();
      const current = stateRef.current;
      const momentumRatio = current.momentum / 100;

      if (previousPhase !== current.phase) {
        previousPhase = current.phase;
        if (current.phase === "kicking") kickStart = elapsed;
      }

      crowd.children.forEach((child, index) => {
        child.position.y += Math.sin(elapsed * 2.4 + index) * 0.0015;
      });

      striker.position.x = -1.7 + Math.sin(elapsed * (2.2 + momentumRatio * 4)) * 0.04;
      striker.position.z =
        current.phase === "kicking"
          ? THREE.MathUtils.lerp(4.25, 2.55, Math.min(1, (elapsed - kickStart) / 0.75))
          : 4.25 - momentumRatio * 0.18;
      striker.rotation.z = Math.sin(elapsed * 6) * 0.02;

      const diveX = zoneToX(current.keeperZone) * (current.phase === "kicking" || current.phase === "settled" ? 0.72 : 0);
      keeper.position.x = THREE.MathUtils.lerp(keeper.position.x, diveX, 0.08);
      keeper.rotation.z = THREE.MathUtils.lerp(keeper.rotation.z, -diveX * 0.16, 0.08);

      const shotProgress =
        current.phase === "kicking" || current.phase === "settled"
          ? Math.min(1, Math.max(0, (elapsed - kickStart - 0.45) / 0.82))
          : 0;

      if (shotProgress > 0) {
        const targetX = zoneToX(current.shotZone);
        const targetY = current.goal === false ? 1.35 : 2.15 + momentumRatio * 0.35;
        const targetZ = current.goal === false ? -8.8 : -10.12;
        ball.position.x = THREE.MathUtils.lerp(0, targetX, shotProgress);
        ball.position.y = THREE.MathUtils.lerp(0.2, targetY, Math.sin(shotProgress * Math.PI * 0.5));
        ball.position.z = THREE.MathUtils.lerp(2.45, targetZ, shotProgress);
        ball.rotation.x += 0.22 + momentumRatio * 0.18;
        ball.rotation.y += 0.09;
      } else {
        ball.position.set(0, 0.2 + Math.sin(elapsed * 2) * 0.012, 2.45);
      }

      const directionTilt = current.direction === "long" ? -0.025 : current.direction === "short" ? 0.025 : 0;
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, directionTilt * current.momentum, 0.015);
      camera.lookAt(0, 1.5, -2.8);

      renderer.render(scene, camera);
    };

    animate();

    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      resizeObserver.disconnect();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    };
  }, []);

  return <div className="arena-scene" ref={hostRef} aria-label="3D penalty arena" />;
}
