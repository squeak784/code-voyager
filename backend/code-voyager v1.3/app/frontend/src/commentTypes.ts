export interface CommentTarget {
  id: string; name: string; scope: string; type: 'class' | 'function' | 'variable';
  line: number; line_end: number; documented: boolean; supported: boolean;
}
export interface CommentOptions {
  language: 'ru' | 'en'; detail: 'brief' | 'standard' | 'detailed'; style: 'google' | 'numpy' | 'rest'; model: string;
}
export interface CommentEntry { id: string; text: string; }
