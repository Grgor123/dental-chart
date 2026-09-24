// Platform defaults + metadata for every email template. Pure data — NO Deno
// APIs and no imports — because it's shared by both sides: the Edge
// Functions render from it, and the El. pošta editor
// (src/pages/EmailTemplates.tsx) imports this same file directly for labels,
// default wording, allowed placeholders and timing fields, so there's exactly
// one source of truth and nothing to keep in sync.
//
// A practice's edits live in the `email_templates` table
// (supabase/migrations/019_add_email_templates.sql) and only ever OVERRIDE
// these defaults — no row, or a null column, means "use the default".

export const TEMPLATE_KEYS = [
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const PLACEHOLDER_KEYS = ['ime', 'priimek', 'datum', 'ura', 'storitev', 'terapevt', 'ordinacija'] as const;
export type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number];
export type TemplateVars = Record<PlaceholderKey, string>;

export const PLACEHOLDER_LABELS: Record<PlaceholderKey, string> = {
  ime: 'Ime pacienta',
  priimek: 'Priimek pacienta',
  datum: 'Datum termina',
  ura: 'Ura termina',
  storitev: 'Predvidena storitev',
  terapevt: 'Terapevt',
  ordinacija: 'Ime ordinacije',
};

/** Shown in the editor preview / test send. */
export const SAMPLE_VARS: TemplateVars = {
  ime: 'Ana',
  priimek: 'Novak',
  datum: '15. oktober 2026',
  ura: '10:30',
  storitev: 'Kontrolni pregled',
  terapevt: 'Monika Goslar',
  ordinacija: 'Vaša ordinacija',
};

/** What the timing number means for a template — also the unit its
    `timing_value` column is stored in. */
export type TimingUnit = 'days_before' | 'hours_after' | 'months_after';

export interface TimingSpec {
  unit: TimingUnit;
  default: number;
  min: number;
  max: number;
}

export interface TemplateDef {
  key: TemplateKey;
  /** Editor list label (Slovene). */
  label: string;
  /** One line under the label in the editor. */
  description: string;
  defaultSubject: string;
  defaultHeading: string;
  defaultBody: string;
  placeholders: readonly PlaceholderKey[];
  /** Whether the email carries a calendar attachment, and which kind. */
  ics: 'request' | 'cancel' | null;
  /** Null = sent immediately on an event, nothing for the practice to set. */
  timing: TimingSpec | null;
  /** Europe/Ljubljana hour this type sends at, or null if it isn't a
      time-of-day send. */
  sendHourDefault: number | null;
}

const APPOINTMENT_PLACEHOLDERS = PLACEHOLDER_KEYS;

export const TEMPLATE_DEFS: Record<TemplateKey, TemplateDef> = {
  appointment_confirmation: {
    key: 'appointment_confirmation',
    label: 'Potrditev termina',
    description: 'Takoj, ko je termin ustvarjen.',
    defaultSubject: 'Termin potrjen — {datum} ob {ura}',
    defaultHeading: 'Termin je potrjen',
    defaultBody:
      'Pozdravljeni {ime},\n\nvaš termin pri {ordinacija} je naročen za:\n\n**{datum} ob {ura}**\n\nStoritev: {storitev}\n\nV priponki je vabilo za vaš koledar (.ics).',
    placeholders: APPOINTMENT_PLACEHOLDERS,
    ics: 'request',
    timing: null,
    sendHourDefault: null,
  },
  appointment_reminder: {
    key: 'appointment_reminder',
    label: 'Opomnik na termin',
    description: 'Nekaj dni pred terminom.',
    defaultSubject: 'Opomnik na termin — {datum} ob {ura}',
    defaultHeading: 'Opomnik na termin',
    defaultBody: 'Pozdravljeni {ime},\n\nspomnimo vas na vaš termin pri {ordinacija}:\n\n**{datum} ob {ura}**\n\nStoritev: {storitev}',
    placeholders: APPOINTMENT_PLACEHOLDERS,
    ics: null,
    timing: { unit: 'days_before', default: 2, min: 1, max: 14 },
    sendHourDefault: 9,
  },
  appointment_cancelled: {
    key: 'appointment_cancelled',
    label: 'Odpoved termina',
    description: 'Takoj, ko je termin odpovedan.',
    defaultSubject: 'Termin odpovedan — {datum} ob {ura}',
    defaultHeading: 'Termin je odpovedan',
    defaultBody:
      'Pozdravljeni {ime},\n\nvaš termin pri {ordinacija} ({datum} ob {ura}) je odpovedan.\n\nČe želite nov termin, nas prosimo kontaktirajte.',
    placeholders: APPOINTMENT_PLACEHOLDERS,
    ics: 'cancel',
    timing: null,
    sendHourDefault: null,
  },
  appointment_rescheduled: {
    key: 'appointment_rescheduled',
    label: 'Sprememba termina',
    description: 'Takoj, ko je termin prestavljen na drug čas.',
    defaultSubject: 'Termin prestavljen — {datum} ob {ura}',
    defaultHeading: 'Termin je prestavljen',
    defaultBody:
      'Pozdravljeni {ime},\n\nvaš termin pri {ordinacija} je prestavljen na:\n\n**{datum} ob {ura}**\n\nStoritev: {storitev}\n\nV priponki je posodobljeno vabilo za vaš koledar (.ics).',
    placeholders: APPOINTMENT_PLACEHOLDERS,
    ics: 'request',
    timing: null,
    sendHourDefault: null,
  },
  post_visit: {
    key: 'post_visit',
    label: 'Zahvala po obisku',
    description: 'Po koncu opravljenega termina.',
    defaultSubject: 'Hvala za obisk — {ordinacija}',
    defaultHeading: 'Hvala za obisk',
    defaultBody:
      'Pozdravljeni {ime},\n\nhvala, ker ste nas obiskali. Če imate po posegu kakršnakoli vprašanja ali težave, nas kontaktirajte.\n\nLep pozdrav,\n{ordinacija}',
    placeholders: APPOINTMENT_PLACEHOLDERS,
    ics: null,
    timing: { unit: 'hours_after', default: 1, min: 0, max: 24 },
    sendHourDefault: null,
  },
  recall: {
    key: 'recall',
    label: 'Vabilo na kontrolni pregled',
    description: 'Nekaj mesecev po zadnjem obisku, če pacient nima novega termina.',
    defaultSubject: 'Čas je za kontrolni pregled — {ordinacija}',
    defaultHeading: 'Čas je za kontrolni pregled',
    defaultBody:
      'Pozdravljeni {ime},\n\nod vašega zadnjega obiska pri {ordinacija} je minilo že nekaj časa (zadnji obisk: {datum}). Priporočamo redne kontrolne preglede, zato vas vabimo, da se naročite na nov termin.\n\nLep pozdrav,\n{ordinacija}',
    // {datum} is the date of the LAST visit here; there's no meaningful
    // upcoming time, service or therapist for a recall.
    placeholders: ['ime', 'priimek', 'datum', 'ordinacija'],
    ics: null,
    timing: { unit: 'months_after', default: 6, min: 1, max: 36 },
    sendHourDefault: 10,
  },
};

/** Row shape of `email_templates` — a practice's overrides. */
export interface TemplateOverride {
  subject: string | null;
  heading: string | null;
  body: string | null;
  enabled: boolean;
  timing_value: number | null;
  send_hour: number | null;
}

export interface EffectiveTemplateSettings {
  enabled: boolean;
  timingValue: number | null;
  sendHour: number | null;
}

/** Override-or-default for the fields the crons and send helper gate on. */
export function effectiveSettings(key: TemplateKey, override: TemplateOverride | null): EffectiveTemplateSettings {
  const def = TEMPLATE_DEFS[key];
  return {
    enabled: override?.enabled ?? true,
    timingValue: def.timing ? (override?.timing_value ?? def.timing.default) : null,
    sendHour: def.sendHourDefault !== null ? (override?.send_hour ?? def.sendHourDefault) : null,
  };
}
