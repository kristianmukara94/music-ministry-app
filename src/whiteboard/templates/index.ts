import { SLIDE_DESIGN_DEFAULTS, SLIDE_TEMPLATES, type WhiteboardDesign } from '../../../shared/whiteboard.js';
import { SCRIPTURE_TEMPLATE } from './scriptureTemplate';

export type TemplateId = keyof typeof SLIDE_TEMPLATES;

/**
 * The starting title, outline and design for a template. Scripture has its own look; the other templates use the
 * default design.
 */
export function templateStart(id: TemplateId): { title: string; content: string; design: WhiteboardDesign } {
  if (id === 'scripture') {
    return { title: SCRIPTURE_TEMPLATE.title, content: SCRIPTURE_TEMPLATE.content, design: { ...SCRIPTURE_TEMPLATE.design, verses: [] } };
  }
  return { title: SLIDE_TEMPLATES[id].title, content: SLIDE_TEMPLATES[id].content, design: { ...SLIDE_DESIGN_DEFAULTS, verses: [] } };
}
