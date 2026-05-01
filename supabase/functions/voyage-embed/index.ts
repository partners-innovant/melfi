const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");
    if (!VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY no configurada");

    const body = await req.json();
    const input = body.input;
    const inputType = body.input_type ?? "document"; // "document" or "query"

    if (!input || (Array.isArray(input) && input.length === 0)) {
      return new Response(JSON.stringify({ error: "input requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inputs = Array.isArray(input) ? input : [input];

    const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3",
        input: inputs,
        input_type: inputType,
        output_dimension: 1024,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Voyage error:", resp.status, txt);
      return new Response(JSON.stringify({ error: `Voyage error ${resp.status}: ${txt}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const embeddings = data.data.map((d: any) => d.embedding);
    return new Response(JSON.stringify({ embeddings }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("voyage-embed error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
