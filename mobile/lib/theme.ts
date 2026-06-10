// Momni 2.0 — Heritage Refresh design tokens (approved by Karmel 2026-06-10)
// Sacred: original elephant logo only; clay is reserved for legacy 1.0 map dots.
export const colors = {
  purple: '#6D58A4',
  purpleDeep: '#4A3880',
  teal: '#0D878F',
  tealDeep: '#0A6B72',
  tealSoft: '#E1F7F2',
  algae: '#92E2C1',       // CTAs
  lavender: '#F5F0FE',    // surfaces
  clay: '#D9C0A3',        // legacy 1.0 map dots ONLY
  ink: '#2B2233',
  muted: '#6B6477',
  white: '#FFFFFF',
  danger: '#C94B4B',
};

// Fonts loaded in app/_layout.tsx via @expo-google-fonts
export const fonts = {
  display: 'Montserrat_700Bold',
  displayHeavy: 'Montserrat_800ExtraBold',
  body: 'AlbertSans_400Regular',
  bodyMedium: 'AlbertSans_500Medium',
  bodySemi: 'AlbertSans_600SemiBold',
  script: 'Caveat_600SemiBold', // warm accents only
};

export const radii = { card: 18, pill: 100, input: 10 };

// The exact clickwrap texts. NEVER paraphrase in UI — these are the legal record.
export const SIGNUP_ACKNOWLEDGMENT =
  'I understand Momni is a community platform, not a childcare provider. Momni does not screen or vet any member. I am responsible for my own decisions about care, just as I would be when choosing a trusted friend in my neighborhood.';

export const CONNECTION_ACKNOWLEDGMENT =
  'I understand Momni is a community platform, not a childcare provider. Momni does not vet, screen, or endorse any member. I am solely responsible for choosing and evaluating my children’s care, just as I would when choosing a trusted friend. Care payments are between me and my Momni.';

export const PAYMENT_LINE =
  'Pay your Momni directly — Venmo, cash, her choice. She keeps every penny.';
