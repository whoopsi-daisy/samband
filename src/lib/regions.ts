/**
 * Which county a place belongs to.
 *
 * The feed names places at whatever level the officer writing the notice chose:
 * "Malmö" on one row, "Skåne län" on the next, "Nationellt" on a third. Counted
 * as they come, the country breaks into three hundred labels of four different
 * kinds, which is a list nobody can read and not a picture of anywhere.
 *
 * Sweden has twenty-one counties and two hundred and ninety municipalities, and
 * the mapping between them is fixed public administrative fact, so it is a table
 * rather than a guess. A name this table does not recognise is counted as
 * unplaced and reported as such: an unknown bucket that quietly disappears would
 * make every county's share look larger than it is.
 */

export const COUNTIES = [
  'Blekinge län',
  'Dalarnas län',
  'Gotlands län',
  'Gävleborgs län',
  'Hallands län',
  'Jämtlands län',
  'Jönköpings län',
  'Kalmar län',
  'Kronobergs län',
  'Norrbottens län',
  'Skåne län',
  'Stockholms län',
  'Södermanlands län',
  'Uppsala län',
  'Värmlands län',
  'Västerbottens län',
  'Västernorrlands län',
  'Västmanlands län',
  'Västra Götalands län',
  'Örebro län',
  'Östergötlands län',
] as const;

export type County = (typeof COUNTIES)[number];

/**
 * Sweden's official county codes, which are the first two digits of every
 * municipality code. Not a sequence: 02, 11, 15 and 16 were counties that have
 * since been merged away, and their numbers were not reused.
 *
 * This is what joins the map geometry to the counted data. The geometry names
 * its features by code rather than by name, which is the right way round: a
 * code is stable and a name is a spelling.
 */
export const COUNTY_BY_CODE: Record<string, County> = {
  '01': 'Stockholms län',
  '03': 'Uppsala län',
  '04': 'Södermanlands län',
  '05': 'Östergötlands län',
  '06': 'Jönköpings län',
  '07': 'Kronobergs län',
  '08': 'Kalmar län',
  '09': 'Gotlands län',
  '10': 'Blekinge län',
  '12': 'Skåne län',
  '13': 'Hallands län',
  '14': 'Västra Götalands län',
  '17': 'Värmlands län',
  '18': 'Örebro län',
  '19': 'Västmanlands län',
  '20': 'Dalarnas län',
  '21': 'Gävleborgs län',
  '22': 'Västernorrlands län',
  '23': 'Jämtlands län',
  '24': 'Västerbottens län',
  '25': 'Norrbottens län',
};

/** Every municipality, by the county it sits in. */
export const MUNICIPALITIES: Record<County, string[]> = {
  'Stockholms län': [
    'Botkyrka', 'Danderyd', 'Ekerö', 'Haninge', 'Huddinge', 'Järfälla', 'Lidingö', 'Nacka',
    'Norrtälje', 'Nykvarn', 'Nynäshamn', 'Salem', 'Sigtuna', 'Sollentuna', 'Solna', 'Stockholm',
    'Sundbyberg', 'Södertälje', 'Tyresö', 'Täby', 'Upplands Väsby', 'Upplands-Bro', 'Vallentuna',
    'Vaxholm', 'Värmdö', 'Österåker',
  ],
  'Uppsala län': [
    'Enköping', 'Heby', 'Håbo', 'Knivsta', 'Tierp', 'Uppsala', 'Älvkarleby', 'Östhammar',
  ],
  'Södermanlands län': [
    'Eskilstuna', 'Flen', 'Gnesta', 'Katrineholm', 'Nyköping', 'Oxelösund', 'Strängnäs', 'Trosa',
    'Vingåker',
  ],
  'Östergötlands län': [
    'Boxholm', 'Finspång', 'Kinda', 'Linköping', 'Mjölby', 'Motala', 'Norrköping', 'Söderköping',
    'Vadstena', 'Valdemarsvik', 'Ydre', 'Åtvidaberg', 'Ödeshög',
  ],
  'Jönköpings län': [
    'Aneby', 'Eksjö', 'Gislaved', 'Gnosjö', 'Habo', 'Jönköping', 'Mullsjö', 'Nässjö', 'Sävsjö',
    'Tranås', 'Vaggeryd', 'Vetlanda', 'Värnamo',
  ],
  'Kronobergs län': [
    'Alvesta', 'Lessebo', 'Ljungby', 'Markaryd', 'Tingsryd', 'Uppvidinge', 'Växjö', 'Älmhult',
  ],
  'Kalmar län': [
    'Borgholm', 'Emmaboda', 'Hultsfred', 'Högsby', 'Kalmar', 'Mönsterås', 'Mörbylånga', 'Nybro',
    'Oskarshamn', 'Torsås', 'Vimmerby', 'Västervik',
  ],
  'Gotlands län': ['Gotland'],
  'Blekinge län': ['Karlshamn', 'Karlskrona', 'Olofström', 'Ronneby', 'Sölvesborg'],
  'Skåne län': [
    'Bjuv', 'Bromölla', 'Burlöv', 'Båstad', 'Eslöv', 'Helsingborg', 'Hässleholm', 'Höganäs',
    'Hörby', 'Höör', 'Klippan', 'Kristianstad', 'Kävlinge', 'Landskrona', 'Lomma', 'Lund', 'Malmö',
    'Osby', 'Perstorp', 'Simrishamn', 'Sjöbo', 'Skurup', 'Staffanstorp', 'Svalöv', 'Svedala',
    'Tomelilla', 'Trelleborg', 'Vellinge', 'Ystad', 'Åstorp', 'Ängelholm', 'Örkelljunga',
    'Östra Göinge',
  ],
  'Hallands län': ['Falkenberg', 'Halmstad', 'Hylte', 'Kungsbacka', 'Laholm', 'Varberg'],
  'Västra Götalands län': [
    'Ale', 'Alingsås', 'Bengtsfors', 'Bollebygd', 'Borås', 'Dals-Ed', 'Essunga', 'Falköping',
    'Färgelanda', 'Grästorp', 'Gullspång', 'Göteborg', 'Götene', 'Herrljunga', 'Hjo', 'Härryda',
    'Karlsborg', 'Kungälv', 'Lerum', 'Lidköping', 'Lilla Edet', 'Lysekil', 'Mariestad', 'Mark',
    'Mellerud', 'Munkedal', 'Mölndal', 'Orust', 'Partille', 'Skara', 'Skövde', 'Sotenäs',
    'Stenungsund', 'Strömstad', 'Svenljunga', 'Tanum', 'Tibro', 'Tidaholm', 'Tjörn', 'Tranemo',
    'Trollhättan', 'Töreboda', 'Uddevalla', 'Ulricehamn', 'Vara', 'Vårgårda', 'Vänersborg', 'Åmål',
    'Öckerö',
  ],
  'Värmlands län': [
    'Arvika', 'Eda', 'Filipstad', 'Forshaga', 'Grums', 'Hagfors', 'Hammarö', 'Karlstad', 'Kil',
    'Kristinehamn', 'Munkfors', 'Storfors', 'Sunne', 'Säffle', 'Torsby', 'Årjäng',
  ],
  'Örebro län': [
    'Askersund', 'Degerfors', 'Hallsberg', 'Hällefors', 'Karlskoga', 'Kumla', 'Laxå', 'Lekeberg',
    'Lindesberg', 'Ljusnarsberg', 'Nora', 'Örebro',
  ],
  'Västmanlands län': [
    'Arboga', 'Fagersta', 'Hallstahammar', 'Kungsör', 'Köping', 'Norberg', 'Sala',
    'Skinnskatteberg', 'Surahammar', 'Västerås',
  ],
  'Dalarnas län': [
    'Avesta', 'Borlänge', 'Falun', 'Gagnef', 'Hedemora', 'Leksand', 'Ludvika', 'Malung-Sälen',
    'Mora', 'Orsa', 'Rättvik', 'Smedjebacken', 'Säter', 'Vansbro', 'Älvdalen',
  ],
  'Gävleborgs län': [
    'Bollnäs', 'Gävle', 'Hofors', 'Hudiksvall', 'Ljusdal', 'Nordanstig', 'Ockelbo', 'Ovanåker',
    'Sandviken', 'Söderhamn',
  ],
  'Västernorrlands län': [
    'Härnösand', 'Kramfors', 'Sollefteå', 'Sundsvall', 'Timrå', 'Ånge', 'Örnsköldsvik',
  ],
  'Jämtlands län': [
    'Berg', 'Bräcke', 'Härjedalen', 'Krokom', 'Ragunda', 'Strömsund', 'Åre', 'Östersund',
  ],
  'Västerbottens län': [
    'Bjurholm', 'Dorotea', 'Lycksele', 'Malå', 'Nordmaling', 'Norsjö', 'Robertsfors', 'Skellefteå',
    'Sorsele', 'Storuman', 'Umeå', 'Vilhelmina', 'Vindeln', 'Vännäs', 'Åsele',
  ],
  'Norrbottens län': [
    'Arjeplog', 'Arvidsjaur', 'Boden', 'Gällivare', 'Haparanda', 'Jokkmokk', 'Kalix', 'Kiruna',
    'Luleå', 'Pajala', 'Piteå', 'Älvsbyn', 'Överkalix', 'Övertorneå',
  ],
};

/** Lowercased and single-spaced: the shape every lookup below compares on. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

const BY_MUNICIPALITY = new Map<string, County>();
for (const county of COUNTIES) {
  BY_MUNICIPALITY.set(normalise(county), county);
  for (const municipality of MUNICIPALITIES[county]) {
    BY_MUNICIPALITY.set(normalise(municipality), county);
  }
}

/**
 * Spellings the feed uses that are not the administrative name.
 *
 * Short list on purpose. Every entry is a name seen in the data rather than one
 * imagined: guessing at aliases is how a place ends up counted in the wrong
 * county, which is worse than not counting it at all.
 */
const ALIASES: Record<string, County> = {
  'skåne': 'Skåne län',
  'stockholm län': 'Stockholms län',
  'västra götaland': 'Västra Götalands län',
  'gotland': 'Gotlands län',
  'halland': 'Hallands län',
  'blekinge': 'Blekinge län',
  'dalarna': 'Dalarnas län',
  'jämtland': 'Jämtlands län',
  'värmland': 'Värmlands län',
  'gävleborg': 'Gävleborgs län',
  'norrbotten': 'Norrbottens län',
  'västerbotten': 'Västerbottens län',
  'västernorrland': 'Västernorrlands län',
  'västmanland': 'Västmanlands län',
  'södermanland': 'Södermanlands län',
  'östergötland': 'Östergötlands län',
  'jönköping län': 'Jönköpings län',
  'kronoberg': 'Kronobergs län',
  'göteborgs stad': 'Västra Götalands län',
  'stockholms stad': 'Stockholms län',
  'malmö stad': 'Skåne län',
};

/**
 * The county a place name belongs to, or null when it is not a place.
 *
 * Null is a real answer here and not a failure: the feed carries "Nationellt"
 * and empty locations, and a notice filed against the whole country did not
 * happen in any county.
 */
/**
 * County and place, with a place that is really a county folded into the one
 * filter that handles counties properly.
 *
 * Applied wherever filters are parsed, so every route in reaches the same
 * state: the two dropdowns, a row on the statistics page, and a link shared
 * before the county filter existed, when `?plats=Skåne län` was the only way to
 * ask for a county at all.
 *
 * Widening rather than narrowing is the point. A place filter matches the
 * string an officer typed, so `?plats=Skåne län` returns the notices labelled
 * with the county and silently drops the ones labelled "Malmö", which are in it.
 * The county column resolves both, so the answer stops depending on how the
 * notice happened to be written.
 */
export function resolveRegionFilters(
  county: string | null | undefined,
  location: string | null | undefined
): { county: string; location: string } {
  if (isCountyName(location)) {
    // An explicit county wins; the place was only ever standing in for one.
    return { county: countyOf(county) ?? countyOf(location) ?? '', location: '' };
  }
  return { county: countyOf(county) ?? '', location: location ?? '' };
}

/**
 * Whether a name is a county rather than somewhere inside one.
 *
 * `countyOf` deliberately answers for both: "Malmö" resolves to Skåne län,
 * which is what places a pin and fills the breakdown. This asks the narrower
 * question, and the difference matters wherever a county and a place are two
 * separate filters. The feed labels a great many notices with the county alone,
 * so "Blekinge län" is a value in the place column as well as a county, and
 * without this the two controls can both be set to it: the chips read
 * "Län: Blekinge län" beside "Plats: Blekinge län", and what comes back is the
 * intersection, meaning only the notices where an officer typed the county
 * rather than every notice in it.
 *
 * The suffix test is the same one the feed's own title parsing uses, so the app
 * has one idea of what a county name looks like. Paired with `countyOf` so a
 * hand-typed "Mordor län" is not mistaken for an administrative area.
 */
export function isCountyName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\slän$/i.test(name.trim()) && countyOf(name) !== null;
}

export function countyOf(name: string | null | undefined): County | null {
  if (!name) return null;
  const key = normalise(name);
  if (!key) return null;

  return BY_MUNICIPALITY.get(key) ?? ALIASES[key] ?? null;
}
