import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Una richiesta a una funzione Netlify accetta al massimo circa 4 MB di file binario.
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

type PhraseRecord = { id: string; text: string; by: string; at: string };
type VideoRecord = { id: string; title: string; contentType: string; size: number; addedAt: string };

const json = (data: unknown, status = 200) => Response.json(data, { status });

export default async (req: Request, _context: Context) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean); // ["api", resource, id?]
  const resource = parts[1];
  const id = parts[2];

  const phrases = getStore("love-phrases");
  const videos = getStore("love-videos");

  try {
    if (resource === "phrases" && req.method === "GET") {
      const { blobs } = await phrases.list();
      const items = await Promise.all(blobs.map(b => phrases.get(b.key, { type: "json" })));
      const list = (items.filter(Boolean) as PhraseRecord[]).sort((a, b) => a.at.localeCompare(b.at));
      return json(list);
    }

    if (resource === "phrases" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const text = typeof body?.text === "string" ? body.text.trim().slice(0, 400) : "";
      if (!text) return json({ error: "Frase vuota" }, 400);
      const by = typeof body?.by === "string" ? body.by.trim().slice(0, 40) : "";
      const rec: PhraseRecord = { id: crypto.randomUUID(), text, by, at: new Date().toISOString() };
      await phrases.setJSON(`${rec.at}_${rec.id}`, rec);
      return json(rec, 201);
    }

    if (resource === "videos" && req.method === "GET") {
      const { blobs } = await videos.list({ prefix: "meta/" });
      const items = await Promise.all(blobs.map(b => videos.get(b.key, { type: "json" })));
      const list = (items.filter(Boolean) as VideoRecord[]).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
      return json(list);
    }

    if (resource === "videos" && req.method === "POST") {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "File mancante" }, 400);
      if (!file.type.startsWith("video/")) return json({ error: "Il file non è un video" }, 400);
      if (file.size > MAX_VIDEO_BYTES) {
        return json({ error: "Il video supera 4 MB: comprimilo e riprova" }, 413);
      }
      const vid = crypto.randomUUID();
      await videos.set(`file/${vid}`, await file.arrayBuffer(), { metadata: { contentType: file.type } });
      const title = String(form.get("title") || file.name).replace(/\.[^.]+$/, "").slice(0, 80);
      const meta: VideoRecord = {
        id: vid,
        title,
        contentType: file.type,
        size: file.size,
        addedAt: new Date().toISOString(),
      };
      await videos.setJSON(`meta/${vid}`, meta);
      return json(meta, 201);
    }

    if (resource === "video" && id && UUID.test(id) && req.method === "GET") {
      const entry = await videos.getWithMetadata(`file/${id}`, { type: "stream" });
      if (entry === null) return new Response("Non trovato", { status: 404 });
      return new Response(entry.data, {
        headers: {
          "content-type": String(entry.metadata?.contentType || "video/mp4"),
          "cache-control": "public, max-age=86400",
        },
      });
    }

    if (resource === "video" && id && UUID.test(id) && req.method === "PUT") {
      const body = await req.json().catch(() => null);
      const title = typeof body?.title === "string" ? body.title.trim().slice(0, 80) : "";
      if (!title) return json({ error: "Titolo vuoto" }, 400);
      const meta = (await videos.get(`meta/${id}`, { type: "json" })) as VideoRecord | null;
      if (!meta) return json({ error: "Video non trovato" }, 404);
      const updated: VideoRecord = { ...meta, title };
      await videos.setJSON(`meta/${id}`, updated);
      return json(updated);
    }

    return json({ error: "Non trovato" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Errore del server, riprova" }, 500);
  }
};

export const config: Config = {
  path: "/api/*",
};
