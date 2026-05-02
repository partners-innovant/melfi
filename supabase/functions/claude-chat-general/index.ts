import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres Claude, un asistente de IA creado por Anthropic. Estás siendo usado por un psicólogo o profesional de la salud mental a través de Psicoasist. Ayúdalo con cualquier tarea general que necesite — redacción, búsqueda de información, análisis, planificación, o cualquier otra consulta. No estás en modo clínico — responde de forma natural y útil como lo harías normalmente.
Responde siempre en español a menos que el usuario escriba en otro idioma.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { conversation_id, message, history } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "message requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure conversation exists / create one
    let convId: string = conversation_id;
    if (!convId) {
      const { data: conv, error: convErr } = await userClient
        .from("general_conversations")
        .insert({
          psychologist_id: user.id,
          title: message.slice(0, 50),
        })
        .select("id")
        .single();
      if (convErr) throw convErr;
      convId = conv.id;
    } else {
      // touch updated_at
      await userClient
        .from("general_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convId);
    }

    // Save user message
    await userClient.from("general_messages").insert({
      conversation_id: convId,
      role: "user",
      content: message,
    });

    const messages = [
      ...(Array.isArray(history) ? history : []).map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? ""),
      })),
      { role: "user", content: message },
    ];

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
        stream: true,
      }),
    });

    if (!claudeResp.ok || !claudeResp.body) {
      const txt = await claudeResp.text().catch(() => "");
      console.error("[claude-chat-general] Claude error", claudeResp.status, txt);
      return new Response(
        JSON.stringify({ error: `Claude API ${claudeResp.status}: ${txt.slice(0, 500)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let fullAnswer = "";

    const stream = new ReadableStream({
      async start(controller) {
        // Send conversation id first as a meta event
        controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ conversation_id: convId })}\n\n`));

        const reader = claudeResp.body!.getReader();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let nlIdx: number;
            while ((nlIdx = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
              buffer = buffer.slice(nlIdx + 1);
              if (!line.startsWith("data: ")) continue;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr) continue;
              try {
                const evt = JSON.parse(jsonStr);
                if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                  const chunk = evt.delta.text as string;
                  fullAnswer += chunk;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ delta: chunk })}\n\n`),
                  );
                }
              } catch {
                // ignore parse errors
              }
            }
          }

          // Persist assistant message
          await userClient.from("general_messages").insert({
            conversation_id: convId,
            role: "assistant",
            content: fullAnswer,
          });
          await userClient
            .from("general_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", convId);

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err) {
          console.error("[claude-chat-general] stream error", err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("[claude-chat-general] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
