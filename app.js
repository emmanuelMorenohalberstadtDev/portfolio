/* =======================================================================
   app.js — Portfolio de Emmanuel Moreno Halberstadt
   1) Fondo de red de partículas (canvas 2D) que se anima y cambia de
      color + comportamiento según la sección visible.
   2) Scroll-reveal escalonado de componentes.
   3) Barra de progreso de scroll.
   Sin dependencias. Robusto en pantalla completa. Anima siempre.
   ======================================================================= */
(function () {
  "use strict";

  /* =====================================================================
     1) SCROLL-REVEAL
     ===================================================================== */
  (function scrollReveal() {
    const selectors = [
      ".hero__eyebrow", ".hero__title", ".hero__subtitle", ".hero__desc",
      ".hero__cta", ".hero__social", ".hero__avatar",
      ".section__title", ".about p", ".skill-card", ".marquee",
      ".project--featured", ".card", ".ia-card", ".ia-badge",
      ".lang-card", ".contact__text", ".section--contact .btn",
    ];
    const nodes = document.querySelectorAll(selectors.join(","));

    const groupCounter = new Map();
    nodes.forEach((el) => {
      el.classList.add("reveal");
      const parent = el.parentElement;
      const i = groupCounter.get(parent) || 0;
      groupCounter.set(parent, i + 1);
      el.style.setProperty("--reveal-delay", (i % 8) * 70 + "ms");
    });

    // Se re-anima cada vez que el elemento entra en el viewport:
    // al salir se resetea para que el efecto se repita al volver.
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle("is-visible", entry.isIntersecting);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    nodes.forEach((el) => io.observe(el));
  })();

  /* =====================================================================
     2) BARRA DE PROGRESO DE SCROLL
     ===================================================================== */
  (function scrollProgress() {
    const bar = document.getElementById("progress");
    if (!bar) return;
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const p = max > 0 ? h.scrollTop / max : 0;
      bar.style.transform = "scaleX(" + p + ")";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  })();

  /* =====================================================================
     3) FONDO: RED DE PARTÍCULAS ANIMADA (canvas 2D) — anima siempre
     ===================================================================== */
  (function particleBackground() {
    const canvas = document.getElementById("bg-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /* --- Configuración por sección ---
       line/dot: color RGB · speed: multiplicador · link: distancia de enlace
       flow: corriente [x,y] · neural: 0/1 pulsos viajando por los enlaces */
    const SECTIONS = {
      hero:       { line: [88, 166, 255], dot: [126, 231, 135], speed: 1.0, link: 135, flow: [0, 0],     neural: 0 },
      "sobre-mi": { line: [88, 166, 255], dot: [69, 208, 217],  speed: 0.8, link: 120, flow: [0, -0.12], neural: 0 },
      skills:     { line: [124, 108, 255], dot: [88, 166, 255], speed: 1.1, link: 118, flow: [0, 0],     neural: 0 },
      proyectos:  { line: [126, 231, 135], dot: [88, 166, 255], speed: 1.0, link: 160, flow: [0, 0],     neural: 0 },
      ia:         { line: [46, 230, 200],  dot: [126, 231, 135], speed: 0.9, link: 145, flow: [0, 0],    neural: 1 },
      idiomas:    { line: [255, 148, 87],  dot: [88, 166, 255], speed: 1.2, link: 122, flow: [0.14, 0],  neural: 0 },
      contacto:   { line: [88, 166, 255], dot: [126, 231, 135], speed: 0.7, link: 130, flow: [0, 0],     neural: 0 },
    };

    function clone(c) {
      return {
        line: c.line.slice(), dot: c.dot.slice(),
        speed: c.speed, link: c.link, flow: c.flow.slice(), neural: c.neural,
      };
    }

    const S = clone(SECTIONS.hero);
    let target = SECTIONS.hero;

    let W = 0, H = 0, DPR = 1;
    let particles = [];

    function buildParticles() {
      const count = Math.min(130, Math.max(45, Math.round((W * H) / 14000)));
      particles = [];
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.7,
          vy: (Math.random() - 0.5) * 0.7,
          r: Math.random() * 1.6 + 0.8,
        });
      }
    }

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      // window.innerWidth/Height es fiable incluso en pantalla completa.
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * DPR);
      canvas.height = Math.floor(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      buildParticles();
    }

    // Redimensionar en cualquier cambio de tamaño / pantalla completa.
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", () =>
      requestAnimationFrame(resize)
    );
    window.addEventListener("orientationchange", () =>
      requestAnimationFrame(resize)
    );

    // Sección activa según cuál ocupa más viewport.
    const ratios = new Map();
    const watched = [document.querySelector(".hero")].concat(
      Array.from(document.querySelectorAll(".section"))
    );
    const keyOf = (el) => (el.classList.contains("hero") ? "hero" : el.id);
    const secObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => ratios.set(e.target, e.intersectionRatio));
        let best = null, bestR = -1;
        ratios.forEach((r, el) => {
          if (r > bestR) { bestR = r; best = el; }
        });
        if (best) {
          const cfg = SECTIONS[keyOf(best)];
          if (cfg) target = cfg;
        }
      },
      { threshold: [0, 0.15, 0.35, 0.6, 0.85, 1] }
    );
    watched.forEach((el) => el && secObserver.observe(el));

    // Puntero (leve atracción + enlace al cursor).
    const mouse = { x: -9999, y: -9999, active: false };
    window.addEventListener("pointermove", (e) => {
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
    }, { passive: true });
    window.addEventListener("pointerleave", () => (mouse.active = false));

    const lerp = (a, b, t) => a + (b - a) * t;
    const rgba = (c, a) => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";

    resize();

    function draw(now) {
      // Interpolación suave hacia la sección objetivo.
      const k = 0.05;
      for (let i = 0; i < 3; i++) {
        S.line[i] = lerp(S.line[i], target.line[i], k);
        S.dot[i] = lerp(S.dot[i], target.dot[i], k);
      }
      S.speed = lerp(S.speed, target.speed, k);
      S.link = lerp(S.link, target.link, k);
      S.flow[0] = lerp(S.flow[0], target.flow[0], k);
      S.flow[1] = lerp(S.flow[1], target.flow[1], k);
      S.neural = lerp(S.neural, target.neural, k);

      // Fondo: degradado oscuro + glow tenue del color activo.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#0d1117");
      g.addColorStop(1, "#080b10");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(
        W * 0.5, H * 0.2, 0, W * 0.5, H * 0.2, Math.max(W, H) * 0.7
      );
      glow.addColorStop(0, rgba(S.line, 0.07));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // Actualizar partículas.
      for (const p of particles) {
        p.x += p.vx * S.speed + S.flow[0];
        p.y += p.vy * S.speed + S.flow[1];

        if (mouse.active) {
          const dx = mouse.x - p.x, dy = mouse.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 26000) {
            p.x += dx * 0.0012;
            p.y += dy * 0.0012;
          }
        }

        if (p.x < -20) p.x = W + 20; else if (p.x > W + 20) p.x = -20;
        if (p.y < -20) p.y = H + 20; else if (p.y > H + 20) p.y = -20;
      }

      // Enlaces entre partículas cercanas.
      const link = S.link, link2 = link * link;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < link2) {
            const t = 1 - d2 / link2;
            ctx.strokeStyle = rgba(S.line, t * 0.35);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();

            // Pulso "neuronal" viajando por el enlace (sección IA).
            if (S.neural > 0.15) {
              const ph = ((now * 0.0005) + (i * 0.13 + j * 0.07)) % 1;
              const px = a.x + (b.x - a.x) * ph;
              const py = a.y + (b.y - a.y) * ph;
              ctx.fillStyle = rgba(S.dot, t * S.neural * 0.9);
              ctx.beginPath();
              ctx.arc(px, py, 1.8, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        // Enlace al puntero.
        if (mouse.active) {
          const dx = a.x - mouse.x, dy = a.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < link2) {
            const t = 1 - d2 / link2;
            ctx.strokeStyle = rgba(S.dot, t * 0.4);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }

      // Nodos.
      for (const p of particles) {
        ctx.fillStyle = rgba(S.dot, 0.85);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
  })();
})();
