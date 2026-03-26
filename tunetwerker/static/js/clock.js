/**
 * clock.js — Analogue + digital studio clock
 * Squirrel FM | GPL v3 | No ads. Ever.
 */

"use strict";

(function Clock() {
  const canvas  = document.getElementById("clockFace");
  const digital = document.getElementById("clockDigital");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const CX = W / 2;
  const CY = H / 2;
  const R  = (W / 2) - 3;

  function drawClock() {
    const now  = new Date();
    const hrs  = now.getHours();
    const mins = now.getMinutes();
    const secs = now.getSeconds();
    const ms   = now.getMilliseconds();

    // Smooth second hand
    const secAngle = ((secs + ms / 1000) / 60) * 2 * Math.PI - Math.PI / 2;
    const minAngle = ((mins + secs / 60) / 60) * 2 * Math.PI - Math.PI / 2;
    const hrAngle  = ((hrs % 12 + mins / 60) / 12) * 2 * Math.PI - Math.PI / 2;

    // Background
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, 2 * Math.PI);
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--skin-clock-face").trim() || "#f5f5f0";
    ctx.fill();

    // Hour tick marks
    const accentCol = getComputedStyle(document.documentElement)
      .getPropertyValue("--skin-clock-accent").trim() || "#c0392b";
    const handCol = getComputedStyle(document.documentElement)
      .getPropertyValue("--skin-clock-hands").trim() || "#1a1a1a";

    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const isMajor = i % 5 === 0;
      const inner = R - (isMajor ? 7 : 3);
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(a) * inner, CY + Math.sin(a) * inner);
      ctx.lineTo(CX + Math.cos(a) * R,     CY + Math.sin(a) * R);
      ctx.strokeStyle = isMajor ? handCol : "#aaa";
      ctx.lineWidth   = isMajor ? 1.5 : 0.8;
      ctx.stroke();
    }

    // Hour hand
    drawHand(hrAngle,  R * 0.5, 2.5, handCol);
    // Minute hand
    drawHand(minAngle, R * 0.75, 2, handCol);
    // Second hand
    drawHand(secAngle, R * 0.88, 1, accentCol, true);

    // Centre dot
    ctx.beginPath();
    ctx.arc(CX, CY, 3, 0, 2 * Math.PI);
    ctx.fillStyle = accentCol;
    ctx.fill();

    // Digital readout
    const hh = String(hrs).padStart(2, "0");
    const mm = String(mins).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");
    digital.textContent = `${hh}:${mm}:${ss}`;
  }

  function drawHand(angle, length, width, colour, hasCounterweight) {
    ctx.beginPath();
    if (hasCounterweight) {
      // Tail counterweight
      const tailLen = length * 0.2;
      ctx.moveTo(
        CX + Math.cos(angle + Math.PI) * tailLen,
        CY + Math.sin(angle + Math.PI) * tailLen
      );
    } else {
      ctx.moveTo(CX, CY);
    }
    ctx.lineTo(CX + Math.cos(angle) * length, CY + Math.sin(angle) * length);
    ctx.strokeStyle = colour;
    ctx.lineWidth   = width;
    ctx.lineCap     = "round";
    ctx.stroke();
  }

  // Redraw every ~50ms for smooth second hand
  setInterval(drawClock, 50);
  drawClock();
})();
