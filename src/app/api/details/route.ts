import { NextRequest, NextResponse } from 'next/server';
import { fetchDetailsText } from '@/lib/policeApi';
import { getBpkEventText } from '@/lib/brottsplatskartanDb';
import { sanitizeInput } from '@/lib/utils';
import { checkRateLimit, rateLimitResponse, addRateLimitHeaders } from '@/lib/rateLimit';

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

  const sanitizedUrl = sanitizeInput(url, 500);

  try {
    const details = await fetchDetailsText(sanitizedUrl);

    const response = NextResponse.json({
      success: !!details,
      details: { content: details },
    });
    return addRateLimitHeaders(response, rateLimitResult);
  } catch (error) {
    console.error('Error fetching details:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch details' },
      { status: 500 }
    );
  }
}
