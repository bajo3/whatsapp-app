import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Save, Trash2, User } from "lucide-react";

import { supabase } from "../lib/supabase";
import type { Contact } from "../lib/types";

async function fetchContacts(q: string): Promise<Contact[]> {
  const base = supabase
    .from("contacts")
    .select("id,name,phone_e164,last_seen_at,last_seen_by_agent_at")
    .order("created_at", { ascending: false })
    .limit(400);

  if (!q.trim()) {
    const { data, error } = await base;
    if (error) {
      // compat: si no existe last_seen_by_agent_at
      const { data: d2, error: e2 } = await supabase
        .from("contacts")
        .select("id,name,phone_e164,last_seen_at")
        .order("created_at", { ascending: false })
        .limit(400);
      if (e2) throw e2;
      return (d2 ?? []) as any;
    }
    return (data ?? []) as any;
  }

  // búsqueda por nombre o teléfono
  const like = `%${q.trim()}%`;
  const { data, error } = await base.or(`name.ilike.${like},phone_e164.ilike.${like}`);
  if (!error) return (data ?? []) as any;

  // compat fallback
  const { data: d2, error: e2 } = await supabase
    .from("contacts")
    .select("id,name,phone_e164,last_seen_at")
    .or(`name.ilike.${like},phone_e164.ilike.${like}`)
    .order("created_at", { ascending: false })
    .limit(400);
  if (e2) throw e2;
  return (d2 ?? []) as any;
}

function normalizePhoneE164(raw: string): string {
  const s = raw.replace(/\s+/g, "").replace(/\-/g, "");
  if (s.startsWith("+")) return s;
  // Si el usuario carga 2494..., asumimos AR +54
  if (/^\d{6,}$/.test(s)) return `+54${s}`;
  return s;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-panel)] shadow-sm">{children}</div>;
}

function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 top-10 mx-auto w-[92vw] max-w-lg">
        <div className="rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-panel)] shadow-xl">
          <div className="px-4 py-3 border-b border-[var(--wa-border)] bg-[var(--wa-header)] rounded-t-2xl">
            <div className="font-semibold">{title}</div>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function ContactsPage() {
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Contact | null>(null);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");

  const contactsQ = useQuery({ queryKey: ["contacts", q], queryFn: () => fetchContacts(q), staleTime: 8_000 });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim() || null, phone_e164: normalizePhoneE164(phone.trim()) };
      if (!payload.phone_e164) throw new Error("Ingresá un teléfono");

      if (editing) {
        const { error } = await supabase.from("contacts").update(payload).eq("id", editing.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("contacts").insert(payload);
      if (error) throw error;
    },
    onSuccess: async () => {
      setOpen(false);
      setEditing(null);
      setName("");
      setPhone("");
      await qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });

  function openNew() {
    setEditing(null);
    setName("");
    setPhone("");
    setOpen(true);
  }

  function openEdit(c: Contact) {
    setEditing(c);
    setName(c.name ?? "");
    setPhone(c.phone_e164);
    setOpen(true);
  }

  return (
    <div className="h-full w-full p-4 md:p-6 bg-[var(--wa-bg)]">
      <div className="mx-auto max-w-5xl flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">Clientes</div>
            <div className="text-sm text-[var(--wa-subtext)]">Agenda de contactos (nombre + WhatsApp)</div>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--wa-accent)] text-white px-4 py-2 text-sm font-semibold hover:opacity-95"
          >
            <Plus size={18} />
            Agregar
          </button>
        </div>

        <Card>
          <div className="p-3 border-b border-[var(--wa-border)] bg-[var(--wa-header)] rounded-t-2xl">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-black/5 dark:bg-white/10 inline-flex items-center justify-center">
                <Search size={18} />
              </div>
              <input
                className="flex-1 bg-transparent outline-none text-sm"
                placeholder="Buscar por nombre o teléfono"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          <div className="divide-y divide-[var(--wa-border)]">
            {(contactsQ.data ?? []).map((c) => (
              <div key={c.id} className="p-3 flex items-center justify-between gap-3">
                <button type="button" className="min-w-0 text-left" onClick={() => openEdit(c)}>
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

                <button
                  type="button"
                  className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center justify-center"
                  onClick={() => delMut.mutate(c.id)}
                  aria-label="Eliminar"
                  title="Eliminar"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            {contactsQ.isLoading ? <div className="p-4 text-sm text-[var(--wa-subtext)]">Cargando…</div> : null}
            {!contactsQ.isLoading && (contactsQ.data ?? []).length === 0 ? (
              <div className="p-4 text-sm text-[var(--wa-subtext)]">No hay contactos.</div>
            ) : null}
          </div>
        </Card>
      </div>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        title={editing ? "Editar contacto" : "Nuevo contacto"}
      >
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-xs text-[var(--wa-subtext)] mb-1">Nombre</div>
            <input
              className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Juan Pérez"
            />
          </div>
          <div>
            <div className="text-xs text-[var(--wa-subtext)] mb-1">Teléfono (WhatsApp)</div>
            <input
              className="w-full rounded-xl border border-[var(--wa-border)] bg-transparent px-3 py-2 text-sm outline-none"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: +5492494621182"
            />
            <div className="mt-1 text-xs text-[var(--wa-subtext)]">Tip: si escribís 2494… se asume +54</div>
          </div>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--wa-accent)] text-white px-4 py-2 text-sm font-semibold hover:opacity-95 disabled:opacity-60"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
          >
            <Save size={18} />
            Guardar
          </button>
          {saveMut.isError ? (
            <div className="text-sm text-red-600">{String((saveMut.error as any)?.message || "Error")}</div>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
