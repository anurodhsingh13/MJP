export type TaskState = 'open' | 'acknowledged' | 'action_taken' | 'resolved';
export interface FieldTask {
  id: string; title: string; due_on: string | null; status: TaskState;
  reason?: string | null; scene_id?: string | null; boundary_version?: number | null;
}
export interface ProcessingJob {
  id: string; field_id: string; boundary_version: number; kind: 'satellite' | 'weather';
  status: 'queued' | 'running' | 'succeeded' | 'failed'; progress: string;
  result: { accepted?: boolean; sceneId?: string; validCoverage?: number; imported?: number; message?: string } | null;
  error: string | null; created_at: string; finished_at: string | null;
}
