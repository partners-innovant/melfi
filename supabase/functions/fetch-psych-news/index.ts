const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `Search for the latest psychology and psychiatry news from the last 7 days from these sources: Psychiatric Times (psychiatrictimes.com), APA News (apa.org/news), NIMH News (nimh.nih.gov/news), Medscape Psychiatry (medscape.com/psychiatry), Psychology Today (psychologytoday.com).

Return ONLY a JSON array (no markdown fences, no prose) with the 6 most relevant clinical/scientific news items. Format:
[{
  "title": "article title",
  "source": "source name",
  "url": "article URL",
  "summary": "2 sentence summary in Spanish",
  "date": "YYYY-MM-DD",
  "category": "investigación|clínica|política_salud|neurociencia|otro"
}]`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 3000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: PROMPT }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("[fetch-psych-news] claude error", resp.status, t);
      return new Response(JSON.stringify({ error: `Claude ${resp.status}`, items: [] }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text: string = (data?.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    // Extract JSON array
    let items: any[] = [];
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try { items = JSON.parse(match[0]); } catch (e) { console.error("parse fail", e); }
    }

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[fetch-psych-news]", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error", items: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
