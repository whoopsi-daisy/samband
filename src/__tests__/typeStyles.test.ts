import { TYPE_STYLES, getTypeStyle } from '@/types';

// polisen.se's own vocabulary, as it comes out of the events API. The table in
// types/index.ts exists to keep these off the fallback pin: a feed where most
// rows show 📍 has an emoji column that carries no information.
const POLISEN_TYPES = [
  'Alkohollagen',
  'Anträffad död',
  'Anträffat gods',
  'Arbetsplatsolycka',
  'Bedrägeri',
  'Bombhot',
  'Brand',
  'Brand automatlarm',
  'Bråk',
  'Detonation',
  'Djur',
  'Ekobrott',
  'Explosion',
  'Fjällräddning',
  'Fylleri/LOB',
  'Förfalskningsbrott',
  'Försvunnen person',
  'Gränskontroll',
  'Häleri',
  'Inbrott',
  'Inbrott, försök',
  'Knivlagen',
  'Kontroll person/fordon',
  'Larm Inbrott',
  'Larm Överfall',
  'Miljöbrott',
  'Missbruk av urkund',
  'Mordbrand',
  'Misshandel',
  'Misshandel, grov',
  'Mord/dråp',
  'Mord/dråp, försök',
  'Motorfordon, anträffat stulet',
  'Motorfordon, stöld',
  'Narkotikabrott',
  'Naturkatastrof',
  'Ofog barn/ungdom',
  'Ofredande/förargelse',
  'Olaga frihetsberövande',
  'Olaga hot',
  'Olaga intrång/hemfridsbrott',
  'Olovlig körning',
  'Ordningslagen',
  'Polisinsats/kommendering',
  'Rattfylleri',
  'Rån',
  'Rån väpnat',
  'Rån, försök',
  'Räddningsinsats',
  'Sammanfattning natt',
  'Sammanfattning kväll och natt',
  'Sedlighetsbrott',
  'Sjukdom/olycksfall',
  'Sjölagen',
  'Skadegörelse',
  'Skottlossning',
  'Skottlossning, misstänkt',
  'Snatteri',
  'Stöld',
  'Stöld, försök',
  'Stöld, ringa',
  'Stöld/inbrott',
  'Trafikbrott',
  'Trafikhinder',
  'Trafikkontroll',
  'Trafikolycka',
  'Trafikolycka, personskada',
  'Trafikolycka, singel',
  'Trafikolycka, smitning från',
  'Trafikolycka, vilt',
  'Uppdatering',
  'Vapenlagen',
  'Varningslarm/haveri',
  'Våld/hot mot tjänsteman',
  'Våldtäkt',
  'Våldtäkt, försök',
  'Åldringsbrott',
  'Övrigt',
];

describe('getTypeStyle', () => {
  it('resolves every published polisen.se type to something other than the pin', () => {
    const unresolved = POLISEN_TYPES.filter(
      (type) => getTypeStyle(type).emoji === TYPE_STYLES['default'].emoji
    );

    expect(unresolved).toEqual([]);
  });

  it('matches a named type exactly', () => {
    expect(getTypeStyle('Trafikolycka')).toEqual({ emoji: '🚗', color: '#3b82f6' });
  });

  it('ignores case and stray whitespace', () => {
    expect(getTypeStyle('  TRAFIKOLYCKA  ')).toEqual(getTypeStyle('Trafikolycka'));
  });

  // The previous resolver scanned the table with a bidirectional `includes` and
  // returned whichever key was declared first, so a plain "Brand" was answered
  // by "Brand automatlarm" and a plain "Stöld" by "Stöld/inbrott".
  it('does not let a longer type name capture a shorter one', () => {
    expect(getTypeStyle('Brand')).toEqual(TYPE_STYLES['Brand']);
    expect(getTypeStyle('Stöld')).toEqual(TYPE_STYLES['Stöld']);
    expect(getTypeStyle('Inbrott')).toEqual(TYPE_STYLES['Inbrott']);
    expect(getTypeStyle('Rån')).toEqual(TYPE_STYLES['Rån']);
  });

  it('falls back to the base type when an unknown qualifier is appended', () => {
    expect(getTypeStyle('Trafikolycka, mötesolycka')).toEqual(TYPE_STYLES['Trafikolycka']);
    expect(getTypeStyle('Misshandel, försök')).toEqual(TYPE_STYLES['Misshandel']);
  });

  it('prefers the longest stem when a type has several qualifiers', () => {
    expect(getTypeStyle('Stöld/inbrott, i bostad')).toEqual(TYPE_STYLES['Stöld/inbrott']);
    expect(getTypeStyle('Mord/dråp, förberedelse')).toEqual(TYPE_STYLES['Mord/dråp']);
  });

  it('matches on a keyword when the type is worded differently', () => {
    expect(getTypeStyle('Sammanfattning helg')).toEqual(TYPE_STYLES['Sammanfattning']);
    expect(getTypeStyle('Grov misshandel')).toEqual(TYPE_STYLES['Misshandel']);
    expect(getTypeStyle('Misstänkt narkotikabrott')).toEqual(TYPE_STYLES['Narkotikabrott']);
  });

  // Swedish writes compounds as one word, so there is no boundary to anchor a
  // pattern on. "Mordbrand" reached the fallback pin for exactly this reason.
  it('reads a compound by its last element', () => {
    expect(getTypeStyle('Villainbrott')).toEqual(TYPE_STYLES['Inbrott']);
    expect(getTypeStyle('Bostadsinbrott')).toEqual(TYPE_STYLES['Inbrott']);
    expect(getTypeStyle('Cykelstöld')).toEqual(TYPE_STYLES['Stöld']);
    expect(getTypeStyle('Personrån')).toEqual(TYPE_STYLES['Rån']);
  });

  // A mordbrand is a fire, not a homicide, and the table names it outright so
  // it keeps the arson colour instead of the plain fire orange.
  it('does not read a compound as its first element', () => {
    expect(getTypeStyle('Mordbrand')).toEqual(TYPE_STYLES['Mordbrand']);
    expect(getTypeStyle('Mordbrand')).not.toEqual(TYPE_STYLES['Mord/dråp']);
    expect(getTypeStyle('Mordbrand').color).not.toBe(TYPE_STYLES['Brand'].color);
  });

  it('reads a phrase by its head, right to left', () => {
    expect(getTypeStyle('Brott mot knivlagen')).toEqual(TYPE_STYLES['Knivlagen']);
    expect(getTypeStyle('Försök till mord')).toEqual(TYPE_STYLES['Mord/dråp']);
    expect(getTypeStyle('Stöld ur bil')).toEqual(TYPE_STYLES['Stöld']);
  });

  // Faces reading as a reaction to someone else's assault or bereavement.
  it('keeps cartoon faces off crimes against people', () => {
    const faces = ['🤕', '😠', '😡', '😢', '😱', '🥴', '🤬', '😨', '👵', '🧒'];
    const offending = Object.entries(TYPE_STYLES).filter(([, style]) =>
      faces.includes(style.emoji)
    );

    expect(offending).toEqual([]);
  });

  it('returns the fallback for an empty or unrecognisable type', () => {
    expect(getTypeStyle('')).toEqual(TYPE_STYLES['default']);
    expect(getTypeStyle('   ')).toEqual(TYPE_STYLES['default']);
    expect(getTypeStyle('Okänd')).toEqual(TYPE_STYLES['default']);
  });
});
