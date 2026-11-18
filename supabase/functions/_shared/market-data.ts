type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function getPrices(
  symbols: string[],
  apiKey: string
): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};

  const requests = Object.fromEntries(symbols.map((symbol, index) => [
    `quote_${index}`,
    {
      url: `/quote?symbol=${encodeURIComponent(symbol)}&type=Common%20Stock&apikey=${encodeURIComponent(apiKey)}`
    }
  ]));
  const response = await fetch('https://api.twelvedata.com/batch', {
    method: 'POST',
    headers: {
      'Authorization': `apikey ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requests)
  });
  const payload: unknown = await response.json();
  const responseCode = isRecord(payload) ? Number(payload.code) : NaN;

  if (!response.ok || (isRecord(payload) && payload.status === 'error')) {
    if (response.status === 429 || responseCode === 429) {
      throw new Error('Market data rate limit reached. Try again later.');
    }
    throw new Error('The market data provider could not return these symbols.');
  }

  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error('The market data provider returned an invalid response.');
  }

  const prices: Record<string, number> = {};
  for (const [index, requestedSymbol] of symbols.entries()) {
    const result = payload.data[`quote_${index}`];
    if (!isRecord(result) || result.status !== 'success' || !isRecord(result.response)) {
      continue;
    }

    const quote = result.response;
    const symbol = requestedSymbol.toUpperCase();
    if (String(quote.currency).toUpperCase() !== 'USD') {
      throw new Error(`Only USD-denominated common stocks are supported: ${symbol}.`);
    }

    const price = Number(quote.close);
    if (Number.isFinite(price) && price > 0) prices[symbol] = price;
  }

  const missingSymbols = symbols.filter((symbol) => prices[symbol.toUpperCase()] === undefined);
  if (missingSymbols.length > 0) {
    throw new Error(`No valid quote was returned for: ${missingSymbols.join(', ')}.`);
  }

  return prices;
}
