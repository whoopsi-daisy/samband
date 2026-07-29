import { QUERY, parseView, readParam, toSwedishParams, viewSlug } from '@/lib/urlParams';

const from = (query: string) => {
  const params = new URLSearchParams(query);
  return (name: string) => params.get(name);
};

describe('urlParams', () => {
  // The URL is part of the interface: people read it in the address bar and
  // every shared link carries it into a chat.
  it('addresses the views in Swedish', () => {
    expect(viewSlug('list')).toBe('lista');
    expect(viewSlug('map')).toBe('karta');
    expect(viewSlug('stats')).toBe('statistik');
  });

  it('reads the Swedish names', () => {
    const get = from('vy=karta&plats=Bor%C3%A5s&typ=R%C3%A5n&sok=f%C3%B6nster&handelse=42');

    expect(parseView(readParam(get, 'view'))).toBe('map');
    expect(readParam(get, 'location')).toBe('Borås');
    expect(readParam(get, 'type')).toBe('Rån');
    expect(readParam(get, 'search')).toBe('fönster');
    expect(readParam(get, 'event')).toBe('42');
  });

  // Links shared before the rename have to keep working.
  it('still reads the English names a shared link may carry', () => {
    const get = from('view=map&location=Bor%C3%A5s&type=R%C3%A5n&search=f%C3%B6nster&event=42');

    expect(parseView(readParam(get, 'view'))).toBe('map');
    expect(readParam(get, 'location')).toBe('Borås');
    expect(readParam(get, 'type')).toBe('Rån');
    expect(readParam(get, 'search')).toBe('fönster');
    expect(readParam(get, 'event')).toBe('42');
  });

  it('falls back to the feed for a view it does not recognise', () => {
    expect(parseView('sprakvy')).toBe('list');
    expect(parseView('')).toBe('list');
    expect(parseView(undefined)).toBe('list');
  });

  // An old link upgrades itself the first time the reader touches a filter,
  // rather than the app writing a URL that mixes the two languages.
  it('rewrites an old query into the new one', () => {
    const params = toSwedishParams(new URLSearchParams('view=map&location=Borås&type=Rån'));

    expect(params.toString()).not.toContain('view=');
    expect(params.get(QUERY.view)).toBe('karta');
    expect(params.get(QUERY.location)).toBe('Borås');
    expect(params.get(QUERY.type)).toBe('Rån');
  });

  it('keeps the Swedish value when a URL somehow carries both', () => {
    const params = toSwedishParams(new URLSearchParams('plats=Kiruna&location=Borås'));

    expect(params.get(QUERY.location)).toBe('Kiruna');
    expect(params.get('location')).toBeNull();
  });

  it('leaves a query that is already Swedish alone', () => {
    const params = toSwedishParams(new URLSearchParams('vy=karta&plats=Borås'));
    expect(params.toString()).toBe(new URLSearchParams('vy=karta&plats=Borås').toString());
  });
});
