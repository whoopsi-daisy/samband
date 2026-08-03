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
export function countyOf(name: string | null | undefined): County | null {
  if (!name) return null;
  const key = normalise(name);
  if (!key) return null;

  return BY_MUNICIPALITY.get(key) ?? ALIASES[key] ?? null;
}
