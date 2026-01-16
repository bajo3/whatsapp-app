import React from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Bell,
  Check,
  CheckCheck,
  Filter,
  Phone,
  Search,
  Send,
  Tag as TagIcon,
  UserPlus,
  X,
  StickyNote,
  Clock,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import { apiPost } from "../lib/api";
import { useSession } from "../lib/hooks";
import type { Conversation, Followup, Message, ProfileMini, Tag } from "../lib/types";

type Note = {
  id: string;
  conversation_id: string;
  body: string;
  created_at: string;
  created_by: string | null;
};

type SendTextResponse = {
  ok: boolean;
  message_id?: string;
  created_at?: string;
  status?: string;
  wa_message_id?: string | null;
};

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function friendlyError(e: any): string {
  const raw = String(e?.message || e || "").trim();
  // apiPost tira text; a veces es JSON
  const json = safeJsonParse(raw);
  if (json?.detail) return String(json.detail);
  if (json?.error && typeof json.error === "string") return json.error;
  if (/failed to fetch/i.test(raw)) return "No se pudo conectar. Revisá tu internet y reintentá.";
  return raw || "Ocurrió un error";
}

async function fetchConversations(): Promise<Conversation[]> {
  const selectBase = "id,contact_id,status,assigned_to,last_message_at,unread_count,contact:contact_id(id,name,phone_e164,last_seen_at)";
  const selectWithAgent = `${selectBase.slice(0, -1)},last_seen_by_agent_at)`;

  // Compat: si todavía no corriste la migración 002 (columna nueva), hacemos fallback.
  const first = await supabase
    .from("conversations")
    .select(selectWithAgent)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(400);

  if (!first.error) return (first.data ?? []) as any;

  const msg = String((first.error as any)?.message || "");
  if (/last_seen_by_agent_at/i.test(msg) || /column/i.test(msg)) {
    const second = await supabase
      .from("conversations")
      .select(selectBase)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(400);
    if (second.error) throw second.error;
    return (second.data ?? []) as any;
  }

  throw first.error;
}

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id,conversation_id,direction,type,text_body,status,wa_message_id,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(800);
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchProfiles(): Promise<ProfileMini[]> {
  const { data, error } = await supabase.from("profiles").select("id,full_name,role").order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchTags(): Promise<Tag[]> {
  const { data, error } = await supabase.from("tags").select("id,name").order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchConversationTags(conversationId: string): Promise<string[]> {
  const { data, error } = await supabase.from("conversation_tags").select("tag_id").eq("conversation_id", conversationId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.tag_id);
}

async function fetchFollowups(conversationId: string): Promise<Followup[]> {
  const { data, error } = await supabase
    .from("followups")
    .select("id,conversation_id,due_at,status,reason")
    .eq("conversation_id", conversationId)
    .order("due_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchDueFollowups(): Promise<(Followup & { conversation_id: string })[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("followups")
    .select("id,conversation_id,due_at,status,reason")
    .eq("status", "pending")
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchNotes(conversationId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("id,conversation_id,body,created_at,created_by")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as any;
}

function Pill({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition ${
        active ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function SectionTitle({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">
        {icon}
        <span>{title}</span>
      </div>
      {right}
    </div>
  );
}

function StatusIcon({ status }: { status: Message["status"] }) {
  if (status === "sent") return <Check size={14} className="inline-block" />;
  if (status === "delivered") return <CheckCheck size={14} className="inline-block" />;
  if (status === "read") return <CheckCheck size={14} className="inline-block" />;
  return null;
}

function upsertConversationInList(list: Conversation[] | undefined, patch: Partial<Conversation> & { id: string }): Conversation[] {
  const arr = Array.isArray(list) ? [...list] : [];
  const idx = arr.findIndex((c) => c.id === patch.id);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...patch } as any;
  } else {
    // Si no lo tenemos, forzamos refetch luego; esto mantiene UI estable
    arr.unshift(patch as any);
  }
  // ordenar por last_message_at desc
  arr.sort((a, b) => {
    const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return tb - ta;
  });
  return arr;
}

export function InboxPage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const [sp, setSp] = useSearchParams();
  const conversationId = sp.get("c") || null;

  // UI state
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "mine" | "unassigned" | "unread">("all");

  // --- Queries ---
  const convQ = useQuery({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
    // fallback suave (aunque realtime falle, nunca requiere refresh)
    refetchInterval: 15000,
  });
  const profilesQ = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const dueFupsQ = useQuery({
    queryKey: ["due_followups"],
    queryFn: fetchDueFollowups,
    refetchInterval: 20000,
  });

  const activeConv = React.useMemo(
    () => convQ.data?.find((c) => c.id === conversationId) ?? null,
    [convQ.data, conversationId]
  );

  const msgsQ = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => fetchMessages(conversationId!),
    enabled: !!conversationId,
    refetchInterval: conversationId ? 8000 : false,
  });

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

  const notesQ = useQuery({
    queryKey: ["notes", conversationId],
    queryFn: () => fetchNotes(conversationId!),
    enabled: !!conversationId,
  });

  // --- Realtime: append/patch en memoria (sin invalidate masivo) ---
  React.useEffect(() => {
    const ch = supabase
      .channel("rt:inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = (payload as any)?.new as Message | undefined;
          if (!m?.conversation_id) return;

          // 1) Mensajes: append si corresponde
          qc.setQueryData(["messages", m.conversation_id], (old: any) => {
            const arr: any[] = Array.isArray(old) ? [...old] : [];
            if (arr.some((x) => x.id === m.id)) return arr;
            arr.push(m);
            arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            return arr;
          });

          // 2) Conversaciones: actualizamos last_message_at y (si es inbound) unread_count
          const nowIso = m.created_at ?? new Date().toISOString();
          qc.setQueryData(["conversations"], (old: any) => {
            const list = Array.isArray(old) ? (old as Conversation[]) : [];
            const current = list.find((c) => c.id === m.conversation_id);

            const isOpen = conversationId === m.conversation_id;
            const nextUnread = m.direction === "in" && !isOpen ? (current?.unread_count ?? 0) + 1 : current?.unread_count ?? 0;

            return upsertConversationInList(list, {
              id: m.conversation_id,
              last_message_at: nowIso,
              unread_count: nextUnread,
            });
          });

          // 3) Si el chat está abierto y entra un inbound, lo marcamos como leído (DB + cache)
          if (conversationId && m.conversation_id === conversationId && m.direction === "in") {
            supabase
              .from("conversations")
              .update({ unread_count: 0 })
              .eq("id", conversationId)
              .then(
                () => {
                  qc.setQueryData(["conversations"], (old: any) => upsertConversationInList(old, { id: conversationId, unread_count: 0 }));
                },
                () => {}
              );
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const m = (payload as any)?.new as Message | undefined;
          if (!m?.conversation_id) return;
          qc.setQueryData(["messages", m.conversation_id], (old: any) => {
            const arr: any[] = Array.isArray(old) ? [...old] : [];
            const idx = arr.findIndex((x) => x.id === m.id);
            if (idx < 0) return arr;
            arr[idx] = { ...arr[idx], ...m };
            return arr;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        (payload) => {
          const c = (payload as any)?.new as Partial<Conversation> | undefined;
          if (!c?.id) return;
          qc.setQueryData(["conversations"], (old: any) => upsertConversationInList(old, c as any));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, conversationId]);

  // Mark as read + last_seen_by_agent_at al abrir
  React.useEffect(() => {
    if (!conversationId) return;

    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(
        () => {
          qc.setQueryData(["conversations"], (old: any) => upsertConversationInList(old, { id: conversationId, unread_count: 0 }));
        },
        () => {}
      );

    const contactId = activeConv?.contact_id;
    if (contactId) {
      supabase
        .from("contacts")
        .update({ last_seen_by_agent_at: new Date().toISOString() })
        .eq("id", contactId)
        .then(
          () => {
            // refresco leve del listado
            qc.invalidateQueries({ queryKey: ["conversations"], exact: true });
          },
          () => {}
        );
    }
  }, [conversationId, activeConv?.contact_id, qc]);

  // Auto-scroll al final
  const endRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!conversationId) return;
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }, [conversationId, (msgsQ.data ?? []).length]);

  // --- Mutations ---
  const assignToMeM = useMutation({
    mutationFn: async () => {
      if (!user?.id || !conversationId) throw new Error("Missing");
      const { error } = await supabase.from("conversations").update({ assigned_to: user.id }).eq("id", conversationId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"], exact: true }),
  });

  const updateAssigneeM = useMutation({
    mutationFn: async (assigned_to: string | null) => {
      if (!conversationId) throw new Error("Missing");
      const { error } = await supabase.from("conversations").update({ assigned_to }).eq("id", conversationId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"], exact: true }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversation_tags", conversationId], exact: true }),
  });

  const addFollowupM = useMutation({
    mutationFn: async (payload: { due_at: string; reason?: string }) => {
      if (!conversationId) throw new Error("Missing");
      const { error } = await supabase
        .from("followups")
        .insert({ conversation_id: conversationId, due_at: payload.due_at, reason: payload.reason ?? null });
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followups", conversationId], exact: true });
      qc.invalidateQueries({ queryKey: ["due_followups"], exact: true });
    },
  });

  const updateFollowupStatusM = useMutation({
    mutationFn: async (payload: { id: string; status: "done" | "canceled" | "pending" }) => {
      const { error } = await supabase.from("followups").update({ status: payload.status }).eq("id", payload.id);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followups", conversationId], exact: true });
      qc.invalidateQueries({ queryKey: ["due_followups"], exact: true });
    },
  });

  const addNoteM = useMutation({
    mutationFn: async (body: string) => {
      if (!conversationId) throw new Error("Missing");
      const { error } = await supabase.from("notes").insert({ conversation_id: conversationId, body });
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", conversationId], exact: true }),
  });

  const sendTextM = useMutation({
    mutationFn: async (vars: { text: string; client_id: string }) => {
      if (!conversationId) throw new Error("No conversation");
      return apiPost<SendTextResponse>("/v1/messages/send_text", { conversation_id: conversationId, text: vars.text });
    },
    onMutate: async (vars) => {
      if (!conversationId) return;
      const optimistic: Message & { __client_id?: string } = {
        id: `tmp_${vars.client_id}`,
        conversation_id: conversationId,
        direction: "out",
        type: "text",
        text_body: vars.text,
        status: "queued",
        wa_message_id: null,
        created_at: new Date().toISOString(),
        __client_id: vars.client_id,
      } as any;

      qc.setQueryData(["messages", conversationId], (old: any) => {
        const arr: any[] = Array.isArray(old) ? [...old] : [];
        arr.push(optimistic);
        arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        return arr;
      });

      qc.setQueryData(["conversations"], (old: any) =>
        upsertConversationInList(old, { id: conversationId, last_message_at: optimistic.created_at })
      );

      return { conversationId, optimisticId: optimistic.id };
    },
    onSuccess: (data, vars, ctx) => {
      const convId = ctx?.conversationId;
      if (!convId) return;

      // Si el API devolvió message_id, reemplazamos el tmp. Si no, lo dejamos y el realtime lo corrige.
      if (data?.message_id) {
        qc.setQueryData(["messages", convId], (old: any) => {
          const arr: any[] = Array.isArray(old) ? [...old] : [];
          const tmpIdx = arr.findIndex((m) => m.id === ctx?.optimisticId);
          const replacement: Message = {
            id: data.message_id!,
            conversation_id: convId,
            direction: "out",
            type: "text",
            text_body: vars.text,
            status: (data.status as any) || "sent",
            wa_message_id: data.wa_message_id ?? null,
            created_at: data.created_at || new Date().toISOString(),
          };
          if (tmpIdx >= 0) {
            arr[tmpIdx] = { ...arr[tmpIdx], ...replacement };
          } else if (!arr.some((m) => m.id === replacement.id)) {
            arr.push(replacement);
          }
          arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          return arr;
        });
      } else {
        qc.setQueryData(["messages", convId], (old: any) => {
          const arr: any[] = Array.isArray(old) ? [...old] : [];
          const tmpIdx = arr.findIndex((m) => m.id === ctx?.optimisticId);
          if (tmpIdx >= 0) arr[tmpIdx] = { ...arr[tmpIdx], status: "sent" };
          return arr;
        });
      }
    },
    onError: (err, _vars, ctx) => {
      const convId = ctx?.conversationId;
      if (!convId) return;
      qc.setQueryData(["messages", convId], (old: any) => {
        const arr: any[] = Array.isArray(old) ? [...old] : [];
        const idx = arr.findIndex((m) => m.id === ctx?.optimisticId);
        if (idx >= 0) arr[idx] = { ...arr[idx], status: "failed", __error: friendlyError(err) };
        return arr;
      });
    },
  });

  // --- Filters ---
  const filteredConversations = React.useMemo(() => {
    const all = convQ.data ?? [];
    const q = search.trim().toLowerCase();

    return all.filter((c) => {
      if (filter === "mine" && user?.id && c.assigned_to !== user.id) return false;
      if (filter === "unassigned" && c.assigned_to != null) return false;
      if (filter === "unread" && !(c.unread_count > 0)) return false;

      if (!q) return true;
      const name = (c.contact?.name ?? "").toLowerCase();
      const phone = (c.contact?.phone_e164 ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [convQ.data, filter, search, user?.id]);

  // --- Chat composer ---
  const [draft, setDraft] = React.useState("");
  const [noteDraft, setNoteDraft] = React.useState("");

  function openConversation(id: string) {
    setSp({ c: id });
  }

  function retryMessage(msg: any) {
    if (!msg?.text_body) return;
    const client_id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    sendTextM.mutate({ text: String(msg.text_body), client_id });
  }

  const headerName = activeConv ? activeConv.contact?.name || activeConv.contact?.phone_e164 || "Sin nombre" : "Seleccioná una conversación";
  const headerPhone = activeConv ? activeConv.contact?.phone_e164 : "";

  return (
    <div className="h-full w-full flex bg-slate-50">
      {/* Left: Inbox */}
      <div className="w-[360px] border-r bg-white flex flex-col min-w-0">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Inbox</div>
              <div className="text-xs text-slate-500">Respuestas rápidas, sin perder leads</div>
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <Filter size={14} />
              <span>{filteredConversations.length}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-2xl border px-3 py-2">
            <Search size={16} className="text-slate-500" />
            <input
              className="w-full text-sm outline-none"
              placeholder="Buscar por nombre o teléfono"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button className="text-slate-500 hover:text-slate-800" onClick={() => setSearch("")}
                type="button"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Pill active={filter === "all"} onClick={() => setFilter("all")}>Todos</Pill>
            <Pill active={filter === "mine"} onClick={() => setFilter("mine")}>Asignadas a mí</Pill>
            <Pill active={filter === "unassigned"} onClick={() => setFilter("unassigned")}>Sin asignar</Pill>
            <Pill active={filter === "unread"} onClick={() => setFilter("unread")}>No leídas</Pill>
          </div>
        </div>

        {/* Reminders / Follow-ups vencidos */}
        <div className="border-b bg-white p-3">
          <SectionTitle
            icon={<Clock size={14} />}
            title="Recordatorios vencidos"
            right={
              <span className="text-xs text-slate-500">{(dueFupsQ.data ?? []).length}</span>
            }
          />
          {dueFupsQ.isLoading ? (
            <div className="mt-2 text-xs text-slate-500">Cargando...</div>
          ) : (dueFupsQ.data ?? []).length === 0 ? (
            <div className="mt-2 text-xs text-slate-500">Nada vencido. Bien.</div>
          ) : (
            <div className="mt-2 flex flex-col gap-2 max-h-[140px] overflow-auto pr-1">
              {(dueFupsQ.data ?? []).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="text-left rounded-2xl border px-3 py-2 hover:bg-slate-50"
                  onClick={() => openConversation(f.conversation_id)}
                >
                  <div className="text-xs font-semibold truncate">{f.reason || "Seguimiento"}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Venció {formatDistanceToNowStrict(new Date(f.due_at), { addSuffix: true })}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {convQ.isLoading ? (
            <div className="p-4 text-sm text-slate-500">Cargando...</div>
          ) : convQ.error ? (
            <div className="p-4 text-sm text-red-700">Error: {friendlyError(convQ.error)}</div>
          ) : (
            <div className="p-2 flex flex-col gap-1">
              {filteredConversations.map((c) => {
                const active = c.id === conversationId;
                const name = c.contact?.name || c.contact?.phone_e164 || "Sin nombre";
                const phone = c.contact?.phone_e164 || "";
                const when = c.last_message_at
                  ? formatDistanceToNowStrict(new Date(c.last_message_at), { addSuffix: true })
                  : "—";

                return (
                  <button
                    key={c.id}
                    className={`text-left rounded-2xl border px-3 py-2 hover:bg-slate-50 transition ${
                      active ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-900" : "bg-white"
                    }`}
                    onClick={() => openConversation(c.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{name}</div>
                        <div className={`text-xs truncate ${active ? "text-white/70" : "text-slate-500"}`}>{phone}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.unread_count > 0 ? (
                          <span className={`text-xs rounded-full px-2 py-0.5 ${active ? "bg-white/20" : "bg-slate-900 text-white"}`}>
                            {c.unread_count}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className={`text-xs mt-1 flex items-center justify-between ${active ? "text-white/70" : "text-slate-500"}`}>
                      <span className="truncate">{when}</span>
                      <span className="ml-2">{c.assigned_to ? "Asignado" : "Sin asignar"}</span>
                    </div>
                  </button>
                );
              })}

              {filteredConversations.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">No hay conversaciones con ese filtro.</div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Middle: Chat */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-14 border-b bg-white px-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{headerName}</div>
            <div className="text-xs text-slate-500 truncate">{headerPhone}</div>
          </div>
          <div className="flex items-center gap-2">
            {conversationId ? (
              <>
                <a
                  href={headerPhone ? `tel:${headerPhone.replace(/\s/g, "")}` : "#"}
                  className={`rounded-xl border px-3 py-2 text-xs hover:bg-slate-50 inline-flex items-center gap-2 ${
                    headerPhone ? "" : "pointer-events-none opacity-50"
                  }`}
                >
                  <Phone size={16} />
                  Llamar
                </a>
                <button
                  onClick={() => assignToMeM.mutate()}
                  className="rounded-xl border px-3 py-2 text-xs hover:bg-slate-50 inline-flex items-center gap-2"
                  type="button"
                >
                  <UserPlus size={16} />
                  Asignarme
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!conversationId ? (
            <div className="h-full grid place-items-center text-sm text-slate-500">Elegí un chat a la izquierda.</div>
          ) : msgsQ.isLoading ? (
            <div className="text-sm text-slate-500">Cargando mensajes...</div>
          ) : msgsQ.error ? (
            <div className="text-sm text-red-700">Error: {friendlyError(msgsQ.error)}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {(msgsQ.data ?? []).map((m: any) => {
                const mine = m.direction === "out";
                const isFailed = m.status === "failed";
                const isQueued = m.status === "queued";
                const ts = new Date(m.created_at).toLocaleString();
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm border ${mine ? "bg-slate-900 text-white border-slate-900" : "bg-white"}`}>
                      <div className="whitespace-pre-wrap break-words">{m.text_body || "(sin texto)"}</div>
                      <div className={`mt-1 flex items-center justify-between gap-3 text-[11px] ${mine ? "text-white/70" : "text-slate-500"}`}>
                        <span className="truncate">{ts}</span>
                        {mine ? (
                          <span className="inline-flex items-center gap-1">
                            {isQueued ? <span>Enviando…</span> : null}
                            {isFailed ? <span>No enviado</span> : null}
                            {!isQueued && !isFailed ? <StatusIcon status={m.status} /> : null}
                          </span>
                        ) : (
                          <span>{m.status}</span>
                        )}
                      </div>

                      {mine && isFailed ? (
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="text-[11px] text-white/80 truncate">{m.__error || "Falló el envío"}</div>
                          <button
                            type="button"
                            onClick={() => retryMessage(m)}
                            className="rounded-full bg-white/10 px-3 py-1 text-[11px] hover:bg-white/15"
                          >
                            Reintentar
                          </button>
                        </div>
                      ) : null}
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
              if (!conversationId) return;
              const text = draft.trim();
              if (!text) return;
              const client_id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
              setDraft("");
              sendTextM.mutate({ text, client_id });
            }}
          >
            <textarea
              className="flex-1 min-h-[44px] max-h-[140px] rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900/20"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={conversationId ? "Escribí un mensaje..." : "Seleccioná un chat"}
              disabled={!conversationId}
            />
            <button
              type="submit"
              disabled={!conversationId || !draft.trim()}
              className="h-[44px] px-4 rounded-2xl bg-slate-900 text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Send size={16} />
              Enviar
            </button>
          </form>
        </div>
      </div>

      {/* Right: Details */}
      <div className="w-[360px] border-l bg-white p-4 flex flex-col gap-4 overflow-auto">
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
                      type="button"
                    >
                      {t.name}
                    </button>
                  );
                })}
                {(tagsQ.data ?? []).length === 0 ? (
                  <span className="text-xs text-slate-500">Creá tags en Settings</span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <SectionTitle icon={<Bell size={14} />} title="Recordatorios" />
              <FollowupComposer
                onAdd={(due_at, reason) => addFollowupM.mutate({ due_at, reason })}
              />

              <div className="flex flex-col gap-2">
                {(followupsQ.data ?? []).map((f) => {
                  const overdue = f.status === "pending" && new Date(f.due_at).getTime() <= Date.now();
                  return (
                    <div key={f.id} className={`rounded-2xl border p-3 ${overdue ? "border-amber-300 bg-amber-50" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{new Date(f.due_at).toLocaleString()}</div>
                          <div className="text-xs text-slate-600 mt-1">{f.reason || "(sin motivo)"}</div>
                          <div className="text-xs mt-2">
                            Estado: <span className="font-medium">{f.status}</span>
                            {overdue ? <span className="ml-2 font-semibold text-amber-700">VENCIDO</span> : null}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          {f.status === "pending" ? (
                            <>
                              <button
                                className="rounded-xl border px-3 py-1 text-xs hover:bg-white"
                                type="button"
                                onClick={() => updateFollowupStatusM.mutate({ id: f.id, status: "done" })}
                              >
                                Hecho
                              </button>
                              <button
                                className="rounded-xl border px-3 py-1 text-xs hover:bg-white"
                                type="button"
                                onClick={() => updateFollowupStatusM.mutate({ id: f.id, status: "canceled" })}
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <button
                              className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                              type="button"
                              onClick={() => updateFollowupStatusM.mutate({ id: f.id, status: "pending" })}
                            >
                              Reabrir
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(followupsQ.data ?? []).length === 0 ? <span className="text-xs text-slate-500">No hay recordatorios</span> : null}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <SectionTitle icon={<StickyNote size={14} />} title="Notas internas" />
              <div className="rounded-2xl border p-3">
                <textarea
                  className="w-full min-h-[70px] rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900/20"
                  placeholder="Ej: Le interesa Vento/Corolla, presupuesto 12M, quiere permuta…"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                />
                <button
                  className="mt-2 rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:opacity-95 disabled:opacity-50"
                  disabled={!noteDraft.trim() || addNoteM.isPending}
                  type="button"
                  onClick={() => {
                    const body = noteDraft.trim();
                    if (!body) return;
                    setNoteDraft("");
                    addNoteM.mutate(body);
                  }}
                >
                  Guardar nota
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {(notesQ.data ?? []).map((n) => (
                  <div key={n.id} className="rounded-2xl border p-3">
                    <div className="text-xs text-slate-500">{new Date(n.created_at).toLocaleString()}</div>
                    <div className="mt-1 text-sm whitespace-pre-wrap break-words">{n.body}</div>
                  </div>
                ))}
                {(notesQ.data ?? []).length === 0 ? <span className="text-xs text-slate-500">No hay notas</span> : null}
              </div>
            </div>

            <div className="rounded-2xl border p-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">Atajos útiles</div>
              <div className="mt-1">
                • Asignate el lead apenas entra • Poné un recordatorio (+2 / +7 / +15 días) • Dejá nota de intención y presupuesto.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FollowupComposer({ onAdd }: { onAdd: (due_at: string, reason?: string) => void }) {
  const [reason, setReason] = React.useState("Seguimiento");
  const [when, setWhen] = React.useState<"2d" | "7d" | "15d" | "tomorrow10" | "custom">("2d");
  const [customMinutes, setCustomMinutes] = React.useState(120);

  function computeDueIso() {
    const now = new Date();
    if (when === "2d") return new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    if (when === "7d") return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    if (when === "15d") return new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();
    if (when === "tomorrow10") {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      t.setHours(10, 0, 0, 0);
      return t.toISOString();
    }
    // custom
    return new Date(now.getTime() + customMinutes * 60 * 1000).toISOString();
  }

  return (
    <div className="rounded-2xl border p-3 flex flex-col gap-2">
      <div className="text-xs text-slate-500">Cuándo</div>
      <div className="flex flex-wrap gap-2">
        <Pill active={when === "2d"} onClick={() => setWhen("2d")}>+2 días</Pill>
        <Pill active={when === "7d"} onClick={() => setWhen("7d")}>+7 días</Pill>
        <Pill active={when === "15d"} onClick={() => setWhen("15d")}>+15 días</Pill>
        <Pill active={when === "tomorrow10"} onClick={() => setWhen("tomorrow10")}>Mañana 10:00</Pill>
        <Pill active={when === "custom"} onClick={() => setWhen("custom")}>Personalizado</Pill>
      </div>

      {when === "custom" ? (
        <div className="flex items-center gap-2">
          <input
            className="w-24 rounded-xl border px-3 py-2 text-sm"
            type="number"
            min={5}
            value={customMinutes}
            onChange={(e) => setCustomMinutes(parseInt(e.target.value || "0", 10))}
          />
          <div className="text-sm">minutos</div>
        </div>
      ) : null}

      <div className="text-xs text-slate-500 mt-1">Motivo</div>
      <input
        className="w-full rounded-xl border px-3 py-2 text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo"
      />
      <button
        className="rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:opacity-95"
        type="button"
        onClick={() => onAdd(computeDueIso(), reason)}
      >
        Crear recordatorio
      </button>
    </div>
  );
}
