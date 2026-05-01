const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const reqId = crypto.randomUUID().slice(0, 8);
  try {
    console.log(`[voyage-embed:${reqId}] request received`);
    const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");
    if (!VOYAGE_API_KEY) {
      console.error(`[voyage-embed:${reqId}] VOYAGE_API_KEY not configured`);
      throw new Error("VOYAGE_API_KEY no configurada");
    }

    const body = await req.json();
    const input = body.input;
    const inputType = body.input_type ?? "document";

    if (!input || (Array.isArray(input) && input.length === 0)) {
      console.error(`[voyage-embed:${reqId}] missing input`);
      return new Response(JSON.stringify({ error: "input requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inputs = Array.isArray(input) ? input : [input];
    const totalChars = inputs.reduce((s: number, x: string) => s + (x?.length ?? 0), 0);
    console.log(`[voyage-embed:${reqId}] calling Voyage API: ${inputs.length} inputs, ${totalChars} chars, type=${inputType}`);

    const t0 = Date.now();
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
    const dt = Date.now() - t0;
    console.log(`[voyage-embed:${reqId}] Voyage responded ${resp.status} in ${dt}ms`);

    if (!resp.ok) {
      const txt = await resp.text();
      console.error(`[voyage-embed:${reqId}] Voyage error ${resp.status}:`, txt);
      return new Response(JSON.stringify({ error: `Voyage error ${resp.status}: ${txt}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const embeddings = data.data.map((d: any) => d.embedding);
    console.log(`[voyage-embed:${reqId}] returning ${embeddings.length} embeddings (dim=${embeddings[0]?.length ?? 0})`);
    return new Response(JSON.stringify({ embeddings }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(`[voyage-embed:${reqId}] error:`, e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
