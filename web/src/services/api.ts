import type {
  Agent,
  Analytics,
  CampaignState,
  CampaignSummary,
  Contact,
  ContactDetail,
  HumanTransfer,
  SessionToken,
  TestSessionDetail,
  TestSessionRow,
  Workflow,
} from "@/types";

// In dev (vite), talk to the Python server directly (CORS is open there).
// In the built app, server.py serves us from the same origin, so base is "".
const API_BASE = import.meta.env.DEV ? "http://localhost:8000" : "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = (data as { detail?: string } | null)?.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data as T;
}

// POST /call response — the test_session_id we poll on for live phone transcript.
export interface PhoneCallResponse {
  mode: string;
  phone: string;
  ccid: string;
  test_session_id: string;
}

export const api = {
  // ---- single calls ----
  connectBrowser: (agent: string) =>
    req<SessionToken>("/connect", { method: "POST", body: JSON.stringify({ agent }) }),
  callPhone: (phone: string, agent: string) =>
    req<PhoneCallResponse>("/call", { method: "POST", body: JSON.stringify({ phone, agent }) }),

  // ---- agents ----
  listAgents: () => req<{ agents: Agent[] }>("/agents"),
  getAgent: (workflow: string) => req<Agent>(`/agents/${encodeURIComponent(workflow)}`),
  saveAgent: (cfg: Agent) =>
    req<{ ok: boolean; workflow_name: string }>("/agents", { method: "POST", body: JSON.stringify(cfg) }),
  deleteAgent: (workflow: string) =>
    req<{ ok: boolean }>(`/agents/${encodeURIComponent(workflow)}`, { method: "DELETE" }),
  // Create Agent with AI — returns a draft to review; saving still goes through saveAgent.
  generateAgent: (body: {
    knowledge: string;
    workflow_name: string;
    agent_name: string;
    tone: string[];
    avoid: string;
    success: string;
    constraints: string;
  }) =>
    req<{ agent: Agent; missing: string[] }>("/agents/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ---- contacts ----
  uploadContacts: (csv: string, tags: string[]) =>
    req<{ added: number; updated: number; invalid: string[]; total: number }>("/contacts/upload", {
      method: "POST",
      body: JSON.stringify({ csv, tags }),
    }),
  listContacts: () => req<{ contacts: Contact[] }>("/contacts"),
  contactTags: () => req<{ tags: string[] }>("/contacts/tags"),
  createContact: (name: string, phone: string, tags: string[]) =>
    req<Contact>("/contacts", { method: "POST", body: JSON.stringify({ name, phone, tags }) }),
  updateContact: (id: string, name: string, phone: string, tags: string[]) =>
    req<Contact>(`/contacts/${id}`, { method: "PUT", body: JSON.stringify({ name, phone, tags }) }),
  deleteContact: (id: string) => req<{ ok: boolean }>(`/contacts/${id}`, { method: "DELETE" }),

  // ---- workflows ----
  listWorkflows: () => req<{ workflows: Workflow[] }>("/workflows"),
  getWorkflow: (name: string) => req<Workflow>(`/workflows/${encodeURIComponent(name)}`),
  saveWorkflow: (wf: Workflow) =>
    req<{ ok: boolean; name: string }>("/workflows", { method: "POST", body: JSON.stringify(wf) }),
  deleteWorkflow: (name: string) =>
    req<{ ok: boolean }>(`/workflows/${encodeURIComponent(name)}`, { method: "DELETE" }),

  // ---- campaign ----
  listCampaigns: () => req<{ campaigns: CampaignSummary[] }>("/campaigns"),
  createCampaign: (name: string, workflow: string, contact_ids: string[]) =>
    req<{ campaign_id: string; count: number; campaign_name: string; workflow: string }>("/campaign/create", {
      method: "POST",
      body: JSON.stringify({ name, workflow, contact_ids }),
    }),
  startCampaign: (campaignId: string) =>
    req<{ ok: boolean }>("/campaign/start", {
      method: "POST",
      body: JSON.stringify({ campaign_id: campaignId }),
    }),
  pauseCampaign: (campaignId: string) =>
    req<{ ok: boolean }>("/campaign/pause", {
      method: "POST",
      body: JSON.stringify({ campaign_id: campaignId }),
    }),
  resumeCampaign: (campaignId: string) =>
    req<{ ok: boolean }>("/campaign/resume", {
      method: "POST",
      body: JSON.stringify({ campaign_id: campaignId }),
    }),
  stopCampaign: (campaignId: string) =>
    req<{ ok: boolean }>("/campaign/stop", {
      method: "POST",
      body: JSON.stringify({ campaign_id: campaignId }),
    }),
  resetCampaign: (campaignId?: string) =>
    req<{ ok: boolean }>(`/campaign/reset${campaignId ? `?campaign_id=${encodeURIComponent(campaignId)}` : ""}`, { method: "POST" }),
  deleteCampaign: (campaignId: string) =>
    req<{ ok: boolean }>(`/campaigns/${encodeURIComponent(campaignId)}`, { method: "DELETE" }),
  campaignState: (campaignId?: string) =>
    req<CampaignState>(`/campaign/state${campaignId ? `?campaign_id=${encodeURIComponent(campaignId)}` : ""}`),
  campaignContact: (campaignContactId: string) =>
    req<ContactDetail>(`/campaign/contact/${encodeURIComponent(campaignContactId)}`),

  // ---- analytics / human transfers ----
  analytics: () => req<Analytics>("/analytics"),
  humanTransfers: () => req<{ transfers: HumanTransfer[] }>("/human-transfers"),

  // ---- test sessions ----
  listTestSessions: () => req<{ sessions: TestSessionRow[] }>("/test/sessions"),
  testSession: (id: string) =>
    req<TestSessionDetail>(`/test/session/${encodeURIComponent(id)}`),
  deleteTestSession: (id: string) =>
    req<{ ok: boolean }>(`/test/session/${encodeURIComponent(id)}`, { method: "DELETE" }),
};