export const ANN_LANGS: readonly ['en', 'tl', 'ceb'];

export type AnnKey =
  | 'eyebrow' | 'title' | 'subtitle' | 'importSlides' | 'createText' | 'play' | 'newFolder'
  | 'folderName' | 'create' | 'save' | 'cancel' | 'rename' | 'deleteFolder' | 'deleteSlide'
  | 'confirmDeleteFolder' | 'confirmDeleteSlide' | 'allSlides' | 'importTo' | 'emptyTitle'
  | 'emptyBody' | 'infoTitle' | 'infoBody' | 'live' | 'staged' | 'modalTitle' | 'textLabel'
  | 'textHint' | 'autoPaginate' | 'insertBreak' | 'mergeWithPrevious' | 'uploadBackground'
  | 'changeBackground' | 'removeBackground' | 'preview' | 'prev' | 'next' | 'pageOf' | 'noText'
  | 'saveSequence' | 'dragHint' | 'dialogImport' | 'backgroundDialog' | 'dropHint'
  | 'notesTitle' | 'notesEmpty' | 'notesNothing';

export function annT(lang: string, key: AnnKey): string;
