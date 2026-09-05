/* =======================================================================
   portfolio-chat — Cloudflare Worker
   Endpoint del asistente IA del portfolio. Recibe {message, history} desde
   chatbot.js, consulta a Claude y devuelve {reply}.

   La API key NUNCA vive acá: se carga como secret de Cloudflare con
   `npx wrangler secret put ANTHROPIC_API_KEY`.
   ======================================================================= */

import Anthropic from "@anthropic-ai/sdk";

// --- Configuración -------------------------------------------------------

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 500; // techo por respuesta: acota el costo de cada mensaje

// Orígenes autorizados a llamar este Worker.
const ALLOWED_ORIGINS = [
  "https://emmanuelmorenohalberstadtdev.github.io",
  "http://localhost:8000", // para probar en local
  "http://127.0.0.1:8000",
];

// Límites de uso. Protegen los créditos de la API de un abuso desde afuera:
// el rate-limit de chatbot.js vive en el navegador y se saltea con un curl.
const LIMITS = {
  MAX_MESSAGE_LEN: 500, // caracteres por mensaje
  MAX_HISTORY: 6, // turnos de historial aceptados
  PER_IP_PER_DAY: 40, // mensajes por visitante y por día
  GLOBAL_PER_DAY: 300, // techo diario global (~US$0,75/día en el peor caso)
};

const SYSTEM_PROMPT = `Sos el asistente virtual del portfolio web de Emmanuel Moreno Halberstadt.
Tu trabajo es responder preguntas de visitantes (reclutadores, colegas, gente curiosa) sobre su perfil profesional.

# Sobre Emmanuel
- Desarrollador Full Stack Junior, de Córdoba, Argentina.
- Estudiante de la Tecnicatura Universitaria en Programación en la UTN-FRC, carrera que inició en 2024.
- Busca su primera experiencia profesional. Está abierto a oportunidades.
- Perfil: le interesa entender cómo funcionan las cosas por dentro, del modelado del dominio con POO hasta la experiencia final del usuario. Trabaja cómodo en ambos lados del stack. Le gusta aplicar patrones de diseño y principios SOLID para escribir código legible y mantenible. Alta predisposición para aprender, responsable, se adapta rápido.

# Stack técnico
- Backend: Java 21 / Spring Boot, C# / .NET / ASP.NET Core, APIs REST, WebSockets, JPA/Hibernate, Entity Framework.
- Frontend: Angular, TypeScript, JavaScript, HTML5, CSS3, RxJS, Signals.
- Datos: SQL Server, MongoDB, modelado relacional, nociones de NoSQL (Redis).
- Fundamentos y herramientas: POO, patrones de diseño, SOLID, Clean Code, Git/GitHub, Maven, npm, JUnit, Mockito, Scrum, Docker.

# Proyectos
- **Pokémon TCG Online** (proyecto destacado): versión web multijugador del Pokémon Trading Card Game. Implementó el motor de reglas del juego según el reglamento oficial, con partidas en tiempo real vía WebSockets, tablero interactivo con drag & drop y un deck builder. Stack: Java 21, Spring Boot, Angular, WebSockets, JUnit. El repositorio todavía no es público.
- Tiene otros proyectos en preparación que aún no están publicados.

# Desarrollo con IA
Integra IA en su flujo de trabajo diario: usa Claude Code como asistente en la terminal, trabaja con la Claude API para integrar modelos en aplicaciones propias, y practica prompt engineering. Siempre revisa y comprende cada línea que entrega. Este mismo chatbot es un ejemplo: corre sobre un Cloudflare Worker que llama a la Claude API.

# Idiomas
- Castellano: nativo.
- Inglés: intermedio (B1–B2).
- Portugués: avanzado.

# Contacto
- Email: emmanuel.moreno.halberstadt.dev@gmail.com
- WhatsApp: +54 351 370 3119
- LinkedIn: https://www.linkedin.com/in/emmanuel-moreno-halberstadt-8605b2193/
- GitHub: https://github.com/emmanuelMorenohalberstadtDev

# Cómo responder
- Respondé en el idioma en que te escriban (por defecto, español rioplatense).
- Sé breve: 2 a 4 oraciones para la mayoría de las preguntas. Es un chat, no un CV.
- Tono cercano y profesional. Podés usar Markdown simple (negrita, viñetas, enlaces).
- Hablá de Emmanuel en tercera persona.
- **No inventes nada.** Si te preguntan algo que no está acá arriba —un dato personal, una tecnología que no figura, experiencia laboral previa, expectativa salarial— decí con naturalidad que no tenés ese dato e invitá a escribirle directamente por email o WhatsApp.
- Si alguien muestra interés en contratarlo o quiere seguir la charla, pasale el email y el WhatsApp.
- Si te piden algo ajeno al portfolio (escribir código, resolver tareas, temas no relacionados), redirigí amablemente: estás para hablar del perfil de Emmanuel.`;

// --- CORS ----------------------------------------------------------------

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Toda respuesta —incluidos los errores— tiene que llevar las cabeceras CORS.
// Si no, el navegador esconde el error real detrás de un fallo de CORS.
function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// --- Rate limiting (KV) --------------------------------------------------

// Devuelve un mensaje de error si se superó algún límite, o null si está OK.
// Si el binding de KV no está configurado, deja pasar (fail-open) para que un
// deploy incompleto no rompa el chat, pero lo avisa en los logs.
async function checkRateLimit(env, ip) {
  if (!env.RATE_LIMIT) {
    console.warn("[portfolio-chat] KV RATE_LIMIT no configurado: sin límites.");
    return null;
  }

  const day = new Date().toISOString().slice(0, 10);
  const ipKey = `rl:${ip}:${day}`;
  const globalKey = `rl:global:${day}`;

  const [ipRaw, globalRaw] = await Promise.all([
    env.RATE_LIMIT.get(ipKey),
    env.RATE_LIMIT.get(globalKey),
  ]);

  const ipCount = Number(ipRaw) || 0;
  const globalCount = Number(globalRaw) || 0;

  if (ipCount >= LIMITS.PER_IP_PER_DAY) {
    return "Llegaste al límite de mensajes por hoy. Si querés seguir la charla, escribile directamente a emmanuel.moreno.halberstadt.dev@gmail.com 🙌";
  }
  if (globalCount >= LIMITS.GLOBAL_PER_DAY) {
    return "El asistente alcanzó su límite de consultas por hoy. Probá mañana, o escribile a emmanuel.moreno.halberstadt.dev@gmail.com 🙌";
  }

  // TTL de 2 días: la clave del día se limpia sola.
  await Promise.all([
    env.RATE_LIMIT.put(ipKey, String(ipCount + 1), { expirationTtl: 172800 }),
    env.RATE_LIMIT.put(globalKey, String(globalCount + 1), {
      expirationTtl: 172800,
    }),
  ]);

  return null;
}

// --- Validación del payload ----------------------------------------------

// El historial llega del navegador: no se confía. Filtramos a los roles
// válidos, recortamos el largo y garantizamos que arranque en "user".
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];

  const clean = raw
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-LIMITS.MAX_HISTORY)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, LIMITS.MAX_MESSAGE_LEN),
    }));

  // La API exige que el primer mensaje sea del usuario.
  while (clean.length && clean[0].role !== "user") clean.shift();
  return clean;
}

// --- Handler -------------------------------------------------------------

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    // Preflight: el navegador lo manda antes del POST porque enviamos
    // Content-Type: application/json. Sin esto, el chat no funciona.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return json({ error: "Método no permitido" }, 405, origin);
    }

    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: "Origen no autorizado" }, 403, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "JSON inválido" }, 400, origin);
    }

    const message = String(payload?.message ?? "")
      .trim()
      .slice(0, LIMITS.MAX_MESSAGE_LEN);
    if (!message) {
      return json({ error: "Falta el campo 'message'" }, 400, origin);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "desconocida";
    const limitMessage = await checkRateLimit(env, ip);
    if (limitMessage) {
      // 200 a propósito: chatbot.js muestra el texto de `reply` tal cual, así
      // el visitante lee el motivo en vez de un error genérico.
      return json({ reply: limitMessage }, 200, origin);
    }

    // Aceptamos los dos nombres: el secret quedó cargado como
    // ANTHROPIC_API_KEY2 en Cloudflare. Si algún día se unifica en
    // ANTHROPIC_API_KEY, este fallback se puede borrar.
    const apiKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY2;

    if (!apiKey) {
      console.error(
        "[portfolio-chat] Falta el secret ANTHROPIC_API_KEY (o ANTHROPIC_API_KEY2)."
      );
      return json({ error: "Asistente sin configurar" }, 500, origin);
    }

    const client = new Anthropic({ apiKey });

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          ...sanitizeHistory(payload?.history),
          { role: "user", content: message },
        ],
      });

      // response.content es una unión discriminada: hay que filtrar por tipo.
      const reply = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (!reply) {
        console.error(
          `[portfolio-chat] Respuesta vacía. stop_reason=${response.stop_reason}`
        );
        return json(
          { reply: "Perdón, no pude generar una respuesta. Probá de nuevo." },
          200,
          origin
        );
      }

      return json({ reply }, 200, origin);
    } catch (error) {
      // Clases de error tipadas del SDK, de la más específica a la más general.
      if (error instanceof Anthropic.AuthenticationError) {
        console.error("[portfolio-chat] API key inválida o revocada.");
      } else if (error instanceof Anthropic.RateLimitError) {
        console.error("[portfolio-chat] Rate limit de la API de Anthropic.");
      } else if (error instanceof Anthropic.APIError) {
        console.error(
          `[portfolio-chat] Error de la API ${error.status}: ${error.message}`
        );
      } else {
        console.error("[portfolio-chat] Error inesperado:", error);
      }

      return json(
        { error: "No se pudo contactar al asistente" },
        502,
        origin
      );
    }
  },
};
