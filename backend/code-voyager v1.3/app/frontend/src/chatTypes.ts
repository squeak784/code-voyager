export interface IndexStatus {
  status: 'queued' | 'running' | 'ready' | 'error'; phase: string;
  completed: number; total: number; files: number; chunks: number;
  skipped: string[]; error: string; generation: string; updated_at: string;
  ready: boolean; embedding_model: string; collection: string;
}
export interface ChatSource { path: string; start: number; end: number; symbol: string; text: string; file_hash: string; }
export interface ChatTurn { id: string; question: string; answer: string; status: 'running' | 'done' | 'error'; error: string; sources: ChatSource[]; generation: string; created_at: string; }
