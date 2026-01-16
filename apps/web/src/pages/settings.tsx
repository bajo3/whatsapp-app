import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { apiPost } from "../lib/api";

type TagRow = { id: string; name: string };
type QuickReplyRow = { id: string; title: string; body: string };
type TemplateRow = { id: string; name: string; language: string; components: any };

async function fetchTags(): Promise<TagRow[]> {
  const { data, error } = await supabase.from("tags").select("id,name").order("name");
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchQuickReplies(): Promise<QuickReplyRow[]> {
  const { data, error } = await supabase.from("quick_replies").select("id,title,body").order("title");
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await supabase.from("wa_templates").select("id,name,language,components").order("name");
  if (error) throw error;
  return (data ?? []) as any;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const qrQ = useQuery({ queryKey: ["quick_replies"], queryFn: fetchQuickReplies });
  const tplQ = useQuery({ queryKey: ["wa_templates"], queryFn: fetchTemplates });

  const [newTag, setNewTag] = React.useState("");
  const addTagM = useMutation({
    mutationFn: async () => {
      const name = newTag.trim();
      if (!name) throw new Error("Nombre vacío");
      const { error } = await supabase.from("tags").insert({ name });
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      setNewTag("");
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });

  const delTagM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tags").delete().eq("id", id);
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });

  const [qrTitle, setQrTitle] = React.useState("");
  const [qrBody, setQrBody] = React.useState("");
  const addQrM = useMutation({
    mutationFn: async () => {
      const title = qrTitle.trim();
      const body = qrBody.trim();
      if (!title || !body) throw new Error("Completar título y cuerpo");
      const { error } = await supabase.from("quick_replies").insert({ title, body });
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      setQrTitle("");
      setQrBody("");
      qc.invalidateQueries({ queryKey: ["quick_replies"] });
    },
  });

  const delQrM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quick_replies").delete().eq("id", id);
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quick_replies"] }),
  });

  const [tplName, setTplName] = React.useState("");
  const [tplLang, setTplLang] = React.useState("es_AR");
  const [tplJson, setTplJson] = React.useState(
    JSON.stringify(
      {
        name: "followup_1",
        language: "es_AR",
        components: [{ type: "BODY", text: "Hola {{1}}, ¿seguís buscando auto?" }],
      },
      null,
      2
    )
  );

  const saveTplM = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(tplJson);
      const name = (parsed.name || tplName).trim();
      const language = (parsed.language || tplLang).trim();
      const components = parsed.components;
      if (!name || !language || !components) throw new Error("JSON inválido");
      const { error } = await supabase.from("wa_templates").upsert({ name, language, components }, { onConflict: "name" });
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa_templates"] }),
  });

  const syncFromMetaM = useMutation({
    mutationFn: async () => {
      // Backend puede implementar GET a Meta para traer templates; por ahora solo "stub".
      return apiPost<{ ok: boolean }>("/v1/templates/sync", {});
    },
  });

  return (
    <div className="p-6 max-w-5xl">
      <div className="text-xl font-semibold">Settings</div>
      <div className="text-sm text-slate-600 mt-1">Tags, respuestas rápidas, templates y (opcional) Flows</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <section className="rounded-2xl border bg-white p-5">
          <div className="font-semibold">Etiquetas</div>
          <div className="text-xs text-slate-500 mt-1">Para clasificar conversaciones</div>

          <div className="mt-4 flex gap-2">
            <input
              className="flex-1 rounded-xl border px-3 py-2 text-sm"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Ej: Nuevo, Seguimiento, Cerrado"
            />
            <button className="rounded-xl bg-slate-900 text-white px-4 text-sm" onClick={() => addTagM.mutate()}>
              Agregar
            </button>
          </div>
          {addTagM.error ? <div className="text-xs text-red-700 mt-2">{(addTagM.error as any).message}</div> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {(tagsQ.data ?? []).map((t) => (
              <div key={t.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
                <span>{t.name}</span>
                <button className="text-xs text-red-700" onClick={() => delTagM.mutate(t.id)}>
                  borrar
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <div className="font-semibold">Respuestas rápidas</div>
          <div className="text-xs text-slate-500 mt-1">Snippets para ahorrar tiempo</div>

          <div className="mt-4 flex flex-col gap-2">
            <input className="rounded-xl border px-3 py-2 text-sm" value={qrTitle} onChange={(e) => setQrTitle(e.target.value)} placeholder="Título" />
            <textarea className="rounded-xl border px-3 py-2 text-sm min-h-[80px]" value={qrBody} onChange={(e) => setQrBody(e.target.value)} placeholder="Texto" />
            <button className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm" onClick={() => addQrM.mutate()}>
              Agregar
            </button>
            {addQrM.error ? <div className="text-xs text-red-700">{(addQrM.error as any).message}</div> : null}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {(qrQ.data ?? []).map((r) => (
              <div key={r.id} className="rounded-2xl border p-3">
                <div className="text-sm font-semibold">{r.title}</div>
                <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{r.body}</div>
                <button className="mt-2 text-xs text-red-700" onClick={() => delQrM.mutate(r.id)}>
                  borrar
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 md:col-span-2">
          <div className="font-semibold">Templates (oficial)</div>
          <div className="text-xs text-slate-500 mt-1">
            Guardá acá la definición para usarlos al reabrir chats fuera de ventana. El envío real lo hace el API.
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <div className="text-sm font-semibold">Guardados</div>
              <div className="mt-2 flex flex-col gap-2">
                {(tplQ.data ?? []).map((t) => (
                  <div key={t.id} className="rounded-2xl border p-3">
                    <div className="text-sm font-semibold">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.language}</div>
                  </div>
                ))}
                {(tplQ.data ?? []).length === 0 ? <div className="text-sm text-slate-500">Aún no hay templates</div> : null}
              </div>

              <button
                className="mt-3 rounded-xl border px-3 py-2 text-sm hover:bg-slate-50"
                onClick={() => syncFromMetaM.mutate()}
              >
                Sync desde Meta (stub)
              </button>
              {syncFromMetaM.error ? <div className="text-xs text-red-700 mt-2">{(syncFromMetaM.error as any).message}</div> : null}
            </div>

            <div className="md:col-span-2">
              <div className="text-sm font-semibold">Upsert por JSON</div>
              <div className="text-xs text-slate-500">Pegá el JSON (name, language, components) y guardá.</div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <input className="rounded-xl border px-3 py-2 text-sm" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Nombre (opcional)" />
                <input className="rounded-xl border px-3 py-2 text-sm" value={tplLang} onChange={(e) => setTplLang(e.target.value)} placeholder="Idioma (ej es_AR)" />
              </div>

              <textarea className="mt-2 w-full rounded-2xl border px-3 py-2 text-sm min-h-[220px] font-mono" value={tplJson} onChange={(e) => setTplJson(e.target.value)} />
              <button className="mt-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm" onClick={() => saveTplM.mutate()}>
                Guardar
              </button>
              {saveTplM.error ? <div className="text-xs text-red-700 mt-2">{(saveTplM.error as any).message}</div> : null}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border p-4 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">Flows (MVP 5)</div>
            <div className="mt-1">
              Si tu WABA tiene Flows habilitado, podés enviar un mensaje interactivo tipo flow desde el API. En este MVP lo dejamos listo en el backend.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
