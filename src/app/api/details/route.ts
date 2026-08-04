import { NextRequest, NextResponse } from 'next/server';
import { fetchDetailsText } from '@/lib/policeApi';
import { getBpkEventText } from '@/lib/brottsplatskartanDb';
import { getEventDetailText, saveEventDetailText } from '@/lib/db';
import { sanitizeInput } from '@/lib/utils';
import { checkRateLimit, rateLimitResponse, addRateLimitHeaders } from '@/lib/rateLimit';
import { logger } from '@/lib/log';

const log = logger('api:details');

export async function GET(request: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(request);
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult);
  }

  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');
  const id = Number(searchParams.get('id'));

  // Imported events carry their own text, and the polisen.se page they came
  // from is usually long gone: the archive reaches back to 2016. Answer from
  // the database and never touch the network.
  if (Number.isInteger(id) && id < 0) {
    const stored = getBpkEventText(id);
    const response = NextResponse.json({
      success: stored !== null,
      details: { content: stored },
    });
    return addRateLimitHeaders(response, rateLimitResult);
  }

  if (!url) {
    return NextResponse.json(
      { success: false, error: 'URL parameter required' },
      { status: 400 }
    );
  }

  /*
   * A live notice we have already read.
   *
   * This route used to scrape polisen.se on every single expansion: two people
   * opening the same incident meant two scrapes, and so did one person opening
   * it twice. The imported half of the dataset has always answered the same
   * question straight out of the database, a few lines above; this is the live
   * half catching up.
   *
   * The write path clears the stored text whenever the notice itself changes,
   * so a correction is never served out of a copy taken before it.
   */
  const liveId = Number.isInteger(id) && id > 0 ? id : null;
  if (liveId !== null) {
    const stored = getEventDetailText(liveId);
    if (stored) {
      const response = NextResponse.json({ success: true, details: { content: stored } });
      return addRateLimitHeaders(response, rateLimitResult);
    }
  }

  const sanitizedUrl = sanitizeInput(url, 500);

  try {
    const details = await fetchDetailsText(sanitizedUrl);

    // Only a real answer is kept. A scrape that came back empty is a page whose
    // layout we misread or a fetch that failed, and remembering that as "this
    // notice has no text" would make one bad minute permanent.
    if (liveId !== null && details) {
      saveEventDetailText(liveId, details);
    }

    const response = NextResponse.json({
      success: !!details,
      details: { content: details },
    });
    return addRateLimitHeaders(response, rateLimitResult);
  } catch (error) {
    log.error('could not fetch the notice text', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch details' },
      { status: 500 }
    );
  }
}
