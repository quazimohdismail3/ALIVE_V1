// frontend/src/components/HrvChart.jsx
// Canvas-based real-time RMSSD line chart. No charting lib.
import { useRef, useEffect } from 'react';

export function HrvChart({ points = [], width = 280, height = 80, colorHex = '#3FBFA8' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    if (points.length < 2) {
      // Draw empty state grid
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let y = 0; y <= 1; y += 0.5) {
        ctx.beginPath();
        ctx.moveTo(0, height * y);
        ctx.lineTo(width, height * y);
        ctx.stroke();
      }
      return;
    }

    const rmssdValues = points.map(p => p.rmssd).filter(v => v > 0);
    const minV = Math.min(...rmssdValues);
    const maxV = Math.max(...rmssdValues);
    const range = maxV - minV || 10;
    const pad = range * 0.15;

    const xScale = width / Math.max(points.length - 1, 1);
    const yScale = (height - 16) / (range + 2 * pad);
    const yOffset = 8;

    function toX(i) { return i * xScale; }
    function toY(v) { return height - yOffset - (v - minV + pad) * yScale; }

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `${colorHex}30`);
    grad.addColorStop(1, `${colorHex}00`);

    ctx.beginPath();
    ctx.moveTo(toX(0), height);
    points.forEach((p, i) => {
      if (p.rmssd > 0) ctx.lineTo(toX(i), toY(p.rmssd));
    });
    ctx.lineTo(toX(points.length - 1), height);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    let started = false;
    points.forEach((p, i) => {
      if (p.rmssd <= 0) return;
      if (!started) { ctx.moveTo(toX(i), toY(p.rmssd)); started = true; }
      else ctx.lineTo(toX(i), toY(p.rmssd));
    });
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Current value dot
    const last = points[points.length - 1];
    if (last?.rmssd > 0) {
      ctx.beginPath();
      ctx.arc(toX(points.length - 1), toY(last.rmssd), 3, 0, Math.PI * 2);
      ctx.fillStyle = colorHex;
      ctx.fill();
    }
  }, [points, width, height, colorHex]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ borderRadius: 8, display: 'block' }}
    />
  );
}
