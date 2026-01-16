import React from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { apiPost } from "../lib/api";
import { useSession } from "../lib/hooks";
import type { Conversation, Followup, Message, ProfileMini, Tag } from "../lib/types";
import { formatDistanceToNowStrict } from "date-fns";
import { Send, UserPlus, Tag as TagIcon, Bell } from "lucide-react";

async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id,contact_id,status,assigned_to,last_message_at,unread_count,contact:contact_id(id,name,phone_e164,last_seen_at)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id,conversation_id,direction,type,text_body,status,wa_message_id,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchProfiles(): Promise<ProfileMini[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,role")
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchTags(): Promise<Tag[]> {
  const { data, error } = await supabase.from("tags").select("id,name").order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchConversationTags(conversationId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("conversation_tags")
    .select("tag_id")
    .eq("conversation_id", conversationId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.tag_id);
}

async function fetchFollowups(conversationId: string): Promise<Followup[]> {
  const { data, error } = await supabase
    .from("followups")
    .select("id,conversation_id,due_at,status,reason")
    .eq("conversation_id", conversationId)
    .order("due_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as any;
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-slate-700 bg-white">{children}</span>;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">
      {icon}
      <span>{title}</span>
    </div>
  );
}

export function InboxPage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const [sp, setSp] = useSearchParams();
  const conversationId = sp.get("c") || null;

  // --- Realtime (sin refresh) ---
  // Escucha inserts/updates de mensajes y refresca queries relevantes.
  React.useEffect(() => {
    // 1) Canal global para refrescar el listado cuando entra/actualiza un mensaje
    const convListChannel = supabase
      .channel("rt:conversations_list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        (payload) => {
          // Refresca listado (last_message_at/unread_count) y, si aplica, el chat activo
          qc.invalidateQueries({ queryKey: ["conversations"] });
          const convId = (payload as any)?.new?.conversation_id || (payload as any)?.old?.conversation_id;
          if (conversationId && convId === conversationId) {
            qc.invalidateQueries({ queryKey: ["messages", conversationId] });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => {
          qc.invalidateQueries({ queryKey: ["conversations"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(convListChannel);
    };
    // qc es estable; conversationId cambia => re-suscribe para que invalide el chat correcto
  }, [qc, conversationId]);

  const convQ = useQuery({ queryKey: ["conversations"], queryFn: fetchConversations });
  const profilesQ = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: fetchTags });

  const activeConv = React.useMemo(() => convQ.data?.find((c) => c.id === conversationId) ?? null, [convQ.data, conversationId]);

  const msgsQ = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => fetchMessages(conversationId!),
    enabled: !!conversationId,
  });

  // Marcar como leída al abrir la conversación (evita que quede badge pegado)
  React.useEffect(() => {
    if (!conversationId) return;
    // Fire-and-forget: si falla por RLS/no permisos, no bloquea UI
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      // Nota: Supabase devuelve PromiseLike (no siempre tiene .catch en TS). Usamos el 2do arg de .then.
      .then(
        () => qc.invalidateQueries({ queryKey: ["conversations"] }),
        () => {}
      );
  }, [conversationId, qc]);

  // Auto-scroll al final cuando llegan mensajes
  const endRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!conversationId) return;
    // Espera el paint
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }, [conversationId, msgsQ.data?.length]);

  const convTagsQ = useQuery({
    queryKey: ["conversation_tags", conversationId],
    queryFn: () => fetchConversationTags(conversationId!),
    enabled: !!conversationId,
  });

  const followupsQ = useQuery({
    queryKey: ["followups", conversationId],
    queryFn: () => fetchFollowups(conversationId!),
    enabled: !!conversationId,
  });

  const [draft, setDraft] = React.useState("");

  const sendTextM = useMutation({
    mutationFn: async () => {
      if (!conversationId) throw new Error("No conversation");
      const text = draft.trim();
      if (!text) throw new Error("Empty message");
      return apiPost<{ ok: boolean }>("/v1/messages/send_text", { conversation_id: conversationId, text });
    },
    onSuccess: async () => {
      setDraft("");
      await qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      await qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const assignToMeM = useMutation({
    mutationFn: async () => {
      if (!user?.id || !conversationId) throw new Error("Missing");
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_to: user.id })
        .eq("id", conversationId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const updateAssigneeM = useMutation({
    mutationFn: async (assigned_to: string | null) => {
      if (!conversationId) throw new Error("Missing");
      const { error } = await supabase.from("conversations").update({ assigned_to }).eq("id", conversationId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const toggleTagM = useMutation({
    mutationFn: async (tagId: string) => {
      if (!conversationId) throw new Error("Missing");
      const current = new Set(convTagsQ.data ?? []);
      if (current.has(tagId)) {
        const { error } = await supabase.from("conversation_tags").delete().eq("conversation_id", conversationId).eq("tag_id", tagId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("conversation_tags").insert({ conversation_id: conversationId, tag_id: tagId });
        if (error) throw error;
      }
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversation_tags", conversationId] }),
  });

  const addFollowupM = useMutation({
    mutationFn: async (payload: { due_at: string; reason?: string }) => {
      if (!conversationId) throw new Error("Missing");
      const { error } = await supabase.from("followups").insert({ conversation_id: conversationId, due_at: payload.due_at, reason: payload.reason ?? null });
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["followups", conversationId] }),
  });

  return (
    <div className="h-full w-full flex">
      {/* Left: Inbox */}
      <div className="w-[340px] border-r bg-white flex flex-col min-w-0">
        <div className="p-4 border-b">
          <div className="text-sm font-semibold">Inbox</div>
          <div className="text-xs text-slate-500">Conversaciones recientes</div>
        </div>
        <div className="flex-1 overflow-auto">
          {convQ.isLoading ? (
            <div className="p-4 text-sm text-slate-500">Cargando...</div>
          ) : convQ.error ? (
            <div className="p-4 text-sm text-red-700">Error: {(convQ.error as any).message}</div>
          ) : (
            <div className="p-2 flex flex-col gap-1">
              {(convQ.data ?? []).map((c) => {
                const active = c.id === conversationId;
                const name = c.contact?.name || c.contact?.phone_e164 || "Sin nombre";
                return (
                  <button
                    key={c.id}
                    className={`text-left rounded-2xl border px-3 py-2 hover:bg-slate-50 ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white"}`}
                    onClick={() => setSp({ c: c.id })}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm truncate">{name}</div>
                      {c.unread_count > 0 ? (
                        <span className={`text-xs rounded-full px-2 py-0.5 ${active ? "bg-white/20" : "bg-slate-900 text-white"}`}>{c.unread_count}</span>
                      ) : null}
                    </div>
                    <div className={`text-xs mt-1 truncate ${active ? "text-white/70" : "text-slate-500"}`}>
                      {c.last_message_at ? formatDistanceToNowStrict(new Date(c.last_message_at), { addSuffix: true }) : "—"}
                      {c.assigned_to ? " • Asignado" : " • Sin asignar"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Middle: Chat */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-14 border-b bg-white px-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {activeConv ? activeConv.contact?.name || activeConv.contact?.phone_e164 : "Seleccioná una conversación"}
            </div>
            <div className="text-xs text-slate-500 truncate">
              {activeConv ? activeConv.contact?.phone_e164 : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {conversationId ? (
              <button
                onClick={() => assignToMeM.mutate()}
                className="rounded-xl border px-3 py-2 text-xs hover:bg-slate-50 inline-flex items-center gap-2"
              >
                <UserPlus size={16} />
                Asignarme
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!conversationId ? (
            <div className="h-full grid place-items-center text-sm text-slate-500">Elegí un chat a la izquierda.</div>
          ) : msgsQ.isLoading ? (
            <div className="text-sm text-slate-500">Cargando mensajes...</div>
          ) : msgsQ.error ? (
            <div className="text-sm text-red-700">Error: {(msgsQ.error as any).message}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {(msgsQ.data ?? []).map((m) => {
                const mine = m.direction === "out";
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm border ${mine ? "bg-slate-900 text-white border-slate-900" : "bg-white"}`}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.text_body || "(sin texto)"}</div>
                      <div className={`mt-1 text-[11px] ${mine ? "text-white/70" : "text-slate-500"}`}>
                        {new Date(m.created_at).toLocaleString()} • {m.status}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="border-t bg-white p-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendTextM.mutate();
            }}
          >
            <textarea
              className="flex-1 min-h-[44px] max-h-[140px] rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900/20"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={conversationId ? "Escribí un mensaje..." : "Seleccioná un chat"}
              disabled={!conversationId || sendTextM.isPending}
            />
            <button
              type="submit"
              disabled={!conversationId || sendTextM.isPending || !draft.trim()}
              className="h-[44px] px-4 rounded-2xl bg-slate-900 text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Send size={16} />
              Enviar
            </button>
          </form>
          {sendTextM.error ? <div className="text-xs text-red-700 mt-2">{(sendTextM.error as any).message}</div> : null}
        </div>
      </div>

      {/* Right: Details */}
      <div className="w-[340px] border-l bg-white p-4 flex flex-col gap-4">
        {!conversationId ? (
          <div className="text-sm text-slate-500">Detalles</div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <SectionTitle icon={<UserPlus size={14} />} title="Asignación" />
              <select
                className="w-full rounded-xl border px-3 py-2 text-sm"
                value={activeConv?.assigned_to ?? ""}
                onChange={(e) => updateAssigneeM.mutate(e.target.value ? e.target.value : null)}
              >
                <option value="">Sin asignar</option>
                {(profilesQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.id.slice(0, 8)} ({p.role})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <SectionTitle icon={<TagIcon size={14} />} title="Etiquetas" />
              <div className="flex flex-wrap gap-2">
                {(tagsQ.data ?? []).map((t) => {
                  const on = (convTagsQ.data ?? []).includes(t.id);
                  return (
                    <button
                      key={t.id}
                      className={`rounded-full border px-3 py-1 text-xs ${on ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-slate-50"}`}
                      onClick={() => toggleTagM.mutate(t.id)}
                    >
                      {t.name}
                    </button>
                  );
                })}
                {(tagsQ.data ?? []).length === 0 ? <Pill>Creá tags en Settings</Pill> : null}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <SectionTitle icon={<Bell size={14} />} title="Follow-ups" />
              <AddFollowup onAdd={(due_at, reason) => addFollowupM.mutate({ due_at, reason })} />
              <div className="flex flex-col gap-2">
                {(followupsQ.data ?? []).map((f) => (
                  <div key={f.id} className="rounded-2xl border p-3">
                    <div className="text-sm font-medium">{new Date(f.due_at).toLocaleString()}</div>
                    <div className="text-xs text-slate-500 mt-1">{f.reason || "(sin motivo)"}</div>
                    <div className="text-xs mt-2">Estado: <span className="font-medium">{f.status}</span></div>
                  </div>
                ))}
                {(followupsQ.data ?? []).length === 0 ? <Pill>No hay follow-ups</Pill> : null}
              </div>
            </div>

            <div className="rounded-2xl border p-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">Tip</div>
              <div className="mt-1">
                Para mensajes proactivos (cuando ya pasaron 24hs), usá <b>Templates</b> desde Settings + el endpoint del API.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AddFollowup({ onAdd }: { onAdd: (due_at: string, reason?: string) => void }) {
  const [minutes, setMinutes] = React.useState(120);
  const [reason, setReason] = React.useState("Seguimiento");

  return (
    <div className="rounded-2xl border p-3 flex flex-col gap-2">
      <div className="text-xs text-slate-500">Programar en</div>
      <div className="flex items-center gap-2">
        <input
          className="w-24 rounded-xl border px-3 py-2 text-sm"
          type="number"
          min={5}
          value={minutes}
          onChange={(e) => setMinutes(parseInt(e.target.value || "0", 10))}
        />
        <div className="text-sm">minutos</div>
      </div>
      <input
        className="w-full rounded-xl border px-3 py-2 text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo"
      />
      <button
        className="rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:opacity-95"
        onClick={() => {
          const due = new Date(Date.now() + minutes * 60 * 1000).toISOString();
          onAdd(due, reason);
        }}
      >
        Crear follow-up
      </button>
    </div>
  );
}
