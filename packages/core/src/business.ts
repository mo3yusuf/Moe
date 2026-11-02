/**
 * Australian Business Number validation (ATO checksum algorithm): subtract 1 from the first digit,
 * multiply each digit by its weight, and the sum must be divisible by 89.
 * A valid checksum does not prove the business exists — verification must also check the ABN Lookup
 * register (abr.business.gov.au) and match the legal name. That check is done by an administrator.
 */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function normaliseAbn(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export function isValidAbn(input: string): boolean {
  const abn = normaliseAbn(input);
  if (!/^\d{11}$/.test(abn)) return false;
  const digits = abn.split('').map(Number);
  digits[0] = digits[0]! - 1;
  const sum = digits.reduce((acc, d, i) => acc + d * ABN_WEIGHTS[i]!, 0);
  return sum % 89 === 0;
}

export function formatAbn(input: string): string {
  const a = normaliseAbn(input);
  return a.length === 11 ? `${a.slice(0, 2)} ${a.slice(2, 5)} ${a.slice(5, 8)} ${a.slice(8)}` : input;
}

export function slugify(name: string): string {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'restaurant';
}

export const AU_STATES = ['QLD', 'NSW', 'VIC', 'TAS', 'SA', 'WA', 'NT', 'ACT'] as const;
export const isValidAuPostcode = (p: string) => /^\d{4}$/.test(p.trim());

/** Basic AU phone check: landline (0X XXXX XXXX) or mobile (04XX XXX XXX), +61 allowed. */
export function isValidAuPhone(input: string): boolean {
  const d = input.replace(/[\s()-]/g, '').replace(/^\+61/, '0');
  return /^0[2-478]\d{8}$/.test(d);
}

/**
 * Approximate centroids for Brisbane suburbs, used to place a restaurant before a geocoding
 * provider is integrated. Accurate enough for "near me" ranking (~1–2 km), NOT for delivery.
 */
export const BRISBANE_SUBURBS: Record<string, { postcode: string; lat: number; lng: number }> = {
  'Brisbane City': { postcode: '4000', lat: -27.4698, lng: 153.0251 },
  'Spring Hill': { postcode: '4000', lat: -27.4609, lng: 153.0230 },
  'Fortitude Valley': { postcode: '4006', lat: -27.4575, lng: 153.0355 },
  'Newstead': { postcode: '4006', lat: -27.4446, lng: 153.0450 },
  'New Farm': { postcode: '4005', lat: -27.4670, lng: 153.0450 },
  'Teneriffe': { postcode: '4005', lat: -27.4560, lng: 153.0480 },
  'South Brisbane': { postcode: '4101', lat: -27.4778, lng: 153.0174 },
  'West End': { postcode: '4101', lat: -27.4820, lng: 153.0090 },
  'Woolloongabba': { postcode: '4102', lat: -27.4880, lng: 153.0360 },
  'Kangaroo Point': { postcode: '4169', lat: -27.4766, lng: 153.0360 },
  'East Brisbane': { postcode: '4169', lat: -27.4840, lng: 153.0470 },
  'Paddington': { postcode: '4064', lat: -27.4600, lng: 153.0050 },
  'Milton': { postcode: '4064', lat: -27.4700, lng: 153.0030 },
  'Red Hill': { postcode: '4059', lat: -27.4560, lng: 153.0040 },
  'Kelvin Grove': { postcode: '4059', lat: -27.4480, lng: 153.0130 },
  'Herston': { postcode: '4006', lat: -27.4470, lng: 153.0220 },
  'Bowen Hills': { postcode: '4006', lat: -27.4440, lng: 153.0370 },
  'Albion': { postcode: '4010', lat: -27.4310, lng: 153.0430 },
  'Ascot': { postcode: '4007', lat: -27.4310, lng: 153.0630 },
  'Hamilton': { postcode: '4007', lat: -27.4370, lng: 153.0670 },
  'Bulimba': { postcode: '4171', lat: -27.4520, lng: 153.0590 },
  'Hawthorne': { postcode: '4171', lat: -27.4640, lng: 153.0600 },
  'Coorparoo': { postcode: '4151', lat: -27.4950, lng: 153.0580 },
  'Greenslopes': { postcode: '4120', lat: -27.5080, lng: 153.0500 },
  'Annerley': { postcode: '4103', lat: -27.5120, lng: 153.0330 },
  'Highgate Hill': { postcode: '4101', lat: -27.4890, lng: 153.0180 },
  'St Lucia': { postcode: '4067', lat: -27.4980, lng: 153.0000 },
  'Toowong': { postcode: '4066', lat: -27.4850, lng: 152.9920 },
  'Indooroopilly': { postcode: '4068', lat: -27.4990, lng: 152.9730 },
  'Chermside': { postcode: '4032', lat: -27.3850, lng: 153.0310 },
  'Nundah': { postcode: '4012', lat: -27.4010, lng: 153.0590 },
  'Windsor': { postcode: '4030', lat: -27.4330, lng: 153.0280 },
  'Lutwyche': { postcode: '4030', lat: -27.4220, lng: 153.0330 },
  'Stones Corner': { postcode: '4120', lat: -27.4980, lng: 153.0440 },
  'Sunnybank': { postcode: '4109', lat: -27.5800, lng: 153.0600 },
  'Sunnybank Hills': { postcode: '4109', lat: -27.5960, lng: 153.0530 },
  'Mount Gravatt': { postcode: '4122', lat: -27.5390, lng: 153.0800 },
  'Carindale': { postcode: '4152', lat: -27.5030, lng: 153.1010 },
  'Inala': { postcode: '4077', lat: -27.5900, lng: 152.9750 },
  'Moorooka': { postcode: '4105', lat: -27.5350, lng: 153.0230 },
};
