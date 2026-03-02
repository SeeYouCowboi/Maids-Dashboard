export interface Maid {
  id: string;
  /** API returns 'displayName', not 'name' */
  displayName: string;
  name?: string; // kept for backward compat, may be absent
  role?: string;
  status?: 'work' | 'rp' | 'unknown' | string;
  workspace?: string;
  avatar?: string;
}

export interface Session {
  key: string;
  maid_id?: string;
  updated_at?: string;
  model?: string;
  has_tokens?: boolean;
  token_count?: number;
}

export interface LoreEntry {
  id: string;
  title: string;
  body: string;
  world_id: string;
  tags?: string[];
}

export interface CharacterCard {
  id: string;
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  creator_notes?: string;
  character_version?: string;
  world_id: string;
}

export interface Conflict {
  id: string;
  severity: 'high' | 'medium' | 'low' | string;
  description?: string;
  world_id?: string;
  branch_id?: string;
  created_at?: string;
  status?: string;
}

export interface CronSchedule {
  kind: string;
  expr: string;
  tz?: string;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  /** API returns an object like {kind:'cron', expr:'0 2 * * *', tz:'Asia/Shanghai'} */
  schedule?: CronSchedule | string;
  last_run?: string;
  next_run?: string;
}

export interface ApiError {
  message: string;
  status: number;
}
