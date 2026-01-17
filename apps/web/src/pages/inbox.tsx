import React from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Check,
  CheckCheck,
  ChevronLeft,
  Info,
  Loader2,
  Bookmark,
  FileText,
  MessageSquarePlus,
  Phone,
  Search,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import { apiPost } from "../lib/api";
import { useSession } from "../lib/hooks";
import type { Contact, Conversation, Message } from "../lib/types";

type Followup = {
  id: string;
  conversation_id: string;
  due_at: string;
  status: "pending" | "done" | "canceled";
  reason: string | null;
};

type Note = {
  id: string;
  conversation_id: string;
  body: string;
  created_at: string;
  created_by: string | null;
};

type InboxFilter = "all" | "mine" | "unassigned" | "unread";

type SendTextResponse = {
  ok: boolean;
  message_id?: string;
  created_at?: string;
  status?: string;
  wa_message_id?: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function friendlyError(e: any): string {
  const raw = String(e?.message || e || "").trim();
  if (/failed to fetch/i.test(raw)) return "No se pudo conectar. Revisá tu internet y reintentá.";
  return raw || "Ocurrió un error";
}

function normalizePhoneE164(raw: string): string {
  const s = raw.replace(/\s+/g, "").replace(/\-/g, "");
  if (s.startsWith("+")) return s;
  if (/^\d{6,}$/.test(s)) return `+54${s}`;
  return s;
}

function StatusTicks({ status }: { status: Message["status"] }) {
  if (status === "sent") return <Check size={14} className="text-[var(--wa-subtext)]" />;
  if (status === "delivered") return <CheckCheck size={14} className="text-[var(--wa-subtext)]" />;
  if (status === "read") return <CheckCheck size={14} className="text-sky-500" />;
  return null;
}

const STAGE_LABEL: Record<string, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  visited: "Visitó",
  reserved: "Reservado",
  sold: "Vendido",
  lost: "Perdido",
};

const SOURCE_LABEL: Record<string, string> = {
  ig: "Instagram",
  ml: "MercadoLibre",
  referral: "Referido",
  web: "Web",
  walkin: "Mostrador",
  other: "Otro",
};

function stageBadgeClass(stage?: string | null) {
  const s = stage || "new";
  if (s === "sold") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (s === "reserved") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (s === "visited") return "bg-sky-500/15 text-sky-700 dark:text-sky-300";
  if (s === "contacted") return "bg-[var(--wa-accent)]/15 text-[var(--wa-accent)]";
  if (s === "lost") return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  return "bg-black/5 dark:bg-white/10 text-[var(--wa-text)]";
}

async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id,contact_id,status,assigned_to,lead_stage,lead_source,ai_meta,last_message_at,unread_count,contact:contact_id(id,name,phone_e164,last_seen_at,last_seen_by_agent_at,lead_source,email,doc_id,address,notes)"
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(500);

  if (!error) return (data ?? []) as any;

  // compat: si faltan columnas nuevas
  const { data: d2, error: e2 } = await supabase
    .from("conversations")
    .select(
      "id,contact_id,status,assigned_to,last_message_at,unread_count,contact:contact_id(id,name,phone_e164,last_seen_at)"
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (e2) throw e2;
  return (d2 ?? []) as any;
}

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id,conversation_id,direction,type,text_body,status,wa_message_id,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(900);
  if (error) throw error;
  return (data ?? []) as any;
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

type TagRow = { id: string; name: string };
type ConversationTagRow = { tag_id: string; tag: TagRow };

async function fetchProfiles(): Promise<{ id: string; full_name: string | null; role: string }[]> {
  const { data, error } = await supabase.from("profiles").select("id,full_name,role").order("full_name");
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchTags(): Promise<TagRow[]> {
  const { data, error } = await supabase.from("tags").select("id,name").order("name");
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchConversationTags(conversationId: string): Promise<ConversationTagRow[]> {
  const { data, error } = await supabase
    .from("conversation_tags")
    .select("tag_id,tag:tag_id(id,name)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchQuickReplies(): Promise<{ id: string; title: string; body: string }[]> {
  const { data, error } = await supabase.from("quick_replies").select("id,title,body").order("title");
  if (error) throw error;
  return (data ?? []) as any;
}

async function fetchTemplates(): Promise<{ id: string; name: string; language: string; components: any }[]> {
  const { data, error } = await supabase.from("wa_templates").select("id,name,language,components").order("name");
  if (error) throw error;
  return (data ?? []) as any;
}

async function searchContacts(q: string): Promise<Contact[]> {
  const like = `%${q.trim()}%`;
  const base = supabase
    .from("contacts")
    .select("id,name,phone_e164,last_seen_at,last_seen_by_agent_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!q.trim()) {
    const { data, error } = await base;
    if (!error) return (data ?? []) as any;
    const { data: d2, error: e2 } = await supabase
      .from("contacts")
      .select("id,name,phone_e164,last_seen_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (e2) throw e2;
    return (d2 ?? []) as any;
  }

  const { data, error } = await base.or(`name.ilike.${like},phone_e164.ilike.${like}`);
  if (!error) return (data ?? []) as any;
  const { data: d2, error: e2 } = await supabase
    .from("contacts")
    .select("id,name,phone_e164,last_seen_at")
    .or(`name.ilike.${like},phone_e164.ilike.${like}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (e2) throw e2;
  return (d2 ?? []) as any;
}

async function getOrCreateConversationForContact(contactId: string): Promise<string> {
  const { data: existing, error: e1 } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .limit(1);
  if (e1) throw e1;
  if (existing?.[0]?.id) return String(existing[0].id);

  const { data, error } = await supabase.from("conversations").insert({ contact_id: contactId }).select("id").limit(1);
  if (error) throw error;
  return String(data?.[0]?.id);
}

async function getOrCreateContactByPhone(phoneRaw: string, name?: string): Promise<Contact> {
  const phone = normalizePhoneE164(phoneRaw);
  const { data: rows, error } = await supabase.from("contacts").select("id,name,phone_e164,last_seen_at").eq("phone_e164", phone).limit(1);
  if (error) throw error;
  if (rows?.[0]) return rows[0] as any;
  const { data, error: e2 } = await supabase
    .from("contacts")
    .insert({ phone_e164: phone, name: name?.trim() || null })
    .select("id,name,phone_e164,last_seen_at")
    .limit(1);
  if (e2) throw e2;
  return (data?.[0] as any) as Contact;
}

function useIsMobile() {
  const [m, setM] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return m;
}

function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 top-10 mx-auto w-[92vw] max-w-lg">
        <div className="rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-panel)] shadow-xl">
          <div className="px-4 py-3 border-b border-[var(--wa-border)] bg-[var(--wa-header)] rounded-t-2xl flex items-center justify-between">
            <div className="font-semibold">{title}</div>
            <button
              type="button"
              className="h-9 w-9 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center justify-center"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function InboxPage() {
  useSession();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const selectedId = sp.get("c") || "";

  const [filter, setFilter] = React.useState<InboxFilter>("all");
  const [q, setQ] = React.useState("");
  const [composer, setComposer] = React.useState("");
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  const [newChatOpen, setNewChatOpen] = React.useState(false);
  const [newChatQuery, setNewChatQuery] = React.useState("");
  const [newChatName, setNewChatName] = React.useState("");
  const [newChatPhone, setNewChatPhone] = React.useState("");

  const [noteBody, setNoteBody] = React.useState("");
  const [followupReason, setFollowupReason] = React.useState("");

  const [qrPickerOpen, setQrPickerOpen] = React.useState(false);
  const [qrSearch, setQrSearch] = React.useState("");
  const [tplPickerOpen, setTplPickerOpen] = React.useState(false);
  const [tplVars, setTplVars] = React.useState("");
  const [tplSelected, setTplSelected] = React.useState<{ name: string; language: string } | null>(null);

  const [aiLoading, setAiLoading] = React.useState(false);

  const me = (qc.getQueryData(["me"]) as any) || null;

  const conversationsQ = useQuery({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
    staleTime: 6_000,
    refetchInterval: 15_000,
  });

  const messagesQ = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => fetchMessages(selectedId),
    enabled: Boolean(selectedId),
    staleTime: 5_000,
    refetchInterval: selectedId ? 8_000 : false,
  });

  const followupsQ = useQuery({
    queryKey: ["followups", selectedId],
    queryFn: () => fetchFollowups(selectedId),
    enabled: Boolean(selectedId) && detailsOpen,
    staleTime: 5_000,
  });

  const notesQ = useQuery({
    queryKey: ["notes", selectedId],
    queryFn: () => fetchNotes(selectedId),
    enabled: Boolean(selectedId) && detailsOpen,
    staleTime: 5_000,
  });

  const profilesQ = useQuery({
    queryKey: ["profiles_mini"],
    queryFn: fetchProfiles,
    staleTime: 60_000,
  });

  const tagsQ = useQuery({
    queryKey: ["tags"],
    queryFn: fetchTags,
    staleTime: 60_000,
  });

  const convTagsQ = useQuery({
    queryKey: ["conversation_tags", selectedId],
    queryFn: () => fetchConversationTags(selectedId),
    enabled: Boolean(selectedId),
    staleTime: 15_000,
  });

  const quickRepliesQ = useQuery({
    queryKey: ["quick_replies"],
    queryFn: fetchQuickReplies,
    staleTime: 60_000,
  });

  const templatesQ = useQuery({
    queryKey: ["wa_templates"],
    queryFn: fetchTemplates,
    staleTime: 60_000,
  });

  const visibleConversations = React.useMemo(() => {
    const list = conversationsQ.data ?? [];
    const qn = q.trim().toLowerCase();
    const mineId = me?.id ? String(me.id) : "";
    return list
      .filter((c) => {
        if (filter === "mine" && mineId) return c.assigned_to === mineId;
        if (filter === "unassigned") return !c.assigned_to;
        if (filter === "unread") return (c.unread_count ?? 0) > 0;
        return true;
      })
      .filter((c) => {
        if (!qn) return true;
        const name = (c.contact?.name || "").toLowerCase();
        const phone = (c.contact?.phone_e164 || "").toLowerCase();
        return name.includes(qn) || phone.includes(qn);
      });
  }, [conversationsQ.data, filter, q, me?.id]);

  const selectedConversation = React.useMemo(
    () => (conversationsQ.data ?? []).find((c) => c.id === selectedId) || null,
    [conversationsQ.data, selectedId]
  );

  function patchConversationInCache(convId: string, patch: Partial<Conversation>) {
    qc.setQueryData(["conversations"], (old: any) => {
      const arr = Array.isArray(old) ? [...old] : [];
      const i = arr.findIndex((x: Conversation) => x.id === convId);
      if (i >= 0) arr[i] = { ...arr[i], ...patch };
      return arr;
    });
  }

  const setStageMut = useMutation({
    mutationFn: async (lead_stage: Conversation["lead_stage"]) => {
      if (!selectedId) throw new Error("no_conversation");
      const { error } = await supabase.from("conversations").update({ lead_stage } as any).eq("id", selectedId);
      if (error) throw error;
      return lead_stage;
    },
    onMutate: async (lead_stage) => {
      if (!selectedId) return;
      patchConversationInCache(selectedId, { lead_stage } as any);
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const setSourceMut = useMutation({
    mutationFn: async (lead_source: Conversation["lead_source"]) => {
      if (!selectedId) throw new Error("no_conversation");
      const { error } = await supabase.from("conversations").update({ lead_source } as any).eq("id", selectedId);
      if (error) throw error;
      // mirror on contact when possible
      const contactId = selectedConversation?.contact_id;
      if (contactId) {
        await supabase.from("contacts").update({ lead_source } as any).eq("id", contactId);
      }
      return lead_source;
    },
    onMutate: async (lead_source) => {
      if (!selectedId) return;
      patchConversationInCache(selectedId, { lead_source } as any);
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const setAssigneeMut = useMutation({
    mutationFn: async (assigned_to: string | null) => {
      if (!selectedId) throw new Error("no_conversation");
      const { error } = await supabase.from("conversations").update({ assigned_to } as any).eq("id", selectedId);
      if (error) throw error;
      return assigned_to;
    },
    onMutate: async (assigned_to) => {
      if (!selectedId) return;
      patchConversationInCache(selectedId, { assigned_to } as any);
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const addTagMut = useMutation({
    mutationFn: async (tag_id: string) => {
      if (!selectedId) throw new Error("no_conversation");
      const { error } = await supabase.from("conversation_tags").insert({ conversation_id: selectedId, tag_id } as any);
      if (error) throw error;
      return tag_id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation_tags", selectedId] });
    },
  });

  const removeTagMut = useMutation({
    mutationFn: async (tag_id: string) => {
      if (!selectedId) throw new Error("no_conversation");
      const { error } = await supabase
        .from("conversation_tags")
        .delete()
        .eq("conversation_id", selectedId)
        .eq("tag_id", tag_id);
      if (error) throw error;
      return tag_id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation_tags", selectedId] });
    },
  });

  const aiAnalyzeMut = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("no_conversation");
      setAiLoading(true);
      const res = await apiPost<{ ok: boolean; ai_meta?: any; error?: string }>("/v1/ai/analyze_conversation", { conversation_id: selectedId });
      if (!res.ok) throw new Error(res.error || "ai_failed");
      return res.ai_meta;
    },
    onSuccess: (ai_meta) => {
      if (!selectedId) return;
      patchConversationInCache(selectedId, { ai_meta } as any);
    },
    onSettled: () => setAiLoading(false),
  });

  // Mark as read
  const markReadMut = useMutation({
    mutationFn: async (convId: string) => {
      // DB
      await supabase.from("conversations").update({ unread_count: 0 }).eq("id", convId);
      const contactId = selectedConversation?.contact_id;
      if (contactId) {
        // opcional: puede no existir la columna
        await supabase
          .from("contacts")
          .update({ last_seen_by_agent_at: new Date().toISOString() } as any)
          .eq("id", contactId);
      }
      // cache
      qc.setQueryData(["conversations"], (old: any) => {
        const arr = Array.isArray(old) ? [...old] : [];
        const i = arr.findIndex((x: Conversation) => x.id === convId);
        if (i >= 0) arr[i] = { ...arr[i], unread_count: 0 };
        return arr;
      });
    },
  });

  React.useEffect(() => {
    if (!selectedId) return;
    if (!selectedConversation) return;
    if ((selectedConversation.unread_count ?? 0) <= 0) return;
    markReadMut.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Send message (optimistic)
  const sendMut = useMutation({
    mutationFn: async ({ conversationId, text, clientTempId }: { conversationId: string; text: string; clientTempId: string }) => {
      const res = await apiPost<SendTextResponse>("/v1/messages/send_text", {
        conversation_id: conversationId,
        text,
        client_temp_id: clientTempId,
      });
      if (!res.ok) throw new Error("send_failed");
      return res;
    },
    onMutate: async (vars) => {
      const nowIso = new Date().toISOString();
      const optimistic: Message = {
        id: vars.clientTempId,
        conversation_id: vars.conversationId,
        direction: "out",
        type: "text",
        text_body: vars.text,
        status: "queued",
        wa_message_id: null,
        created_at: nowIso,
      };

      qc.setQueryData(["messages", vars.conversationId], (old: any) => {
        const arr = Array.isArray(old) ? [...old] : [];
        if (!arr.find((m: Message) => m.id === optimistic.id)) arr.push(optimistic);
        return arr;
      });

      qc.setQueryData(["conversations"], (old: any) => {
        const arr = Array.isArray(old) ? [...old] : [];
        const i = arr.findIndex((c: Conversation) => c.id === vars.conversationId);
        if (i >= 0) arr[i] = { ...arr[i], last_message_at: nowIso };
        return arr;
      });
    },
    onSuccess: (res, vars) => {
      const realId = res.message_id || vars.clientTempId;
      const createdAt = res.created_at || new Date().toISOString();
      const nextStatus = (res.status as any) || "sent";

      qc.setQueryData(["messages", vars.conversationId], (old: any) => {
        const arr = Array.isArray(old) ? [...old] : [];
        return arr.map((m: Message) => {
          if (m.id !== vars.clientTempId) return m;
          return {
            ...m,
            id: realId,
            status: nextStatus,
            wa_message_id: res.wa_message_id ?? m.wa_message_id,
            created_at: createdAt,
          };
        });
      });
    },
    onError: (_err, vars) => {
      qc.setQueryData(["messages", vars.conversationId], (old: any) => {
        const arr = Array.isArray(old) ? [...old] : [];
        return arr.map((m: Message) => (m.id === vars.clientTempId ? { ...m, status: "failed" } : m));
      });
    },
  });

  const sendTemplateMut = useMutation({
    mutationFn: async ({ templateName, language, bodyVars }: { templateName: string; language?: string; bodyVars?: string[] }) => {
      if (!selectedId) return;
      const res = await apiPost<any>("/v1/messages/send_template", {
        conversation_id: selectedId,
        template_name: templateName,
        language: language || "es_AR",
        body_vars: bodyVars || [],
      });
      if (!res.ok) throw new Error("template_send_failed");
      return res;
    },
    onError: () => {},
  });

  const suggestReplyMut = useMutation({
    mutationFn: async () => {
      if (!selectedId) return;
      const res = await apiPost<any>("/v1/ai/suggest_reply", { conversation_id: selectedId });
      if (!res.ok) throw new Error("ai_suggest_failed");
      return res;
    },
    onSuccess: (res) => {
      if (res?.text) setComposer(String(res.text));
    },
  });

  function sendCurrent() {
    if (!selectedId) return;
    const text = composer.trim();
    if (!text) return;
    setComposer("");
    const temp = `tmp_${Date.now()}`;
    sendMut.mutate({ conversationId: selectedId, text, clientTempId: temp });
  }

  function retryMessage(m: Message) {
    if (!selectedId) return;
    const text = (m.text_body || "").trim();
    if (!text) return;
    // Reusamos el mismo bubble: lo pasamos a queued y reenviamos
    qc.setQueryData(["messages", selectedId], (old: any) => {
      const arr = Array.isArray(old) ? [...old] : [];
      return arr.map((x: Message) => (x.id === m.id ? { ...x, status: "queued" } : x));
    });
    const temp = `tmp_${Date.now()}`;
    // creamos un nuevo bubble para no pisar el id real; el fallido queda como historial
    sendMut.mutate({ conversationId: selectedId, text, clientTempId: temp });
  }

  function dueFromPreset(preset: "2d" | "7d" | "15d" | "tomorrow10"): string {
    const now = new Date();
    if (preset === "2d") now.setDate(now.getDate() + 2);
    if (preset === "7d") now.setDate(now.getDate() + 7);
    if (preset === "15d") now.setDate(now.getDate() + 15);
    if (preset === "tomorrow10") {
      now.setDate(now.getDate() + 1);
      now.setHours(10, 0, 0, 0);
    }
    return now.toISOString();
  }

  // New chat
  const contactsQ = useQuery({
    queryKey: ["contacts_search", newChatQuery],
    queryFn: () => searchContacts(newChatQuery),
    enabled: newChatOpen,
    staleTime: 4_000,
  });

  const startChatMut = useMutation({
    mutationFn: async ({ contactId }: { contactId: string }) => {
      const convId = await getOrCreateConversationForContact(contactId);
      return convId;
    },
    onSuccess: async (convId) => {
      setNewChatOpen(false);
      setNewChatQuery("");
      setNewChatName("");
      setNewChatPhone("");
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      setSp((prev) => {
        prev.set("c", convId);
        return prev;
      });
    },
  });

  const createAndStartChatMut = useMutation({
    mutationFn: async () => {
      const c = await getOrCreateContactByPhone(newChatPhone, newChatName);
      const convId = await getOrCreateConversationForContact(c.id);
      return convId;
    },
    onSuccess: async (convId) => {
      setNewChatOpen(false);
      setNewChatQuery("");
      setNewChatName("");
      setNewChatPhone("");
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      setSp((prev) => {
        prev.set("c", convId);
        return prev;
      });
    },
  });

  // Notes + followups (kept simple, inside Details panel)
  const addNoteMut = useMutation({
    mutationFn: async () => {
      if (!selectedId) return;
      const body = noteBody.trim();
      if (!body) throw new Error("Escribí una nota");
      const { error } = await supabase.from("notes").insert({ conversation_id: selectedId, body });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNoteBody("");
      await qc.invalidateQueries({ queryKey: ["notes", selectedId] });
    },
  });

  const addFollowupMut = useMutation({
    mutationFn: async (dueIso: string) => {
      if (!selectedId) return;
      const { error } = await supabase.from("followups").insert({ conversation_id: selectedId, due_at: dueIso, reason: followupReason.trim() || null });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["followups", selectedId] });
    },
  });

  const setFollowupStatusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "done" | "canceled" }) => {
      const { error } = await supabase.from("followups").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["followups", selectedId] });
    },
  });

  // Realtime (append/patch, no full invalidate)
  React.useEffect(() => {
    const ch = supabase
      .channel("wa-manager")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: any) => {
          const msg = payload.new as Message & { dealership_id?: string };
          if (!msg?.conversation_id) return;

          // append to cache
          qc.setQueryData(["messages", msg.conversation_id], (old: any) => {
            const arr = Array.isArray(old) ? [...old] : [];
            if (!arr.find((m: Message) => m.id === msg.id)) arr.push(msg as any);
            return arr;
          });

          // patch conversation list
          qc.setQueryData(["conversations"], (old: any) => {
            const arr = Array.isArray(old) ? [...old] : [];
            const i = arr.findIndex((c: Conversation) => c.id === msg.conversation_id);
            if (i >= 0) {
              const current = arr[i] as Conversation;
              const incUnread = msg.direction === "in" && msg.conversation_id !== selectedId;
              arr[i] = {
                ...current,
                last_message_at: msg.created_at,
                unread_count: incUnread ? (current.unread_count ?? 0) + 1 : current.unread_count,
              };
              // move to top
              const [moved] = arr.splice(i, 1);
              arr.unshift(moved);
            }
            return arr;
          });

          // if viewing the conversation, mark as read instantly
          if (msg.direction === "in" && msg.conversation_id === selectedId) {
            markReadMut.mutate(msg.conversation_id);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload: any) => {
          const msg = payload.new as Message;
          if (!msg?.conversation_id) return;
          qc.setQueryData(["messages", msg.conversation_id], (old: any) => {
            const arr = Array.isArray(old) ? [...old] : [];
            return arr.map((m: Message) => (m.id === msg.id ? { ...m, ...msg } : m));
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Layout helpers
  const showChatOnlyOnMobile = isMobile && selectedId;

  return (
    <div className="h-full w-full flex bg-[var(--wa-bg)]">
      {/* LEFT: conversation list */}
      <div
        className={cx(
          "h-full border-r border-[var(--wa-border)] bg-[var(--wa-panel)] flex flex-col",
          showChatOnlyOnMobile ? "hidden" : "w-full md:w-[380px]"
        )}
      >
        <div className="px-3 py-3 bg-[var(--wa-header)] border-b border-[var(--wa-border)]">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Chats</div>
            <button
              type="button"
              className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center justify-center"
              onClick={() => setNewChatOpen(true)}
              aria-label="Nuevo chat"
              title="Nuevo chat"
            >
              <MessageSquarePlus size={20} />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-black/5 dark:bg-white/10 inline-flex items-center justify-center">
              <Search size={18} />
            </div>
            <input
              className="flex-1 bg-transparent outline-none text-sm"
              placeholder="Buscar nombre o teléfono"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="mt-3 flex items-center gap-2 overflow-x-auto">
            {([
              ["all", "Todos"],
              ["mine", "Asignadas"],
              ["unassigned", "Sin asignar"],
              ["unread", "No leídas"],
            ] as Array<[InboxFilter, string]>).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cx(
                  "whitespace-nowrap rounded-full px-3 py-1 text-xs border",
                  filter === k
                    ? "bg-[var(--wa-accent)] text-white border-[var(--wa-accent)]"
                    : "bg-transparent border-[var(--wa-border)] text-[var(--wa-text)]/90 hover:bg-black/5 dark:hover:bg-white/5"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {conversationsQ.isLoading ? (
            <div className="p-4 text-sm text-[var(--wa-subtext)]">Cargando…</div>
          ) : null}

          {visibleConversations.map((c) => {
            const active = c.id === selectedId;
            const name = c.contact?.name || "Sin nombre";
            const phone = c.contact?.phone_e164 || "";
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSp((prev) => {
                    prev.set("c", c.id);
                    return prev;
                  });
                }}
                className={cx(
                  "w-full text-left px-3 py-3 border-b border-[var(--wa-border)] hover:bg-black/5 dark:hover:bg-white/5",
                  active && "bg-black/5 dark:bg-white/5"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-full bg-black/5 dark:bg-white/10 inline-flex items-center justify-center shrink-0">
                    <User size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium truncate">{name}</div>
                      {(c.unread_count ?? 0) > 0 ? (
                        <div className="h-5 min-w-[20px] px-2 rounded-full bg-[var(--wa-accent)] text-white text-xs inline-flex items-center justify-center">
                          {c.unread_count}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--wa-subtext)] truncate">{phone}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px]", stageBadgeClass((c as any).lead_stage))}>
                        {STAGE_LABEL[(c as any).lead_stage || "new"] || "Nuevo"}
                      </span>
                      {(c as any).lead_source ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] bg-black/5 dark:bg-white/10 text-[var(--wa-text)]/80">
                          {SOURCE_LABEL[String((c as any).lead_source)] || String((c as any).lead_source)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {!conversationsQ.isLoading && visibleConversations.length === 0 ? (
            <div className="p-4 text-sm text-[var(--wa-subtext)]">No hay conversaciones para mostrar.</div>
          ) : null}
        </div>
      </div>

      {/* RIGHT: chat */}
      <div className={cx("flex-1 min-w-0 h-full flex flex-col", !selectedId && "bg-[var(--wa-chat-bg)]")}> 
        {/* Header */}
        <div className="h-14 shrink-0 bg-[var(--wa-header)] border-b border-[var(--wa-border)] flex items-center justify-between px-3">
          <div className="flex items-center gap-2 min-w-0">
            {isMobile && selectedId ? (
              <button
                type="button"
                className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center justify-center"
                onClick={() => {
                  setSp((prev) => {
                    prev.delete("c");
                    return prev;
                  });
                }}
                aria-label="Volver"
              >
                <ChevronLeft size={20} />
              </button>
            ) : null}

            {selectedConversation ? (
              <>
                <div className="h-10 w-10 rounded-full bg-black/5 dark:bg-white/10 inline-flex items-center justify-center shrink-0">
                  <User size={18} />
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">{selectedConversation.contact?.name || "Sin nombre"}</div>
                  <div className="text-xs text-[var(--wa-subtext)] truncate inline-flex items-center gap-1">
                    <Phone size={13} /> {selectedConversation.contact?.phone_e164}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-[var(--wa-subtext)]">Seleccioná un chat</div>
            )}
          </div>

          {selectedId ? (
            <button
              type="button"
              className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center justify-center"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-label="Detalles"
              title="Detalles"
            >
              <Info size={20} />
            </button>
          ) : null}
        </div>

        {/* Body */}
        {selectedId ? (
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 flex flex-col bg-[var(--wa-chat-bg)]">
              <div className="flex-1 overflow-auto p-3 md:p-4">
                {(messagesQ.data ?? []).map((m) => {
                  const isOut = m.direction === "out";
                  const bubbleClass = isOut ? "bg-[var(--wa-bubble-out)] text-[var(--wa-bubble-out-text)]" : "bg-[var(--wa-bubble-in)] text-[var(--wa-bubble-in-text)]";
                  return (
                    <div key={m.id} className={cx("mb-2 flex", isOut ? "justify-end" : "justify-start")}>
                      <div className={cx("max-w-[82%] rounded-2xl px-3 py-2 shadow-sm", bubbleClass)}>
                        <div className="text-sm whitespace-pre-wrap break-words">{m.text_body}</div>
                        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[var(--wa-subtext)]">
                          {m.status === "queued" ? <span>Enviando…</span> : null}
                          {m.status === "failed" ? (
                            <button
                              type="button"
                              className="text-red-600 hover:underline"
                              onClick={() => retryMessage(m)}
                            >
                              Reintentar
                            </button>
                          ) : null}
                          <StatusTicks status={m.status} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {messagesQ.isLoading ? <div className="text-sm text-[var(--wa-subtext)]">Cargando mensajes…</div> : null}
              </div>

              {/* Composer */}
              <div className="shrink-0 border-t border-[var(--wa-border)] bg-[var(--wa-header)] p-2">
                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-1 pb-1">
                    <button
                      type="button"
                      className="h-11 w-11 rounded-2xl hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center justify-center"
                      onClick={() => setQrPickerOpen(true)}
                      aria-label="Respuestas rápidas"
                      title="Respuestas rápidas"
                    >
                      <Bookmark size={18} />
                    </button>
                    <button
                      type="button"
                      className="h-11 w-11 rounded-2xl hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center justify-center"
                      onClick={() => setTplPickerOpen(true)}
                      aria-label="Plantillas"
                      title="Plantillas"
                    >
                      <FileText size={18} />
                    </button>
                    <button
                      type="button"
                      className="h-11 w-11 rounded-2xl hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center justify-center disabled:opacity-60"
                      onClick={() => suggestReplyMut.mutate()}
                      disabled={!selectedId || suggestReplyMut.isPending}
                      aria-label="Sugerir respuesta con IA"
                      title="Sugerir respuesta con IA"
                    >
                      {suggestReplyMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                    </button>
                  </div>
                  <textarea
                    className="flex-1 resize-none rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-panel)] px-3 py-2 text-sm outline-none min-h-[42px] max-h-32"
                    placeholder="Escribí un mensaje"
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendCurrent();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={sendCurrent}
                    className="h-11 w-11 rounded-2xl bg-[var(--wa-accent)] text-white inline-flex items-center justify-center hover:opacity-95 disabled:opacity-60"
                    disabled={!composer.trim() || sendMut.isPending}
                    aria-label="Enviar"
                    title="Enviar"
                  >
                    {sendMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  </button>
                </div>
                {sendMut.isError ? (
                  <div className="mt-2 text-sm text-red-600">{friendlyError(sendMut.error)}</div>
                ) : null}
              </div>
            </div>

            {/* Details panel */}
            {detailsOpen ? (
              <div className="hidden lg:flex w-[360px] border-l border-[var(--wa-border)] bg-[var(--wa-panel)] flex-col">
                <div className="px-3 py-3 bg-[var(--wa-header)] border-b border-[var(--wa-border)] flex items-center justify-between">
                  <div className="font-semibold text-sm">Detalles</div>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center justify-center"
                    onClick={() => setDetailsOpen(false)}
                    aria-label="Cerrar"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="p-3 flex flex-col gap-4 overflow-auto">
                  {/* Lead / Pipeline */}
                  <div className="rounded-2xl border border-[var(--wa-border)] overflow-hidden">
                    <div className="px-3 py-2 bg-[var(--wa-header)] text-sm font-semibold">Lead</div>
                    <div className="p-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-xs text-[var(--wa-subtext)] mb-1">Pipeline</div>
                          <select
                            className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
                            value={(selectedConversation as any)?.lead_stage || "new"}
                            onChange={(e) => setStageMut.mutate(e.target.value as any)}
                          >
                            {Object.keys(STAGE_LABEL).map((k) => (
                              <option key={k} value={k}>
                                {STAGE_LABEL[k]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--wa-subtext)] mb-1">Fuente</div>
                          <select
                            className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
                            value={(selectedConversation as any)?.lead_source || ""}
                            onChange={(e) => setSourceMut.mutate((e.target.value || null) as any)}
                          >
                            <option value="">—</option>
                            {Object.keys(SOURCE_LABEL).map((k) => (
                              <option key={k} value={k}>
                                {SOURCE_LABEL[k]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-[var(--wa-subtext)] mb-1">Asignado a</div>
                        <div className="flex items-center gap-2">
                          <select
                            className="flex-1 rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
                            value={(selectedConversation?.assigned_to || "") as any}
                            onChange={(e) => setAssigneeMut.mutate(e.target.value || null)}
                          >
                            <option value="">Sin asignar</option>
                            {(profilesQ.data ?? []).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.full_name || p.id.slice(0, 8)}
                              </option>
                            ))}
                          </select>
                          {!selectedConversation?.assigned_to && me?.id ? (
                            <button
                              type="button"
                              className="rounded-xl bg-[var(--wa-accent)] text-white px-3 py-2 text-sm font-semibold hover:opacity-95"
                              onClick={() => setAssigneeMut.mutate(String(me.id))}
                            >
                              Asignarme
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--wa-subtext)]">
                          Tip: los chats nuevos se auto-asignan de forma automática (por teléfono) cuando entran.
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-[var(--wa-subtext)] mb-1">Tags</div>
                        <div className="flex flex-wrap gap-2">
                          {(convTagsQ.data ?? []).map((ct) => (
                            <button
                              key={ct.tag_id}
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/10 px-3 py-1 text-xs"
                              onClick={() => removeTagMut.mutate(ct.tag_id)}
                              title="Quitar"
                            >
                              <span>{ct.tag?.name || "Tag"}</span>
                              <X size={14} />
                            </button>
                          ))}
                          {((convTagsQ.data ?? []).length === 0) ? (
                            <div className="text-sm text-[var(--wa-subtext)]">Sin tags.</div>
                          ) : null}
                        </div>
                        <div className="mt-2">
                          <select
                            className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
                            value=""
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v) return;
                              const already = (convTagsQ.data ?? []).some((x) => x.tag_id === v);
                              if (!already) addTagMut.mutate(v);
                            }}
                          >
                            <option value="">Agregar tag…</option>
                            {(tagsQ.data ?? []).filter((t) => !(convTagsQ.data ?? []).some((x) => x.tag_id === t.id)).map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AI */}
                  <div className="rounded-2xl border border-[var(--wa-border)] overflow-hidden">
                    <div className="px-3 py-2 bg-[var(--wa-header)] text-sm font-semibold flex items-center justify-between">
                      <span>IA</span>
                      <button
                        type="button"
                        className="rounded-xl bg-[var(--wa-accent)] text-white px-3 py-1.5 text-xs font-semibold hover:opacity-95 disabled:opacity-60"
                        onClick={() => aiAnalyzeMut.mutate()}
                        disabled={aiLoading || aiAnalyzeMut.isPending}
                      >
                        {aiLoading ? "Analizando…" : "Analizar"}
                      </button>
                    </div>
                    <div className="p-3 space-y-3">
                      {selectedConversation?.ai_meta?.summary ? (
                        <div>
                          <div className="text-xs text-[var(--wa-subtext)] mb-1">Resumen</div>
                          <div className="text-sm whitespace-pre-wrap">{String(selectedConversation.ai_meta.summary)}</div>
                        </div>
                      ) : (
                        <div className="text-sm text-[var(--wa-subtext)]">Pedile a la IA un resumen, intención, objeciones y próximos pasos.</div>
                      )}

                      {selectedConversation?.ai_meta?.intent ? (
                        <div>
                          <div className="text-xs text-[var(--wa-subtext)] mb-1">Intención</div>
                          <div className="text-sm">{String(selectedConversation.ai_meta.intent)}</div>
                        </div>
                      ) : null}

                      {(selectedConversation?.ai_meta?.objections || []).length ? (
                        <div>
                          <div className="text-xs text-[var(--wa-subtext)] mb-1">Objeciones</div>
                          <div className="flex flex-wrap gap-2">
                            {(selectedConversation.ai_meta.objections as any[]).slice(0, 6).map((o, i) => (
                              <span key={i} className="inline-flex items-center rounded-full bg-black/5 dark:bg-white/10 px-3 py-1 text-xs">
                                {String(o)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {(selectedConversation?.ai_meta?.next_steps || []).length ? (
                        <div>
                          <div className="text-xs text-[var(--wa-subtext)] mb-1">Próximos pasos</div>
                          <ul className="list-disc pl-5 text-sm space-y-1">
                            {(selectedConversation.ai_meta.next_steps as any[]).slice(0, 6).map((s, i) => (
                              <li key={i}>{String(s)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {selectedConversation?.ai_meta?.recommended_stage ? (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--wa-border)] px-3 py-2">
                          <div className="text-sm">
                            Recomendado: <span className="font-semibold">{STAGE_LABEL[String(selectedConversation.ai_meta.recommended_stage)] || String(selectedConversation.ai_meta.recommended_stage)}</span>
                          </div>
                          <button
                            type="button"
                            className="rounded-xl bg-[var(--wa-accent)] text-white px-3 py-1.5 text-xs font-semibold hover:opacity-95"
                            onClick={() => setStageMut.mutate(String(selectedConversation.ai_meta.recommended_stage) as any)}
                          >
                            Aplicar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Followups */}
                  <div className="rounded-2xl border border-[var(--wa-border)] overflow-hidden">
                    <div className="px-3 py-2 bg-[var(--wa-header)] text-sm font-semibold">Seguimiento</div>
                    <div className="p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {([
                          ["2d", "+2 días"],
                          ["7d", "+7 días"],
                          ["15d", "+15 días"],
                          ["tomorrow10", "Mañana 10:00"],
                        ] as Array<["2d" | "7d" | "15d" | "tomorrow10", string]>).map(([k, label]) => (
                          <button
                            key={k}
                            type="button"
                            className="rounded-full border border-[var(--wa-border)] px-3 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5"
                            onClick={() => addFollowupMut.mutate(dueFromPreset(k))}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <input
                        className="mt-2 w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
                        placeholder="Motivo (opcional)"
                        value={followupReason}
                        onChange={(e) => setFollowupReason(e.target.value)}
                      />

                      <div className="mt-3 space-y-2">
                        {(followupsQ.data ?? []).filter((f) => f.status === "pending").map((f) => (
                          <div key={f.id} className="rounded-xl border border-[var(--wa-border)] px-3 py-2">
                            <div className="text-sm font-medium">
                              {formatDistanceToNowStrict(new Date(f.due_at), { addSuffix: true })}
                            </div>
                            {f.reason ? <div className="text-xs text-[var(--wa-subtext)] mt-0.5">{f.reason}</div> : null}
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded-full bg-[var(--wa-accent)] text-white px-3 py-1 text-xs hover:opacity-95"
                                onClick={() => setFollowupStatusMut.mutate({ id: f.id, status: "done" })}
                              >
                                Hecho
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-[var(--wa-border)] px-3 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5"
                                onClick={() => setFollowupStatusMut.mutate({ id: f.id, status: "canceled" })}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ))}
                        {followupsQ.isLoading ? <div className="text-sm text-[var(--wa-subtext)]">Cargando…</div> : null}
                        {!followupsQ.isLoading && (followupsQ.data ?? []).filter((f) => f.status === "pending").length === 0 ? (
                          <div className="text-sm text-[var(--wa-subtext)]">Sin recordatorios pendientes.</div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="rounded-2xl border border-[var(--wa-border)] overflow-hidden">
                    <div className="px-3 py-2 bg-[var(--wa-header)] text-sm font-semibold">Notas</div>
                    <div className="p-3">
                      <textarea
                        className="w-full resize-none rounded-2xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none min-h-[80px]"
                        placeholder="Anotá datos del cliente, permuta, presupuesto, etc."
                        value={noteBody}
                        onChange={(e) => setNoteBody(e.target.value)}
                      />
                      <button
                        type="button"
                        className="mt-2 w-full rounded-xl bg-[var(--wa-accent)] text-white px-4 py-2 text-sm font-semibold hover:opacity-95 disabled:opacity-60"
                        onClick={() => addNoteMut.mutate()}
                        disabled={addNoteMut.isPending}
                      >
                        Guardar nota
                      </button>
                      {addNoteMut.isError ? <div className="mt-2 text-sm text-red-600">{friendlyError(addNoteMut.error)}</div> : null}

                      <div className="mt-3 space-y-2">
                        {(notesQ.data ?? []).slice(0, 10).map((n) => (
                          <div key={n.id} className="rounded-xl border border-[var(--wa-border)] px-3 py-2">
                            <div className="text-sm whitespace-pre-wrap break-words">{n.body}</div>
                            <div className="mt-1 text-xs text-[var(--wa-subtext)]">{formatDistanceToNowStrict(new Date(n.created_at), { addSuffix: true })}</div>
                          </div>
                        ))}
                        {notesQ.isLoading ? <div className="text-sm text-[var(--wa-subtext)]">Cargando…</div> : null}
                        {!notesQ.isLoading && (notesQ.data ?? []).length === 0 ? (
                          <div className="text-sm text-[var(--wa-subtext)]">No hay notas.</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--wa-subtext)]">
            Elegí un chat o creá uno nuevo.
          </div>
        )}
      </div>

      {/* New chat dialog */}
      <Dialog open={newChatOpen} title="Nuevo chat" onClose={() => setNewChatOpen(false)}>
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-xs text-[var(--wa-subtext)] mb-1">Buscar contacto</div>
            <input
              className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
              placeholder="Nombre o teléfono"
              value={newChatQuery}
              onChange={(e) => setNewChatQuery(e.target.value)}
            />
          </div>

          <div className="rounded-2xl border border-[var(--wa-border)] overflow-hidden">
            <div className="px-3 py-2 bg-[var(--wa-header)] text-xs font-semibold">Resultados</div>
            <div className="max-h-56 overflow-auto">
              {(contactsQ.data ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full text-left px-3 py-3 border-t border-[var(--wa-border)] hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => startChatMut.mutate({ contactId: c.id })}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-black/5 dark:bg-white/10 inline-flex items-center justify-center">
                      <User size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.name || "Sin nombre"}</div>
                      <div className="text-xs text-[var(--wa-subtext)] truncate">{c.phone_e164}</div>
                    </div>
                  </div>
                </button>
              ))}
              {contactsQ.isLoading ? <div className="p-3 text-sm text-[var(--wa-subtext)]">Buscando…</div> : null}
              {!contactsQ.isLoading && (contactsQ.data ?? []).length === 0 ? (
                <div className="p-3 text-sm text-[var(--wa-subtext)]">Sin resultados.</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--wa-border)] p-3">
            <div className="text-xs font-semibold mb-2">Crear contacto y abrir chat</div>
            <div className="grid grid-cols-1 gap-2">
              <input
                className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
                placeholder="Nombre (opcional)"
                value={newChatName}
                onChange={(e) => setNewChatName(e.target.value)}
              />
              <input
                className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
                placeholder="Teléfono (ej: +549...)"
                value={newChatPhone}
                onChange={(e) => setNewChatPhone(e.target.value)}
              />
              <button
                type="button"
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--wa-accent)] text-white px-4 py-2 text-sm font-semibold hover:opacity-95 disabled:opacity-60"
                disabled={!newChatPhone.trim() || createAndStartChatMut.isPending}
                onClick={() => createAndStartChatMut.mutate()}
              >
                {createAndStartChatMut.isPending ? <Loader2 size={18} className="animate-spin" /> : <MessageSquarePlus size={18} />}
                Abrir chat
              </button>
            </div>
            {createAndStartChatMut.isError ? (
              <div className="mt-2 text-sm text-red-600">{friendlyError(createAndStartChatMut.error)}</div>
            ) : null}
          </div>
        </div>
      </Dialog>

      {/* Quick replies */}
      <Dialog
        open={qrPickerOpen}
        title="Respuestas rápidas"
        onClose={() => {
          setQrPickerOpen(false);
          setQrSearch("");
        }}
      >
        <div className="flex flex-col gap-3">
          <input
            className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
            placeholder="Buscar…"
            value={qrSearch}
            onChange={(e) => setQrSearch(e.target.value)}
          />
          <div className="max-h-72 overflow-auto rounded-2xl border border-[var(--wa-border)]">
            {(quickRepliesQ.data ?? [])
              .filter((r) => {
                const s = qrSearch.trim().toLowerCase();
                if (!s) return true;
                return `${r.title} ${r.body}`.toLowerCase().includes(s);
              })
              .map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="w-full text-left px-3 py-3 border-t border-[var(--wa-border)] hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => {
                    setComposer((prev) => (prev ? prev + "\n" : "") + r.body);
                    setQrPickerOpen(false);
                    setQrSearch("");
                  }}
                >
                  <div className="font-semibold text-sm">{r.title}</div>
                  <div className="mt-1 text-xs text-[var(--wa-subtext)] whitespace-pre-wrap break-words">{r.body}</div>
                </button>
              ))}
            {(quickRepliesQ.data ?? []).length === 0 ? (
              <div className="p-3 text-sm text-[var(--wa-subtext)]">No tenés respuestas rápidas. Crealas en Ajustes.</div>
            ) : null}
          </div>
        </div>
      </Dialog>

      {/* Templates */}
      <Dialog
        open={tplPickerOpen}
        title="Plantillas de WhatsApp"
        onClose={() => {
          setTplPickerOpen(false);
          setTplSelected(null);
          setTplVars("");
        }}
      >
        {!tplSelected ? (
          <div className="max-h-80 overflow-auto rounded-2xl border border-[var(--wa-border)]">
            {(templatesQ.data ?? []).map((t) => (
              <button
                key={t.name}
                type="button"
                className="w-full text-left px-3 py-3 border-t border-[var(--wa-border)] hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => setTplSelected({ name: t.name, language: t.language || "es_AR" })}
              >
                <div className="font-semibold text-sm">{t.name}</div>
                <div className="mt-1 text-xs text-[var(--wa-subtext)]">{t.language || "es_AR"}</div>
              </button>
            ))}
            {(templatesQ.data ?? []).length === 0 ? (
              <div className="p-3 text-sm text-[var(--wa-subtext)]">No hay plantillas cargadas. Importalas en Ajustes.</div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-[var(--wa-border)] p-3">
              <div className="text-sm font-semibold">{tplSelected.name}</div>
              <div className="text-xs text-[var(--wa-subtext)] mt-0.5">Idioma: {tplSelected.language}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--wa-subtext)] mb-1">Variables (separadas por coma, opcional)</div>
              <input
                className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
                placeholder='Ej: "Felipe", "Vento 2015"'
                value={tplVars}
                onChange={(e) => setTplVars(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-[var(--wa-border)] px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => setTplSelected(null)}
              >
                Volver
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-[var(--wa-accent)] text-white px-4 py-2 text-sm font-semibold hover:opacity-95 disabled:opacity-60"
                disabled={sendTemplateMut.isPending}
                onClick={async () => {
                  const vars = tplVars
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((s) => s.replace(/^"|"$/g, ""));
                  await sendTemplateMut.mutateAsync({ templateName: tplSelected.name, language: tplSelected.language, bodyVars: vars });
                  setTplPickerOpen(false);
                  setTplSelected(null);
                  setTplVars("");
                }}
              >
                {sendTemplateMut.isPending ? "Enviando…" : "Enviar"}
              </button>
            </div>
            {sendTemplateMut.isError ? <div className="text-sm text-red-600">{friendlyError(sendTemplateMut.error)}</div> : null}
          </div>
        )}
      </Dialog>
    </div>
  );
}
