// Mirrors shared/forecast.py's constants exactly -- these are the values a
// dropdown/toggle is allowed to send the API, not independently chosen.
export const HORIZONS = [2, 3, 4, 5, 6, 10, 12, 18];
export const CURRENCIES = ['AED', 'USD', 'EUR'];
export const RATES = { AED: 1, USD: 1 / 3.7, EUR: 1 / 4.4 };

export const ALLOWED_CHANNEL_WEIGHTS = {
  Showroom: [1.0, 1.2],
  Distribution: [0, 0.5, 1.0, 1.5],
  Ecommerce: [0, 0.5, 1.0, 1.5],
};
export const DEFAULT_CHANNEL_WEIGHTS = { Showroom: 1.0, Distribution: 1.0, Ecommerce: 1.0 };

export const COUNTRIES = [
  { key: 'UAE', label: 'UAE', dot: 'uae' },
  { key: 'QAT', label: 'QAT', dot: 'qat' },
  { key: 'KSA', label: 'KSA', dot: 'ksa' },
];
