export type ConversationStatus = "open" | "snoozed" | "closed";
export type MessageDirection = "in" | "out";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export type Contact = {
  id: string;
  name: string | null;
  phone_e164: string;
  last_seen_at: string | null;
  last_seen_by_agent_at?: string | null;
  email?: string | null;
  doc_id?: string | null;
  address?: string | null;
  notes?: string | null;
  lead_source?: "ig" | "ml" | "referral" | "web" | "walkin" | "other" | null;
};

export type Conversation = {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_to: string | null;
  lead_stage?: "new" | "contacted" | "visited" | "reserved" | "sold" | "lost";
  lead_source?: "ig" | "ml" | "referral" | "web" | "walkin" | "other" | null;
  ai_meta?: any;
  last_message_at: string | null;
  unread_count: number;
  contact?: Contact;
};

export type Message = {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  type: string;
  text_body: string | null;
  status: MessageStatus;
  wa_message_id: string | null;
  created_at: string;
};

export type ProfileMini = {
  id: string;
  full_name: string | null;
  role: "admin" | "manager" | "seller";
};

export type Tag = {
  id: string;
  name: string;
};

export type Followup = {
  id: string;
  conversation_id: string;
  due_at: string;
  status: "pending" | "done" | "canceled";
  reason: string | null;
};
