export type Role = "admin" | "faculty" | "student";
export type PlanStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PUBLISHED" | "REJECTED" | "SUPERSEDED";

export interface User {
  id: number;
  email: string;
  role: Role;
  ref_id: string | null;
}

export interface Health {
  score: number;
  components: Record<string, number>;
}

export interface Kpis {
  clashes: number;
  hard_violations: number;
  soft_violations: number;
  pct_students_one_exam_per_day: number;
  mean_gap_days: number;
  min_gap_days: number;
  rooms_per_slot_mean: number;
  rooms_total: number;
  seat_utilisation_pct: number;
  duties_min: number;
  duties_max: number;
  duties_mean: number;
  duty_gini: number;
  seating_risk_index: number;
  seating_risk_reduction_pct: number;
  adjacent_pairs: number;
  relaxed_rules: boolean;
  students: number;
  courses: number;
  stage_seconds: Record<string, number>;
  health?: Health;
}

export interface PlanSummary {
  id: number;
  parent_id: number | null;
  kind: string;
  status: PlanStatus;
  version: number;
  row_version: number;
  label: string;
  origin: string;
  created_at: string;
  kpis: Kpis;
  hard_violations: number;
  soft_violations: number;
  relaxed: boolean;
  rejection_reason: string | null;
}

export interface Violation {
  code: string;
  severity: "hard" | "soft";
  entity_ids: string[];
  message: string;
  rule_id: string;
}

export interface ExamRow {
  course_id: string;
  name: string;
  dept: string;
  semester: number;
  difficulty: number;
  size: number;
  slot_id: string;
  pinned: boolean;
}

export interface PlanDetail extends PlanSummary {
  violations: Violation[];
  exams: ExamRow[];
}

export interface SlotInfo {
  id: string;
  date: string;
  session: string;
  start: string;
  end: string;
  blocked: boolean;
  label: string;
}

export interface Catalogue {
  courses: { id: string; name: string; dept: string; semester: number; size: number }[];
  rooms: { id: string; building: string; rows: number; cols: number; seats: number; accessible: boolean; quiet: boolean }[];
  faculty: { id: string; name: string; dept: string; rank: number }[];
  slots: SlotInfo[];
}

export interface MovedCourse {
  course_id: string;
  from: string | null;
  to: string;
  students: number;
}

export interface Diff {
  courses_moved: MovedCourse[];
  rooms_changed: number;
  students_affected: { count: number; sample: string[] };
  invigilators_changed: { count: number; faculty: string[]; replacements: { slot_id: string; room_id: string | null; from: string; to: string }[] };
  seats_changed: number;
  kpi_deltas: Record<string, number>;
}

export interface Proposal {
  status: string;
  plan_id: number;
  version: number;
  hard_count: number;
  hard_violations: Violation[];
  soft_count: number;
  relaxed: boolean;
  kpis: Kpis;
  health: Health;
  diff: Diff | null;
}

export interface Alternative {
  label: string;
  title: string;
  ops: Record<string, unknown>[];
  courses_moved: number;
  students_affected: number;
  moved: { course_id: string; from: string | null; to: string }[];
}

export interface ClarifyOption {
  label: string;
  reply: string;
}

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface JobEvent {
  type: string;
  stage?: string;
  status?: string;
  seconds?: number;
  t?: number;
  objective?: number;
  bound?: number;
  solutions?: number;
  plan_id?: number;
  message?: string;
  [key: string]: unknown;
}

export interface AiStatus {
  mode: "live" | "degraded" | "offline";
  model: string | null;
  calls_today: number;
  daily_limit: number;
  remaining_est: number;
}
