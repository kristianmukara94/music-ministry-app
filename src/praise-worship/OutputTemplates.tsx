import type { ReactNode } from 'react';
import { PRAYER_PLACEHOLDER, slidesFor, type PwSlide } from '../../shared/pw.js';
import type { LowerThird } from '../../shared/live.js';
import { SegmentLowerThird } from '../output/LowerThirdView';
import { PwSlideFace } from './PwSlideFace';
import { slideFooter } from './SlideThumb';
import { lowerThirdFor } from './live';
import { resolvedFor, usePw } from './store';
import { usePwT, type PwT } from './strings';
import type { PwSession } from './types';

/** One sample per template. Each comes from this session where it has that content, else a bracketed placeholder. */
interface Samples {
  lyric: { slide: PwSlide; segmentName: string };
  prayer: { slide: PwSlide; segmentName: string };
  title: { slide: PwSlide; segmentName: string };
  lower: LowerThird;
}

function samplesFor(session: PwSession | null, t: PwT): Samples {
  const state = usePw.getState();
  const segmentName = t('phSegment');
  const fallback: Samples = {
    lyric: {
      slide: { kind: 'lyrics', label: 'Verse 1', chip: 'V1', text: t('phLyrics'), hymnId: 0, hymnTitle: t('phSong'), sectionId: '' },
      segmentName,
    },
    prayer: { slide: { kind: 'prayer', label: segmentName, text: PRAYER_PLACEHOLDER, placeholder: true }, segmentName },
    title: { slide: { kind: 'title', label: segmentName, subtitle: '' }, segmentName },
    lower: { template: 'segment', tag: segmentName, line1: t('phSong'), line2: t('phComposer') },
  };
  if (!session) return fallback;

  const slidesOf = (type: 'song' | 'prayer' | 'scripture') =>
    session.segments
      .filter((s) => s.type === type)
      .map((segment) => ({ segment, slides: slidesFor(segment, resolvedFor(segment, state)) }));

  const lyric = slidesOf('song').flatMap(({ segment, slides }) =>
    slides.filter((s) => s.kind === 'lyrics').map((slide) => ({ slide, segmentName: segment.name })),
  )[0];
  const prayer = slidesOf('prayer').flatMap(({ segment, slides }) =>
    slides.filter((s) => s.kind === 'prayer' && !s.placeholder).map((slide) => ({ slide, segmentName: segment.name })),
  )[0];
  const scripture = slidesOf('scripture')[0]?.segment ?? session.segments[0];
  const songSegment = session.segments.find((s) => s.content.hymnIds.length > 0);

  return {
    lyric: lyric ?? fallback.lyric,
    prayer: prayer ?? fallback.prayer,
    title: scripture
      ? { slide: { kind: 'title', label: scripture.name, subtitle: '' }, segmentName: scripture.name }
      : fallback.title,
    lower: songSegment ? lowerThirdFor(session, songSegment) : fallback.lower,
  };
}

function Card({ heading, sub, children }: { heading: string; sub: string; children: ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-base font-bold">{heading}</span>
        <span className="text-sm text-muted">{sub}</span>
      </figcaption>
      {children}
    </figure>
  );
}

/** The four output templates, as the congregation and the livestream will see them. */
export function OutputTemplates() {
  const t = usePwT();
  const session = usePw((s) => s.session);
  // Re-drawn when the content they show finishes loading.
  usePw((s) => s.hymns);
  usePw((s) => s.prayers);
  usePw((s) => s.day);
  const samples = samplesFor(session, t);
  const stage = 'relative aspect-video w-full overflow-hidden rounded-lg border border-line [container-type:size]';

  return (
    <section aria-labelledby="pw-out-heading" className="flex flex-col gap-4 rounded-[10px] border border-line bg-panel p-5">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('eyebrow_outputs')}</p>
        <h2 id="pw-out-heading" className="text-2xl font-bold tracking-tight">{t('out_heading')}</h2>
        <p className="max-w-3xl text-sm text-muted">{t('out_note')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 @3xl/pw:grid-cols-2">
        <Card heading={t('out_lyric')} sub={t('out_lyric_sub')}>
          <div className={stage}>
            <PwSlideFace slide={samples.lyric.slide} segmentName={samples.lyric.segmentName} type="song" index={0} total={6} footer={slideFooter(samples.lyric.slide, t('prayTogether'))} />
          </div>
        </Card>
        <Card heading={t('out_prayer')} sub={t('out_prayer_sub')}>
          <div className={stage}>
            <PwSlideFace slide={samples.prayer.slide} segmentName={samples.prayer.segmentName} type="prayer" index={0} total={4} footer={t('prayTogether')} />
          </div>
        </Card>
        <Card heading={t('out_title')} sub={t('out_title_sub')}>
          <div className={stage}>
            <PwSlideFace slide={samples.title.slide} segmentName={samples.title.segmentName} type="scripture" index={0} total={1} />
          </div>
        </Card>
        <Card heading={t('out_lower')} sub={t('out_lower_sub')}>
          <div className={`${stage} bg-canvas`}>
            <div className="absolute bottom-[6%] left-[5%]">
              <SegmentLowerThird value={samples.lower} />
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
