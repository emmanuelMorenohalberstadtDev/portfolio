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

  function addBubble(text, who) {
    const el = document.createElement("div");
    el.className = "chat-bubble chat-bubble--" + who;
    el.textContent = text;
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
    const text = input.value.trim();
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

    addBubble(text, "user");
    history.push({ role: "user", content: text });
    input.value = "";
    input.disabled = true;
    const typing = showTyping();

    try {
      const res = await fetch(CONFIG.WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(0, -1) }),
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
