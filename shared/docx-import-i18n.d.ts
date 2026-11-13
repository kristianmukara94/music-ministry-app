export type DocxKey =
  | 'stepChoose' | 'stepReview' | 'stepDone' | 'fileHint' | 'howTitle' | 'how1' | 'how2' | 'how3' | 'dropOr' | 'back' | 'backConfirm' | 'done'
  | 'heading' | 'close' | 'dropTitle' | 'browse' | 'reading' | 'badType' | 'tooBig' | 'noSongs' | 'another'
  | 'songsFound' | 'titlesFrom' | 'titlesGuessed' | 'selectAll' | 'selectNone' | 'sections' | 'slides' | 'duplicate' | 'duplicateLibrary'
  | 'duplicateFile' | 'actionSkip' | 'actionUpdate' | 'actionNew' | 'mixed' | 'songTitle' | 'language'
  | 'addSection' | 'duplicateSlide' | 'removeSlide' | 'repeatSung' | 'slidesPreview' | 'slidesHint' | 'slidePart' | 'partContinuation' | 'slidesCustom' | 'slidesReset' | 'caseSentence' | 'caseKeep'
  | 'cues' | 'issueNoTitle' | 'issueNoSlides' | 'issueTooManySlides' | 'filing' | 'categoryMissing' | 'addToQueue' | 'importN'
  | 'saving' | 'doneTitle' | 'doneSummary' | 'queued' | 'queueFailed' | 'failed' | 'discardConfirm';

export function docxT(lang: string, key: DocxKey, vars?: Record<string, string | number>): string;
export const DOCX_KEYS: DocxKey[];
export const DOCX_LANGS: string[];
export function docxStrings(lang: string): Record<DocxKey, string>;
