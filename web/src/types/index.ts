// Types mirror the payloads from server.py exactly. Keep in sync if the backend changes.

export interface Contact {
  id: string;
  name: string;
  phone: string;
  tags: string[];
}

export interface DataField {
  name: string;
  example: string;
}

export interface CallerPersona {
  name: string;
  description: string;
}

export interface ObjectionRule {
  objection: string;
  response: string;
}

export interface Agent {
  // Basic information
  workflow_name: string;
  agent_name: string;
  agent_role: string;
  // Instructions
  instruction_prompt: string;
  negative_instructions: string;
  // Personality
  persona: string;
  tone: string[];
  communication_style: string;
  // Conversation setup
  greeting: string;
  sign_off: string;
  conversation_flow: string;
  // Business knowledge
  knowledge_context: string;
  // Routing & control
  outcomes: string[];
  handoff_rules: string;
  safety_rules: string;
  // Optional configuration
  data_fields: DataField[];
  caller_personas: CallerPersona[];
  objection_rules: ObjectionRule[];
}

export interface RoutingRule {
  target: string; // agent workflow_name | "END" | "HUMAN_TRANSFER"
  retry_after_days: number | null;
}

export interface WorkflowStage {
  agent: string;
  routing: Record<string, RoutingRule>;
  focus: string[]; // field names (from the workflow catalog) this stage leads on
}

export interface Workflow {
  name: string;
  stages: WorkflowStage[];
  data_fields: DataField[]; // master catalog collected across the whole journey
}

export type CampaignStatus =
  | "Not Initiated"
  | "Calling"
  | "Answered"
  | "Finished"
  | "No Answer"
  | "Failed";

export interface TranscriptLine {
  role: "user" | "agent";
  text: string;
  // Optional execution tags (campaign calls) — used to split the transcript per agent/stage.
  stage_no?: number;
  stage?: string;
  agent?: string;
}

export interface CampaignContactRow {
  campaign_contact_id: string;
  sno: number;
  name: string;
  phone: string;
  status: CampaignStatus;
  current_stage: string;
  final_outcome: string;
  has_summary: boolean;
  has_transcript: boolean;
  collected: Record<string, string>;
}

export interface CampaignProgress {
  total: number;
  completed: number;
  failed: number;
  no_answer: number;
  remaining: number;
  calling: number;
}

export interface CampaignSummary {
  campaign_id: string;
  name: string;
  workflow: string;
  status: "created" | "running" | "paused" | "stopped" | "done";
  running: boolean;
  total: number;
  done: number;
  created_at: string | null;
}

export interface CampaignState {
  running: boolean;
  paused: boolean;
  status: string;
  campaign_name: string;
  workflow: string;
  current_index: number | null;
  active_name: string | null;
  active_status: string | null;
  active_stage: string | null;
  active_transcript: TranscriptLine[];
  progress: CampaignProgress;
  contacts: CampaignContactRow[];
}

export interface ContactDetail {
  sno: number;
  name: string;
  phone: string;
  status: CampaignStatus;
  current_stage: string;
  final_outcome: string;
  last_outcome: string;
  callback_note: string;
  summary: string;
  transcript: TranscriptLine[];
  collected: Record<string, string>;
  buying_intent_score: number | null;
  buying_intent_reason: string;
  recording_url: string | null;
}

export interface HumanTransfer {
  id: string;
  name: string;
  phone: string;
  workflow_name: string;
  final_outcome: string;
  collected: Record<string, string>;
  summary: string;
  campaign_id: string | null;
}

export interface Analytics {
  total_contacts: number;
  calls_attempted: number;
  calls_answered: number;
  no_answer: number;
  failed: number;
  qualified_leads: number;
  human_transfers: number;
  conversion_rate: number;
}

export type CallMode = "browser" | "phone";

export interface SessionToken {
  mode: CallMode;
  url: string;
  room: string;
  identity: string;
  token: string;
  phone?: string;
}

export interface TestSessionRow {
  id: string;
  mode: "phone" | "browser";
  agent_workflow: string;
  agent_name: string;
  phone: string;
  status: string;            // active | finished | failed
  has_summary: boolean;
  has_transcript: boolean;
  has_recording: boolean;
  created_at: string | null;
}

export interface TestTranscriptLine {
  role: "user" | "agent";
  text: string;
  ts?: number;
}

export interface TestSessionDetail {
  id: string;
  mode: "phone" | "browser";
  agent_workflow: string;
  agent_name: string;
  phone: string;
  status: string;
  summary: string;
  transcript: TestTranscriptLine[];
  recording_url: string;
  metrics?: CallMetrics; 
  created_at: string | null;
}

export interface CallMetrics {
  stt: { seconds: number; cost: number; estimated: boolean };
  llm: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number };
  tts: { characters: number; cost: number };
  total_cost: number;
  turns: number;
  duration_seconds: number;
  avg_latency: number;
  peak_latency: number;
}
