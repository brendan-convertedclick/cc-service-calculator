// src/types/brief-intelligence.ts
export type Requirement = {
  text: string;
  interpretation: string;
  mapped_service_ids: string[];
  confidence: "low" | "medium" | "high";
};

export type Deliverable = {
  name: string;
  format?: string;
  quantity?: number;
  platform?: string;
};

export type BreakdownTask = {
  title: string;
  description?: string;
  is_ai_eligible?: boolean;
};

export type DeptBreakdown = {
  department_id: string;
  department_name: string;
  deliverables: Deliverable[];
  tasks: BreakdownTask[];
  human_hours_low: number;
  human_hours_mid: number;
  human_hours_high: number;
  ai_hours: number;
};

export type OpenQuestion = { question: string; context: string };
