import { useEffect, useRef } from 'react';

export default function HomeBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = canvas?.parentElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !surface || !context) return;

    const motion = matchMedia('(prefers-reduced-motion: no-preference) and (pointer: fine)');
    let width = 0, height = 0, frame = 0, lastTime = 0, phase = 0;
    const pointer = { x: 0, y: 0, strength: 0 };
    const target = { x: 0, y: 0, strength: 0 };

    function draw() {
      if (!width || !height) return;
      const ctx = context!;
      ctx.clearRect(0, 0, width, height);

      // Broad light and fine contours share one slow-moving field.
      const lightX = width * (0.52 + Math.sin(phase * 0.3) * 0.08)
        + (pointer.x - width / 2) * pointer.strength * 0.08;
      const glow = ctx.createRadialGradient(lightX, height * 0.25, 0, lightX, height * 0.25, width * 0.65);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
      glow.addColorStop(0.6, 'rgba(228, 247, 255, 0.16)');
      glow.addColorStop(1, 'rgba(228, 247, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const ink = ctx.createLinearGradient(0, 0, width, 0);
      ink.addColorStop(0, 'rgba(83, 155, 198, 0.28)');
      ink.addColorStop(0.36, 'rgba(255, 255, 255, 0.42)');
      ink.addColorStop(0.64, 'rgba(255, 255, 255, 0.42)');
      ink.addColorStop(1, 'rgba(83, 155, 198, 0.28)');
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      const step = Math.max(8, width / 110);
      for (let line = 0; line < 26; line++) {
        const depth = line / 25;
        ctx.beginPath();
        for (let x = -step; x <= width + step; x += step) {
          const across = x / width;
          const baseY = height * (0.06 + depth * 0.54)
            + Math.sin(across * 5.2 + depth * 1.8 + phase * 0.22) * 50
            + Math.cos(across * 8 - depth * 2 - phase * 0.16) * 18;
          const dx = x - pointer.x;
          const dy = baseY - pointer.y;
          const influence = Math.exp(-(dx * dx + dy * dy) / 42000) * pointer.strength;
          const px = x + dx * influence * 0.14;
          const py = baseY + dy * influence * 0.35;
          if (x === -step) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      if (pointer.strength > 0.01) {
        const light = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 190);
        light.addColorStop(0, `rgba(255, 255, 255, ${pointer.strength * 0.42})`);
        light.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, width, height);
      }
    }

    function tick(time: number) {
      const elapsed = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
      lastTime = time;
      phase += elapsed;
      const ease = 1 - Math.exp(-5 * elapsed);
      pointer.x += (target.x - pointer.x) * ease;
      pointer.y += (target.y - pointer.y) * ease;
      pointer.strength += (target.strength - pointer.strength) * ease;
      draw();
      frame = requestAnimationFrame(tick);
    }

    function updateMotion() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      target.strength = 0;
      pointer.strength = 0;
      if (motion.matches && !document.hidden) frame = requestAnimationFrame(tick);
      else draw();
    }

    function resize() {
      const bounds = canvas!.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }

    function move(event: PointerEvent) {
      if (!motion.matches || event.pointerType !== 'mouse') return;
      const bounds = canvas!.getBoundingClientRect();
      target.x = event.clientX - bounds.left;
      target.y = event.clientY - bounds.top;
      target.strength = target.y >= 0 && target.y <= height ? 1 : 0;
    }

    function leave() { target.strength = 0; }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    surface.addEventListener('pointermove', move, { passive: true });
    surface.addEventListener('pointerleave', leave);
    surface.addEventListener('scroll', leave, { passive: true });
    window.addEventListener('blur', leave);
    motion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateMotion);
    resize();
    updateMotion();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', leave);
      surface.removeEventListener('scroll', leave);
      window.removeEventListener('blur', leave);
      motion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateMotion);
    };
  }, []);

  return <canvas ref={canvasRef} className="home-backdrop" aria-hidden="true" />;
}
