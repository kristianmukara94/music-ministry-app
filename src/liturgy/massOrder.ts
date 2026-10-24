import type { Frame, Lang, SlideLine } from '../../shared/live.js';

/**
 * Ordinary of the Mass, pre-split into projector-sized slides.
 * EN follows the 2011 Roman Missal translation; TL follows common usage in
 * "Ang Pagdiriwang ng Banal na Misa". Proofread both against the parish's
 * CBCP-approved missal before go-live. CEB falls back to TL until texts are supplied.
 */
export interface MassPart {
  id: string;
  name: Record<'en' | 'tl', string>;
  slides: Record<'en' | 'tl', SlideLine[][]>;
}

const P = (text: string): SlideLine => ({ role: 'priest', text });
const A = (text: string): SlideLine => ({ role: 'all', text });

export const MASS_ORDER: MassPart[] = [
  {
    id: 'kyrie',
    name: { en: 'Kyrie (Lord, Have Mercy)', tl: 'Panginoon, Kaawaan Mo Kami' },
    slides: {
      en: [[P('Lord, have mercy.'), A('Lord, have mercy.'), P('Christ, have mercy.'), A('Christ, have mercy.'), P('Lord, have mercy.'), A('Lord, have mercy.')]],
      tl: [[P('Panginoon, kaawaan mo kami.'), A('Panginoon, kaawaan mo kami.'), P('Kristo, kaawaan mo kami.'), A('Kristo, kaawaan mo kami.'), P('Panginoon, kaawaan mo kami.'), A('Panginoon, kaawaan mo kami.')]],
    },
  },
  {
    id: 'gloria',
    name: { en: 'Gloria', tl: 'Papuri sa Diyos' },
    slides: {
      en: [
        [A('Glory to God in the highest, and on earth peace to people of good will.')],
        [A('We praise you, we bless you, we adore you, we glorify you, we give you thanks for your great glory,')],
        [A('Lord God, heavenly King, O God, almighty Father. Lord Jesus Christ, Only Begotten Son, Lord God, Lamb of God, Son of the Father,')],
        [A('you take away the sins of the world, have mercy on us; you take away the sins of the world, receive our prayer;')],
        [A('you are seated at the right hand of the Father, have mercy on us.')],
        [A('For you alone are the Holy One, you alone are the Lord, you alone are the Most High, Jesus Christ, with the Holy Spirit, in the glory of God the Father. Amen.')],
      ],
      tl: [
        [A('Papuri sa Diyos sa kaitaasan at sa lupa’y kapayapaan sa mga taong kinalulugdan niya.')],
        [A('Pinupuri ka namin, dinarangal ka namin, sinasamba ka namin, ipinagbubunyi ka namin, pinasasalamatan ka namin dahil sa dakila mong angking kapurihan.')],
        [A('Panginoong Diyos, Hari ng langit, Diyos Amang makapangyarihan sa lahat. Panginoong Hesukristo, Bugtong na Anak, Panginoong Diyos, Kordero ng Diyos, Anak ng Ama.')],
        [A('Ikaw na nag-aalis ng mga kasalanan ng sanlibutan, maawa ka sa amin. Ikaw na nag-aalis ng mga kasalanan ng sanlibutan, tanggapin mo ang aming kahilingan.')],
        [A('Ikaw na naluluklok sa kanan ng Ama, maawa ka sa amin.')],
        [A('Sapagkat ikaw lamang ang banal, ikaw lamang ang Panginoon, ikaw lamang, O Hesukristo, ang Kataas-taasan, kasama ng Espiritu Santo sa kadakilaan ng Diyos Ama. Amen.')],
      ],
    },
  },
  {
    // Apostles' Creed: permitted in place of the Nicene Creed and the common choice in PH parishes.
    id: 'credo',
    name: { en: "Credo (Apostles' Creed)", tl: 'Sumasampalataya' },
    slides: {
      en: [
        [A('I believe in God, the Father almighty, Creator of heaven and earth,')],
        [A('and in Jesus Christ, his only Son, our Lord, who was conceived by the Holy Spirit, born of the Virgin Mary,')],
        [A('suffered under Pontius Pilate, was crucified, died and was buried; he descended into hell; on the third day he rose again from the dead;')],
        [A('he ascended into heaven, and is seated at the right hand of God the Father almighty; from there he will come to judge the living and the dead.')],
        [A('I believe in the Holy Spirit, the holy catholic Church, the communion of saints, the forgiveness of sins, the resurrection of the body, and life everlasting. Amen.')],
      ],
      tl: [
        [A('Sumasampalataya ako sa Diyos Amang makapangyarihan sa lahat, na may gawa ng langit at lupa.')],
        [A('Sumasampalataya ako kay Hesukristo, iisang Anak ng Diyos, Panginoon nating lahat. Nagkatawang-tao siya lalang ng Espiritu Santo, ipinanganak ni Santa Mariang Birhen.')],
        [A('Pinagpakasakit ni Poncio Pilato, ipinako sa krus, namatay, inilibing. Nanaog sa kinaroroonan ng mga yumao. Nang may ikatlong araw nabuhay na mag-uli.')],
        [A('Umakyat sa langit. Naluluklok sa kanan ng Diyos Amang makapangyarihan sa lahat. Doon magmumulang paririto at huhukom sa nangabubuhay at nangamatay na tao.')],
        [A('Sumasampalataya naman ako sa Diyos Espiritu Santo, sa Banal na Simbahang Katolika, sa kasamahan ng mga banal, sa kapatawaran ng mga kasalanan, sa pagkabuhay na muli ng nangamatay na tao at sa buhay na walang hanggan. Amen.')],
      ],
    },
  },
  {
    id: 'sanctus',
    name: { en: 'Sanctus (Holy, Holy, Holy)', tl: 'Santo, Santo, Santo' },
    slides: {
      en: [[A('Holy, Holy, Holy Lord God of hosts.'), A('Heaven and earth are full of your glory.'), A('Hosanna in the highest.'), A('Blessed is he who comes in the name of the Lord.'), A('Hosanna in the highest.')]],
      tl: [[A('Santo, santo, santo Panginoong Diyos ng mga hukbo.'), A('Napupuno ang langit at lupa ng kadakilaan mo.'), A('Osana sa kaitaasan!'), A('Pinagpala ang naparirito sa ngalan ng Panginoon.'), A('Osana sa kaitaasan!')]],
    },
  },
  {
    id: 'memorial-acclamation',
    name: { en: 'Memorial Acclamation', tl: 'Pagbubunyi' },
    slides: {
      en: [[P('The mystery of faith.'), A('We proclaim your Death, O Lord, and profess your Resurrection until you come again.')]],
      tl: [[P('Ipagbunyi natin ang misteryo ng pananampalataya.'), A('Si Kristo’y gunitain, sarili ay inihain, bilang pagkai’t inumin, pinagsasaluhan natin hanggang sa siya’y dumating.')]],
    },
  },
  {
    id: 'pater-noster',
    name: { en: 'Pater Noster (Our Father)', tl: 'Ama Namin' },
    slides: {
      en: [
        [A('Our Father, who art in heaven, hallowed be thy name; thy kingdom come, thy will be done on earth as it is in heaven.')],
        [A('Give us this day our daily bread, and forgive us our trespasses, as we forgive those who trespass against us; and lead us not into temptation, but deliver us from evil.')],
        [A('For the kingdom, the power and the glory are yours, now and for ever.')],
      ],
      tl: [
        [A('Ama namin, sumasalangit ka, sambahin ang ngalan mo, mapasaamin ang kaharian mo, sundin ang loob mo dito sa lupa para nang sa langit.')],
        [A('Bigyan mo kami ngayon ng aming kakanin sa araw-araw, at patawarin mo kami sa aming mga sala, para nang pagpapatawad namin sa nagkakasala sa amin; at huwag mo kaming ipahintulot sa tukso, at iadya mo kami sa lahat ng masama.')],
        [A('Sapagkat iyo ang kaharian at ang kapangyarihan at ang kapurihan magpakailanman!')],
      ],
    },
  },
  {
    id: 'agnus-dei',
    name: { en: 'Agnus Dei (Lamb of God)', tl: 'Kordero ng Diyos' },
    slides: {
      en: [[A('Lamb of God, you take away the sins of the world, have mercy on us.'), A('Lamb of God, you take away the sins of the world, have mercy on us.'), A('Lamb of God, you take away the sins of the world, grant us peace.')]],
      tl: [[A('Kordero ng Diyos na nag-aalis ng mga kasalanan ng sanlibutan, maawa ka sa amin.'), A('Kordero ng Diyos na nag-aalis ng mga kasalanan ng sanlibutan, maawa ka sa amin.'), A('Kordero ng Diyos na nag-aalis ng mga kasalanan ng sanlibutan, ipagkaloob mo sa amin ang kapayapaan.')]],
    },
  },
];

const massLang = (lang: Lang): 'en' | 'tl' => (lang === 'en' ? 'en' : 'tl');

export function massPartName(part: MassPart, lang: Lang) {
  return part.name[massLang(lang)];
}

export function massPartFrame(id: string, lang: Lang): Frame | null {
  const part = MASS_ORDER.find((p) => p.id === id);
  if (!part) return null;
  const l = massLang(lang);
  return { kind: 'deck', title: part.name[l], slides: part.slides[l], index: 0 };
}
