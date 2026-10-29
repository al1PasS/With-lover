import { useEffect, useRef } from "react";

type Point = { x: number; y: number };
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  rotation: number;
  spin: number;
  kind: "heart" | "bubble";
};

const POINT_COUNT = 12;

/** A decorative, pointer-transparent satin ribbon for fine-pointer devices. */
export default function SilkCursorTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    if (!finePointer.matches || reducedMotion.matches) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const points: Point[] = Array.from({ length: POINT_COUNT }, () => ({
      x: 0,
      y: 0,
    }));
    const target: Point = { x: 0, y: 0 };
    const particles: Particle[] = [];
    let frame = 0;
    let lastTime = performance.now();
    let lastMove = -Infinity;
    let hasPosition = false;
    let opacity = 0;
    let pixelRatio = 1;
    let lastEmit = -Infinity;
    let lastEmitPoint: Point = { x: 0, y: 0 };

    function resize() {
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(innerWidth * pixelRatio);
      canvas!.height = Math.round(innerHeight * pixelRatio);
      canvas!.style.width = `${innerWidth}px`;
      canvas!.style.height = `${innerHeight}px`;
      context!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function move(event: PointerEvent) {
      target.x = event.clientX;
      target.y = event.clientY;
      lastMove = performance.now();
      if (!hasPosition) {
        points.forEach((point) => {
          point.x = target.x;
          point.y = target.y;
        });
        hasPosition = true;
        lastEmitPoint = { ...target };
      } else {
        const now = performance.now();
        const distance = Math.hypot(target.x - lastEmitPoint.x, target.y - lastEmitPoint.y);
        if (now - lastEmit > 72 && distance > 28) {
          emit(target.x, target.y, 1, false);
          lastEmit = now;
          lastEmitPoint = { ...target };
        }
      }
    }

    function press(event: PointerEvent) {
      if (event.button !== 0) return;
      emit(event.clientX, event.clientY, 8, true);
    }

    function leave() {
      lastMove = -Infinity;
    }

    function traceRibbon(side: 1 | -1, backwards = false) {
      const edge: Point[] = points.map((point, index) => {
        const previous = points[Math.max(0, index - 1)];
        const next = points[Math.min(points.length - 1, index + 1)];
        const dx = previous.x - next.x;
        const dy = previous.y - next.y;
        const length = Math.hypot(dx, dy) || 1;
        const progress = index / (points.length - 1);
        const swell = Math.pow(Math.sin(Math.PI * progress), 0.72);
        const width = (2 + 8.5 * swell) * Math.pow(1 - progress, 0.32);
        return {
          x: point.x + (-dy / length) * width * side,
          y: point.y + (dx / length) * width * side,
        };
      });
      if (backwards) edge.reverse();

      context!.lineTo(edge[0].x, edge[0].y);
      for (let index = 1; index < edge.length - 1; index += 1) {
        const midpointX = (edge[index].x + edge[index + 1].x) / 2;
        const midpointY = (edge[index].y + edge[index + 1].y) / 2;
        context!.quadraticCurveTo(
          edge[index].x,
          edge[index].y,
          midpointX,
          midpointY,
        );
      }
      const end = edge[edge.length - 1];
      context!.lineTo(end.x, end.y);
    }

    function drawRibbon() {
      const head = points[0];
      const tail = points[points.length - 1];
      const gradient = context!.createLinearGradient(tail.x, tail.y, head.x, head.y);
      gradient.addColorStop(0, "rgba(202, 94, 128, 0)");
      gradient.addColorStop(0.2, "rgba(202, 94, 128, 0.22)");
      gradient.addColorStop(0.62, "rgba(232, 128, 158, 0.58)");
      gradient.addColorStop(0.88, "rgba(248, 170, 194, 0.76)");
      gradient.addColorStop(1, "rgba(255, 232, 240, 0.88)");

      context!.save();
      context!.globalAlpha = opacity;
      context!.globalCompositeOperation = "screen";
      context!.beginPath();
      traceRibbon(1);
      traceRibbon(-1, true);
      context!.closePath();
      context!.fillStyle = gradient;
      context!.shadowColor = "rgba(220, 104, 143, 0.38)";
      context!.shadowBlur = 15;
      context!.fill();

      // A slim shifting highlight gives the translucent ribbon a satin fold.
      context!.beginPath();
      context!.moveTo(head.x, head.y);
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index];
        const next = points[index + 1];
        context!.quadraticCurveTo(
          point.x,
          point.y,
          (point.x + next.x) / 2,
          (point.y + next.y) / 2,
        );
      }
      context!.strokeStyle = "rgba(255, 238, 245, 0.58)";
      context!.lineWidth = 1.15;
      context!.shadowBlur = 4;
      context!.stroke();

      context!.beginPath();
      context!.arc(head.x, head.y, 2.6, 0, Math.PI * 2);
      context!.fillStyle = "rgba(255, 225, 236, 0.86)";
      context!.shadowBlur = 9;
      context!.fill();
      context!.restore();
    }

    function emit(x: number, y: number, count: number, burst: boolean) {
      const available = Math.max(0, 34 - particles.length);
      for (let index = 0; index < Math.min(count, available); index += 1) {
        const angle = burst
          ? Math.PI * (1.08 + Math.random() * 0.84)
          : Math.PI * (1.3 + Math.random() * 0.4);
        const speed = burst ? 0.75 + Math.random() * 1.15 : 0.35 + Math.random() * 0.45;
        const maxLife = burst ? 720 + Math.random() * 430 : 560 + Math.random() * 280;
        particles.push({
          x: x + (Math.random() - 0.5) * 10,
          y: y + (Math.random() - 0.5) * 8,
          vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 0.25,
          vy: Math.sin(angle) * speed - 0.16,
          size: burst ? 5.5 + Math.random() * 5 : 4.5 + Math.random() * 3.5,
          life: maxLife,
          maxLife,
          rotation: (Math.random() - 0.5) * 0.45,
          spin: (Math.random() - 0.5) * 0.0018,
          kind: index % 3 === 1 ? "bubble" : "heart",
        });
      }
    }

    function heartPath(size: number) {
      context!.beginPath();
      context!.moveTo(0, size * 0.35);
      context!.bezierCurveTo(-size * 1.05, -size * 0.25, -size * 0.95, -size, 0, -size * 0.48);
      context!.bezierCurveTo(size * 0.95, -size, size * 1.05, -size * 0.25, 0, size * 0.35);
      context!.closePath();
    }

    function drawParticles(deltaMs: number) {
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.life -= deltaMs;
        if (particle.life <= 0) {
          particles.splice(index, 1);
          continue;
        }
        const step = deltaMs / 16.67;
        particle.x += particle.vx * step;
        particle.y += particle.vy * step;
        particle.vx *= Math.pow(0.985, step);
        particle.vy -= 0.006 * step;
        particle.rotation += particle.spin * deltaMs;
        const progress = 1 - particle.life / particle.maxLife;
        const alpha = Math.sin(Math.PI * Math.min(1, progress)) * 0.72;
        const scale = 0.72 + Math.sin(Math.PI * progress) * 0.34;

        context!.save();
        context!.translate(particle.x, particle.y);
        context!.rotate(particle.rotation);
        context!.scale(scale, scale);
        context!.globalAlpha = alpha;
        if (particle.kind === "bubble") {
          context!.beginPath();
          context!.arc(0, 0, particle.size * 1.15, 0, Math.PI * 2);
          context!.fillStyle = "rgba(255, 232, 240, 0.28)";
          context!.strokeStyle = "rgba(210, 104, 136, 0.42)";
          context!.lineWidth = 0.9;
          context!.fill();
          context!.stroke();
          heartPath(particle.size * 0.34);
          context!.fillStyle = "rgba(186, 76, 108, 0.62)";
          context!.fill();
        } else {
          heartPath(particle.size);
          context!.fillStyle = "rgba(203, 82, 118, 0.7)";
          context!.fill();
          context!.strokeStyle = "rgba(255, 238, 244, 0.7)";
          context!.lineWidth = 0.75;
          context!.stroke();
        }
        context!.restore();
      }
    }

    function animate(now: number) {
      const deltaMs = Math.min(now - lastTime, 34);
      const delta = deltaMs / 16.67;
      lastTime = now;
      context!.clearRect(0, 0, innerWidth, innerHeight);

      if (hasPosition) {
        const recentlyMoved = now - lastMove < 110;
        opacity += ((recentlyMoved ? 0.92 : 0) - opacity) * (recentlyMoved ? 0.16 : 0.055) * delta;

        points[0].x += (target.x - points[0].x) * 0.38 * delta;
        points[0].y += (target.y - points[0].y) * 0.38 * delta;
        for (let index = 1; index < points.length; index += 1) {
          const follow = 0.42 - index * 0.006;
          points[index].x += (points[index - 1].x - points[index].x) * follow * delta;
          points[index].y += (points[index - 1].y - points[index].y) * follow * delta;
        }

        if (opacity > 0.008) drawRibbon();
      }
      drawParticles(deltaMs);
      frame = requestAnimationFrame(animate);
    }

    resize();
    addEventListener("resize", resize, { passive: true });
    addEventListener("pointermove", move, { passive: true });
    addEventListener("pointerdown", press, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", resize);
      removeEventListener("pointermove", move);
      removeEventListener("pointerdown", press);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, []);

  return <canvas ref={canvasRef} className="silk-cursor-trail" aria-hidden="true" />;
}
