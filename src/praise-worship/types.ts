import type { PwChainItem, PwGroup, PwHymnTag, PwSegment, PwTemplateData } from '../../shared/pw.js';

export type { PwChainItem };

export interface PwSessionSummary {
  id: number;
  name: string;
  liturgicalDate: string;
  createdAt: string;
  segmentCount: number;
}

export interface PwSession {
  id: number;
  name: string;
  liturgicalDate: string;
  groups: PwGroup[];
  segments: PwSegment[];
}

export interface PwTemplate extends PwTemplateData {
  id: number;
  builtIn: boolean;
}

/** Fields `saveSession` replaces. Omitted fields keep their saved value; `segments` always replaces the lineup. */
export interface PwSessionInput {
  name?: string;
  liturgicalDate?: string;
  groups?: PwGroup[];
  segments: PwSegment[];
}

export interface PwApi {
  listSessions(): Promise<PwSessionSummary[]>;
  /** Without `templateId`, the session starts from the built-in lineup. */
  createSession(input: { name: string; liturgicalDate: string; templateId?: number }): Promise<PwSession>;
  getSession(id: number): Promise<PwSession>;
  saveSession(id: number, input: PwSessionInput): Promise<PwSession>;
  deleteSession(id: number): Promise<boolean>;
  listTemplates(): Promise<PwTemplate[]>;
  saveAsTemplate(sessionId: number, name: string): Promise<PwTemplate>;
  /** False for the built-in template, which cannot be deleted. */
  deleteTemplate(id: number): Promise<boolean>;
  listTags(): Promise<PwHymnTag[]>;
  /** Returns every tag after the change. */
  setTag(hymnId: number, segmentKey: string, on: boolean): Promise<PwHymnTag[]>;
}
