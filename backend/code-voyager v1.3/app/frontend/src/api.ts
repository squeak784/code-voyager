import { getSettings } from './settings';
import { t } from './i18n';
import type { IndexStatus, ChatTurn } from './chatTypes';
import type { GraphData } from './ProjectMap';
import type { CommentTarget, CommentEntry, CommentOptions } from './commentTypes';
import type {
  ProjectAnalysis,
  ProjectDocumentationReport,
  ProjectFileResponse,
  ProjectUploadResponse,
  ProjectListItem,
  SaveResult, FileRevision,
} from './types';

const API_URL = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
).replace(/\/$/, '');

export interface User {
  id: string;
  username: string;
  email: string;
  created_at?: string | null;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface RegisterData {
  username: string;
  email: string;
  password: string;
}

export interface LoginData {
  username: string;
  password: string;
}

function getToken(): string | null {
  return localStorage.getItem('access_token');
}

function getAuthHeaders(): Record<string, string> {
  const token = getToken();

  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_URL}${path}`;

  console.log('[API] REQUEST:', url);

  let response: Response;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...(options?.headers || {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    console.error('[API] NETWORK ERROR:', url, error);
    throw new Error(`${t('Ошибка подключения к API')}: ${url}`);
  }

  console.log('[API] RESPONSE:', response.status, url);

  const contentType = response.headers.get('content-type') || '';

  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    const detail =
      typeof data === 'object' &&
      data !== null &&
      'detail' in data
        ? (Array.isArray(data.detail) ? t('Проверьте заполнение полей.') : t(String(data.detail)))
        : '';

    console.error('[API] HTTP ERROR:', response.status, data);

    throw new Error(
      detail || `${t('Ошибка API')}: ${response.status}`,
    );
  }

  return data as T;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

export const api = {
  indexStatus(id: string, signal?: AbortSignal) { return request<IndexStatus>(`/projects/${encodeURIComponent(id)}/index`, {signal}); },
  reindex(id: string) { return request<IndexStatus>(`/projects/${encodeURIComponent(id)}/index`, {method:'POST'}); },
  chatHistory(id: string, signal?: AbortSignal) { return request<ChatTurn[]>(`/projects/${encodeURIComponent(id)}/chat`, {signal}); },
  clearChat(id: string) { return request<{ok: boolean}>(`/projects/${encodeURIComponent(id)}/chat`, {method:'DELETE'}); },
  askCode(id: string, question: string, path: string | null, language: 'ru' | 'en', requestId: string, signal: AbortSignal) {
    return request<ChatTurn>(`/projects/${encodeURIComponent(id)}/chat`, {method:'POST', signal,
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:requestId, question, path, language:getSettings().assistantLanguage === 'auto' ? language : getSettings().assistantLanguage, detail:getSettings().assistantDetail, assistant_name:getSettings().assistantName.trim()})});
  },
  renameProject(id: string, name: string) {
    return request<ProjectListItem>(`/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name}),
    });
  },
  getGraph(id: string, signal?: AbortSignal) { return request<GraphData>(`/projects/${encodeURIComponent(id)}/graph`, {signal}); },
  commentProvider() { return request<{provider: string; configured: boolean; model: string}>('/ai/provider'); },
  commentModels() { return request<{models: string[]}>('/ai/models'); },
  commentTargets(id: string, path: string, signal?: AbortSignal) {
    return request<{version: string; targets: CommentTarget[]}>(`/projects/${encodeURIComponent(id)}/comments/targets?path=${encodeURIComponent(path)}`, {signal});
  },
  generateComment(id: string, path: string, base_version: string, target_id: string, options: CommentOptions, signal: AbortSignal) {
    return request<CommentEntry & {version: string}>(`/projects/${encodeURIComponent(id)}/comments/generate`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, signal,
      body: JSON.stringify({path, base_version, target_id, options}),
    });
  },
  previewComments(id: string, path: string, base_version: string, entries: CommentEntry[], signal: AbortSignal) {
    return request<{content: string}>(`/projects/${encodeURIComponent(id)}/comments/preview`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, signal, body: JSON.stringify({path, base_version, entries}),
    });
  },
  applyComments(id: string, path: string, base_version: string, entries: CommentEntry[]) {
    return request<SaveResult>(`/projects/${encodeURIComponent(id)}/comments/apply`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path, base_version, entries}),
    });
  },
  saveFile(id: string, path: string, content: string, base_version: string) {
    return request<SaveResult>(`/projects/${encodeURIComponent(id)}/workspace/file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content, base_version }),
    });
  },
  getHistory(id: string, path: string) {
    return request<FileRevision[]>(`/projects/${encodeURIComponent(id)}/workspace/history?path=${encodeURIComponent(path)}`);
  },
  getRevision(id: string, path: string, revision: string) {
    return request<{content: string}>(`/projects/${encodeURIComponent(id)}/workspace/revision?path=${encodeURIComponent(path)}&revision_id=${encodeURIComponent(revision)}`);
  },
  restoreFile(id: string, path: string, revision_id: string, base_version: string) {
    return request<SaveResult>(`/projects/${encodeURIComponent(id)}/workspace/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, revision_id, base_version }),
    });
  },
  async exportProject(id: string, name: string) {
    const response = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}/export`, {headers: getAuthHeaders()});
    if (!response.ok) throw new Error(t('Не удалось экспортировать проект'));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = name.replace(/\.zip$/i, '') + '-edited.zip'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  // =========================
  // AUTH
  // =========================

  register(data: RegisterData) {
    return request<AuthResponse>('/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  },

  login(data: LoginData) {
    return request<AuthResponse>('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  },

  changePassword(current_password: string, new_password: string) {
    return request<{ message: string }>('/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_password }),
    });
  },

  getMe() {
    return request<User>('/auth/me');
  },

  saveToken(token: string) {
    localStorage.setItem('access_token', token);
  },

  getToken,

  logout() {
    localStorage.removeItem('access_token');
  },

  // =========================
  // PROJECTS
  // =========================

  uploadProject(file: File) {
    const form = new FormData();

    form.append('file', file);

    return request<ProjectUploadResponse>(
      '/projects/upload',
      {
        method: 'POST',
        body: form,
      },
    );
  },

  getProject(id: string) {
    return request<ProjectAnalysis>(
      `/projects/${encodeURIComponent(id)}`,
    );
  },

  getFile(id: string, path: string) {
    return request<ProjectFileResponse>(
      `/projects/${encodeURIComponent(id)}/workspace/file?path=${encodeURIComponent(path.replace(/\\/g, "/"))}`,
    );
  },

  getProjects() {
  return request<ProjectListItem[]>('/projects');
},

deleteProject(id: string) {
  return request<{ message: string }>(
    `/projects/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    },
  );
},

  getDocumentation(id: string) {
    return request<ProjectDocumentationReport>(
      `/projects/${encodeURIComponent(id)}/documentation`,
    );
  },
};
