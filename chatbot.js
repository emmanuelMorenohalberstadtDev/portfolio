/* =======================================================================
   chatbot.js — Asistente IA del portfolio
   Widget de chat que habla con un webhook de n8n (que a su vez llama a
   Claude). La API key vive en n8n, NUNCA acá.
   -----------------------------------------------------------------------
   CONFIG: pegá abajo la URL del webhook de n8n (Production URL).
   ======================================================================= */
(function () {
  "use strict";

  const CONFIG = {
    // 👉 Reemplazá esto por la "Production URL" de tu Webhook de n8n:
    WEBHOOK_URL: "https://emmanuelmorenohalberstadt.app.n8n.cloud/webhook/portfolio-chat",
    // Mensaje de bienvenida del asistente:
    GREETING:
      "¡Hola! 👋 Soy el asistente de Emmanuel. Preguntame sobre su stack, experiencia, proyectos o cómo contactarlo.",
    // --- Límites para cuidar el consumo de créditos ---
    MAX_MESSAGE_LEN: 500, // máximo de caracteres por mensaje
    MIN_INTERVAL_MS: 3000, // espera mínima entre mensajes (anti-spam)
    MAX_MESSAGES: 20, // máximo de mensajes por sesión
    MAX_HISTORY: 6, // turnos de historial que se envían al modelo
  };

  const $ = (sel) => document.querySelector(sel);
  const toggle = $("#chat-toggle");
  const panel = $("#chat-panel");
  const closeBtn = $("#chat-close");
  const messages = $("#chat-messages");
  const form = $("#chat-form");
  const input = $("#chat-input");
  if (!toggle || !panel || !form) return;

  // Historial de la conversación (formato Claude: role + content).
  const history = [];
  let greeted = false;
  let lastSentAt = 0; // timestamp del último envío (para el rate-limit)
  let messageCount = 0; // mensajes enviados en esta sesión

  function openPanel() {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    toggle.classList.add("chat-toggle--open");
    if (!greeted) {
      addBubble(CONFIG.GREETING, "bot");
      greeted = true;
    }
    setTimeout(() => input.focus(), 250);
  }
  function closePanel() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    toggle.classList.remove("chat-toggle--open");
  }

  toggle.addEventListener("click", () =>
    panel.classList.contains("open") ? closePanel() : openPanel()
  );
  closeBtn.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
  });

  // Escapa HTML para evitar inyección antes de renderizar Markdown.
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Renderiza un subconjunto seguro de Markdown (el modelo suele responder así):
  // encabezados, negrita, cursiva, código, enlaces, viñetas y saltos de línea.
  function renderMarkdown(text) {
    let html = escapeHtml(text.trim());
    // Enlaces [texto](url) — solo http(s) y mailto.
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
    // URLs y emails sueltos → enlaces clicables.
    html = html.replace(
      /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener">$2</a>'
    );
    html = html.replace(
      /(^|[\s(])([\w.+-]+@[\w-]+\.[\w.-]+)/g,
      '$1<a href="mailto:$2">$2</a>'
    );
    // Encabezados ##/### → negrita.
    html = html.replace(/^#{1,6}\s*(.+)$/gm, "<strong>$1</strong>");
    // Negrita y cursiva.
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    // Código en línea.
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Viñetas al inicio de línea.
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, "• $1");
    // Separadores horizontales.
    html = html.replace(/^\s*---+\s*$/gm, "");
    // Saltos de línea.
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  function addBubble(text, who) {
    const el = document.createElement("div");
    el.className = "chat-bubble chat-bubble--" + who;
    if (who === "bot") {
      el.innerHTML = renderMarkdown(text);
    } else {
      el.textContent = text;
    }
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  function showTyping() {
    const el = document.createElement("div");
    el.className = "chat-bubble chat-bubble--bot chat-typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  // Acepta varias formas de respuesta según cómo armes el nodo final en n8n.
  function extractReply(data) {
    if (typeof data === "string") return data;
    return (
      data.reply ||
      data.output ||
      data.text ||
      data.answer ||
      (data.content && data.content[0] && data.content[0].text) ||
      null
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    let text = input.value.trim();
    if (!text) return;

    if (CONFIG.WEBHOOK_URL.includes("TU-INSTANCIA-N8N")) {
      addBubble(text, "user");
      addBubble(
        "⚙️ Falta configurar la URL del webhook de n8n en chatbot.js (CONFIG.WEBHOOK_URL).",
        "bot"
      );
      input.value = "";
      return;
    }

    // --- Rate-limit del lado del cliente (cuida el gasto de créditos) ---
    if (messageCount >= CONFIG.MAX_MESSAGES) {
      addBubble(
        "Llegaste al límite de mensajes de esta sesión. Para seguir la charla, escribile directamente: emmanuel.moreno.halberstadt.dev@gmail.com 🙌",
        "bot"
      );
      return;
    }
    const sinceLast = Date.now() - lastSentAt;
    if (sinceLast < CONFIG.MIN_INTERVAL_MS) {
      const wait = Math.ceil((CONFIG.MIN_INTERVAL_MS - sinceLast) / 1000);
      addBubble(
        `Esperá ${wait}s antes de enviar otro mensaje, por favor. ⏳`,
        "bot"
      );
      return;
    }
    // Recortar mensajes demasiado largos.
    if (text.length > CONFIG.MAX_MESSAGE_LEN) {
      text = text.slice(0, CONFIG.MAX_MESSAGE_LEN);
    }

    lastSentAt = Date.now();
    messageCount++;
    addBubble(text, "user");
    history.push({ role: "user", content: text });
    input.value = "";
    input.disabled = true;
    const typing = showTyping();

    try {
      const res = await fetch(CONFIG.WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          // Enviamos solo los últimos turnos para acotar tokens/costo.
          history: history.slice(0, -1).slice(-CONFIG.MAX_HISTORY),
        }),
      });
      typing.remove();
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json().catch(() => ({}));
      const reply =
        extractReply(data) || "Perdón, no pude generar una respuesta.";
      addBubble(reply, "bot");
      history.push({ role: "assistant", content: reply });
    } catch (err) {
      typing.remove();
      addBubble(
        "Ups, hubo un problema al conectar con el asistente. Probá de nuevo en un momento.",
        "bot"
      );
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
})();
