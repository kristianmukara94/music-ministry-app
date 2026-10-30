export const ANN_LANGS: readonly ['en', 'tl', 'ceb'];

export type AnnKey =
  | 'eyebrow' | 'title' | 'subtitle' | 'importSlides' | 'createText' | 'play' | 'newFolder'
  | 'folderName' | 'create' | 'save' | 'cancel' | 'rename' | 'deleteFolder' | 'deleteSlide'
  | 'confirmDeleteFolder' | 'confirmDeleteSlide' | 'allSlides' | 'importTo' | 'emptyTitle'
  | 'emptyBody' | 'infoTitle' | 'infoBody' | 'live' | 'staged' | 'modalTitle' | 'textLabel'
  | 'textHint' | 'autoPaginate' | 'styleToggle' | 'insertBreak' | 'mergeWithPrevious' | 'uploadBackground'
  | 'changeBackground' | 'removeBackground' | 'preview' | 'prev' | 'next' | 'pageOf' | 'noText'
  | 'saveSequence' | 'dragHint' | 'dialogImport' | 'backgroundDialog' | 'dropHint'
  | 'notesTitle' | 'notesEmpty' | 'notesNothing'
  | 'slideCount' | 'playback' | 'autoplay' | 'autoplayInterval' | 'secondsUnit' | 'loopDeck' | 'showCount'
  | 'noSlideSelected' | 'firstSlide' | 'nextSlide' | 'startAutoplay' | 'pauseAutoplay' | 'playDeck' | 'pauseDeck'
  | 'clearProjector' | 'keyHint';

export function annT(lang: string, key: AnnKey): string;
