// Curated Supra Oracle feed catalog organized by category
// oracle_pair is what the Supra kline API expects (lowercase with underscore)

export interface OracleFeed {
  token: string;        // Display name
  oraclePair: string;   // Supra API pair name
  category: string;
}

export const FEED_CATEGORIES = ["Crypto", "Forex", "Equities", "Commodities"] as const;
export type FeedCategory = typeof FEED_CATEGORIES[number];

export const ORACLE_FEEDS: OracleFeed[] = [
  // === CRYPTO ===
  { token: "BTC", oraclePair: "btc_usdt", category: "Crypto" },
  { token: "ETH", oraclePair: "eth_usdt", category: "Crypto" },
  { token: "SUPRA", oraclePair: "supra_usdt", category: "Crypto" },
  { token: "SOL", oraclePair: "sol_usdt", category: "Crypto" },
  { token: "AAVE", oraclePair: "aave_usdt", category: "Crypto" },
  { token: "LINK", oraclePair: "link_usdt", category: "Crypto" },
  { token: "UNI", oraclePair: "uni_usdt", category: "Crypto" },
  { token: "AVAX", oraclePair: "avax_usdt", category: "Crypto" },
  { token: "DOT", oraclePair: "dot_usdt", category: "Crypto" },
  { token: "ADA", oraclePair: "ada_usdt", category: "Crypto" },
  { token: "DOGE", oraclePair: "doge_usdt", category: "Crypto" },
  { token: "XRP", oraclePair: "xrp_usdt", category: "Crypto" },
  { token: "ATOM", oraclePair: "atom_usdt", category: "Crypto" },
  { token: "LTC", oraclePair: "ltc_usdt", category: "Crypto" },
  { token: "BNB", oraclePair: "bnb_usdt", category: "Crypto" },
  { token: "FTM", oraclePair: "ftm_usdt", category: "Crypto" },
  { token: "CRV", oraclePair: "crv_usdt", category: "Crypto" },
  { token: "COMP", oraclePair: "comp_usdt", category: "Crypto" },
  { token: "SNX", oraclePair: "snx_usdt", category: "Crypto" },
  { token: "RUNE", oraclePair: "rune_usdt", category: "Crypto" },
  { token: "FIL", oraclePair: "fil_usdt", category: "Crypto" },
  { token: "TRX", oraclePair: "trx_usdt", category: "Crypto" },
  { token: "USDC", oraclePair: "usdc_usdt", category: "Crypto" },
  { token: "USDT", oraclePair: "usdt_usd", category: "Crypto" },
  { token: "DAI", oraclePair: "dai_usdt", category: "Crypto" },

  // === FOREX ===
  { token: "EUR/USD", oraclePair: "eur_usd", category: "Forex" },
  { token: "GBP/USD", oraclePair: "gbp_usd", category: "Forex" },
  { token: "USD/JPY", oraclePair: "usd_jpy", category: "Forex" },
  { token: "AUD/USD", oraclePair: "aud_usd", category: "Forex" },
  { token: "USD/CAD", oraclePair: "usd_cad", category: "Forex" },
  { token: "USD/CHF", oraclePair: "usd_chf", category: "Forex" },
  { token: "NZD/USD", oraclePair: "nzd_usd", category: "Forex" },
  { token: "EUR/GBP", oraclePair: "eur_gbp", category: "Forex" },
  { token: "EUR/JPY", oraclePair: "eur_jpy", category: "Forex" },
  { token: "GBP/JPY", oraclePair: "gbp_jpy", category: "Forex" },

  // === EQUITIES ===
  { token: "AAPL", oraclePair: "aapl_usd", category: "Equities" },
  { token: "MSFT", oraclePair: "msft_usd", category: "Equities" },
  { token: "GOOGL", oraclePair: "googl_usd", category: "Equities" },
  { token: "AMZN", oraclePair: "amzn_usd", category: "Equities" },
  { token: "TSLA", oraclePair: "tsla_usd", category: "Equities" },
  { token: "NVDA", oraclePair: "nvda_usd", category: "Equities" },
  { token: "META", oraclePair: "meta_usd", category: "Equities" },
  { token: "NFLX", oraclePair: "nflx_usd", category: "Equities" },
  { token: "AMD", oraclePair: "amd_usd", category: "Equities" },
  { token: "COIN", oraclePair: "coin_usd", category: "Equities" },
  { token: "SPY", oraclePair: "spy_usd", category: "Equities" },
  { token: "QQQ", oraclePair: "qqq_usd", category: "Equities" },

  // === COMMODITIES ===
  { token: "XAU/USD", oraclePair: "xau_usd", category: "Commodities" },
  { token: "XAG/USD", oraclePair: "xag_usd", category: "Commodities" },
  { token: "WTI", oraclePair: "wti_usd", category: "Commodities" },
  { token: "BRENT", oraclePair: "brent_usd", category: "Commodities" },
  { token: "NG", oraclePair: "ng_usd", category: "Commodities" },
  { token: "COPPER", oraclePair: "copper_usd", category: "Commodities" },
];

// Default ticker feeds (shown before customization)
export const DEFAULT_TICKER_FEEDS = ["ETH", "SUPRA", "AAVE", "LINK", "USDC", "USDT"];

// Lookup: token -> oraclePair
export function getOraclePair(token: string): string | null {
  const feed = ORACLE_FEEDS.find(f => f.token === token);
  return feed?.oraclePair || null;
}
